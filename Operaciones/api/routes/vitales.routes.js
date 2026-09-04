import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middlewares/auth.js";
import { sendDbError } from "../utils/dbErrors.js";
import { isInt } from "../utils/validators.js";

const router = Router();

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

const NUMERIC_ALIASES = {
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

const RANGES = {
  frecuencia_cardiaca_bpm: [20, 240, "frecuencia cardiaca fuera de rango"],
  oxigenacion_spo2: [0, 100, "oxigenacion fuera de rango"],
  temperatura_c: [25, 45, "temperatura fuera de rango"],
  frecuencia_respiratoria_rpm: [1, 80, "frecuencia respiratoria fuera de rango"],
  presion_sistolica_mmhg: [30, 260, "presion sistolica fuera de rango"],
  presion_diastolica_mmhg: [20, 180, "presion diastolica fuera de rango"],
  pasos: [0, Number.MAX_SAFE_INTEGER, "pasos fuera de rango"],
  presion_barometrica_hpa: [300, 1100, "presion barometrica fuera de rango"],
  bateria_pct: [0, 100, "bateria fuera de rango"],
  latitud: [-90, 90, "latitud fuera de rango"],
  longitud: [-180, 180, "longitud fuera de rango"],
};

function firstPresent(body, keys) {
  for (const key of keys) {
    if (body?.[key] !== undefined && body?.[key] !== null && body?.[key] !== "") {
      return body[key];
    }
  }
  return null;
}

function readNumber(body, canonicalKey) {
  const raw = firstPresent(body, NUMERIC_ALIASES[canonicalKey] || [canonicalKey]);
  if (raw == null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    const err = new Error(`${canonicalKey} debe ser numerico`);
    err.statusCode = 400;
    throw err;
  }

  const [min, max, message] = RANGES[canonicalKey] || [];
  if (min != null && (value < min || value > max)) {
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  }

  return canonicalKey === "pasos" ? Math.round(value) : value;
}

function readText(body, key, fallback = null) {
  const raw = body?.[key];
  if (raw === undefined || raw === null) return fallback;
  const value = String(raw).trim();
  return value || fallback;
}

function readTimestamp(body) {
  const raw = firstPresent(body, ["timestamp", "capturado_en", "fecha"]);
  if (raw == null) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    const err = new Error("timestamp invalido");
    err.statusCode = 400;
    throw err;
  }
  return date.toISOString();
}

function validateRangePayload(body = {}) {
  const payload = {};
  for (const key of [...VITAL_KEYS, "latitud", "longitud"]) {
    payload[key] = readNumber(body, key);
  }
  if (VITAL_KEYS.every((key) => payload[key] == null)) {
    const err = new Error("Debes enviar al menos un signo vital");
    err.statusCode = 400;
    throw err;
  }
  return payload;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function publicVital(row = {}) {
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

async function getAssignedPersonal(id_operacion, id_personal) {
  const { rows } = await pool.query(
    `SELECT a.id_operacion, a.id_personal, p.apodo, p.nombre, p.apellido, p.rol
       FROM asignacion_operacion_personal a
       JOIN personal p ON p.id_personal = a.id_personal
      WHERE a.id_operacion = $1
        AND a.id_personal = $2
        AND a.estado_asignacion NOT IN ('LIBERADO')
      LIMIT 1`,
    [id_operacion, id_personal]
  );
  return rows[0] || null;
}

async function getLatestVital(id_operacion, id_personal) {
  const { rows } = await pool.query(
    `SELECT *
       FROM v_ultimos_signos_vitales_personal
      WHERE id_operacion = $1
        AND id_personal = $2
      LIMIT 1`,
    [id_operacion, id_personal]
  );
  return rows[0] || null;
}

async function createVitalSigns(req, res) {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return res.status(400).json({ ok: false, mensaje: "id invalido" });

  const body = req.body ?? {};
  const id_personal = Number(body.id_personal);
  if (!isInt(id_personal)) return res.status(400).json({ ok: false, mensaje: "Falta id_personal" });

  if (req.user?.tabla === "personal" && Number(req.user.sub) !== id_personal) {
    return res.status(403).json({ ok: false, mensaje: "No puedes cargar signos vitales de otro elemento" });
  }

  let vitales;
  let timestamp;
  try {
    vitales = validateRangePayload(body);
    timestamp = readTimestamp(body);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ ok: false, mensaje: err.message });
  }

  const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
    ? body.metadata
    : {};

  try {
    const assigned = await getAssignedPersonal(id_operacion, id_personal);
    if (!assigned) {
      return res.status(404).json({ ok: false, mensaje: "Personal no asignado a la operacion" });
    }

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
        id_operacion,
        id_personal,
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
        readText(body, "dispositivo_id"),
        readText(body, "origen", "SMARTWATCH"),
        JSON.stringify(metadata),
        timestamp,
      ]
    );

    const latest = await getLatestVital(id_operacion, id_personal);
    const payload = publicVital(latest || { ...rows[0], ...assigned });

    const io = req.app.get("io");
    io?.to(`op_${id_operacion}`).emit("signos_vitales_personal", payload);

    res.status(201).json({ ok: true, signos: payload });
  } catch (err) {
    sendDbError(res, err, "Error registrando signos vitales");
  }
}

router.post("/ops/:id/signos-vitales", requireAuth, createVitalSigns);
router.post("/ops/:id/vitales", requireAuth, createVitalSigns);

router.get("/ops/:id/signos-vitales/latest", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return res.status(400).json({ ok: false, mensaje: "id invalido" });

  const id_personal = req.query.id_personal != null ? Number(req.query.id_personal) : null;
  if (id_personal != null && !isInt(id_personal)) {
    return res.status(400).json({ ok: false, mensaje: "id_personal invalido" });
  }

  try {
    const params = [id_operacion];
    const personalFilter = id_personal != null ? "AND id_personal = $2" : "";
    if (id_personal != null) params.push(id_personal);

    const { rows } = await pool.query(
      `SELECT *
         FROM v_ultimos_signos_vitales_personal
        WHERE id_operacion = $1
        ${personalFilter}
        ORDER BY id_personal ASC`,
      params
    );
    res.json({ ok: true, items: rows.map(publicVital) });
  } catch (err) {
    sendDbError(res, err, "Error obteniendo signos vitales");
  }
});

router.get("/ops/:id/signos-vitales/:id_personal/historial", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_personal = Number(req.params.id_personal);
  if (!isInt(id_operacion) || !isInt(id_personal)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);

  try {
    const { rows } = await pool.query(
      `SELECT svp.*, p.apodo, p.nombre, p.apellido, p.rol
         FROM signos_vitales_personal svp
         JOIN personal p ON p.id_personal = svp.id_personal
        WHERE svp.id_operacion = $1
          AND svp.id_personal = $2
        ORDER BY svp."timestamp" DESC, svp.id_signo_vital DESC
        LIMIT $3`,
      [id_operacion, id_personal, limit]
    );
    res.json({ ok: true, items: rows.map(publicVital) });
  } catch (err) {
    sendDbError(res, err, "Error obteniendo historial de signos vitales");
  }
});

export default router;
