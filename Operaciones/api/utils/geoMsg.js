import { pool } from "../db.js";

let schemaReady = null;

// Los GEO-MSG viven en memoria dentro del socket para la operación en curso;
// esta tabla los conserva para que el historial pueda reproducirlos.
export function ensureGeoMsgSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS geo_mensaje (
        id_operacion INT NOT NULL REFERENCES operacion(id_operacion) ON DELETE CASCADE,
        id_geo_msg BIGINT NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lon DOUBLE PRECISION NOT NULL,
        texto TEXT NOT NULL,
        autor TEXT,
        id_personal_autor INT,
        id_usuario_autor INT,
        visibilidad TEXT NOT NULL DEFAULT 'PRIVADO',
        fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fecha_eliminacion TIMESTAMPTZ,
        PRIMARY KEY (id_operacion, id_geo_msg, fecha_creacion)
      )
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

// La persistencia es "best effort": un fallo de BD no debe romper el socket.
async function safely(label, fn) {
  try {
    await ensureGeoMsgSchema();
    await fn();
  } catch (error) {
    console.warn(`[geo_msg] no se pudo persistir (${label}):`, error.message);
  }
}

export function persistGeoMsgCreated(msg) {
  return safely("crear", () => pool.query(
    `INSERT INTO geo_mensaje
       (id_operacion, id_geo_msg, lat, lon, texto, autor, id_personal_autor, id_usuario_autor, visibilidad)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [msg.id_operacion, msg.id_geo_msg, msg.lat, msg.lon, msg.text, msg.author,
      msg.id_personal_autor, msg.id_usuario_autor, msg.visibilidad]
  ));
}

// Actualiza solo el registro vigente (el que no ha sido eliminado).
export function persistGeoMsgUpdated(msg) {
  return safely("actualizar", () => pool.query(
    `UPDATE geo_mensaje
        SET texto = $3, visibilidad = $4, fecha_actualizacion = NOW()
      WHERE id_operacion = $1 AND id_geo_msg = $2 AND fecha_eliminacion IS NULL`,
    [msg.id_operacion, msg.id_geo_msg, msg.text, msg.visibilidad]
  ));
}

export function persistGeoMsgDeleted(idOperacion, idGeoMsg) {
  return safely("eliminar", () => pool.query(
    `UPDATE geo_mensaje
        SET fecha_eliminacion = NOW(), fecha_actualizacion = NOW()
      WHERE id_operacion = $1 AND id_geo_msg = $2 AND fecha_eliminacion IS NULL`,
    [idOperacion, idGeoMsg]
  ));
}
