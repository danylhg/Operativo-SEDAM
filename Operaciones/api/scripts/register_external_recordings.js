import { copyFile, mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pool } from "../db.js";
import { ensureStreamStorageDir, resolveStreamRecordingPath } from "../utils/streamRecordings.js";

function getArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : fallback;
}

function sanitizeName(value) {
  return String(value || "rtmp")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 80);
}

async function listMp4Files(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const files = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMp4Files(entryPath)));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".mp4") {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function probeDurationMs(filePath, fallbackMs, ffprobePath) {
  if (!ffprobePath || !existsSync(ffprobePath)) return fallbackMs;

  const result = spawnSync(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath
  ], { encoding: "utf8" });

  const seconds = Number(String(result.stdout || "").trim());
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : fallbackMs;
}

async function moveFile(source, target) {
  await mkdir(dirname(target), { recursive: true });
  try {
    await rename(source, target);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    await copyFile(source, target);
    await unlink(source);
  }
}

async function removeEmptyParents(startDir, stopDir) {
  let current = resolve(startDir);
  const stop = resolve(stopDir);
  while (current.startsWith(stop) && current !== stop) {
    try {
      await rm(current, { recursive: false });
    } catch {
      return;
    }
    current = dirname(current);
  }
}

async function main() {
  const externalDeviceId = getArg("--external-device-id", "obs-01").trim();
  const sourceDir = resolve(getArg("--source-dir"));
  const segmentMs = Number(getArg("--segment-ms", "10000"));
  const fallbackDurationMs = Number.isFinite(segmentMs) && segmentMs > 0 ? Math.round(segmentMs) : 10000;
  const ffprobePath = getArg("--ffprobe-path", "");

  if (!externalDeviceId || !sourceDir) {
    throw new Error("Faltan --external-device-id o --source-dir");
  }

  const { rows } = await pool.query(
    `SELECT id_stream, id_operacion
     FROM media_stream_session
     WHERE source_type = 'EXTERNAL'
       AND external_device_id = $1
     ORDER BY (status = 'ACTIVE') DESC, started_at DESC
     LIMIT 1`,
    [externalDeviceId]
  );

  const stream = rows[0];
  if (!stream) {
    console.log(`[RTMP] No hay stream registrado para ${externalDeviceId}; se conservan los MP4 en ${sourceDir}`);
    return;
  }

  const files = await listMp4Files(sourceDir);
  if (files.length === 0) return;

  const idOperacion = Number(stream.id_operacion);
  const idStream = Number(stream.id_stream);
  await ensureStreamStorageDir(`op_${idOperacion}`, `stream_${idStream}`);

  let imported = 0;
  for (const [index, file] of files.entries()) {
    const fileStat = await stat(file);
    if (!fileStat.size) continue;

    const startedAt = new Date(fileStat.birthtimeMs || fileStat.mtimeMs || Date.now());
    const durationMs = probeDurationMs(file, fallbackDurationMs, ffprobePath);
    const endedAt = new Date(startedAt.getTime() + durationMs);
    const safeExternalId = sanitizeName(externalDeviceId);
    const filename = `rtmp_${safeExternalId}_${Date.now()}_${index}_${basename(file)}`;
    const storagePath = resolveStreamRecordingPath(`op_${idOperacion}`, `stream_${idStream}`, filename);

    await moveFile(file, storagePath);

    await pool.query(
      `INSERT INTO media_stream_recording (
         id_stream, id_operacion, mime_type, storage_path, original_filename,
         size_bytes, duration_ms, recorded_started_at, recorded_ended_at,
         recorded_by_tabla, recorded_by_id
       )
       VALUES ($1,$2,'video/mp4',$3,$4,$5,$6,$7,$8,'sistema',NULL)`,
      [
        idStream,
        idOperacion,
        storagePath,
        filename,
        fileStat.size,
        durationMs,
        startedAt.toISOString(),
        endedAt.toISOString()
      ]
    );

    imported += 1;
  }

  await removeEmptyParents(sourceDir, sourceDir);
  console.log(`[RTMP] Grabaciones importadas para ${externalDeviceId}: ${imported}`);
}

main()
  .catch((err) => {
    console.error(`[RTMP] Error importando grabaciones: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
