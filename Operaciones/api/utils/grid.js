import { pool } from "../db.js";

const GRID_SIZE_RE = /^([1-9]\d?)x([1-9]\d?)$/i;
const MAX_GRID_CELLS = 100;

export async function ensureGridSchema(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS operacion_cuadricula (
      id_cuadricula BIGSERIAL PRIMARY KEY,
      id_operacion INT NOT NULL UNIQUE REFERENCES operacion(id_operacion) ON DELETE CASCADE,
      size TEXT NOT NULL,
      filas INT NOT NULL,
      columnas INT NOT NULL,
      nombres JSONB NOT NULL DEFAULT '[]'::jsonb,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      creado_por_tipo TEXT,
      id_usuario INT REFERENCES usuario(id_usuario) ON DELETE SET NULL,
      id_personal INT REFERENCES personal(id_personal) ON DELETE SET NULL,
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_operacion_cuadricula_operacion
      ON operacion_cuadricula(id_operacion)
  `);
}

export function normalizeGridPayload(body = {}) {
  const size = String(body.size || body.tamano || "3x3").trim().toLowerCase();
  const match = GRID_SIZE_RE.exec(size);

  if (!match) {
    return { ok: false, status: 400, mensaje: "size invalido. Usa formato 3x3" };
  }

  const rows = Number(match[1]);
  const cols = Number(match[2]);
  const total = rows * cols;

  if (total > MAX_GRID_CELLS) {
    return { ok: false, status: 400, mensaje: "La cuadricula no puede exceder 100 cuadrantes" };
  }

  const rawNames = Array.isArray(body.names)
    ? body.names
    : Array.isArray(body.nombres)
      ? body.nombres
      : [];

  const nombres = Array.from({ length: total }, (_, index) =>
    String(rawNames[index] || "").trim().slice(0, 80)
  );

  return { ok: true, size: `${rows}x${cols}`, rows, cols, nombres };
}

export async function fetchOperationGrid(client = pool, idOperacion) {
  await ensureGridSchema(client);
  const { rows } = await client.query(
    `SELECT id_cuadricula, id_operacion, size, filas AS rows, columnas AS cols,
            nombres, nombres AS names,
            activo, creado_por_tipo, id_usuario, id_personal,
            fecha_creacion, fecha_actualizacion
       FROM operacion_cuadricula
      WHERE id_operacion = $1 AND activo = TRUE
      LIMIT 1`,
    [idOperacion]
  );

  return rows[0] || null;
}
