import { Router, raw } from "express";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";
import {
  MEDIA_STREAM_DEFAULT_PROTOCOL,
  RTMP_PLAYBACK_BASE_URL,
  RTMP_PUBLISH_BASE_URL,
  WEBRTC_ICE_SERVERS
} from "../config/env.js";
import { requireAuth } from "../middlewares/auth.js";
import { sendDbError } from "../utils/dbErrors.js";
import { sendError } from "../utils/http.js";
import { isInt } from "../utils/validators.js";
import {
  deleteOrphanStreamFiles,
  ensureStreamStorageDir,
  resolveStreamRecordingPath
} from "../utils/streamRecordings.js";

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const hlsRuntimeRoot = resolve(__dirname, "..", "..", "runtime", "ffmpeg-streams");
let streamingTablesReady = false;
const recordingContentTypes = new Set(["video/mp4", "video/webm", "audio/webm", "application/octet-stream"]);
const hlsStreamKeyPattern = /^[A-Za-z0-9._-]+$/;
const hlsDiscoveryMaxAgeMs = Number.isFinite(Number(process.env.HLS_DISCOVERY_MAX_AGE_MS))
  ? Number(process.env.HLS_DISCOVERY_MAX_AGE_MS)
  : 45000;

function isRecordingContentType(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const mediaType = contentType.split(";")[0].trim();
  return recordingContentTypes.has(mediaType);
}

function getFfmpegExecutable() {
  if (process.env.FFMPEG_PATH?.trim()) return process.env.FFMPEG_PATH.trim();
  if (process.platform === "win32") {
    return resolve(__dirname, "..", "..", "..", "tools", "ffmpeg", "ffmpeg.exe");
  }
  return "ffmpeg";
}

function convertRecordingToMp4(inputPath, outputPath) {
  return new Promise((resolveConversion, rejectConversion) => {
    const ffmpeg = spawn(getFfmpegExecutable(), [
      "-y",
      "-i", inputPath,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outputPath
    ], { windowsHide: true });
    let stderr = "";
    ffmpeg.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    ffmpeg.once("error", rejectConversion);
    ffmpeg.once("close", (code) => {
      if (code === 0) {
        resolveConversion();
      } else {
        rejectConversion(new Error(`FFmpeg termino con codigo ${code}: ${stderr}`));
      }
    });
  });
}

function normalizeKind(value) {
  const kind = String(value || "AUDIO_VIDEO").trim().toUpperCase().replace("-", "_");
  return ["AUDIO", "VIDEO", "AUDIO_VIDEO"].includes(kind) ? kind : null;
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  return ["ACTIVE", "STOPPED", "ERROR"].includes(status) ? status : null;
}

function normalizeProtocol(value) {
  const protocol = String(value || MEDIA_STREAM_DEFAULT_PROTOCOL).trim().toUpperCase();
  return ["WEBRTC", "RTMP", "HYBRID"].includes(protocol) ? protocol : null;
}

function normalizeSourceType(value, fallback = "ANDROID") {
  const sourceType = String(value || fallback).trim().toUpperCase().replace(/[\s-]+/g, "_");
  return /^[A-Z0-9_]{1,40}$/.test(sourceType) ? sourceType : fallback;
}

function optionalInt(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return isInt(number) ? number : NaN;
}

function truthy(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function parseOptionalDate(value) {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function joinStreamUrl(base, streamKey) {
  const cleanBase = String(base || "").trim().replace(/\/+$/, "");
  if (!cleanBase) return null;
  return `${cleanBase}/${streamKey}`;
}

function getRequestHostname(req) {
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || String(req.headers.host || "").trim();
  if (!host) return "";
  if (host.startsWith("[")) return host.replace(/\](:\d+)?$/, "]");
  return host.replace(/:\d+$/, "");
}

function getRtmpPublishBaseUrl(req) {
  const configured = process.env.RTMP_PUBLISH_BASE_URL?.trim();
  if (configured) return configured;
  const hostname = getRequestHostname(req);
  return hostname ? `rtmp://${hostname}/live` : RTMP_PUBLISH_BASE_URL;
}

function getRtmpPlaybackBaseUrl() {
  return process.env.RTMP_PLAYBACK_BASE_URL?.trim() || RTMP_PLAYBACK_BASE_URL;
}

function joinHlsUrl(base, streamKey) {
  const cleanBase = String(base || "").trim().replace(/\/+$/, "");
  if (!cleanBase) return null;
  return `${cleanBase}/${streamKey}/index.m3u8`;
}

function getRtmpPlaybackUrl(req, streamKey, playbackBaseUrl = null) {
  const template = process.env.RTMP_PLAYBACK_URL_TEMPLATE?.trim();
  if (template) {
    const hostname = getRequestHostname(req);
    return template
      .replaceAll("{streamKey}", streamKey)
      .replaceAll("{stream_key}", streamKey)
      .replaceAll("{host}", hostname);
  }
  if (playbackBaseUrl) return joinHlsUrl(playbackBaseUrl, streamKey);
  const configuredBase = getRtmpPlaybackBaseUrl();
  if (configuredBase) return joinHlsUrl(configuredBase, streamKey);
  return null;
}

function getRuntimeHlsPlaybackUrl(streamKey) {
  return `/runtime/ffmpeg-streams/${encodeURIComponent(streamKey)}/index.m3u8`;
}

function getDiscoveredHlsLabel(streamKey) {
  const normalized = String(streamKey || "").toLowerCase();
  if (normalized.startsWith("obs")) return "OBS";
  if (normalized.includes("dron") || normalized.includes("drone")) {
    const suffix = normalized.match(/\d+/)?.[0];
    return suffix ? `Dron ${suffix.padStart(2, "0")}` : "Dron";
  }
  return streamKey;
}

function getDiscoveredHlsSourceType(streamKey) {
  const normalized = String(streamKey || "").toLowerCase();
  return normalized.includes("dron") || normalized.includes("drone") ? "DRONE" : "EXTERNAL";
}

async function listFreshRuntimeHlsStreams() {
  const entries = await readdir(hlsRuntimeRoot, { withFileTypes: true }).catch((err) => {
    if (err?.code === "ENOENT") return [];
    throw err;
  });
  const now = Date.now();
  const maxAge = hlsDiscoveryMaxAgeMs > 0 ? hlsDiscoveryMaxAgeMs : 45000;
  const streams = [];

  await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory() || !hlsStreamKeyPattern.test(entry.name)) return;

    const playlistPath = resolve(hlsRuntimeRoot, entry.name, "index.m3u8");
    const playlistStat = await stat(playlistPath).catch(() => null);
    if (!playlistStat?.isFile()) return;
    if ((now - playlistStat.mtimeMs) > maxAge) return;

    streams.push({
      streamKey: entry.name,
      label: getDiscoveredHlsLabel(entry.name),
      sourceType: getDiscoveredHlsSourceType(entry.name),
      playbackUrl: getRuntimeHlsPlaybackUrl(entry.name),
    });
  }));

  return streams.sort((a, b) => a.streamKey.localeCompare(b.streamKey, "es"));
}

async function syncDiscoveredRuntimeHlsStreams(id_operacion, req) {
  const streams = await listFreshRuntimeHlsStreams();
  const actor = getActorColumns(req);

  for (const stream of streams) {
    const equipo = await resolveAssignedDroneEquipo(id_operacion, stream.streamKey, stream.label);
    const idEquipo = equipo?.id_equipo ? Number(equipo.id_equipo) : null;
    const label = equipo?.nombre || stream.label;
    const sourceType = equipo ? "DRONE" : stream.sourceType;
    const externalDeviceId = equipo?.numero_serie || stream.streamKey;
    const idPersonal = idEquipo ? null : actor.id_personal;

    await pool.query(
      `INSERT INTO media_stream_session (
         id_operacion, id_usuario, id_personal, id_equipo, kind, status, label, protocol,
         source_type, stream_key, rtmp_publish_url, rtmp_playback_url,
         playback_url, external_device_id, consent_ack, foreground_notice,
         created_by_tabla, created_by_id, started_at, last_seen_at
       )
       VALUES ($1,$2,$3,$4,'AUDIO_VIDEO','ACTIVE',$5,'RTMP',$6,$7,$8,NULL,$9,$10,
         TRUE,FALSE,$11,$12,NOW(),NOW())
       ON CONFLICT (stream_key) DO UPDATE SET
         id_operacion = EXCLUDED.id_operacion,
         id_usuario = EXCLUDED.id_usuario,
         id_personal = EXCLUDED.id_personal,
         id_equipo = EXCLUDED.id_equipo,
         kind = EXCLUDED.kind,
         status = 'ACTIVE',
         label = EXCLUDED.label,
         protocol = EXCLUDED.protocol,
         source_type = EXCLUDED.source_type,
         rtmp_publish_url = EXCLUDED.rtmp_publish_url,
         rtmp_playback_url = NULL,
         playback_url = EXCLUDED.playback_url,
         external_device_id = EXCLUDED.external_device_id,
         publisher_socket_id = NULL,
         viewer_count = 0,
         consent_ack = EXCLUDED.consent_ack,
         foreground_notice = EXCLUDED.foreground_notice,
         created_by_tabla = EXCLUDED.created_by_tabla,
         created_by_id = EXCLUDED.created_by_id,
         started_at = CASE
           WHEN media_stream_session.status = 'ACTIVE'
            AND media_stream_session.ended_at IS NULL
           THEN media_stream_session.started_at
           ELSE NOW()
         END,
         last_seen_at = NOW(),
         ended_at = NULL`,
      [
        id_operacion,
        actor.id_usuario,
        idPersonal,
        idEquipo,
        label,
        sourceType,
        stream.streamKey,
        joinStreamUrl(getRtmpPublishBaseUrl(req), stream.streamKey),
        stream.playbackUrl,
        externalDeviceId,
        actor.created_by_tabla,
        actor.created_by_id,
      ]
    );
  }

  await pool.query(
    `UPDATE media_stream_session
        SET status = 'STOPPED',
            ended_at = COALESCE(ended_at, NOW()),
            publisher_socket_id = NULL,
            viewer_count = 0
      WHERE id_operacion = $1
        AND status = 'ACTIVE'
        AND protocol = 'RTMP'
        AND playback_url LIKE '/runtime/ffmpeg-streams/%/index.m3u8'
        AND NOT (stream_key = ANY($2::text[]))`,
    [id_operacion, streams.map((stream) => stream.streamKey)]
  );
}

function getActorColumns(req) {
  const id = Number(req.user.sub);
  return {
    id_usuario: req.user.tabla === "usuario" ? id : null,
    id_personal: req.user.tabla === "personal" ? id : null,
    created_by_tabla: req.user.tabla,
    created_by_id: id,
  };
}

function textMentionsDrone(value) {
  const text = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return text.includes("dron") || text.includes("drone") || text.includes("uav") || text.includes("vant");
}

function normalizeStreamIdentity(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function streamIdentityValues(row = {}) {
  return [
    row.numero_serie,
    row.nombre,
    row.tipo_tactico,
    [row.marca, row.modelo].filter(Boolean).join(" ")
  ]
    .map(normalizeStreamIdentity)
    .filter(Boolean);
}

async function resolveAssignedDroneEquipo(id_operacion, ...values) {
  const incoming = values.map(normalizeStreamIdentity).filter(Boolean);
  if (!incoming.length) return null;

  const { rows } = await pool.query(
    `SELECT e.id_equipo, e.numero_serie, e.nombre, e.categoria,
            ec.marca, ec.modelo, et.tipo_tactico
       FROM operacion_equipo oe
       JOIN equipo e ON e.id_equipo = oe.id_equipo
       LEFT JOIN equipo_comunicacion ec ON ec.id_equipo = e.id_equipo
       LEFT JOIN equipo_tactico et ON et.id_equipo = e.id_equipo
      WHERE oe.id_operacion = $1
        AND oe.estado_asignacion != 'LIBERADO'`,
    [id_operacion]
  );

  return rows.find((row) => {
    const droneText = [
      row.nombre,
      row.categoria,
      row.tipo_tactico,
      row.marca,
      row.modelo,
      row.numero_serie
    ].join(" ");
    if (!textMentionsDrone(droneText)) return false;

    const candidateValues = streamIdentityValues(row);
    return incoming.some((value) => candidateValues.includes(value));
  }) || null;
}

async function getStreamSourceHints({ id_equipo = null, id_dispositivo = null }) {
  const hints = {
    label: null,
    source_type: null,
    external_device_id: null,
  };

  if (id_equipo != null) {
    const { rows } = await pool.query(
      `SELECT e.id_equipo, e.numero_serie, e.nombre, e.categoria,
              ec.marca, ec.modelo, et.tipo_tactico
         FROM equipo e
         LEFT JOIN equipo_comunicacion ec ON ec.id_equipo = e.id_equipo
         LEFT JOIN equipo_tactico et ON et.id_equipo = e.id_equipo
        WHERE e.id_equipo = $1
        LIMIT 1`,
      [id_equipo]
    );
    const equipo = rows[0];
    if (equipo) {
      hints.label = equipo.nombre || equipo.numero_serie || `Equipo ${id_equipo}`;
      hints.external_device_id = equipo.numero_serie || `equipo-${id_equipo}`;
      const droneText = [
        equipo.nombre,
        equipo.categoria,
        equipo.tipo_tactico,
        equipo.marca,
        equipo.modelo,
        equipo.numero_serie
      ].join(" ");
      if (textMentionsDrone(droneText)) hints.source_type = "DRONE";
    }
  }

  if (id_dispositivo != null) {
    const { rows } = await pool.query(
      `SELECT id_dispositivo, tipo, marca, modelo, numero_telefono, imei, numero_serie
         FROM dispositivo
        WHERE id_dispositivo = $1
        LIMIT 1`,
      [id_dispositivo]
    );
    const dispositivo = rows[0];
    if (dispositivo) {
      hints.label ||= [dispositivo.tipo, dispositivo.marca, dispositivo.modelo].filter(Boolean).join(" ") ||
        `Dispositivo ${id_dispositivo}`;
      hints.external_device_id ||= dispositivo.imei || dispositivo.numero_serie ||
        dispositivo.numero_telefono || `dispositivo-${id_dispositivo}`;
      if (!hints.source_type) hints.source_type = "DEVICE";
    }
  }

  return hints;
}

async function ensureStreamingTables() {
  if (streamingTablesReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_stream_session (
      id_stream BIGSERIAL PRIMARY KEY,
      id_operacion INT NOT NULL REFERENCES operacion(id_operacion) ON DELETE CASCADE,
      id_usuario INT REFERENCES usuario(id_usuario) ON DELETE SET NULL,
      id_personal INT REFERENCES personal(id_personal) ON DELETE SET NULL,
      id_equipo INT REFERENCES equipo(id_equipo) ON DELETE SET NULL,
      id_dispositivo INT REFERENCES dispositivo(id_dispositivo) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK (kind IN ('AUDIO','VIDEO','AUDIO_VIDEO')),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','STOPPED','ERROR')),
      label TEXT,
      protocol TEXT NOT NULL DEFAULT 'HYBRID',
      source_type TEXT NOT NULL DEFAULT 'ANDROID',
      stream_key TEXT NOT NULL UNIQUE,
      rtmp_publish_url TEXT,
      rtmp_playback_url TEXT,
      playback_url TEXT,
      external_device_id TEXT,
      publisher_socket_id TEXT,
      viewer_count INT NOT NULL DEFAULT 0 CHECK (viewer_count >= 0),
      consent_ack BOOLEAN NOT NULL DEFAULT FALSE,
      foreground_notice BOOLEAN NOT NULL DEFAULT FALSE,
      created_by_tabla TEXT,
      created_by_id INT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ
    );

    ALTER TABLE media_stream_session
      ADD COLUMN IF NOT EXISTS stream_key TEXT,
      ADD COLUMN IF NOT EXISTS id_equipo INT REFERENCES equipo(id_equipo) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS id_dispositivo INT REFERENCES dispositivo(id_dispositivo) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS protocol TEXT NOT NULL DEFAULT 'HYBRID',
      ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'ANDROID',
      ADD COLUMN IF NOT EXISTS rtmp_publish_url TEXT,
      ADD COLUMN IF NOT EXISTS rtmp_playback_url TEXT,
      ADD COLUMN IF NOT EXISTS playback_url TEXT,
      ADD COLUMN IF NOT EXISTS external_device_id TEXT,
      ADD COLUMN IF NOT EXISTS publisher_socket_id TEXT,
      ADD COLUMN IF NOT EXISTS viewer_count INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

    UPDATE media_stream_session
    SET stream_key = 'legacy-' || id_stream::text
    WHERE stream_key IS NULL;

    ALTER TABLE media_stream_session
      ALTER COLUMN stream_key SET NOT NULL;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'media_stream_session'
          AND column_name = 'storage_dir'
      ) THEN
        ALTER TABLE media_stream_session ALTER COLUMN storage_dir DROP NOT NULL;
      END IF;
    END $$;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_media_stream_session_stream_key
      ON media_stream_session(stream_key);

    CREATE INDEX IF NOT EXISTS idx_media_stream_session_operacion
      ON media_stream_session(id_operacion, status, started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_media_stream_session_equipo
      ON media_stream_session(id_operacion, id_equipo, status);

    CREATE INDEX IF NOT EXISTS idx_media_stream_session_dispositivo
      ON media_stream_session(id_operacion, id_dispositivo, status);

    CREATE TABLE IF NOT EXISTS media_stream_recording (
      id_recording BIGSERIAL PRIMARY KEY,
      id_stream BIGINT NOT NULL REFERENCES media_stream_session(id_stream) ON DELETE CASCADE,
      id_operacion INT NOT NULL REFERENCES operacion(id_operacion) ON DELETE CASCADE,
      mime_type TEXT NOT NULL DEFAULT 'video/webm',
      storage_path TEXT NOT NULL,
      original_filename TEXT,
      size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
      duration_ms BIGINT,
      recorded_started_at TIMESTAMPTZ,
      recorded_ended_at TIMESTAMPTZ,
      recorded_by_tabla TEXT,
      recorded_by_id INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE media_stream_recording
      ADD COLUMN IF NOT EXISTS recorded_started_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS recorded_ended_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_media_stream_recording_stream
      ON media_stream_recording(id_stream, created_at DESC);
  `);

  streamingTablesReady = true;
  cleanupOrphanRecordingFiles().catch((err) => {
    console.warn("[STREAMING] No se pudieron limpiar grabaciones huerfanas:", err.message);
  });
}

async function cleanupOrphanRecordingFiles() {
  const { rows: recordingRows } = await pool.query(
    `SELECT storage_path FROM media_stream_recording WHERE storage_path IS NOT NULL`
  );
  return deleteOrphanStreamFiles(recordingRows.map((row) => row.storage_path));
}

function publicRecording(row) {
  const recording = {
    id_recording: Number(row.id_recording),
    id_stream: Number(row.id_stream),
    id_operacion: row.id_operacion,
    mime_type: row.mime_type,
    original_filename: row.original_filename,
    size_bytes: Number(row.size_bytes || 0),
    duration_ms: row.duration_ms != null ? Number(row.duration_ms) : null,
    recorded_started_at: row.recorded_started_at || null,
    recorded_ended_at: row.recorded_ended_at || null,
    created_at: row.created_at,
    download_url: `/ops/${row.id_operacion}/streams/${row.id_stream}/recordings/${row.id_recording}/download`,
  };

  if (row.stream_kind != null) recording.stream_kind = row.stream_kind;
  if (row.stream_status != null) recording.stream_status = row.stream_status;
  if (row.stream_label != null) recording.stream_label = row.stream_label;
  if (row.stream_started_at != null) recording.stream_started_at = row.stream_started_at;
  if (row.stream_ended_at != null) recording.stream_ended_at = row.stream_ended_at;
  if (row.id_usuario != null) recording.id_usuario = row.id_usuario;
  if (row.id_personal != null) recording.id_personal = row.id_personal;
  if (row.id_equipo != null) recording.id_equipo = row.id_equipo;
  if (row.id_dispositivo != null) recording.id_dispositivo = row.id_dispositivo;
  if (row.source_type != null) recording.source_type = row.source_type;
  if (row.external_device_id != null) recording.external_device_id = row.external_device_id;
  if (row.stream_key != null) recording.stream_key = row.stream_key;

  return recording;
}

function publicStream(row) {
  return {
    id_stream: Number(row.id_stream),
    id_operacion: row.id_operacion,
    id_usuario: row.id_usuario,
    id_personal: row.id_personal,
    id_equipo: row.id_equipo,
    id_dispositivo: row.id_dispositivo,
    kind: row.kind,
    status: row.status,
    label: row.label,
    protocol: row.protocol || "HYBRID",
    source_type: row.source_type || "ANDROID",
    stream_key: row.stream_key,
    rtmp_publish_url: row.rtmp_publish_url,
    rtmp_playback_url: row.rtmp_playback_url,
    playback_url: row.playback_url,
    external_device_id: row.external_device_id,
    publisher_socket_id: row.publisher_socket_id,
    viewer_count: row.viewer_count,
    consent_ack: row.consent_ack,
    foreground_notice: row.foreground_notice,
    started_at: row.started_at,
    last_seen_at: row.last_seen_at,
    ended_at: row.ended_at,
    signaling_room: `media_stream_${row.id_stream}`,
  };
}

async function getStream(id_operacion, id_stream) {
  const { rows } = await pool.query(
    `SELECT *
     FROM media_stream_session
     WHERE id_operacion = $1 AND id_stream = $2
     LIMIT 1`,
    [id_operacion, id_stream]
  );
  return rows[0] || null;
}

router.get("/ops/:id/streams/webrtc-config", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return sendError(res, 400, "id invalido");

  return res.json({
    ok: true,
    config: {
      iceServers: WEBRTC_ICE_SERVERS,
      signaling: {
        namespace: "/",
        joinEvent: "stream_join",
        leaveEvent: "stream_leave",
        offerEvent: "webrtc_offer",
        answerEvent: "webrtc_answer",
        iceCandidateEvent: "webrtc_ice_candidate",
      },
      rtmp: {
        publishBaseUrl: MEDIA_STREAM_DEFAULT_PROTOCOL === "WEBRTC" ? null : getRtmpPublishBaseUrl(req),
        playbackBaseUrl: getRtmpPlaybackBaseUrl() || null,
        playbackUrlTemplate: process.env.RTMP_PLAYBACK_URL_TEMPLATE?.trim() || null,
      },
    },
  });
});

router.get("/ops/:id/streams", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return sendError(res, 400, "id invalido");

  const status = req.query.status ? normalizeStatus(req.query.status) : null;
  if (req.query.status && !status) return sendError(res, 400, "status invalido");

  const params = [id_operacion];
  let where = "WHERE id_operacion = $1";
  if (status) {
    params.push(status);
    where += " AND status = $2";
  }

  try {
    await ensureStreamingTables();
    await syncDiscoveredRuntimeHlsStreams(id_operacion, req);
    const { rows } = await pool.query(
      `SELECT *
       FROM media_stream_session
       ${where}
       ORDER BY started_at DESC
       LIMIT 100`,
      params
    );
    return res.json({ ok: true, items: rows.map(publicStream) });
  } catch (err) {
    return sendDbError(res, err, "Error obteniendo transmisiones en vivo");
  }
});

router.get("/ops/:id/streams/recordings", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return sendError(res, 400, "id invalido");

  try {
    await ensureStreamingTables();
    const { rows } = await pool.query(
      `SELECT r.*,
              s.kind AS stream_kind,
              s.status AS stream_status,
              s.label AS stream_label,
              s.started_at AS stream_started_at,
              s.ended_at AS stream_ended_at,
              s.id_usuario,
              s.id_personal,
              s.id_equipo,
              s.id_dispositivo,
              s.source_type,
              s.external_device_id,
              s.stream_key
       FROM media_stream_recording r
       LEFT JOIN media_stream_session s
         ON s.id_stream = r.id_stream
        AND s.id_operacion = r.id_operacion
       WHERE r.id_operacion = $1
       ORDER BY r.created_at DESC`,
      [id_operacion]
    );
    cleanupOrphanRecordingFiles().catch((err) => {
      console.warn("[STREAMING] No se pudieron limpiar grabaciones huerfanas:", err.message);
    });
    return res.json({ ok: true, items: rows.map(publicRecording) });
  } catch (err) {
    return sendDbError(res, err, "Error obteniendo grabaciones");
  }
});

router.get("/ops/:id/streams/:streamId", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_stream = Number(req.params.streamId);
  if (!isInt(id_operacion) || !isInt(id_stream)) return sendError(res, 400, "id invalido");

  try {
    await ensureStreamingTables();
    const stream = await getStream(id_operacion, id_stream);
    if (!stream) return sendError(res, 404, "Transmision no existe");
    return res.json({ ok: true, stream: publicStream(stream) });
  } catch (err) {
    return sendDbError(res, err, "Error obteniendo transmision en vivo");
  }
});

router.post("/ops/:id/streams", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return sendError(res, 400, "id invalido");

  const kind = normalizeKind(req.body?.kind || req.body?.tipo);
  if (!kind) return sendError(res, 400, "kind invalido");

  const protocol = normalizeProtocol(req.body?.protocol || req.body?.protocolo);
  if (!protocol) return sendError(res, 400, "protocol invalido");

  const consent_ack = truthy(req.body?.consent_ack);
  const foreground_notice = truthy(req.body?.foreground_notice);
  if (!consent_ack || !foreground_notice) {
    return sendError(
      res,
      422,
      "La transmision debe iniciarse con consentimiento explicito y aviso visible en el telefono"
    );
  }

  let id_equipo = optionalInt(req.body?.id_equipo);
  const id_dispositivo = optionalInt(req.body?.id_dispositivo);
  if (Number.isNaN(id_equipo)) return sendError(res, 400, "id_equipo invalido");
  if (Number.isNaN(id_dispositivo)) return sendError(res, 400, "id_dispositivo invalido");

  const stream_key = randomUUID();
  const needsRtmpUrls = protocol !== "WEBRTC";
  const rtmpPublishBaseUrl = needsRtmpUrls
    ? req.body?.rtmp_publish_base_url != null
      ? String(req.body.rtmp_publish_base_url).trim()
      : getRtmpPublishBaseUrl(req)
    : "";
  const rtmpPlaybackBaseUrl = needsRtmpUrls && req.body?.rtmp_playback_base_url != null
    ? String(req.body.rtmp_playback_base_url).trim()
    : null;
  const rtmp_publish_url = needsRtmpUrls
    ? req.body?.rtmp_publish_url != null
      ? String(req.body.rtmp_publish_url).trim()
      : joinStreamUrl(rtmpPublishBaseUrl, stream_key)
    : null;
  const rtmp_playback_url = needsRtmpUrls
    ? req.body?.rtmp_playback_url != null
      ? String(req.body.rtmp_playback_url).trim()
      : getRtmpPlaybackUrl(req, stream_key, rtmpPlaybackBaseUrl)
    : null;
  const playback_url = req.body?.playback_url != null
    ? String(req.body.playback_url).trim()
    : rtmp_playback_url;

  try {
    await ensureStreamingTables();
    const requestedExternalDeviceId = req.body?.external_device_id != null
      ? String(req.body.external_device_id).trim()
      : "";
    const resolvedEquipo = id_equipo == null
      ? await resolveAssignedDroneEquipo(id_operacion, requestedExternalDeviceId, stream_key, req.body?.label)
      : null;
    if (resolvedEquipo?.id_equipo) id_equipo = Number(resolvedEquipo.id_equipo);

    const hints = await getStreamSourceHints({ id_equipo, id_dispositivo });
    const label = req.body?.label != null
      ? String(req.body.label).trim()
      : hints.label;
    const source_type = normalizeSourceType(
      req.body?.source_type || req.body?.tipo_fuente || hints.source_type || "ANDROID",
      "ANDROID"
    );
    const actor = getActorColumns(req);
    const idPersonal = id_equipo != null && source_type === "DRONE" ? null : actor.id_personal;
    const previousParams = [id_operacion, actor.created_by_tabla, actor.created_by_id, protocol];
    await pool.query(
      `UPDATE media_stream_session
       SET status = 'STOPPED',
           ended_at = COALESCE(ended_at, NOW()),
           publisher_socket_id = NULL,
           viewer_count = 0,
           last_seen_at = NOW()
       WHERE id_operacion = $1
         AND created_by_tabla = $2
         AND created_by_id = $3
         AND protocol = $4
         AND status = 'ACTIVE'`,
      previousParams
    );
    const { rows } = await pool.query(
      `INSERT INTO media_stream_session (
         id_operacion, id_usuario, id_personal, id_equipo, id_dispositivo,
         kind, label, protocol, source_type,
         stream_key, rtmp_publish_url, rtmp_playback_url, playback_url,
         consent_ack, foreground_notice, created_by_tabla, created_by_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        id_operacion,
        actor.id_usuario,
        idPersonal,
        id_equipo,
        id_dispositivo,
        kind,
        label,
        protocol,
        source_type,
        stream_key,
        rtmp_publish_url,
        rtmp_playback_url,
        playback_url,
        consent_ack,
        foreground_notice,
        actor.created_by_tabla,
        actor.created_by_id,
      ]
    );

    const stream = publicStream(rows[0]);
    req.app.get("io")?.to(`op_${id_operacion}`).emit("media_stream_started", stream);
    return res.status(201).json({ ok: true, stream });
  } catch (err) {
    return sendDbError(res, err, "Error creando transmision en vivo");
  }
});

router.post("/ops/:id/streams/external", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return sendError(res, 400, "id invalido");

  const kind = normalizeKind(req.body?.kind || req.body?.tipo || "AUDIO_VIDEO");
  if (!kind) return sendError(res, 400, "kind invalido");

  let id_equipo = optionalInt(req.body?.id_equipo);
  const id_dispositivo = optionalInt(req.body?.id_dispositivo);
  if (Number.isNaN(id_equipo)) return sendError(res, 400, "id_equipo invalido");
  if (Number.isNaN(id_dispositivo)) return sendError(res, 400, "id_dispositivo invalido");

  const stream_key = String(req.body?.stream_key || randomUUID()).trim();
  const rtmpPublishBaseUrl = req.body?.rtmp_publish_base_url != null
    ? String(req.body.rtmp_publish_base_url).trim()
    : getRtmpPublishBaseUrl(req);
  const rtmpPlaybackBaseUrl = req.body?.rtmp_playback_base_url != null
    ? String(req.body.rtmp_playback_base_url).trim()
    : null;
  const rtmp_publish_url =
    req.body?.rtmp_publish_url != null
      ? String(req.body.rtmp_publish_url).trim()
      : joinStreamUrl(rtmpPublishBaseUrl, stream_key);
  const rtmp_playback_url =
    req.body?.rtmp_playback_url != null
      ? String(req.body.rtmp_playback_url).trim()
      : getRtmpPlaybackUrl(req, stream_key, rtmpPlaybackBaseUrl);
  const playback_url = req.body?.playback_url != null ? String(req.body.playback_url).trim() : rtmp_playback_url;

  if (!rtmp_publish_url && !rtmp_playback_url && !playback_url) {
    return sendError(res, 400, "Falta URL RTMP o playback_url del dispositivo");
  }

  try {
    await ensureStreamingTables();
    const requestedExternalDeviceId = req.body?.external_device_id != null
      ? String(req.body.external_device_id).trim()
      : "";
    const resolvedEquipo = id_equipo == null
      ? await resolveAssignedDroneEquipo(id_operacion, requestedExternalDeviceId, stream_key, req.body?.label)
      : null;
    if (resolvedEquipo?.id_equipo) id_equipo = Number(resolvedEquipo.id_equipo);

    const hints = await getStreamSourceHints({ id_equipo, id_dispositivo });
    const label = req.body?.label != null
      ? String(req.body.label).trim()
      : hints.label || "";
    if (!label) return sendError(res, 400, "Falta label");

    const source_type = normalizeSourceType(
      req.body?.source_type || req.body?.tipo_fuente || hints.source_type || "EXTERNAL",
      "EXTERNAL"
    );
    const external_device_id = requestedExternalDeviceId
      ? requestedExternalDeviceId
      : hints.external_device_id;
    const actor = getActorColumns(req);
    const idPersonal = id_equipo != null && source_type === "DRONE" ? null : actor.id_personal;
    const { rows } = await pool.query(
      `INSERT INTO media_stream_session (
         id_operacion, id_usuario, id_personal, id_equipo, id_dispositivo,
         kind, label, protocol, source_type,
         stream_key, rtmp_publish_url, rtmp_playback_url, playback_url, external_device_id,
         consent_ack, foreground_notice, created_by_tabla, created_by_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,'RTMP',$8,$9,$10,$11,$12,$13,TRUE,FALSE,$14,$15)
       RETURNING *`,
      [
        id_operacion,
        actor.id_usuario,
        idPersonal,
        id_equipo,
        id_dispositivo,
        kind,
        label,
        source_type,
        stream_key,
        rtmp_publish_url,
        rtmp_playback_url,
        playback_url,
        external_device_id,
        actor.created_by_tabla,
        actor.created_by_id,
      ]
    );

    const stream = publicStream(rows[0]);
    req.app.get("io")?.to(`op_${id_operacion}`).emit("media_stream_started", stream);
    return res.status(201).json({ ok: true, stream });
  } catch (err) {
    return sendDbError(res, err, "Error registrando dispositivo RTMP");
  }
});

router.patch("/ops/:id/streams/:streamId/stop", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_stream = Number(req.params.streamId);
  if (!isInt(id_operacion) || !isInt(id_stream)) return sendError(res, 400, "id invalido");

  const status = String(req.body?.status || "STOPPED").trim().toUpperCase();
  if (!["STOPPED", "ERROR"].includes(status)) return sendError(res, 400, "status invalido");

  try {
    await ensureStreamingTables();
    const { rows } = await pool.query(
      `UPDATE media_stream_session
       SET status = $3,
           ended_at = COALESCE(ended_at, NOW()),
           publisher_socket_id = NULL,
           viewer_count = 0
       WHERE id_operacion = $1 AND id_stream = $2
       RETURNING *`,
      [id_operacion, id_stream, status]
    );

    if (!rows[0]) return sendError(res, 404, "Transmision no existe");
    const stream = publicStream(rows[0]);
    const io = req.app.get("io");
    io?.to(stream.signaling_room).to(`op_${id_operacion}`).emit("media_stream_stopped", stream);
    return res.json({ ok: true, stream });
  } catch (err) {
    return sendDbError(res, err, "Error cerrando transmision en vivo");
  }
});

router.get("/ops/:id/streams/:streamId/recordings", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_stream = Number(req.params.streamId);
  if (!isInt(id_operacion) || !isInt(id_stream)) return sendError(res, 400, "id invalido");

  try {
    await ensureStreamingTables();
    const { rows } = await pool.query(
      `SELECT r.*,
              s.kind AS stream_kind,
              s.status AS stream_status,
              s.label AS stream_label,
              s.started_at AS stream_started_at,
              s.ended_at AS stream_ended_at,
              s.id_usuario,
              s.id_personal,
              s.id_equipo,
              s.id_dispositivo,
              s.source_type,
              s.external_device_id,
              s.stream_key
       FROM media_stream_recording r
       LEFT JOIN media_stream_session s
         ON s.id_stream = r.id_stream
        AND s.id_operacion = r.id_operacion
       WHERE r.id_operacion = $1 AND r.id_stream = $2
       ORDER BY r.created_at DESC`,
      [id_operacion, id_stream]
    );
    cleanupOrphanRecordingFiles().catch((err) => {
      console.warn("[STREAMING] No se pudieron limpiar grabaciones huerfanas:", err.message);
    });
    return res.json({ ok: true, items: rows.map(publicRecording) });
  } catch (err) {
    return sendDbError(res, err, "Error obteniendo grabaciones");
  }
});

router.post(
  "/ops/:id/streams/:streamId/recordings",
  requireAuth,
  raw({ type: isRecordingContentType, limit: "500mb" }),
  async (req, res) => {
    const id_operacion = Number(req.params.id);
    const id_stream = Number(req.params.streamId);
    if (!isInt(id_operacion) || !isInt(id_stream)) return sendError(res, 400, "id invalido");

    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer || buffer.length === 0) return sendError(res, 400, "archivo vacio");

    const mime_type = String(req.headers["content-type"] || "video/webm").split(";")[0].trim();
    const duration_ms = req.query.duration_ms ? Number(req.query.duration_ms) : null;
    const safeDuration = Number.isFinite(duration_ms) && duration_ms >= 0 ? Math.round(duration_ms) : null;
    const recorded_started_at = parseOptionalDate(req.query.started_at);
    const recorded_ended_at = parseOptionalDate(req.query.ended_at);

    try {
      await ensureStreamingTables();
      const stream = await getStream(id_operacion, id_stream);
      if (!stream) return sendError(res, 404, "Transmision no existe");

      const actor = getActorColumns(req);
      await ensureStreamStorageDir(`op_${id_operacion}`, `stream_${id_stream}`);

      const recordingId = `${Date.now()}_${randomUUID()}`;
      const filename = `recording_${recordingId}.mp4`;
      const storagePath = resolveStreamRecordingPath(`op_${id_operacion}`, `stream_${id_stream}`, filename);
      if (mime_type === "video/mp4") {
        await writeFile(storagePath, buffer);
      } else {
        const sourcePath = resolveStreamRecordingPath(
          `op_${id_operacion}`,
          `stream_${id_stream}`,
          `recording_${recordingId}.webm`
        );
        await writeFile(sourcePath, buffer);
        try {
          await convertRecordingToMp4(sourcePath, storagePath);
        } catch (error) {
          await unlink(storagePath).catch(() => {});
          throw error;
        } finally {
          await unlink(sourcePath).catch(() => {});
        }
      }
      const outputStats = await stat(storagePath);

      const { rows } = await pool.query(
        `INSERT INTO media_stream_recording (
           id_stream, id_operacion, mime_type, storage_path, original_filename,
           size_bytes, duration_ms, recorded_started_at, recorded_ended_at,
           recorded_by_tabla, recorded_by_id
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          id_stream,
          id_operacion,
          "video/mp4",
          storagePath,
          filename,
          outputStats.size,
          safeDuration,
          recorded_started_at,
          recorded_ended_at,
          actor.created_by_tabla,
          actor.created_by_id,
        ]
      );

      return res.status(201).json({ ok: true, recording: publicRecording(rows[0]) });
    } catch (err) {
      return sendDbError(res, err, "Error guardando grabacion");
    }
  }
);

router.get("/ops/:id/streams/:streamId/recordings/:recordingId/download", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_stream = Number(req.params.streamId);
  const id_recording = Number(req.params.recordingId);
  if (!isInt(id_operacion) || !isInt(id_stream) || !isInt(id_recording)) {
    return sendError(res, 400, "id invalido");
  }

  try {
    await ensureStreamingTables();
    const { rows } = await pool.query(
      `SELECT *
       FROM media_stream_recording
       WHERE id_operacion = $1 AND id_stream = $2 AND id_recording = $3
       LIMIT 1`,
      [id_operacion, id_stream, id_recording]
    );

    const recording = rows[0];
    if (!recording) return sendError(res, 404, "Grabacion no existe");

    res.setHeader("Content-Type", recording.mime_type || "video/webm");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${recording.original_filename || `stream_${id_stream}.${recording.mime_type === "video/mp4" ? "mp4" : "webm"}`}"`
    );
    return res.sendFile(recording.storage_path);
  } catch (err) {
    return sendDbError(res, err, "Error descargando grabacion");
  }
});

export default router;
