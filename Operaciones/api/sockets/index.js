import { Server } from "socket.io";
import { pool } from "../db.js";
import { ensureExtendedTrackingSchema, ensurePersonalMotionTrackingSchema } from "../utils/trackingSchema.js";
import { derivePersonalTrackingFromDevice, getLatestDevicePosition } from "../utils/personalTrackingFromDevices.js";

function streamRoomName(idStream) {
  return `media_stream_${idStream}`;
}

function normalizeStreamRole(value) {
  const role = String(value || "viewer").trim().toLowerCase();
  return ["publisher", "viewer"].includes(role) ? role : null;
}

function publicSocketStream(row) {
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
    signaling_room: streamRoomName(row.id_stream),
  };
}

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validCoords(latitud, longitud) {
  const lat = Number(latitud);
  const lon = Number(longitud);
  return Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180;
}

function firstPayloadValue(payload, ...keys) {
  for (const key of keys) {
    const value = payload?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

const VITAL_KEYS = [
  "frecuencia_cardiaca_bpm",
  "oxigenacion_spo2",
  "temperatura_c",
  "frecuencia_respiratoria_rpm",
  "presion_sistolica_mmhg",
  "presion_diastolica_mmhg",
  "pasos",
  "presion_barometrica_hpa",
  "bateria_pct",
];

const VITAL_ALIASES = {
  frecuencia_cardiaca_bpm: ["frecuencia_cardiaca_bpm", "frecuencia_cardiaca", "fc", "heart_rate", "heart_rate_bpm", "bpm"],
  oxigenacion_spo2: ["oxigenacion_spo2", "spo2", "oxigenacion", "oxygen_saturation"],
  temperatura_c: ["temperatura_c", "temperatura", "temperature_c", "body_temperature"],
  frecuencia_respiratoria_rpm: ["frecuencia_respiratoria_rpm", "respiracion", "respiratory_rate", "respiratory_rate_rpm"],
  presion_sistolica_mmhg: ["presion_sistolica_mmhg", "sistolica", "systolic", "blood_pressure_systolic"],
  presion_diastolica_mmhg: ["presion_diastolica_mmhg", "diastolica", "diastolic", "blood_pressure_diastolic"],
  pasos: ["pasos", "steps"],
  presion_barometrica_hpa: ["presion_barometrica_hpa", "barometro", "baro", "pressure", "pressure_hpa"],
  bateria_pct: ["bateria_pct", "bateria", "battery", "battery_level", "battery_pct"],
  latitud: ["latitud", "lat", "latitude"],
  longitud: ["longitud", "lon", "lng", "longitude"],
};

const VITAL_RANGES = {
  frecuencia_cardiaca_bpm: [20, 240],
  oxigenacion_spo2: [0, 100],
  temperatura_c: [25, 45],
  frecuencia_respiratoria_rpm: [1, 80],
  presion_sistolica_mmhg: [30, 260],
  presion_diastolica_mmhg: [20, 180],
  pasos: [0, Number.MAX_SAFE_INTEGER],
  presion_barometrica_hpa: [300, 1100],
  bateria_pct: [0, 100],
  latitud: [-90, 90],
  longitud: [-180, 180],
};

function readSocketVitalNumber(payload, key) {
  const raw = firstPayloadValue(payload, ...(VITAL_ALIASES[key] || [key]));
  if (raw == null) return null;
  const number = Number(raw);
  if (!Number.isFinite(number)) return null;
  const [min, max] = VITAL_RANGES[key] || [];
  if (min != null && (number < min || number > max)) return null;
  return key === "pasos" ? Math.round(number) : number;
}

function readSocketVitalText(payload, key, fallback = null) {
  const raw = payload?.[key];
  if (raw === undefined || raw === null) return fallback;
  const value = String(raw).trim();
  return value || fallback;
}

function readSocketVitalTimestamp(payload) {
  const raw = firstPayloadValue(payload, "timestamp", "capturado_en", "fecha");
  if (raw == null) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function socketVitalPayload(payload = {}) {
  const vitales = {};
  for (const key of [...VITAL_KEYS, "latitud", "longitud"]) {
    vitales[key] = readSocketVitalNumber(payload, key);
  }
  return vitales;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function publicSocketVital(row = {}) {
  const fc = toNumberOrNull(row.frecuencia_cardiaca_bpm);
  const spo2 = toNumberOrNull(row.oxigenacion_spo2);
  const temp = toNumberOrNull(row.temperatura_c);
  const resp = toNumberOrNull(row.frecuencia_respiratoria_rpm);
  const sys = toNumberOrNull(row.presion_sistolica_mmhg);
  const dia = toNumberOrNull(row.presion_diastolica_mmhg);
  const baro = toNumberOrNull(row.presion_barometrica_hpa);
  const bateria = toNumberOrNull(row.bateria_pct);

  return {
    id_signo_vital: row.id_signo_vital != null ? Number(row.id_signo_vital) : null,
    id_operacion: row.id_operacion != null ? Number(row.id_operacion) : null,
    id_personal: row.id_personal != null ? Number(row.id_personal) : null,
    apodo: row.apodo ?? null,
    nombre: row.nombre ?? null,
    apellido: row.apellido ?? null,
    rol: row.rol ?? null,
    frecuencia_cardiaca_bpm: fc,
    frecuencia_cardiaca: fc,
    fc,
    heart_rate: fc,
    heart_rate_bpm: fc,
    oxigenacion_spo2: spo2,
    spo2,
    temperatura_c: temp,
    temperatura: temp,
    frecuencia_respiratoria_rpm: resp,
    presion_sistolica_mmhg: sys,
    presion_diastolica_mmhg: dia,
    pasos: row.pasos != null ? Number(row.pasos) : null,
    presion_barometrica_hpa: baro,
    barometro: baro,
    baro,
    bateria_pct: bateria,
    bateria,
    battery_level: bateria,
    latitud: toNumberOrNull(row.latitud),
    longitud: toNumberOrNull(row.longitud),
    dispositivo_id: row.dispositivo_id ?? null,
    origen: row.origen ?? "SMARTWATCH",
    metadata: row.metadata ?? {},
    timestamp: row.timestamp ?? row.ultima_actualizacion ?? row.signos_actualizacion ?? null,
    ultima_actualizacion: row.ultima_actualizacion ?? row.timestamp ?? row.signos_actualizacion ?? null,
    signos_actualizacion: row.signos_actualizacion ?? row.ultima_actualizacion ?? row.timestamp ?? null,
    estado_operacion_creacion: row.estado_operacion_creacion ?? null,
  };
}

async function getAssignedSocketPersonal(idOperacion, idPersonal) {
  const { rows } = await pool.query(
    `SELECT a.id_operacion, a.id_personal, p.apodo, p.nombre, p.apellido, p.rol
       FROM asignacion_operacion_personal a
       JOIN personal p ON p.id_personal = a.id_personal
      WHERE a.id_operacion = $1
        AND a.id_personal = $2
        AND a.estado_asignacion NOT IN ('LIBERADO')
      LIMIT 1`,
    [idOperacion, idPersonal]
  );
  return rows[0] || null;
}

async function getLatestSocketVital(idOperacion, idPersonal) {
  const { rows } = await pool.query(
    `SELECT *
       FROM v_ultimos_signos_vitales_personal
      WHERE id_operacion = $1
        AND id_personal = $2
      LIMIT 1`,
    [idOperacion, idPersonal]
  );
  return rows[0] || null;
}

async function verifyDeviceSerial(idDispositivo, serial) {
  const clean = String(serial || "").trim();
  if (!clean) return false;

  const { rows } = await pool.query(
    `SELECT 1
       FROM dispositivo
      WHERE id_dispositivo = $1
        AND (
          lower(btrim(COALESCE(numero_serie, ''))) = lower($2) OR
          lower(btrim(COALESCE(imei, ''))) = lower($2) OR
          lower(btrim(COALESCE(identificador_app, ''))) = lower($2)
        )
      LIMIT 1`,
    [Number(idDispositivo), clean]
  );

  return rows.length > 0;
}

async function getActiveStream(idOperacion, idStream) {
  const { rows } = await pool.query(
    `SELECT *
     FROM media_stream_session
     WHERE id_operacion = $1 AND id_stream = $2 AND status = 'ACTIVE'
     LIMIT 1`,
    [idOperacion, idStream]
  );
  return rows[0] || null;
}

export function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: "*",
    },
  });

  io.on("connection", (socket) => {
    console.log("🟢 Cliente conectado:", socket.id);

    socket.on("join_operacion", async (payload) => {
      let idOperacion = null;

      if (typeof payload === "number" || typeof payload === "string") {
        idOperacion = Number(payload);
      } else {
        idOperacion = Number(payload?.id_operacion);
      }

      if (!Number.isFinite(idOperacion) || idOperacion <= 0) {
        console.warn("join_operacion inválido:", payload);
        return;
      }

      socket.join(`op_${idOperacion}`);
      socket.operationId = idOperacion;

      // Guardar info del usuario para filtrar eventos por rol
      // El Android puede enviar { id_operacion, id_personal, rol }
      const idPersonal = payload?.id_personal ? Number(payload.id_personal) : null;
      const rol        = (payload?.rol || "").toUpperCase();
      socket.userData  = { id_personal: idPersonal, rol };
      if (Number.isFinite(idPersonal) && idPersonal > 0) {
        socket.join(`op_${idOperacion}_personal_${idPersonal}`);
      }

      console.log(`Socket ${socket.id} unido a operación ${idOperacion} [${rol || "sin rol"}]`);
    });

    socket.on("ptt_alert_toggle", (data = {}, ack) => {
      const opId = socket.operationId;
      if (!opId) {
        if (typeof ack === "function") ack({ ok: false, mensaje: "Socket sin operacion" });
        return;
      }

      const lat = optionalNumber(data.lat ?? data.latitud);
      const lon = optionalNumber(data.lon ?? data.lng ?? data.longitud);
      const idPersonal = Number(data.id_personal);
      const hasCoords = validCoords(lat, lon);
      const payload = {
        id_operacion: opId,
        active: data.active === true,
        sender_name: String(data.sender_name || "Elemento PTT").trim().slice(0, 120),
        id_personal: Number.isInteger(idPersonal) && idPersonal > 0 ? idPersonal : null,
        lat: hasCoords ? lat : null,
        lon: hasCoords ? lon : null,
        timestamp: new Date().toISOString(),
      };

      // No devolver la alerta al mismo dispositivo que la genero.
      socket.to(`op_${opId}`).emit("ptt_alert_update", payload);
      if (typeof ack === "function") ack({ ok: true });
    });

    // Persiste en BD y retransmite al room
    socket.on("tracking_personal", async (data) => {
      const opId = socket.operationId;
      if (!opId) {
        console.warn("[SOCKET] tracking_personal ignorado: socket sin operacion", data);
        return;
      }

      const { id_personal, latitud, longitud, altitud, precision_m, velocidad_kmh, rumbo_grados } = data ?? {};
      if (!id_personal || latitud == null || longitud == null) {
        console.warn("[SOCKET] tracking_personal ignorado: payload incompleto", data);
        return;
      }

      console.log(
        `📍 tracking_personal op=${opId} personal=${id_personal} lat=${latitud} lon=${longitud}`
      );

      let savedTracking = null;
      try {
        await ensurePersonalMotionTrackingSchema();
        const { rows } = await pool.query(
          `INSERT INTO tracking_personal (
             id_operacion, id_personal, latitud, longitud, altitud,
             precision_m, velocidad_kmh, rumbo_grados, fuente_tracking
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id_tracking, id_operacion, id_personal, latitud, longitud, altitud, precision_m, velocidad_kmh, rumbo_grados, timestamp, estado_operacion_creacion`,
          [opId, Number(id_personal), Number(latitud), Number(longitud),
            optionalNumber(altitud),
            optionalNumber(precision_m),
            optionalNumber(velocidad_kmh),
            optionalNumber(rumbo_grados),
            "GPS_DIRECTO"]
        );
        savedTracking = rows[0];
      } catch (err) {
        console.error("[SOCKET] Error guardando tracking_personal:", err.message);
        socket.emit("tracking_personal_error", {
          ok: false,
          mensaje: "No se pudo guardar tracking_personal",
        });
        return;
      }

      // Retransmite a todos los demás en el room (incluye web y otros Android)
      socket.to(`op_${opId}`).emit("tracking_personal", {
        ...data,
        ...savedTracking,
        apodo: data.apodo,
        nombre: data.nombre,
        rol: data.rol,
      });
    });

    socket.on("signos_vitales_personal", async (data) => {
      const opId = socket.operationId;
      if (!opId) {
        console.warn("[SOCKET] signos_vitales_personal ignorado: socket sin operacion", data);
        return;
      }

      const idPersonal = Number(data?.id_personal);
      if (!Number.isInteger(idPersonal) || idPersonal <= 0) {
        console.warn("[SOCKET] signos_vitales_personal ignorado: falta id_personal", data);
        return;
      }

      const vitales = socketVitalPayload(data);
      if (VITAL_KEYS.every((key) => vitales[key] == null)) {
        console.warn("[SOCKET] signos_vitales_personal ignorado: sin signos vitales", data);
        return;
      }

      let savedVital = null;
      try {
        const assigned = await getAssignedSocketPersonal(opId, idPersonal);
        if (!assigned) {
          socket.emit("signos_vitales_personal_error", {
            ok: false,
            mensaje: "Personal no asignado a la operacion",
          });
          return;
        }

        const metadata = data?.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
          ? data.metadata
          : {};
        const timestamp = readSocketVitalTimestamp(data);

        const { rows } = await pool.query(
          `INSERT INTO signos_vitales_personal (
             id_operacion,
             id_personal,
             frecuencia_cardiaca_bpm,
             oxigenacion_spo2,
             temperatura_c,
             frecuencia_respiratoria_rpm,
             presion_sistolica_mmhg,
             presion_diastolica_mmhg,
             pasos,
             presion_barometrica_hpa,
             bateria_pct,
             latitud,
             longitud,
             dispositivo_id,
             origen,
             metadata,
             "timestamp"
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,COALESCE($17::timestamptz, NOW()))
           RETURNING *`,
          [
            opId,
            idPersonal,
            vitales.frecuencia_cardiaca_bpm,
            vitales.oxigenacion_spo2,
            vitales.temperatura_c,
            vitales.frecuencia_respiratoria_rpm,
            vitales.presion_sistolica_mmhg,
            vitales.presion_diastolica_mmhg,
            vitales.pasos,
            vitales.presion_barometrica_hpa,
            vitales.bateria_pct,
            vitales.latitud,
            vitales.longitud,
            readSocketVitalText(data, "dispositivo_id"),
            readSocketVitalText(data, "origen", "SMARTWATCH"),
            JSON.stringify(metadata),
            timestamp,
          ]
        );

        const latest = await getLatestSocketVital(opId, idPersonal);
        savedVital = publicSocketVital(latest || { ...rows[0], ...assigned });
      } catch (err) {
        console.error("[SOCKET] Error guardando signos_vitales_personal:", err.message);
        socket.emit("signos_vitales_personal_error", {
          ok: false,
          mensaje: "No se pudo guardar signos_vitales_personal",
        });
        return;
      }

      io.to(`op_${opId}`).emit("signos_vitales_personal", savedVital);
    });

    // Persiste en BD y retransmite al room
    socket.on("tracking_vehiculo", async (data) => {
      const opId = socket.operationId;
      if (!opId) {
        console.warn("[SOCKET] tracking_vehiculo ignorado: socket sin operacion", data);
        return;
      }

      const { id_vehiculo, latitud, longitud, altitud, velocidad_kmh, rumbo_grados, precision_m } = data ?? {};
      if (!id_vehiculo || latitud == null || longitud == null) {
        console.warn("[SOCKET] tracking_vehiculo ignorado: payload incompleto", data);
        return;
      }

      console.log(
        `📍 tracking_vehiculo op=${opId} vehiculo=${id_vehiculo} lat=${latitud} lon=${longitud}`
      );

      let savedTracking = null;
      try {
        const { rows } = await pool.query(
          `INSERT INTO tracking_vehiculo (id_operacion, id_vehiculo, latitud, longitud, altitud, velocidad_kmh, rumbo_grados, precision_m)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id_tracking, id_operacion, id_vehiculo, latitud, longitud, altitud, velocidad_kmh, rumbo_grados, precision_m, timestamp, estado_operacion_creacion`,
          [opId, Number(id_vehiculo), Number(latitud), Number(longitud),
            altitud != null ? Number(altitud) : null,
            velocidad_kmh != null ? Number(velocidad_kmh) : null,
            rumbo_grados != null ? Number(rumbo_grados) : null,
            precision_m != null ? Number(precision_m) : null]
        );
        savedTracking = rows[0];
      } catch (err) {
        console.error("[SOCKET] Error guardando tracking_vehiculo:", err.message);
        socket.emit("tracking_vehiculo_error", {
          ok: false,
          mensaje: "No se pudo guardar tracking_vehiculo",
        });
        return;
      }

      // Retransmite a todos los demás en el room
      socket.to(`op_${opId}`).emit("tracking_vehiculo", {
        ...data,
        ...savedTracking,
        alias: data.alias,
        nombre: data.nombre,
      });
    });

    socket.on("tracking_equipo", async (data) => {
      const opId = socket.operationId;
      if (!opId) {
        console.warn("[SOCKET] tracking_equipo ignorado: socket sin operacion", data);
        return;
      }

      const { id_equipo, latitud, longitud, altitud, velocidad_kmh, rumbo_grados, precision_m } = data ?? {};
      if (!id_equipo || !validCoords(latitud, longitud)) {
        console.warn("[SOCKET] tracking_equipo ignorado: payload incompleto", data);
        return;
      }

      let savedTracking = null;
      try {
        await ensureExtendedTrackingSchema();
        const { rows } = await pool.query(
          `INSERT INTO tracking_equipo (
             id_operacion, id_equipo, latitud, longitud, altitud,
             velocidad_kmh, rumbo_grados, precision_m
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id_tracking, id_operacion, id_equipo, latitud, longitud, altitud, velocidad_kmh, rumbo_grados, precision_m, timestamp, estado_operacion_creacion`,
          [
            opId,
            Number(id_equipo),
            Number(latitud),
            Number(longitud),
            optionalNumber(altitud),
            optionalNumber(velocidad_kmh),
            optionalNumber(rumbo_grados),
            optionalNumber(precision_m)
          ]
        );
        savedTracking = rows[0];
      } catch (err) {
        console.error("[SOCKET] Error guardando tracking_equipo:", err.message);
        socket.emit("tracking_equipo_error", {
          ok: false,
          mensaje: "No se pudo guardar tracking_equipo",
        });
        return;
      }

      socket.to(`op_${opId}`).emit("tracking_equipo", {
        ...data,
        ...savedTracking,
        nombre: data.nombre,
        categoria: data.categoria,
        tipo_equipo: data.tipo_equipo,
      });
    });

    socket.on("tracking_dispositivo", async (data) => {
      const opId = socket.operationId;
      if (!opId) {
        console.warn("[SOCKET] tracking_dispositivo ignorado: socket sin operacion", data);
        return;
      }

      const {
        id_dispositivo,
        latitud,
        longitud,
        altitud,
        velocidad_kmh,
        rumbo_grados,
        precision_m,
        bateria_pct
      } = data ?? {};
      const serialDispositivo = firstPayloadValue(
        data,
        "serial_dispositivo",
        "numero_serie",
        "numeroSerie",
        "serial",
        "imei",
        "identificador_app"
      );
      if (!id_dispositivo || !validCoords(latitud, longitud)) {
        console.warn("[SOCKET] tracking_dispositivo ignorado: payload incompleto", data);
        return;
      }

      let savedTracking = null;
      try {
        await ensureExtendedTrackingSchema();
        const serialOk = await verifyDeviceSerial(id_dispositivo, serialDispositivo);
        if (!serialOk) {
          console.warn("[SOCKET] tracking_dispositivo ignorado: serie no coincide", data);
          socket.emit("tracking_dispositivo_error", {
            ok: false,
            mensaje: serialDispositivo
              ? "El numero de serie no coincide con el dispositivo"
              : "Falta numero de serie del dispositivo",
          });
          return;
        }

        const { rows } = await pool.query(
          `INSERT INTO tracking_dispositivo (
             id_operacion, id_dispositivo, latitud, longitud, altitud,
             velocidad_kmh, rumbo_grados, precision_m, bateria_pct, serial_dispositivo
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id_tracking, id_operacion, id_dispositivo, latitud, longitud, altitud, velocidad_kmh, rumbo_grados, precision_m, bateria_pct, timestamp, estado_operacion_creacion`,
          [
            opId,
            Number(id_dispositivo),
            Number(latitud),
            Number(longitud),
            optionalNumber(altitud),
            optionalNumber(velocidad_kmh),
            optionalNumber(rumbo_grados),
            optionalNumber(precision_m),
            optionalNumber(bateria_pct),
            serialDispositivo ? String(serialDispositivo).trim() : null
          ]
        );
        savedTracking = rows[0];
      } catch (err) {
        console.error("[SOCKET] Error guardando tracking_dispositivo:", err.message);
        socket.emit("tracking_dispositivo_error", {
          ok: false,
          mensaje: "No se pudo guardar tracking_dispositivo",
        });
        return;
      }

      let latestDevice = null;
      try {
        latestDevice = await getLatestDevicePosition(opId, Number(id_dispositivo));
      } catch (err) {
        console.warn("[SOCKET] No se pudo obtener ultima posicion de dispositivo:", err.message);
      }

      io.to(`op_${opId}`).emit("tracking_dispositivo", latestDevice || {
        ...data,
        ...savedTracking,
        tipo: data.tipo,
        marca: data.marca,
        modelo: data.modelo,
        serial_dispositivo: serialDispositivo ? String(serialDispositivo).trim() : null,
      });

      try {
        const personalFromDevices = await derivePersonalTrackingFromDevice(opId, Number(id_dispositivo));
        if (personalFromDevices) {
          io.to(`op_${opId}`).emit("tracking_personal", personalFromDevices);
        }
      } catch (err) {
        console.error("[SOCKET] Error calculando tracking_personal desde dispositivo:", err.message);
      }
    });

    socket.on("stream_join", async (payload, ack) => {
      const idOperacion = Number(payload?.id_operacion || socket.operationId);
      const idStream = Number(payload?.id_stream);
      const role = normalizeStreamRole(payload?.role);

      if (!Number.isFinite(idOperacion) || idOperacion <= 0 || !Number.isFinite(idStream) || idStream <= 0 || !role) {
        const error = { ok: false, mensaje: "stream_join invalido" };
        if (typeof ack === "function") ack(error);
        return;
      }

      try {
        const streamRow = await getActiveStream(idOperacion, idStream);
        if (!streamRow) {
          const error = { ok: false, mensaje: "Transmision no existe o no esta activa" };
          if (typeof ack === "function") ack(error);
          return;
        }

        const room = streamRoomName(idStream);
        socket.join(`op_${idOperacion}`);
        socket.join(room);
        socket.operationId = idOperacion;
        socket.mediaStreamMemberships ||= new Map();
        const membershipKey = `${idStream}:${role}`;
        const alreadyJoined = socket.mediaStreamMemberships.has(membershipKey);
        const refreshJoin = payload?.refresh === true || payload?.refresh === "true";
        socket.mediaStreamMemberships.set(membershipKey, { idOperacion, idStream, role });

        let updatedRow = streamRow;
        if (role === "publisher") {
          const { rows } = await pool.query(
            `UPDATE media_stream_session
             SET publisher_socket_id = $3, last_seen_at = NOW()
             WHERE id_operacion = $1 AND id_stream = $2 AND status = 'ACTIVE'
             RETURNING *`,
            [idOperacion, idStream, socket.id]
          );
          updatedRow = rows[0] || streamRow;
          socket.to(`op_${idOperacion}`).emit("media_stream_publisher_ready", publicSocketStream(updatedRow));
          socket.to(room).emit("webrtc_publisher_joined", {
            id_operacion: idOperacion,
            id_stream: idStream,
            publisher_socket_id: socket.id,
          });
        } else {
          const { rows } = alreadyJoined
            ? await pool.query(
                `UPDATE media_stream_session
                 SET last_seen_at = NOW()
                 WHERE id_operacion = $1 AND id_stream = $2 AND status = 'ACTIVE'
                 RETURNING *`,
                [idOperacion, idStream]
              )
            : await pool.query(
                `UPDATE media_stream_session
                 SET viewer_count = viewer_count + 1, last_seen_at = NOW()
                 WHERE id_operacion = $1 AND id_stream = $2 AND status = 'ACTIVE'
                 RETURNING *`,
                [idOperacion, idStream]
              );
          updatedRow = rows[0] || streamRow;

          if (updatedRow.publisher_socket_id) {
            const shouldRequestOffer = !alreadyJoined || refreshJoin;
            if (shouldRequestOffer) socket.to(updatedRow.publisher_socket_id).emit("webrtc_viewer_joined", {
              id_operacion: idOperacion,
              id_stream: idStream,
              viewer_socket_id: socket.id,
              viewer: socket.userData || {},
            });
          } else {
            socket.emit("media_stream_waiting_for_publisher", {
              id_operacion: idOperacion,
              id_stream: idStream,
            });
          }
        }

        const stream = publicSocketStream(updatedRow);
        socket.to(`op_${idOperacion}`).emit("media_stream_viewer_count", stream);
        if (typeof ack === "function") ack({ ok: true, socket_id: socket.id, stream });
      } catch (err) {
        console.error("[SOCKET] stream_join:", err.message);
        if (typeof ack === "function") ack({ ok: false, mensaje: "Error uniendo stream" });
      }
    });

    async function leaveStreamMembership(idOperacion, idStream, role, notify = true) {
      const room = streamRoomName(idStream);
      const membershipKey = `${idStream}:${role}`;
      const hadMembership = socket.mediaStreamMemberships?.has(membershipKey);
      if (!hadMembership) return;

      socket.leave(room);
      socket.mediaStreamMemberships?.delete(membershipKey);

      if (role === "viewer") {
        const { rows } = await pool.query(
          `UPDATE media_stream_session
           SET viewer_count = GREATEST(viewer_count - 1, 0), last_seen_at = NOW()
           WHERE id_operacion = $1 AND id_stream = $2
           RETURNING *`,
          [idOperacion, idStream]
        );
        const stream = rows[0] ? publicSocketStream(rows[0]) : null;
        if (notify) {
          socket.to(room).emit("webrtc_viewer_left", {
            id_operacion: idOperacion,
            id_stream: idStream,
            viewer_socket_id: socket.id,
          });
          if (stream) socket.to(`op_${idOperacion}`).emit("media_stream_viewer_count", stream);
        }
        return;
      }

      if (role === "publisher") {
        const { rows } = await pool.query(
          `UPDATE media_stream_session
           SET publisher_socket_id = NULL,
               last_seen_at = NOW()
           WHERE id_operacion = $1
             AND id_stream = $2
             AND publisher_socket_id = $3
             AND status = 'ACTIVE'
           RETURNING *`,
          [idOperacion, idStream, socket.id]
        );
        const stream = rows[0] ? publicSocketStream(rows[0]) : null;
        if (notify && stream) {
          socket.to(room).to(`op_${idOperacion}`).emit("media_stream_publisher_offline", stream);
        }
      }
    }

    socket.on("stream_leave", async (payload, ack) => {
      const idOperacion = Number(payload?.id_operacion || socket.operationId);
      const idStream = Number(payload?.id_stream);
      const role = normalizeStreamRole(payload?.role);

      try {
        if (Number.isFinite(idStream) && idStream > 0 && role) {
          await leaveStreamMembership(idOperacion, idStream, role);
        } else {
          const memberships = Array.from(socket.mediaStreamMemberships?.values() || []);
          for (const membership of memberships) {
            await leaveStreamMembership(membership.idOperacion, membership.idStream, membership.role);
          }
        }
        if (typeof ack === "function") ack({ ok: true });
      } catch (err) {
        console.error("[SOCKET] stream_leave:", err.message);
        if (typeof ack === "function") ack({ ok: false, mensaje: "Error saliendo del stream" });
      }
    });

    socket.on("stream_stop", async (payload, ack) => {
      const idOperacion = Number(payload?.id_operacion || socket.operationId);
      const idStream = Number(payload?.id_stream);
      const status = String(payload?.status || "STOPPED").trim().toUpperCase();

      if (!Number.isFinite(idOperacion) || idOperacion <= 0 || !Number.isFinite(idStream) || idStream <= 0) {
        if (typeof ack === "function") ack({ ok: false, mensaje: "stream_stop invalido" });
        return;
      }

      try {
        const { rows } = await pool.query(
          `UPDATE media_stream_session
           SET status = $3,
               ended_at = COALESCE(ended_at, NOW()),
               publisher_socket_id = NULL,
               viewer_count = 0,
               last_seen_at = NOW()
           WHERE id_operacion = $1 AND id_stream = $2
           RETURNING *`,
          [idOperacion, idStream, status === "ERROR" ? "ERROR" : "STOPPED"]
        );
        const stream = rows[0] ? publicSocketStream(rows[0]) : null;
        if (!stream) {
          if (typeof ack === "function") ack({ ok: false, mensaje: "Transmision no existe" });
          return;
        }
        io.to(stream.signaling_room).to(`op_${idOperacion}`).emit("media_stream_stopped", stream);
        if (typeof ack === "function") ack({ ok: true, stream });
      } catch (err) {
        console.error("[SOCKET] stream_stop:", err.message);
        if (typeof ack === "function") ack({ ok: false, mensaje: "Error cerrando stream" });
      }
    });

    socket.on("stream_ping", async (payload, ack) => {
      const idOperacion = Number(payload?.id_operacion || socket.operationId);
      const idStream = Number(payload?.id_stream);
      if (!Number.isFinite(idOperacion) || idOperacion <= 0 || !Number.isFinite(idStream) || idStream <= 0) {
        if (typeof ack === "function") ack({ ok: false, mensaje: "stream_ping invalido" });
        return;
      }

      try {
        await pool.query(
          `UPDATE media_stream_session
           SET last_seen_at = NOW()
           WHERE id_operacion = $1 AND id_stream = $2 AND status = 'ACTIVE'`,
          [idOperacion, idStream]
        );
        if (typeof ack === "function") ack({ ok: true });
      } catch (err) {
        console.error("[SOCKET] stream_ping:", err.message);
        if (typeof ack === "function") ack({ ok: false, mensaje: "Error actualizando stream" });
      }
    });

    function relayWebRtc(eventName, payload, ack) {
      const idOperacion = Number(payload?.id_operacion || socket.operationId);
      const idStream = Number(payload?.id_stream);
      const to = String(payload?.to || payload?.to_socket_id || "").trim();

      if (!Number.isFinite(idOperacion) || idOperacion <= 0 || !Number.isFinite(idStream) || idStream <= 0 || !to) {
        if (typeof ack === "function") ack({ ok: false, mensaje: `${eventName} invalido` });
        return;
      }

      socket.to(to).emit(eventName, {
        ...payload,
        id_operacion: idOperacion,
        id_stream: idStream,
        from: socket.id,
        from_socket_id: socket.id,
      });

      if (typeof ack === "function") ack({ ok: true });
    }

    socket.on("webrtc_offer", (payload, ack) => relayWebRtc("webrtc_offer", payload, ack));
    socket.on("webrtc_answer", (payload, ack) => relayWebRtc("webrtc_answer", payload, ack));
    socket.on("webrtc_ice_candidate", (payload, ack) => relayWebRtc("webrtc_ice_candidate", payload, ack));

    function relayVoiceCall(eventName, payload, ack) {
      const idOperacion = Number(socket.operationId);
      const fromPersonalId = Number(socket.userData?.id_personal);
      const toPersonalId = Number(payload?.to_personal_id);
      const callId = String(payload?.call_id || "").trim();
      if (!Number.isFinite(idOperacion) || idOperacion <= 0 ||
          !Number.isFinite(fromPersonalId) || fromPersonalId <= 0 ||
          !Number.isFinite(toPersonalId) || toPersonalId <= 0 || !callId) {
        if (typeof ack === "function") ack({ ok: false, mensaje: `${eventName} invalido` });
        return;
      }
      socket.to(`op_${idOperacion}_personal_${toPersonalId}`).emit(eventName, {
        ...payload,
        call_id: callId,
        id_operacion: idOperacion,
        from_personal_id: fromPersonalId,
      });
      if (typeof ack === "function") ack({ ok: true });
    }

    [
      "voice_call_invite", "voice_call_accept", "voice_call_reject",
      "voice_call_end", "voice_call_offer", "voice_call_answer", "voice_call_ice",
    ].forEach((eventName) => {
      socket.on(eventName, (payload, ack) => relayVoiceCall(eventName, payload, ack));
    });

    socket.on("disconnect", async () => {
      const memberships = Array.from(socket.mediaStreamMemberships?.values() || []);
      for (const membership of memberships) {
        try {
          await leaveStreamMembership(membership.idOperacion, membership.idStream, membership.role);
        } catch (err) {
          console.error("[SOCKET] stream disconnect cleanup:", err.message);
        }
      }
      console.log("🔴 Cliente desconectado:", socket.id);
    });
  });

  return io;
}

// ── Emit poi_creado ───────────────────────────────────────────
// Emite el nuevo POI a todos los clientes en el room de la operación.
export function emitPoiCreado(io, idOperacion, poi) {
  io.to(`op_${idOperacion}`).emit("poi_creado", { poi });
}

export function emitPoiActualizado(io, idOperacion, poi) {
  io.to(`op_${idOperacion}`).emit("poi_actualizado", { poi });
  io.to(`op_${idOperacion}`).emit("poi_creado", { poi });
}

// ── Emit poi_eliminado ────────────────────────────────────────
export function emitPoiEliminado(io, idOperacion, idPoi) {
  io.to(`op_${idOperacion}`).emit("poi_eliminado", { id_poi: idPoi });
}

export function emitAreaCreada(io, idOperacion, area) {
  io.to(`op_${idOperacion}`).emit("area_creada", { area });
}

export function emitAreaActualizada(io, idOperacion, area) {
  io.to(`op_${idOperacion}`).emit("area_actualizada", { area });
  io.to(`op_${idOperacion}`).emit("area_creada", { area });
}

export function emitAreaEliminada(io, idOperacion, idArea) {
  io.to(`op_${idOperacion}`).emit("area_eliminada", { id_area: idArea });
}

export function emitEstructuraCreada(io, idOperacion, estructura) {
  io.to(`op_${idOperacion}`).emit("estructura_creada", { estructura });
}

export function emitEstructuraActualizada(io, idOperacion, estructura) {
  io.to(`op_${idOperacion}`).emit("estructura_actualizada", { estructura });
  io.to(`op_${idOperacion}`).emit("estructura_creada", { estructura });
}

export function emitEstructuraEliminada(io, idOperacion, idMarca) {
  io.to(`op_${idOperacion}`).emit("estructura_eliminada", { id_marca: idMarca });
}

export function emitDibujoCreado(io, idOperacion, dibujo) {
  io.to(`op_${idOperacion}`).emit("dibujo_creado", { dibujo });
}

export function emitDibujoEliminado(io, idOperacion, idDibujo) {
  io.to(`op_${idOperacion}`).emit("dibujo_eliminado", { id_dibujo: idDibujo });
}

export function emitCuadriculaActualizada(io, idOperacion, grid) {
  io.to(`op_${idOperacion}`).emit("cuadricula_actualizada", { grid });
  io.to(`op_${idOperacion}`).emit("grid_updated", { grid });
}

export function emitCuadriculaEliminada(io, idOperacion) {
  io.to(`op_${idOperacion}`).emit("cuadricula_eliminada", { id_operacion: idOperacion });
  io.to(`op_${idOperacion}`).emit("grid_deleted", { id_operacion: idOperacion });
}

export function emitRutaOperacionCreada(io, idOperacion, ruta) {
  io.to(`op_${idOperacion}`).emit("ruta_operacion_creada", { ruta });
}

export function emitRutaOperacionEliminada(io, idOperacion, idRuta) {
  io.to(`op_${idOperacion}`).emit("ruta_operacion_eliminada", { id_ruta: idRuta });
}

// ── Visibilidad de mensajes de chat ──────────────────────────
function splitChatDestinationIds(value) {
  return String(value || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

async function canReceiveChatMessage(sock, msg, idOperacion) {
  const { rol, id_personal } = sock.userData || {};
  const tipo   = (msg.destino_tipo || '').toUpperCase().trim();
  const destId = msg.destino_id != null ? String(msg.destino_id).trim() : null;

  if (!tipo || tipo === 'GLOBAL') return true;
  if (!rol) return true;                          // dashboard sin rol → ve todo
  if (rol === 'ADMIN') return true;

  switch (tipo) {
    case 'CETS': return rol === 'CET' || rol === 'CUT';
    case 'CET':  return rol === 'CET'  && id_personal != null && String(id_personal) === destId;
    case 'CUTS': return rol === 'CUT';
    case 'CUT':  return id_personal != null && (
      (rol === 'CUT' && String(id_personal) === destId)
      || (rol === 'CET' && msg.id_personal != null && String(msg.id_personal) === String(id_personal))
    );

    case 'CELL_LIST':
      if (rol === 'CUT') return true;
      return id_personal != null && splitChatDestinationIds(destId).includes(String(id_personal));

    case 'VEHICULO': {
      if (rol === 'CUT') return true;
      if (!id_personal || !destId) return false;
      try {
        const { rows } = await pool.query(
          `SELECT 1
           FROM vehiculo_operacion vo
           WHERE vo.id_operacion = $1
             AND vo.id_vehiculo::text = $2
             AND vo.id_personal = $3
             AND COALESCE(vo.estado_asignacion::text, '') <> 'LIBERADO'
           LIMIT 1`,
          [idOperacion, destId, id_personal]
        );
        return rows.length > 0;
      } catch (err) {
        console.error('[SOCKET] canReceiveChatMessage VEHICULO:', err.message);
        return false;
      }
    }

    case 'CELL': {
      if (!id_personal) return false;
      if (rol === 'CELL') return String(id_personal) === destId;
      if (rol === 'CET' && destId) {
        try {
          const { rows } = await pool.query(
            `SELECT 1
             FROM grupo_personal gp_cell
             JOIN grupo_operacion g_cell ON g_cell.id_grupo_operacion = gp_cell.id_grupo_operacion
             JOIN grupo_personal gp_cet ON TRUE
             JOIN grupo_operacion g_cet ON g_cet.id_grupo_operacion = gp_cet.id_grupo_operacion
             WHERE g_cell.id_operacion          = $1
               AND g_cet.id_operacion           = $1
               AND gp_cell.id_personal::text    = $2
               AND gp_cet.id_personal           = $3
               AND COALESCE(g_cell.id_grupo_padre, g_cell.id_grupo_operacion) =
                   COALESCE(g_cet.id_grupo_padre,  g_cet.id_grupo_operacion)
             LIMIT 1`,
            [idOperacion, destId, id_personal]
          );
          return rows.length > 0;
        } catch (err) {
          console.error('[SOCKET] canReceiveChatMessage CELL:', err.message);
          return false;
        }
      }
      return false;
    }

    case 'FLOTILLA':
    case 'GRUPO': {
      if (!id_personal || !destId) return false;
      try {
        const { rows } = await pool.query(
          `SELECT 1
           FROM grupo_personal gper
           JOIN grupo_operacion g  ON g.id_grupo_operacion  = gper.id_grupo_operacion
           LEFT JOIN grupo_operacion gp ON gp.id_grupo_operacion = g.id_grupo_padre
           WHERE g.id_operacion    = $1
             AND gper.id_personal  = $2
             AND (g.id_grupo_operacion::text = $3
                  OR gp.id_grupo_operacion::text = $3
                  OR g.nombre = $3 OR g.apodo = $3
                  OR gp.nombre = $3 OR gp.apodo = $3)
           LIMIT 1`,
          [idOperacion, id_personal, destId]
        );
        return rows.length > 0;
      } catch (err) {
        console.error('[SOCKET] canReceiveChatMessage FLOTILLA/GRUPO:', err.message);
        return false;
      }
    }

    default: return true;
  }
}

export async function emitChatMessage(io, idOperacion, payload) {
  const room    = `op_${idOperacion}`;
  const sockets = await io.in(room).fetchSockets();
  for (const sock of sockets) {
    try {
      if (await canReceiveChatMessage(sock, payload, idOperacion))
        sock.emit('chat_message', payload);
    } catch (err) {
      console.error('[SOCKET] emitChatMessage error:', err.message);
      sock.emit('chat_message', payload); // fallback: mejor mostrar que perder
    }
  }
}

// ── Emit filtrado de ruta_navegacion_creada ───────────────────
// Emite la ruta solo a sockets que tienen permiso de verla:
//   - Admin / CUT / CET / sin rol registrado → ven todo
//   - CELL → solo rutas generales (id_vehiculo null)
//            o rutas del vehículo al que están asignados en la operación
export async function emitRutaCreada(io, idOperacion, ruta) {
  const room   = `op_${idOperacion}`;
  const sockets = await io.in(room).fetchSockets();

  for (const sock of sockets) {
    const { rol, id_personal } = sock.userData || {};

    if (!rol || rol !== "CELL") {
      // Admin / CUT / CET / web dashboard → recibe todo
      sock.emit("ruta_navegacion_creada", { ruta });
      continue;
    }

    // CELL: ruta general siempre visible
    if (ruta.id_vehiculo == null) {
      sock.emit("ruta_navegacion_creada", { ruta });
      continue;
    }

    // CELL: verificar si está asignada al vehículo de la ruta
    if (id_personal) {
      try {
        const { rows } = await pool.query(
          `SELECT 1 FROM vehiculo_operacion
           WHERE id_operacion = $1 AND id_vehiculo = $2 AND id_personal = $3
           LIMIT 1`,
          [idOperacion, ruta.id_vehiculo, id_personal]
        );
        if (rows.length > 0) sock.emit("ruta_navegacion_creada", { ruta });
      } catch (err) {
        console.error("[SOCKET] Error filtrando ruta para célula:", err.message);
      }
    }
  }
}
