import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middlewares/auth.js";
import { sendDbError } from "../utils/dbErrors.js";
import { ensureExtendedTrackingSchema, ensurePersonalMotionTrackingSchema } from "../utils/trackingSchema.js";
import { derivePersonalTrackingFromDevice } from "../utils/personalTrackingFromDevices.js";
import { isInt } from "../utils/validators.js";

const router = Router();

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalHeadingDegrees(value) {
  const number = optionalNumber(value);
  if (number == null) return null;
  if (number === 360) return 360;
  return ((number % 360) + 360) % 360;
}

async function getLatestPersonalPosition(id_operacion, id_personal) {
  await ensurePersonalMotionTrackingSchema();
  const { rows } = await pool.query(
    `SELECT * FROM v_ultima_posicion_personal
     WHERE id_operacion = $1 AND id_personal = $2
     LIMIT 1`,
    [id_operacion, id_personal]
  );
  return rows[0] || null;
}

async function getLatestVehiculoPosition(id_operacion, id_vehiculo) {
  const { rows } = await pool.query(
    `SELECT * FROM v_ultima_posicion_vehiculo
     WHERE id_operacion = $1 AND id_vehiculo = $2
     LIMIT 1`,
    [id_operacion, id_vehiculo]
  );
  return rows[0] || null;
}

async function getLatestEquipoPosition(id_operacion, id_equipo) {
  await ensureExtendedTrackingSchema();
  const { rows } = await pool.query(
    `SELECT * FROM v_ultima_posicion_equipo
     WHERE id_operacion = $1 AND id_equipo = $2
     LIMIT 1`,
    [id_operacion, id_equipo]
  );
  return rows[0] || null;
}

async function getLatestDispositivoPosition(id_operacion, id_dispositivo) {
  await ensureExtendedTrackingSchema();
  const { rows } = await pool.query(
    `SELECT * FROM v_ultima_posicion_dispositivo
     WHERE id_operacion = $1 AND id_dispositivo = $2
     LIMIT 1`,
    [id_operacion, id_dispositivo]
  );
  return rows[0] || null;
}

async function verifyDeviceSerial(id_dispositivo, serial) {
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
    [Number(id_dispositivo), clean]
  );

  return rows.length > 0;
}

function optionalBoolean(value) {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "si", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return null;
}

function optionalInteger(value) {
  const number = optionalNumber(value);
  return number == null ? null : Math.trunc(number);
}

function firstPayloadValue(payload, ...keys) {
  for (const key of keys) {
    const value = payload?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
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

async function resolveDroneOperationId(payload) {
  const requested = Number(firstPayloadValue(
    payload,
    "id_operacion",
    "idOperacion",
    "operation_id",
    "operationId"
  ));

  if (isInt(requested)) return requested;

  const { rows } = await pool.query(
    `SELECT id_operacion
     FROM operacion
     WHERE estado = 'ACTIVA'
     ORDER BY fecha_inicio DESC NULLS LAST, id_operacion DESC
     LIMIT 1`
  );
  return rows[0]?.id_operacion || null;
}

async function resolveDroneEquipo({ id_operacion, id_equipo, serial }) {
  const numericId = Number(id_equipo);
  if (isInt(numericId)) {
    const { rows } = await pool.query(
      `SELECT e.id_equipo, e.numero_serie, e.nombre
       FROM equipo e
       WHERE e.id_equipo = $1
       LIMIT 1`,
      [numericId]
    );
    if (rows[0]) return rows[0];
  }

  if (serial) {
    const { rows } = await pool.query(
      `SELECT e.id_equipo, e.numero_serie, e.nombre
       FROM equipo e
       WHERE e.numero_serie = $1
       LIMIT 1`,
      [serial]
    );
    if (rows[0]) return rows[0];
  }

  const { rows } = await pool.query(
    `SELECT e.id_equipo, e.numero_serie, e.nombre
     FROM operacion_equipo oe
     JOIN equipo e ON e.id_equipo = oe.id_equipo
     LEFT JOIN equipo_tactico et ON et.id_equipo = e.id_equipo
     WHERE oe.id_operacion = $1
       AND oe.estado_asignacion != 'LIBERADO'
       AND UPPER(COALESCE(et.tipo_tactico, e.categoria, '')) = 'DRON'
     ORDER BY e.id_equipo
     LIMIT 1`,
    [id_operacion]
  );
  return rows[0] || null;
}

// ===============================
// TRACKING PUBLICO DRON
// ===============================

// GET /external/drone/telemetry - ultima telemetria publica del dron.
router.get("/external/drone/telemetry", async (req, res) => {
  const payload = req.query ?? {};
  const wantsInfo = ["1", "true", "si", "yes"].includes(
    String(firstPayloadValue(payload, "info", "help", "health") || "").trim().toLowerCase()
  );

  const baseResponse = {
    ok: true,
    mensaje: "Endpoint de telemetria dron activo",
    metodo_envio: "POST",
    post_url: "/external/drone/telemetry",
    campos_minimos: ["lat", "lng"],
    timestamp: new Date().toISOString()
  };

  if (wantsInfo) {
    return res.json(baseResponse);
  }

  try {
    await ensureExtendedTrackingSchema();

    const id_operacion = await resolveDroneOperationId(payload);
    if (!id_operacion) {
      return res.status(404).json({ ok: false, mensaje: "No hay operacion activa para consultar el dron" });
    }

    const serial = firstPayloadValue(payload, "EXTRA_SERIAL", "serial", "droneSerialNumber", "drone_serial");
    const equipo = await resolveDroneEquipo({
      id_operacion,
      id_equipo: firstPayloadValue(payload, "id_equipo", "idEquipo", "equipment_id"),
      serial
    });

    if (!equipo) {
      return res.status(404).json({
        ok: false,
        mensaje: "No se encontro un equipo dron asignado a la operacion activa"
      });
    }

    const latest = await getLatestEquipoPosition(id_operacion, equipo.id_equipo);

    return res.json({
      ...baseResponse,
      id_operacion,
      id_equipo: equipo.id_equipo,
      numero_serie_equipo: equipo.numero_serie,
      telemetry: latest || null
    });
  } catch (err) {
    return sendDbError(res, err, "Error consultando telemetria del dron");
  }
});

// POST /external/drone/telemetry - telemetria de app externa sin token.
router.post("/external/drone/telemetry", async (req, res) => {
  const payload = req.body ?? {};
  const latitud = firstPayloadValue(payload, "EXTRA_LAT", "latitud", "lat", "latitude");
  const longitud = firstPayloadValue(payload, "EXTRA_LNG", "longitud", "lng", "lon", "longitude");

  if (!validCoords(latitud, longitud)) {
    return res.status(400).json({ ok: false, mensaje: "Latitud/longitud invalidas" });
  }

  try {
    await ensureExtendedTrackingSchema();

    const id_operacion = await resolveDroneOperationId(payload);
    if (!id_operacion) {
      return res.status(404).json({ ok: false, mensaje: "No hay operacion activa para registrar el dron" });
    }

    const serial = firstPayloadValue(payload, "EXTRA_SERIAL", "serial", "droneSerialNumber", "drone_serial");
    const equipo = await resolveDroneEquipo({
      id_operacion,
      id_equipo: firstPayloadValue(payload, "id_equipo", "idEquipo", "equipment_id"),
      serial
    });

    if (!equipo) {
      return res.status(404).json({
        ok: false,
        mensaje: "No se encontro un equipo dron asignado a la operacion activa"
      });
    }

    const altitud = firstPayloadValue(payload, "EXTRA_ALT", "altitud", "alt", "altitude");
    const velocidad = firstPayloadValue(payload, "EXTRA_SPEED", "velocidad_kmh", "speed_kmh", "speed");
    const rumbo = firstPayloadValue(payload, "EXTRA_HEADING", "rumbo_grados", "heading", "heading_deg");
    const bateria = firstPayloadValue(payload, "EXTRA_BATTERY", "bateria_pct", "battery", "battery_pct");
    const modoVuelo = firstPayloadValue(payload, "EXTRA_FLIGHT_MODE", "modo_vuelo", "flight_mode");
    const tiempoVuelo = firstPayloadValue(payload, "EXTRA_FLIGHT_TIME", "tiempo_vuelo_s", "flight_time", "flight_time_s");

    const { rows } = await pool.query(
      `INSERT INTO tracking_equipo (
         id_operacion, id_equipo, latitud, longitud, altitud,
         velocidad_kmh, rumbo_grados, precision_m, bateria_pct,
         conectado, dron_encendido, modo_vuelo, pitch_grados, roll_grados,
         satelites, tiempo_vuelo_s, serial_dispositivo
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id_tracking, timestamp, estado_operacion_creacion`,
      [
        id_operacion,
        equipo.id_equipo,
        Number(latitud),
        Number(longitud),
        optionalNumber(altitud),
        optionalNumber(velocidad),
        optionalHeadingDegrees(rumbo),
        optionalNumber(firstPayloadValue(payload, "precision_m", "accuracy", "accuracy_m")),
        optionalNumber(bateria),
        optionalBoolean(firstPayloadValue(payload, "EXTRA_CONNECTED", "connected", "is_connected")),
        optionalBoolean(firstPayloadValue(payload, "EXTRA_DRONE_ON", "drone_on", "dron_encendido")),
        modoVuelo ? String(modoVuelo).trim() : null,
        optionalNumber(firstPayloadValue(payload, "EXTRA_PITCH", "pitch", "pitch_grados")),
        optionalNumber(firstPayloadValue(payload, "EXTRA_ROLL", "roll", "roll_grados")),
        optionalInteger(firstPayloadValue(payload, "EXTRA_SATS", "sats", "satellites")),
        optionalNumber(tiempoVuelo),
        serial ? String(serial).trim() : null
      ]
    );

    const latest = await getLatestEquipoPosition(id_operacion, equipo.id_equipo);
    const io = req.app.get("io");
    io?.to(`op_${id_operacion}`).emit("tracking_equipo", latest || {
      id_operacion,
      id_equipo: equipo.id_equipo,
      latitud: Number(latitud),
      longitud: Number(longitud),
      altitud: optionalNumber(altitud),
      velocidad_kmh: optionalNumber(velocidad),
      rumbo_grados: optionalHeadingDegrees(rumbo),
      bateria_pct: optionalNumber(bateria),
      serial_dispositivo: serial ? String(serial).trim() : null
    });

    return res.json({
      ok: true,
      id_operacion,
      id_equipo: equipo.id_equipo,
      numero_serie_equipo: equipo.numero_serie,
      tracking: rows[0]
    });
  } catch (err) {
    return sendDbError(res, err, "Error registrando telemetria del dron");
  }
});

// ===============================
// TRACKING PERSONAL
// ===============================

// POST /ops/:id/tracking/personal — registrar posición GPS de personal
router.post("/ops/:id/tracking/personal", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return res.status(400).json({ ok: false, mensaje: "id invalido" });

  const { id_personal, latitud, longitud, altitud, precision_m, velocidad_kmh, rumbo_grados } = req.body ?? {};
  if (!isInt(Number(id_personal))) return res.status(400).json({ ok: false, mensaje: "Falta id_personal" });
  if (latitud == null || longitud == null) return res.status(400).json({ ok: false, mensaje: "Falta latitud/longitud" });

  try {
    await ensurePersonalMotionTrackingSchema();
    const { rows } = await pool.query(
      `INSERT INTO tracking_personal (
         id_operacion, id_personal, latitud, longitud, altitud,
         precision_m, velocidad_kmh, rumbo_grados, fuente_tracking
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id_tracking, timestamp, estado_operacion_creacion`,
      [id_operacion, Number(id_personal), Number(latitud), Number(longitud),
        optionalNumber(altitud),
        optionalNumber(precision_m),
        optionalNumber(velocidad_kmh),
        optionalNumber(rumbo_grados),
        "GPS_DIRECTO"]
    );

    const latest = await getLatestPersonalPosition(id_operacion, Number(id_personal));
    const io = req.app.get("io");
    io?.to(`op_${id_operacion}`).emit("tracking_personal", latest || {
      id_operacion,
      id_personal: Number(id_personal),
      latitud: Number(latitud),
      longitud: Number(longitud),
      altitud: optionalNumber(altitud),
      precision_m: optionalNumber(precision_m),
      velocidad_kmh: optionalNumber(velocidad_kmh),
      rumbo_grados: optionalNumber(rumbo_grados)
    });

    res.json({ ok: true, tracking: rows[0] });
  } catch (err) {
    sendDbError(res, err, "Error registrando tracking personal");
  }
});

// GET /ops/:id/tracking/personal — última posición de todo el personal
router.get("/ops/:id/tracking/personal", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return res.status(400).json({ ok: false, mensaje: "id invalido" });
  try {
    await ensurePersonalMotionTrackingSchema();
    const { rows } = await pool.query(
      `SELECT * FROM v_ultima_posicion_personal WHERE id_operacion=$1`, [id_operacion]);
    res.json({ ok: true, items: rows });
  } catch (err) {
    sendDbError(res, err, "Error obteniendo posiciones personal");
  }
});

// GET /ops/:id/tracking/personal/:id_personal/historial — historial de posiciones
router.get("/ops/:id/tracking/personal/:id_personal/historial", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_personal = Number(req.params.id_personal);
  if (!isInt(id_operacion) || !isInt(id_personal))
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  try {
    await ensurePersonalMotionTrackingSchema();
    const { rows } = await pool.query(
      `SELECT id_tracking, latitud, longitud, altitud, precision_m, velocidad_kmh, rumbo_grados, timestamp,
              estado_operacion_creacion
       FROM tracking_personal
       WHERE id_operacion=$1 AND id_personal=$2
       ORDER BY timestamp ASC`,
      [id_operacion, id_personal]
    );
    res.json({ ok: true, items: rows });
  } catch (err) {
    sendDbError(res, err, "Error obteniendo historial personal");
  }
});

// ===============================
// TRACKING VEHÍCULOS
// ===============================

// POST /ops/:id/tracking/vehiculos — registrar posición GPS de vehículo
router.post("/ops/:id/tracking/vehiculos", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return res.status(400).json({ ok: false, mensaje: "id invalido" });

  const { id_vehiculo, latitud, longitud, altitud, velocidad_kmh, rumbo_grados, precision_m } = req.body ?? {};
  if (!isInt(Number(id_vehiculo))) return res.status(400).json({ ok: false, mensaje: "Falta id_vehiculo" });
  if (latitud == null || longitud == null) return res.status(400).json({ ok: false, mensaje: "Falta latitud/longitud" });

  try {
    const { rows } = await pool.query(
      `INSERT INTO tracking_vehiculo (id_operacion, id_vehiculo, latitud, longitud, altitud, velocidad_kmh, rumbo_grados, precision_m)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_tracking, timestamp, estado_operacion_creacion`,
      [id_operacion, Number(id_vehiculo), Number(latitud), Number(longitud),
        altitud != null ? Number(altitud) : null,
        velocidad_kmh != null ? Number(velocidad_kmh) : null,
        rumbo_grados != null ? Number(rumbo_grados) : null,
        precision_m != null ? Number(precision_m) : null]
    );

    const latest = await getLatestVehiculoPosition(id_operacion, Number(id_vehiculo));
    const io = req.app.get("io");
    io?.to(`op_${id_operacion}`).emit("tracking_vehiculo", latest || {
      id_operacion,
      id_vehiculo: Number(id_vehiculo),
      latitud: Number(latitud),
      longitud: Number(longitud),
      altitud: altitud != null ? Number(altitud) : null,
      velocidad_kmh: velocidad_kmh != null ? Number(velocidad_kmh) : null,
      rumbo_grados: rumbo_grados != null ? Number(rumbo_grados) : null,
      precision_m: precision_m != null ? Number(precision_m) : null
    });

    res.json({ ok: true, tracking: rows[0] });
  } catch (err) {
    sendDbError(res, err, "Error registrando tracking vehiculo");
  }
});

// GET /ops/:id/tracking/vehiculos — última posición de todos los vehículos
router.get("/ops/:id/tracking/vehiculos", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return res.status(400).json({ ok: false, mensaje: "id invalido" });
  try {
    const { rows } = await pool.query(
      `SELECT * FROM v_ultima_posicion_vehiculo WHERE id_operacion=$1`, [id_operacion]);
    res.json({ ok: true, items: rows });
  } catch (err) {
    sendDbError(res, err, "Error obteniendo posiciones vehiculos");
  }
});

// GET /ops/:id/tracking/vehiculos/:id_vehiculo/historial — historial de posiciones
router.get("/ops/:id/tracking/vehiculos/:id_vehiculo/historial", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_vehiculo = Number(req.params.id_vehiculo);
  if (!isInt(id_operacion) || !isInt(id_vehiculo))
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  try {
    const { rows } = await pool.query(
      `SELECT id_tracking, latitud, longitud, altitud, velocidad_kmh, rumbo_grados, precision_m, timestamp,
              estado_operacion_creacion
       FROM tracking_vehiculo
       WHERE id_operacion=$1 AND id_vehiculo=$2
       ORDER BY timestamp ASC`,
      [id_operacion, id_vehiculo]
    );
    res.json({ ok: true, items: rows });
  } catch (err) {
    sendDbError(res, err, "Error obteniendo historial vehiculo");
  }
});

// ===============================
// TRACKING EQUIPOS
// ===============================

// POST /ops/:id/tracking/equipos - registrar posicion GPS de equipo
router.post("/ops/:id/tracking/equipos", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return res.status(400).json({ ok: false, mensaje: "id invalido" });

  const { id_equipo, latitud, longitud, altitud, velocidad_kmh, rumbo_grados, precision_m } = req.body ?? {};
  if (!isInt(Number(id_equipo))) return res.status(400).json({ ok: false, mensaje: "Falta id_equipo" });
  if (!validCoords(latitud, longitud)) return res.status(400).json({ ok: false, mensaje: "Latitud/longitud invalidas" });

  try {
    await ensureExtendedTrackingSchema();
    const { rows } = await pool.query(
      `INSERT INTO tracking_equipo (
         id_operacion, id_equipo, latitud, longitud, altitud,
         velocidad_kmh, rumbo_grados, precision_m
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id_tracking, timestamp, estado_operacion_creacion`,
      [
        id_operacion,
        Number(id_equipo),
        Number(latitud),
        Number(longitud),
        optionalNumber(altitud),
        optionalNumber(velocidad_kmh),
        optionalNumber(rumbo_grados),
        optionalNumber(precision_m)
      ]
    );

    const latest = await getLatestEquipoPosition(id_operacion, Number(id_equipo));
    const io = req.app.get("io");
    io?.to(`op_${id_operacion}`).emit("tracking_equipo", latest || {
      id_operacion,
      id_equipo: Number(id_equipo),
      latitud: Number(latitud),
      longitud: Number(longitud),
      altitud: optionalNumber(altitud),
      velocidad_kmh: optionalNumber(velocidad_kmh),
      rumbo_grados: optionalNumber(rumbo_grados),
      precision_m: optionalNumber(precision_m)
    });

    res.json({ ok: true, tracking: rows[0] });
  } catch (err) {
    sendDbError(res, err, "Error registrando tracking equipo");
  }
});

// GET /ops/:id/tracking/equipos - ultima posicion de todos los equipos
router.get("/ops/:id/tracking/equipos", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return res.status(400).json({ ok: false, mensaje: "id invalido" });
  try {
    await ensureExtendedTrackingSchema();
    const { rows } = await pool.query(
      `SELECT * FROM v_ultima_posicion_equipo WHERE id_operacion=$1`, [id_operacion]);
    res.json({ ok: true, items: rows });
  } catch (err) {
    sendDbError(res, err, "Error obteniendo posiciones equipos");
  }
});

// GET /ops/:id/tracking/equipos/:id_equipo/historial - historial de posiciones
router.get("/ops/:id/tracking/equipos/:id_equipo/historial", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_equipo = Number(req.params.id_equipo);
  if (!isInt(id_operacion) || !isInt(id_equipo))
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  try {
    await ensureExtendedTrackingSchema();
    const { rows } = await pool.query(
      `SELECT id_tracking, latitud, longitud, altitud, velocidad_kmh, rumbo_grados, precision_m, timestamp,
              estado_operacion_creacion
       FROM tracking_equipo
       WHERE id_operacion=$1 AND id_equipo=$2
       ORDER BY timestamp ASC`,
      [id_operacion, id_equipo]
    );
    res.json({ ok: true, items: rows });
  } catch (err) {
    sendDbError(res, err, "Error obteniendo historial equipo");
  }
});

// ===============================
// TRACKING DISPOSITIVOS
// ===============================

// POST /ops/:id/tracking/dispositivos - registrar posicion GPS de dispositivo
router.post("/ops/:id/tracking/dispositivos", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return res.status(400).json({ ok: false, mensaje: "id invalido" });

  const payload = req.body ?? {};
  const {
    id_dispositivo,
    latitud,
    longitud,
    altitud,
    velocidad_kmh,
    rumbo_grados,
    precision_m,
    bateria_pct
  } = payload;
  const serialDispositivo = firstPayloadValue(
    payload,
    "serial_dispositivo",
    "numero_serie",
    "numeroSerie",
    "serial",
    "imei",
    "identificador_app"
  );
  if (!isInt(Number(id_dispositivo))) return res.status(400).json({ ok: false, mensaje: "Falta id_dispositivo" });
  if (!validCoords(latitud, longitud)) return res.status(400).json({ ok: false, mensaje: "Latitud/longitud invalidas" });

  try {
    await ensureExtendedTrackingSchema();
    const serialOk = await verifyDeviceSerial(id_dispositivo, serialDispositivo);
    if (!serialOk) {
      return res.status(409).json({
        ok: false,
        mensaje: serialDispositivo
          ? "El numero de serie no coincide con el dispositivo"
          : "Falta numero de serie del dispositivo"
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO tracking_dispositivo (
         id_operacion, id_dispositivo, latitud, longitud, altitud,
         velocidad_kmh, rumbo_grados, precision_m, bateria_pct, serial_dispositivo
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id_tracking, timestamp, estado_operacion_creacion`,
      [
        id_operacion,
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

    const latest = await getLatestDispositivoPosition(id_operacion, Number(id_dispositivo));
    const io = req.app.get("io");
    io?.to(`op_${id_operacion}`).emit("tracking_dispositivo", latest || {
      id_operacion,
      id_dispositivo: Number(id_dispositivo),
      latitud: Number(latitud),
      longitud: Number(longitud),
      altitud: optionalNumber(altitud),
      velocidad_kmh: optionalNumber(velocidad_kmh),
      rumbo_grados: optionalNumber(rumbo_grados),
      precision_m: optionalNumber(precision_m),
      bateria_pct: optionalNumber(bateria_pct),
      serial_dispositivo: serialDispositivo ? String(serialDispositivo).trim() : null
    });

    let personalFromDevices = null;
    try {
      personalFromDevices = await derivePersonalTrackingFromDevice(id_operacion, Number(id_dispositivo));
      if (personalFromDevices) {
        io?.to(`op_${id_operacion}`).emit("tracking_personal", personalFromDevices);
      }
    } catch (aggregateErr) {
      console.error("[TRACKING] Error calculando tracking_personal desde dispositivo:", aggregateErr.message);
    }

    res.json({ ok: true, tracking: rows[0], tracking_personal: personalFromDevices });
  } catch (err) {
    sendDbError(res, err, "Error registrando tracking dispositivo");
  }
});

// GET /ops/:id/tracking/dispositivos - ultima posicion de todos los dispositivos
router.get("/ops/:id/tracking/dispositivos", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return res.status(400).json({ ok: false, mensaje: "id invalido" });
  try {
    await ensureExtendedTrackingSchema();
    const { rows } = await pool.query(
      `SELECT * FROM v_ultima_posicion_dispositivo WHERE id_operacion=$1`, [id_operacion]);
    res.json({ ok: true, items: rows });
  } catch (err) {
    sendDbError(res, err, "Error obteniendo posiciones dispositivos");
  }
});

// GET /ops/:id/tracking/dispositivos/:id_dispositivo/historial - historial de posiciones
router.get("/ops/:id/tracking/dispositivos/:id_dispositivo/historial", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_dispositivo = Number(req.params.id_dispositivo);
  if (!isInt(id_operacion) || !isInt(id_dispositivo))
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  try {
    await ensureExtendedTrackingSchema();
    const { rows } = await pool.query(
      `SELECT id_tracking, latitud, longitud, altitud, velocidad_kmh, rumbo_grados, precision_m, bateria_pct, timestamp,
              estado_operacion_creacion
       FROM tracking_dispositivo
       WHERE id_operacion=$1 AND id_dispositivo=$2
       ORDER BY timestamp ASC`,
      [id_operacion, id_dispositivo]
    );
    res.json({ ok: true, items: rows });
  } catch (err) {
    sendDbError(res, err, "Error obteniendo historial dispositivo");
  }
});

export default router;
