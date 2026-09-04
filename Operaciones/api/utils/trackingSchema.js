import { pool } from "../db.js";

const TRACKING_SCHEMA_LOCK_NAME = "operaciones_tracking_schema";
const TRANSIENT_LOCK_ERRORS = new Set(["40P01", "55P03"]);

let extendedTrackingReady = false;
let personalMotionTrackingReady = false;
let extendedTrackingPromise = null;
let personalMotionTrackingPromise = null;

const PERSONAL_TRACKING_COLUMNS = [
  "velocidad_kmh",
  "rumbo_grados",
  "fuente_tracking",
  "dispositivos_fuente",
  "confianza_tracking",
];

const PERSONAL_POSITION_VIEW_COLUMNS = [
  "velocidad_kmh",
  "rumbo_grados",
  "fuente_tracking",
  "dispositivos_fuente",
  "confianza_tracking",
  "frecuencia_cardiaca_bpm",
  "bateria_pct",
  "signos_actualizacion",
];

const DISPOSITIVO_COLUMNS = ["imagen_disp", "identificador_app"];

const TRACKING_EQUIPO_COLUMNS = [
  "id_tracking",
  "id_operacion",
  "id_equipo",
  "latitud",
  "longitud",
  "bateria_pct",
  "conectado",
  "dron_encendido",
  "modo_vuelo",
  "pitch_grados",
  "roll_grados",
  "satelites",
  "tiempo_vuelo_s",
  "serial_dispositivo",
];

const TRACKING_DISPOSITIVO_COLUMNS = [
  "id_tracking",
  "id_operacion",
  "id_dispositivo",
  "latitud",
  "longitud",
  "bateria_pct",
  "serial_dispositivo",
];

const EQUIPO_POSITION_VIEW_COLUMNS = [
  "id_tracking",
  "id_equipo",
  "tipo_equipo",
  "bateria_pct",
  "conectado",
  "serial_dispositivo",
  "ultima_actualizacion",
];

const DISPOSITIVO_POSITION_VIEW_COLUMNS = [
  "id_tracking",
  "id_dispositivo",
  "imagen_disp",
  "identificador_app",
  "id_personal",
  "serial_dispositivo",
  "ultima_actualizacion",
];

const EXTENDED_INDEXES = [
  "uq_dispositivo_identificador_app",
  "idx_tracking_equipo_op_eq_ts",
  "idx_tracking_equipo_ts",
  "idx_tracking_equipo_estado_operacion_creacion",
  "idx_tracking_dispositivo_op_disp_ts",
  "idx_tracking_dispositivo_ts",
  "idx_tracking_dispositivo_estado_operacion_creacion",
];

const EXTENDED_TRIGGERS = [
  ["tracking_equipo", "tr_estado_operacion_creacion"],
  ["tracking_dispositivo", "tr_estado_operacion_creacion"],
  ["tracking_equipo", "tr_tracking_equipo_op_modificable"],
  ["tracking_dispositivo", "tr_tracking_dispositivo_op_modificable"],
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hasColumns(client, relationName, columns) {
  const { rows } = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = ANY($2::text[])`,
    [relationName, columns]
  );
  return new Set(rows.map((row) => row.column_name)).size === columns.length;
}

async function hasConstraints(client, constraintNames) {
  const { rows } = await client.query(
    `SELECT conname
       FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public'
        AND c.conname = ANY($1::text[])`,
    [constraintNames]
  );
  return new Set(rows.map((row) => row.conname)).size === constraintNames.length;
}

async function hasIndexes(client, indexNames) {
  const { rows } = await client.query(
    `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'i'
        AND c.relname = ANY($1::text[])`,
    [indexNames]
  );
  return new Set(rows.map((row) => row.relname)).size === indexNames.length;
}

async function hasFunctions(client, functionNames) {
  const { rows } = await client.query(
    `SELECT p.proname
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = ANY($1::text[])`,
    [functionNames]
  );
  return new Set(rows.map((row) => row.proname)).size === functionNames.length;
}

async function hasTriggers(client, triggers) {
  const triggerKeys = triggers.map(([tableName, triggerName]) => `${tableName}.${triggerName}`);
  const { rows } = await client.query(
    `SELECT c.relname || '.' || t.tgname AS trigger_key
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND NOT t.tgisinternal
        AND c.relname || '.' || t.tgname = ANY($1::text[])`,
    [triggerKeys]
  );
  return new Set(rows.map((row) => row.trigger_key)).size === triggerKeys.length;
}

async function isPersonalMotionTrackingSchemaReady(client) {
  return (await hasColumns(client, "tracking_personal", PERSONAL_TRACKING_COLUMNS)) &&
    (await hasColumns(client, "v_ultima_posicion_personal", PERSONAL_POSITION_VIEW_COLUMNS)) &&
    (await hasConstraints(client, ["chk_tp_rumbo"]));
}

async function isExtendedTrackingSchemaReady(client) {
  return (await isPersonalMotionTrackingSchemaReady(client)) &&
    (await hasColumns(client, "dispositivo", DISPOSITIVO_COLUMNS)) &&
    (await hasColumns(client, "tracking_equipo", TRACKING_EQUIPO_COLUMNS)) &&
    (await hasColumns(client, "tracking_dispositivo", TRACKING_DISPOSITIVO_COLUMNS)) &&
    (await hasColumns(client, "v_ultima_posicion_equipo", EQUIPO_POSITION_VIEW_COLUMNS)) &&
    (await hasColumns(client, "v_ultima_posicion_dispositivo", DISPOSITIVO_POSITION_VIEW_COLUMNS)) &&
    (await hasIndexes(client, EXTENDED_INDEXES)) &&
    (await hasFunctions(client, [
      "fn_set_estado_operacion_creacion_tracking_ext",
      "fn_validar_tracking_ext_modificable",
    ])) &&
    (await hasTriggers(client, EXTENDED_TRIGGERS));
}

async function withTrackingSchemaLock(callback) {
  const client = await pool.connect();
  let locked = false;

  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext($1::text)::bigint)",
      [TRACKING_SCHEMA_LOCK_NAME]
    );
    locked = true;
    return await callback(client);
  } finally {
    if (locked) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext($1::text)::bigint)",
          [TRACKING_SCHEMA_LOCK_NAME]
        );
      } catch (err) {
        console.error("[DB SCHEMA] Error liberando lock de tracking:", err.message);
      }
    }

    client.release();
  }
}

async function querySchemaSql(client, sql) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await client.query(sql);
    } catch (err) {
      if (!TRANSIENT_LOCK_ERRORS.has(err.code) || attempt === 3) throw err;
      await delay(200 * attempt);
    }
  }
}

export async function ensurePersonalMotionTrackingSchema() {
  if (personalMotionTrackingReady) return;
  if (personalMotionTrackingPromise) return personalMotionTrackingPromise;

  personalMotionTrackingPromise = withTrackingSchemaLock(async (client) => {
    if (await isPersonalMotionTrackingSchemaReady(client)) {
      return;
    }

    await querySchemaSql(client, `
    ALTER TABLE tracking_personal
      ADD COLUMN IF NOT EXISTS velocidad_kmh NUMERIC(6,2),
      ADD COLUMN IF NOT EXISTS rumbo_grados NUMERIC(5,2),
      ADD COLUMN IF NOT EXISTS fuente_tracking TEXT,
      ADD COLUMN IF NOT EXISTS dispositivos_fuente JSONB,
      ADD COLUMN IF NOT EXISTS confianza_tracking TEXT;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_tp_rumbo'
      ) THEN
        ALTER TABLE tracking_personal
          ADD CONSTRAINT chk_tp_rumbo CHECK (
            rumbo_grados IS NULL OR rumbo_grados BETWEEN 0 AND 360
          );
      END IF;
    END $$;

    DROP VIEW IF EXISTS v_ultima_posicion_personal;
    CREATE VIEW v_ultima_posicion_personal AS
    SELECT DISTINCT ON (tp.id_operacion, tp.id_personal)
      tp.id_operacion,
      tp.id_personal,
      p.apodo,
      p.rol,
      tp.latitud,
      tp.longitud,
      tp.altitud,
      tp.velocidad_kmh,
      tp.rumbo_grados,
      tp.precision_m,
      tp.fuente_tracking,
      tp.dispositivos_fuente,
      tp.confianza_tracking,
      tp."timestamp" AS ultima_actualizacion,
      tp.estado_operacion_creacion,
      sv.frecuencia_cardiaca_bpm,
      sv.frecuencia_cardiaca,
      sv.fc,
      sv.heart_rate,
      sv.oxigenacion_spo2,
      sv.spo2,
      sv.temperatura_c,
      sv.frecuencia_respiratoria_rpm,
      sv.presion_sistolica_mmhg,
      sv.presion_diastolica_mmhg,
      sv.pasos,
      sv.presion_barometrica_hpa,
      sv.barometro,
      sv.baro,
      sv.bateria_pct,
      sv.bateria,
      sv.signos_actualizacion
    FROM tracking_personal tp
    JOIN personal p ON p.id_personal = tp.id_personal
    LEFT JOIN v_ultimos_signos_vitales_personal sv
      ON sv.id_operacion = tp.id_operacion
     AND sv.id_personal = tp.id_personal
    ORDER BY tp.id_operacion, tp.id_personal, tp."timestamp" DESC;
  `);

    if (!(await isPersonalMotionTrackingSchemaReady(client))) {
      throw new Error("No se pudo preparar el esquema de tracking_personal");
    }
  })
    .then(() => {
      personalMotionTrackingReady = true;
    })
    .catch((err) => {
      personalMotionTrackingPromise = null;
      throw err;
    });

  return personalMotionTrackingPromise;
}

export async function ensureExtendedTrackingSchema() {
  if (extendedTrackingReady) return;
  if (extendedTrackingPromise) return extendedTrackingPromise;

  extendedTrackingPromise = withTrackingSchemaLock(async (client) => {
    if (await isExtendedTrackingSchemaReady(client)) {
      return;
    }

    await querySchemaSql(client, `
    ALTER TABLE dispositivo
      ADD COLUMN IF NOT EXISTS imagen_disp TEXT,
      ADD COLUMN IF NOT EXISTS identificador_app TEXT;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_dispositivo_identificador_app
      ON dispositivo(identificador_app)
      WHERE identificador_app IS NOT NULL AND btrim(identificador_app) <> '';

    ALTER TABLE tracking_personal
      ADD COLUMN IF NOT EXISTS velocidad_kmh NUMERIC(6,2),
      ADD COLUMN IF NOT EXISTS rumbo_grados NUMERIC(5,2),
      ADD COLUMN IF NOT EXISTS fuente_tracking TEXT,
      ADD COLUMN IF NOT EXISTS dispositivos_fuente JSONB,
      ADD COLUMN IF NOT EXISTS confianza_tracking TEXT;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_tp_rumbo'
      ) THEN
        ALTER TABLE tracking_personal
          ADD CONSTRAINT chk_tp_rumbo CHECK (
            rumbo_grados IS NULL OR rumbo_grados BETWEEN 0 AND 360
          );
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS tracking_equipo (
      id_tracking BIGSERIAL PRIMARY KEY,
      id_operacion INT NOT NULL REFERENCES operacion(id_operacion) ON DELETE CASCADE,
      id_equipo INT NOT NULL REFERENCES equipo(id_equipo) ON DELETE CASCADE,
      latitud NUMERIC(8,5) NOT NULL,
      longitud NUMERIC(9,5) NOT NULL,
      altitud NUMERIC(7,2),
      velocidad_kmh NUMERIC(6,2),
      rumbo_grados NUMERIC(5,2),
      precision_m NUMERIC(6,2),
      "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      estado_operacion_creacion estado_operacion_enum,
      CONSTRAINT chk_te_latitud CHECK (latitud BETWEEN -90 AND 90),
      CONSTRAINT chk_te_longitud CHECK (longitud BETWEEN -180 AND 180),
      CONSTRAINT chk_te_rumbo CHECK (
        rumbo_grados IS NULL OR rumbo_grados BETWEEN 0 AND 360
      )
    );

    CREATE INDEX IF NOT EXISTS idx_tracking_equipo_op_eq_ts
      ON tracking_equipo(id_operacion, id_equipo, "timestamp" DESC);

    CREATE INDEX IF NOT EXISTS idx_tracking_equipo_ts
      ON tracking_equipo("timestamp" DESC);

    CREATE INDEX IF NOT EXISTS idx_tracking_equipo_estado_operacion_creacion
      ON tracking_equipo(id_operacion, estado_operacion_creacion);

    ALTER TABLE tracking_equipo
      ADD COLUMN IF NOT EXISTS bateria_pct NUMERIC(5,2),
      ADD COLUMN IF NOT EXISTS conectado BOOLEAN,
      ADD COLUMN IF NOT EXISTS dron_encendido BOOLEAN,
      ADD COLUMN IF NOT EXISTS modo_vuelo TEXT,
      ADD COLUMN IF NOT EXISTS pitch_grados NUMERIC(7,2),
      ADD COLUMN IF NOT EXISTS roll_grados NUMERIC(7,2),
      ADD COLUMN IF NOT EXISTS satelites INT,
      ADD COLUMN IF NOT EXISTS tiempo_vuelo_s NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS serial_dispositivo TEXT;

    CREATE TABLE IF NOT EXISTS tracking_dispositivo (
      id_tracking BIGSERIAL PRIMARY KEY,
      id_operacion INT NOT NULL REFERENCES operacion(id_operacion) ON DELETE CASCADE,
      id_dispositivo INT NOT NULL REFERENCES dispositivo(id_dispositivo) ON DELETE CASCADE,
      latitud NUMERIC(8,5) NOT NULL,
      longitud NUMERIC(9,5) NOT NULL,
      altitud NUMERIC(7,2),
      velocidad_kmh NUMERIC(6,2),
      rumbo_grados NUMERIC(5,2),
      precision_m NUMERIC(6,2),
      bateria_pct NUMERIC(5,2),
      "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      estado_operacion_creacion estado_operacion_enum,
      CONSTRAINT chk_td_latitud CHECK (latitud BETWEEN -90 AND 90),
      CONSTRAINT chk_td_longitud CHECK (longitud BETWEEN -180 AND 180),
      CONSTRAINT chk_td_rumbo CHECK (
        rumbo_grados IS NULL OR rumbo_grados BETWEEN 0 AND 360
      ),
      CONSTRAINT chk_td_bateria CHECK (
        bateria_pct IS NULL OR bateria_pct BETWEEN 0 AND 100
      )
    );

    ALTER TABLE tracking_dispositivo
      ADD COLUMN IF NOT EXISTS serial_dispositivo TEXT;

    CREATE INDEX IF NOT EXISTS idx_tracking_dispositivo_op_disp_ts
      ON tracking_dispositivo(id_operacion, id_dispositivo, "timestamp" DESC);

    CREATE INDEX IF NOT EXISTS idx_tracking_dispositivo_ts
      ON tracking_dispositivo("timestamp" DESC);

    CREATE INDEX IF NOT EXISTS idx_tracking_dispositivo_estado_operacion_creacion
      ON tracking_dispositivo(id_operacion, estado_operacion_creacion);

    DO $$
    BEGIN
      IF to_regclass('public.v_ultimos_signos_vitales_personal') IS NOT NULL THEN
        EXECUTE $view$
          DROP VIEW IF EXISTS v_ultima_posicion_personal;
          CREATE VIEW v_ultima_posicion_personal AS
          SELECT DISTINCT ON (tp.id_operacion, tp.id_personal)
            tp.id_operacion,
            tp.id_personal,
            p.apodo,
            p.rol,
            tp.latitud,
            tp.longitud,
            tp.altitud,
            tp.velocidad_kmh,
            tp.rumbo_grados,
            tp.precision_m,
            tp.fuente_tracking,
            tp.dispositivos_fuente,
            tp.confianza_tracking,
            tp."timestamp" AS ultima_actualizacion,
            tp.estado_operacion_creacion,
            sv.frecuencia_cardiaca_bpm,
            sv.frecuencia_cardiaca,
            sv.fc,
            sv.heart_rate,
            sv.oxigenacion_spo2,
            sv.spo2,
            sv.temperatura_c,
            sv.frecuencia_respiratoria_rpm,
            sv.presion_sistolica_mmhg,
            sv.presion_diastolica_mmhg,
            sv.pasos,
            sv.presion_barometrica_hpa,
            sv.barometro,
            sv.baro,
            sv.bateria_pct,
            sv.bateria,
            sv.signos_actualizacion
          FROM tracking_personal tp
          JOIN personal p ON p.id_personal = tp.id_personal
          LEFT JOIN v_ultimos_signos_vitales_personal sv
            ON sv.id_operacion = tp.id_operacion
           AND sv.id_personal = tp.id_personal
          ORDER BY tp.id_operacion, tp.id_personal, tp."timestamp" DESC
        $view$;
      END IF;
    END $$;

    CREATE OR REPLACE VIEW v_ultima_posicion_equipo AS
    SELECT DISTINCT ON (te.id_operacion, te.id_equipo)
      te.id_tracking,
      te.id_operacion,
      te.id_equipo,
      e.numero_serie,
      e.nombre,
      e.categoria,
      e.estado,
      ec.marca,
      ec.modelo,
      et.tipo_tactico,
      CASE
        WHEN UPPER(COALESCE(e.categoria, '')) = 'COMUNICACION'
          THEN COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ec.marca, ec.modelo)), ''), 'Equipo de comunicacion')
        WHEN UPPER(COALESCE(e.categoria, '')) = 'TACTICO'
          THEN COALESCE(NULLIF(TRIM(et.tipo_tactico), ''), 'Equipo tactico')
        ELSE COALESCE(NULLIF(TRIM(e.categoria), ''), 'Equipo')
      END AS tipo_equipo,
      te.latitud,
      te.longitud,
      te.altitud,
      te.velocidad_kmh,
      te.rumbo_grados,
      te.precision_m,
      te.bateria_pct,
      te.conectado,
      te.dron_encendido,
      te.modo_vuelo,
      te.pitch_grados,
      te.roll_grados,
      te.satelites,
      te.tiempo_vuelo_s,
      te.serial_dispositivo,
      te."timestamp" AS ultima_actualizacion,
      te.estado_operacion_creacion
    FROM tracking_equipo te
    JOIN equipo e ON e.id_equipo = te.id_equipo
    LEFT JOIN equipo_comunicacion ec ON ec.id_equipo = e.id_equipo
    LEFT JOIN equipo_tactico et ON et.id_equipo = e.id_equipo
    ORDER BY te.id_operacion, te.id_equipo, te."timestamp" DESC;

    CREATE OR REPLACE VIEW v_ultima_posicion_dispositivo AS
    SELECT DISTINCT ON (td.id_operacion, td.id_dispositivo)
      td.id_tracking,
      td.id_operacion,
      td.id_dispositivo,
      d.imagen_disp,
      d.tipo,
      d.marca,
      d.modelo,
      d.numero_telefono,
      d.imei,
      d.numero_serie,
      d.sistema_operativo,
      d.identificador_app,
      d.estado AS dispositivo_estado,
      od.id_personal,
      p.apodo AS personal_apodo,
      p.nombre AS personal_nombre,
      p.apellido AS personal_apellido,
      p.puesto AS personal_puesto,
      td.latitud,
      td.longitud,
      td.altitud,
      td.velocidad_kmh,
      td.rumbo_grados,
      td.precision_m,
      td.bateria_pct,
      td.serial_dispositivo,
      td."timestamp" AS ultima_actualizacion,
      td.estado_operacion_creacion
    FROM tracking_dispositivo td
    JOIN dispositivo d ON d.id_dispositivo = td.id_dispositivo
    LEFT JOIN operacion_dispositivo od
      ON od.id_operacion = td.id_operacion
     AND od.id_dispositivo = td.id_dispositivo
     AND od.estado_asignacion = 'ASIGNADO'
     AND od.fecha_devolucion IS NULL
    LEFT JOIN personal p ON p.id_personal = od.id_personal
    ORDER BY td.id_operacion, td.id_dispositivo, td."timestamp" DESC;

    CREATE OR REPLACE FUNCTION fn_set_estado_operacion_creacion_tracking_ext()
    RETURNS TRIGGER AS $$
    DECLARE
      v_estado estado_operacion_enum;
    BEGIN
      IF TG_OP <> 'INSERT' OR NEW.estado_operacion_creacion IS NOT NULL THEN
        RETURN NEW;
      END IF;

      SELECT estado
        INTO v_estado
      FROM operacion
      WHERE id_operacion = NEW.id_operacion
      LIMIT 1;

      NEW.estado_operacion_creacion := v_estado;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION fn_validar_tracking_ext_modificable()
    RETURNS TRIGGER AS $$
    DECLARE
      v_id_operacion INT;
      v_estado estado_operacion_enum;
    BEGIN
      v_id_operacion := COALESCE(NEW.id_operacion, OLD.id_operacion);

      SELECT estado
        INTO v_estado
      FROM operacion
      WHERE id_operacion = v_id_operacion
      LIMIT 1;

      IF v_estado IN ('CERRADA','CANCELADA') THEN
        RAISE EXCEPTION
          'La operacion % esta en estado %, no se permiten modificaciones en %',
          v_id_operacion, v_estado, TG_TABLE_NAME;
      END IF;

      RETURN COALESCE(NEW, OLD);
    END;
    $$ LANGUAGE plpgsql;

    DO $$
    BEGIN
      DROP TRIGGER IF EXISTS tr_estado_operacion_creacion ON tracking_equipo;
      DROP TRIGGER IF EXISTS tr_estado_operacion_creacion ON tracking_dispositivo;

      CREATE TRIGGER tr_estado_operacion_creacion
      BEFORE INSERT ON tracking_equipo
      FOR EACH ROW
      EXECUTE FUNCTION fn_set_estado_operacion_creacion_tracking_ext();

      CREATE TRIGGER tr_estado_operacion_creacion
      BEFORE INSERT ON tracking_dispositivo
      FOR EACH ROW
      EXECUTE FUNCTION fn_set_estado_operacion_creacion_tracking_ext();

      DROP TRIGGER IF EXISTS tr_tracking_equipo_op_modificable ON tracking_equipo;
      DROP TRIGGER IF EXISTS tr_tracking_dispositivo_op_modificable ON tracking_dispositivo;

      CREATE TRIGGER tr_tracking_equipo_op_modificable
      BEFORE INSERT OR UPDATE ON tracking_equipo
      FOR EACH ROW
      EXECUTE FUNCTION fn_validar_tracking_ext_modificable();

      CREATE TRIGGER tr_tracking_dispositivo_op_modificable
      BEFORE INSERT OR UPDATE ON tracking_dispositivo
      FOR EACH ROW
      EXECUTE FUNCTION fn_validar_tracking_ext_modificable();
    END $$;
  `);

    if (!(await isExtendedTrackingSchemaReady(client))) {
      throw new Error("No se pudo preparar el esquema extendido de tracking");
    }
  })
    .then(() => {
      extendedTrackingReady = true;
      personalMotionTrackingReady = true;
    })
    .catch((err) => {
      extendedTrackingPromise = null;
      throw err;
    });

  return extendedTrackingPromise;
}

async function ensurePoiIndexes() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DROP INDEX IF EXISTS uq_poi_usuario");
    await client.query("DROP INDEX IF EXISTS uq_poi_personal");
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_poi_usuario_nombre
      ON puntos_interes(id_usuario, id_operacion, nombre)
      WHERE id_usuario IS NOT NULL AND activo = TRUE
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_poi_personal_nombre
      ON puntos_interes(id_personal, id_operacion, nombre)
      WHERE id_personal IS NOT NULL AND activo = TRUE
    `);
    await client.query("COMMIT");
    console.log("[DB SCHEMA] Indices de puntos_interes actualizados correctamente.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[DB SCHEMA] Error actualizando indices de puntos_interes:", err);
  } finally {
    client.release();
  }
}

export async function ensureTrackingSchemas() {
  await ensurePoiIndexes();
  await ensureExtendedTrackingSchema();
  await ensurePersonalMotionTrackingSchema();
}
