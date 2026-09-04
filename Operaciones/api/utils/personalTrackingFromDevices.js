import { pool } from "../db.js";
import { ensureExtendedTrackingSchema, ensurePersonalMotionTrackingSchema } from "./trackingSchema.js";

const ACTIVE_DEVICE_WINDOW_MINUTES = 5;
const DEVICE_CLUSTER_RADIUS_M = 50;

const DEVICE_TYPE_PRIORITY = {
  SMARTWATCH: 4,
  WATCH: 4,
  TELEFONO: 3,
  CELULAR: 3,
  PHONE: 3,
  TABLET: 2,
  LORA: 1.5,
  GPS: 1.5,
  RADIO: 1.2,
};

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeType(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function deviceTypePriority(row) {
  return DEVICE_TYPE_PRIORITY[normalizeType(row.tipo)] || 1;
}

function timestampMs(value) {
  if (!value) return Date.now();
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

function deviceWeight(row) {
  const precision = optionalNumber(row.precision_m);
  const accuracyWeight = 1 / Math.max(precision || 35, 5);
  const ageMinutes = Math.max(0, (Date.now() - timestampMs(row.ultima_actualizacion)) / 60000);
  const recencyWeight = Math.max(0.2, 1 - ageMinutes / ACTIVE_DEVICE_WINDOW_MINUTES);
  return deviceTypePriority(row) * accuracyWeight * recencyWeight;
}

function distanceMeters(a, b) {
  const lat1 = Number(a.latitud) * Math.PI / 180;
  const lat2 = Number(b.latitud) * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (Number(b.longitud) - Number(a.longitud)) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function weightedAverage(rows, key) {
  let total = 0;
  let weighted = 0;
  rows.forEach((row) => {
    const value = optionalNumber(row[key]);
    if (value == null) return;
    total += row.__weight;
    weighted += value * row.__weight;
  });
  return total > 0 ? weighted / total : null;
}

function buildPersonalPosition(rows) {
  const candidates = rows
    .map((row) => ({
      ...row,
      latitud: optionalNumber(row.latitud),
      longitud: optionalNumber(row.longitud),
      __weight: deviceWeight(row),
    }))
    .filter((row) => row.latitud != null && row.longitud != null && row.__weight > 0)
    .sort((a, b) => b.__weight - a.__weight);

  if (!candidates.length) return null;

  const best = candidates[0];
  const cluster = candidates.filter((row) => distanceMeters(best, row) <= DEVICE_CLUSTER_RADIUS_M);
  const used = cluster.length > 1 ? cluster : [best];
  const totalWeight = used.reduce((sum, row) => sum + row.__weight, 0);
  const latitud = used.reduce((sum, row) => sum + row.latitud * row.__weight, 0) / totalWeight;
  const longitud = used.reduce((sum, row) => sum + row.longitud * row.__weight, 0) / totalWeight;
  const bestPrecision = optionalNumber(best.precision_m);

  return {
    latitud,
    longitud,
    altitud: weightedAverage(used, "altitud"),
    velocidad_kmh: weightedAverage(used, "velocidad_kmh"),
    rumbo_grados: optionalNumber(best.rumbo_grados),
    precision_m: bestPrecision,
    confianza_tracking: used.length > 1 && used.length === candidates.length ? "ALTA" : "MEDIA",
    dispositivos_fuente: used.map((row) => ({
      id_dispositivo: Number(row.id_dispositivo),
      tipo: row.tipo || null,
      marca: row.marca || null,
      modelo: row.modelo || null,
      precision_m: optionalNumber(row.precision_m),
      ultima_actualizacion: row.ultima_actualizacion,
    })),
  };
}

export async function getLatestDevicePosition(idOperacion, idDispositivo) {
  await ensureExtendedTrackingSchema();
  const { rows } = await pool.query(
    `SELECT *
       FROM v_ultima_posicion_dispositivo
      WHERE id_operacion = $1
        AND id_dispositivo = $2
      LIMIT 1`,
    [idOperacion, idDispositivo]
  );
  return rows[0] || null;
}

async function getAssignedPersonalForDevice(idOperacion, idDispositivo) {
  const { rows } = await pool.query(
    `SELECT od.id_personal, p.apodo, p.rol
       FROM operacion_dispositivo od
       JOIN personal p ON p.id_personal = od.id_personal
      WHERE od.id_operacion = $1
        AND od.id_dispositivo = $2
        AND od.estado_asignacion = 'ASIGNADO'
        AND od.fecha_devolucion IS NULL
      LIMIT 1`,
    [idOperacion, idDispositivo]
  );
  return rows[0] || null;
}

async function getActiveDevicePositionsForPersonal(idOperacion, idPersonal) {
  const { rows } = await pool.query(
    `SELECT *
       FROM v_ultima_posicion_dispositivo
      WHERE id_operacion = $1
        AND id_personal = $2
        AND ultima_actualizacion >= NOW() - INTERVAL '${ACTIVE_DEVICE_WINDOW_MINUTES} minutes'
      ORDER BY id_dispositivo`,
    [idOperacion, idPersonal]
  );
  return rows;
}

async function getLatestPersonalPosition(idOperacion, idPersonal) {
  await ensurePersonalMotionTrackingSchema();
  const { rows } = await pool.query(
    `SELECT *
       FROM v_ultima_posicion_personal
      WHERE id_operacion = $1
        AND id_personal = $2
      LIMIT 1`,
    [idOperacion, idPersonal]
  );
  return rows[0] || null;
}

export async function derivePersonalTrackingFromDevice(idOperacion, idDispositivo) {
  await ensureExtendedTrackingSchema();
  await ensurePersonalMotionTrackingSchema();

  const assignment = await getAssignedPersonalForDevice(idOperacion, idDispositivo);
  if (!assignment?.id_personal) return null;

  const deviceRows = await getActiveDevicePositionsForPersonal(idOperacion, assignment.id_personal);
  const position = buildPersonalPosition(deviceRows);
  if (!position) return null;

  await pool.query(
    `INSERT INTO tracking_personal (
       id_operacion, id_personal, latitud, longitud, altitud,
       precision_m, velocidad_kmh, rumbo_grados,
       fuente_tracking, dispositivos_fuente, confianza_tracking
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
    [
      idOperacion,
      Number(assignment.id_personal),
      position.latitud,
      position.longitud,
      position.altitud,
      position.precision_m,
      position.velocidad_kmh,
      position.rumbo_grados,
      "DISPOSITIVOS",
      JSON.stringify(position.dispositivos_fuente),
      position.confianza_tracking,
    ]
  );

  const latest = await getLatestPersonalPosition(idOperacion, Number(assignment.id_personal));
  if (!latest) return null;

  return {
    ...latest,
    apodo: latest.apodo || assignment.apodo,
    nombre: latest.apodo || assignment.apodo,
    rol: latest.rol || assignment.rol,
  };
}
