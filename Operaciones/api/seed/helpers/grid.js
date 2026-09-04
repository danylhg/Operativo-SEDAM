import { ensureGridSchema, normalizeGridPayload } from "../../utils/grid.js";

export async function ensureSeedGridSchema(client) {
  await ensureGridSchema(client);
}

export async function seedOperationGrid(client, {
  idOperacion,
  size,
  names = [],
  actorTipo = "USUARIO",
  idUsuario = null,
  idPersonal = null,
  fecha = null,
}) {
  await ensureSeedGridSchema(client);

  const parsed = normalizeGridPayload({ size, names });
  if (!parsed.ok) {
    throw new Error(`Cuadricula invalida para operacion ${idOperacion}: ${parsed.mensaje}`);
  }

  const timestamp = fecha ?? new Date();
  const { rows } = await client.query(
    `INSERT INTO operacion_cuadricula (
       id_operacion, size, filas, columnas, nombres, activo,
       creado_por_tipo, id_usuario, id_personal,
       fecha_creacion, fecha_actualizacion
     )
     VALUES ($1,$2,$3,$4,$5::jsonb,TRUE,$6,$7,$8,$9,$9)
     ON CONFLICT (id_operacion) DO UPDATE SET
       size = EXCLUDED.size,
       filas = EXCLUDED.filas,
       columnas = EXCLUDED.columnas,
       nombres = EXCLUDED.nombres,
       activo = TRUE,
       creado_por_tipo = EXCLUDED.creado_por_tipo,
       id_usuario = EXCLUDED.id_usuario,
       id_personal = EXCLUDED.id_personal,
       fecha_actualizacion = EXCLUDED.fecha_actualizacion
     RETURNING id_cuadricula, id_operacion, size, filas AS rows, columnas AS cols,
               nombres, nombres AS names, activo,
               creado_por_tipo, id_usuario, id_personal,
               fecha_creacion, fecha_actualizacion`,
    [
      idOperacion,
      parsed.size,
      parsed.rows,
      parsed.cols,
      JSON.stringify(parsed.nombres),
      actorTipo,
      idUsuario,
      idPersonal,
      timestamp,
    ]
  );

  return rows[0];
}
