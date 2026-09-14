// Importa Router de Express para declarar rutas agrupadas
import { Router } from "express";

// Pool de PostgreSQL para ejecutar consultas
import { pool } from "../db.js";

// Middleware que exige autenticación antes de acceder a estas rutas
import { requireAuth } from "../middlewares/auth.js";

// Emitters de socket para tiempo real
import {
  emitPoiCreado,
  emitPoiActualizado,
  emitPoiEliminado,
  emitAreaCreada,
  emitAreaActualizada,
  emitAreaEliminada,
  emitEstructuraCreada,
  emitEstructuraActualizada,
  emitEstructuraEliminada,
  emitDibujoCreado,
  emitDibujoEliminado,
  emitCuadriculaActualizada,
  emitCuadriculaEliminada
} from "../sockets/index.js";

// Helper para responder errores de BD/backend de forma uniforme
import { sendDbError } from "../utils/dbErrors.js";

// Helper para validar enteros
import { isInt } from "../utils/validators.js";
import { getActorFromRequest, logOperacionEvento } from "../utils/timeline.js";
import { ensureGridSchema, fetchOperationGrid, normalizeGridPayload } from "../utils/grid.js";
import { ensureExtendedTrackingSchema } from "../utils/trackingSchema.js";

// Crea la instancia del router
const router = Router();

function poiOwner(req) {
  const tabla = String(req.user?.tabla || "usuario").toLowerCase();
  return {
    tipo: tabla === "personal" ? "PERSONAL" : "USUARIO",
    id: Number(req.user?.sub)
  };
}

async function ensurePoiVisibilitySchema() {
  await pool.query(
    `ALTER TABLE puntos_interes
       ADD COLUMN IF NOT EXISTS visibilidad VARCHAR(10) NOT NULL DEFAULT 'PRIVADO',
       ADD COLUMN IF NOT EXISTS editor_nombre VARCHAR(255),
       ADD COLUMN IF NOT EXISTS velocidad_kmh NUMERIC(8,2),
       ADD COLUMN IF NOT EXISTS rumbo_grados NUMERIC(5,2)`
  );
}

function circleToPolygonCoordinates(lat, lng, radiusMeters, segments = 48) {
  const earthRadius = 6378137;
  const latRad = (Number(lat) * Math.PI) / 180;
  const lonRad = (Number(lng) * Math.PI) / 180;
  const angularDistance = Number(radiusMeters) / earthRadius;
  const coords = [];

  for (let i = 0; i <= segments; i += 1) {
    const bearing = (2 * Math.PI * i) / segments;
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const sinAd = Math.sin(angularDistance);
    const cosAd = Math.cos(angularDistance);

    const pointLat = Math.asin(
      sinLat * cosAd + cosLat * sinAd * Math.cos(bearing)
    );
    const pointLon = lonRad + Math.atan2(
      Math.sin(bearing) * sinAd * cosLat,
      cosAd - sinLat * Math.sin(pointLat)
    );

    coords.push([
      (pointLon * 180) / Math.PI,
      (pointLat * 180) / Math.PI
    ]);
  }

  return [coords];
}


// ===============================
// PUNTOS DE INTERÉS (POI)
// ===============================


// =========================================================
// GET /ops/:id/pois
// Qué hace:
//   Lista todos los puntos de interés activos de una operación.
// Fuente:
//   Lee desde la vista v_poi_detalle, que ya trae datos enriquecidos
//   del creador (usuario/personal).
// Orden:
//   Los más recientes primero.
// =========================================================
router.get("/ops/:id/pois", requireAuth, async (req, res) => {
  // Convierte id de operación desde la URL
  const id_operacion = Number(req.params.id);

  // Valida que sea entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  try {
    // Consulta todos los POIs activos de la operación
    await ensurePoiVisibilitySchema();
    const owner = poiOwner(req);
    const { rows } = await pool.query(
      `SELECT v.*, poi.visibilidad AS visibilidad, poi.velocidad_kmh, poi.rumbo_grados, p.puesto AS creador_puesto,
              COALESCE(poi.editor_nombre, '') AS editor_nombre,
              COALESCE(poi.editor_nombre, '') AS "editorLabel"
         FROM v_poi_detalle v
         JOIN puntos_interes poi ON poi.id_poi = v.id_poi
        LEFT JOIN personal p
          ON v.tipo_creador='PERSONAL' AND v.id_personal=p.id_personal
        WHERE v.id_operacion=$1
          AND v.activo=TRUE
          AND (poi.visibilidad='PUBLICO'
            OR (v.tipo_creador=$2 AND COALESCE(v.id_usuario,v.id_personal)=$3))
        ORDER BY v.fecha_creacion DESC`,
      [id_operacion, owner.tipo, owner.id]
    );

    // Responde con la lista
    res.json({ ok: true, items: rows });
  } catch (err) {
    // Manejo uniforme de error
    sendDbError(res, err, "Error obteniendo POIs");
  }
});


// =========================================================
// POST /ops/:id/pois
// Qué hace:
//   Crea un nuevo punto de interés (POI) dentro de una operación.
// Campos esperados:
//   - nombre
//   - tipo_poi
//   - latitud
//   - longitud
//   - descripcion (opcional)
//   - tipo_creador (USUARIO o PERSONAL)
//   - id_usuario / id_personal según corresponda
// Validaciones:
//   - nombre obligatorio
//   - tipo_poi obligatorio
//   - latitud/longitud obligatorias
//   - tipo_creador válido
// Nota:
//   Aquí no se valida que el creador coincida con req.user.
// =========================================================
router.post("/ops/:id/pois", requireAuth, async (req, res) => {
  // Convierte id_operacion
  const id_operacion = Number(req.params.id);

  // Valida entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  // Extrae datos del body
  const {
    nombre,
    tipo_poi,
    latitud,
    longitud,
    descripcion,
    color,
    icono_src,
    sidc,
    tipo_creador,
    id_usuario,
    id_personal,
    velocidad_kmh,
    rumbo_grados
  } = req.body ?? {};

  // Valida nombre
  if (!nombre?.toString().trim()) {
    return res.status(400).json({ ok: false, mensaje: "Falta nombre" });
  }

  // Valida tipo_poi
  if (!tipo_poi?.toString().trim()) {
    return res.status(400).json({ ok: false, mensaje: "Falta tipo_poi" });
  }

  // Valida coordenadas
  if (latitud == null || longitud == null) {
    return res.status(400).json({ ok: false, mensaje: "Falta latitud/longitud" });
  }

  // Normaliza tipo_creador
  const tipo = (tipo_creador || "USUARIO").toString().toUpperCase();

  // Solo permite USUARIO o PERSONAL
  if (!["USUARIO", "PERSONAL"].includes(tipo)) {
    return res.status(400).json({ ok: false, mensaje: "tipo_creador invalido" });
  }

  try {
    // Inserta el POI en la tabla puntos_interes
    const { rows } = await pool.query(
      `INSERT INTO puntos_interes (tipo_creador, id_usuario, id_personal, nombre, tipo_poi, latitud, longitud, descripcion, color, icono_src, sidc, id_operacion, visibilidad, velocidad_kmh, rumbo_grados)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PRIVADO',$13,$14) RETURNING *`,
      [
        tipo,
        id_usuario ? Number(id_usuario) : null,
        id_personal ? Number(id_personal) : null,
        nombre.toString().trim(),
        tipo_poi.toString().trim(),
        Number(latitud),
        Number(longitud),
        descripcion?.toString().trim() || null,
        color?.toString().trim() || '#FFD700',
        icono_src?.toString().trim() || null,
        sidc?.toString().trim() || null,
        id_operacion,
        velocidad_kmh == null ? null : Number(velocidad_kmh),
        rumbo_grados == null ? null : Number(rumbo_grados)
      ]
    );

    const poi = rows[0];
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "poi_creado",
      entidad_tipo: "poi",
      entidad_id: poi.id_poi,
      payload: poi,
      occurred_at: poi.fecha_creacion,
      actor: getActorFromRequest(req)
    });

    // Emite en tiempo real a todos los clientes de la operación
    const io = req.app.get("io");
    if (io && String(poi.visibilidad || "PRIVADO").toUpperCase() === "PUBLICO") {
      emitPoiCreado(io, id_operacion, poi);
    }

    // Devuelve el POI creado
    res.json({ ok: true, poi });
  } catch (err) {
    // Manejo uniforme de error
    sendDbError(res, err, "Error creando POI");
  }
});

router.patch("/ops/:id/pois/:id_poi/publicar", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_poi = Number(req.params.id_poi);
  if (!isInt(id_operacion) || !isInt(id_poi)) return res.status(400).json({ ok: false, mensaje: "id invalido" });
  try {
    await ensurePoiVisibilitySchema();
    const owner = poiOwner(req);
    const { rows } = await pool.query(
      `UPDATE puntos_interes SET visibilidad='PUBLICO'
       WHERE id_poi=$1 AND id_operacion=$2 AND activo=TRUE
         AND tipo_creador=$3 AND COALESCE(id_usuario,id_personal)=$4 RETURNING *`,
      [id_poi, id_operacion, owner.tipo, owner.id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, mensaje: "POI no encontrado o no te pertenece" });
    const { rows: publishedRows } = await pool.query(
      `SELECT v.*, poi.visibilidad AS visibilidad, poi.velocidad_kmh, poi.rumbo_grados, p.puesto AS creador_puesto,
               COALESCE(NULLIF(v.personal_nombre, ''), NULLIF(v.usuario_nombre, ''), v.tipo_creador::text) AS creador_nombre
         FROM v_poi_detalle v
         JOIN puntos_interes poi ON poi.id_poi = v.id_poi
         LEFT JOIN personal p
           ON v.tipo_creador='PERSONAL' AND v.id_personal=p.id_personal
        WHERE v.id_poi=$1 AND v.id_operacion=$2
        LIMIT 1`,
      [id_poi, id_operacion]
    );
    const publishedPoi = publishedRows[0] || rows[0];
    const io = req.app.get("io");
    if (io) emitPoiActualizado(io, id_operacion, publishedPoi);
    res.json({ ok: true, poi: publishedPoi });
  } catch (err) {
    sendDbError(res, err, "No se pudo hacer publico el POI");
  }
});

router.patch("/ops/:id/pois/:id_poi/privatizar", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_poi = Number(req.params.id_poi);
  if (!isInt(id_operacion) || !isInt(id_poi)) return res.status(400).json({ ok: false, mensaje: "id invalido" });
  try {
    await ensurePoiVisibilitySchema();
    const owner = poiOwner(req);
    const { rows } = await pool.query(
      `UPDATE puntos_interes SET visibilidad='PRIVADO'
       WHERE id_poi=$1 AND id_operacion=$2 AND activo=TRUE
         AND tipo_creador=$3 AND COALESCE(id_usuario,id_personal)=$4 RETURNING *`,
      [id_poi, id_operacion, owner.tipo, owner.id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, mensaje: "POI publico no encontrado o no te pertenece" });
    const io = req.app.get("io");
    if (io) emitPoiEliminado(io, id_operacion, id_poi);
    res.json({ ok: true, poi: rows[0] });
  } catch (err) {
    sendDbError(res, err, "No se pudo hacer privado el POI");
  }
});

router.put("/ops/:id/pois/:id_poi", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_poi = Number(req.params.id_poi);

  if (!isInt(id_operacion) || !isInt(id_poi)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  const { latitud, longitud, nombre, tipo_poi, color, icono_src, sidc, editor_nombre, editorLabel, modificado_por, velocidad_kmh, rumbo_grados } = req.body ?? {};
  if (Object.keys(req.body ?? {}).length === 0) {
    return res.status(400).json({ ok: false, mensaje: "Cuerpo vacio" });
  }

  try {
    await ensurePoiVisibilitySchema();
    const setClauses = [];
    const values = [id_poi, id_operacion];
    let paramIndex = 3;

    if (latitud != null) { setClauses.push(`latitud = $${paramIndex++}`); values.push(Number(latitud)); }
    if (longitud != null) { setClauses.push(`longitud = $${paramIndex++}`); values.push(Number(longitud)); }
    if (nombre !== undefined) { setClauses.push(`nombre = $${paramIndex++}`); values.push(String(nombre)); }
    if (tipo_poi !== undefined) { setClauses.push(`tipo_poi = $${paramIndex++}`); values.push(String(tipo_poi)); }
    if (color !== undefined) { setClauses.push(`color = $${paramIndex++}`); values.push(String(color)); }
    if (icono_src !== undefined) { setClauses.push(`icono_src = $${paramIndex++}`); values.push(icono_src); }
    if (sidc !== undefined) { setClauses.push(`sidc = $${paramIndex++}`); values.push(sidc); }
    if (velocidad_kmh !== undefined) { setClauses.push(`velocidad_kmh = $${paramIndex++}`); values.push(velocidad_kmh == null ? null : Number(velocidad_kmh)); }
    if (rumbo_grados !== undefined) { setClauses.push(`rumbo_grados = $${paramIndex++}`); values.push(rumbo_grados == null ? null : Number(rumbo_grados)); }

    const resolvedEditor = (editor_nombre || editorLabel || modificado_por || req.user?.nombre || req.user?.username || '').toString().trim();
    if (resolvedEditor) {
      setClauses.push(`editor_nombre = $${paramIndex++}`);
      values.push(resolvedEditor);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ ok: false, mensaje: "Nada que actualizar" });
    }

    const { rows } = await pool.query(
      `UPDATE puntos_interes
          SET ${setClauses.join(', ')}
        WHERE id_poi = $1
          AND id_operacion = $2
          AND activo = TRUE
      RETURNING *`,
      values
    );

    if (!rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "POI no existe" });
    }

    const io = req.app.get("io");
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "poi_actualizado",
      entidad_tipo: "poi",
      entidad_id: rows[0].id_poi,
      payload: rows[0],
      actor: getActorFromRequest(req)
    });
    if (io && String(rows[0].visibilidad || "PRIVADO").toUpperCase() === "PUBLICO") {
      emitPoiActualizado(io, id_operacion, rows[0]);
    }

    res.json({ ok: true, poi: rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: "Error: " + (err.message || String(err)) });
  }
});

router.delete("/ops/:id/pois/:id_poi", requireAuth, async (req, res) => {
  const id_poi = Number(req.params.id_poi);
  if (!isInt(id_poi)) {
    return res.status(400).json({ ok: false, mensaje: "id_poi invalido" });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE puntos_interes SET activo=FALSE WHERE id_poi=$1 RETURNING *`,
      [id_poi]
    );

    if (!rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "POI no existe" });
    }

    const io = req.app.get("io");
    await logOperacionEvento(pool, {
      id_operacion: Number(req.params.id),
      tipo_evento: "poi_eliminado",
      entidad_tipo: "poi",
      entidad_id: id_poi,
      payload: rows[0],
      actor: getActorFromRequest(req)
    });
    if (io) emitPoiEliminado(io, Number(req.params.id), id_poi);

    // Respuesta final
    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    // Manejo uniforme de error
    sendDbError(res, err, "Error eliminando POI");
  }
});


// ===============================
// ÁREAS DE INTERÉS
// ===============================


// =========================================================
// GET /ops/:id/areas
// Qué hace:
//   Lista todas las áreas de interés activas de una operación.
// Fuente:
//   Lee directo desde area_interes.
// Orden:
//   Las más recientes primero.
// =========================================================
router.get("/ops/:id/areas", requireAuth, async (req, res) => {
  // Convierte id_operacion
  const id_operacion = Number(req.params.id);

  // Valida entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  try {
    // Consulta áreas activas
    const { rows } = await pool.query(
      `SELECT * FROM area_interes WHERE id_operacion=$1 AND estado='ACTIVA' ORDER BY fecha_creacion DESC`,
      [id_operacion]
    );

    // Respuesta final
    res.json({ ok: true, items: rows });
  } catch (err) {
    sendDbError(res, err, "Error obteniendo areas");
  }
});


// =========================================================
// POST /ops/:id/areas
// Qué hace:
//   Crea una nueva área de interés dentro de una operación.
// Campos esperados:
//   - nombre
//   - descripcion (opcional)
//   - geometria (GeoJSON)
//   - color (opcional)
//   - tipo_creador
//   - id_usuario / id_personal
// Validaciones:
//   - nombre obligatorio
//   - geometria obligatoria
//   - tipo_creador válido
// Nota:
//   Aquí se manda geometria serializada como JSON.stringify.
// =========================================================
router.post("/ops/:id/areas", requireAuth, async (req, res) => {
  // Convierte id_operacion
  const id_operacion = Number(req.params.id);

  // Valida entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  // Extrae datos del body
  const {
    nombre,
    descripcion,
    geometria,
    color,
    tipo_creador,
    id_usuario,
    id_personal
  } = req.body ?? {};

  // Valida nombre
  if (!nombre?.toString().trim()) {
    return res.status(400).json({ ok: false, mensaje: "Falta nombre" });
  }

  // geometria obligatoria
  if (!geometria) {
    return res.status(400).json({ ok: false, mensaje: "Falta geometria (GeoJSON Polygon)" });
  }

  // Normaliza tipo_creador
  const tipo = (tipo_creador || "USUARIO").toString().toUpperCase();

  // Solo permite USUARIO o PERSONAL
  if (!["USUARIO", "PERSONAL"].includes(tipo)) {
    return res.status(400).json({ ok: false, mensaje: "tipo_creador invalido" });
  }

  try {
    // Inserta área de interés
    const { rows } = await pool.query(
      `INSERT INTO area_interes (id_operacion, tipo_creador, id_usuario, id_personal, nombre, descripcion, geometria, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        id_operacion,
        tipo,
        id_usuario ? Number(id_usuario) : null,
        id_personal ? Number(id_personal) : null,
        nombre.toString().trim(),
        descripcion?.toString().trim() || null,
        JSON.stringify(geometria),
        color || "#FF4500"
      ]
    );

    // Devuelve el área creada
    const area = rows[0];
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "area_creada",
      entidad_tipo: "area",
      entidad_id: area.id_area,
      payload: area,
      occurred_at: area.fecha_creacion,
      actor: getActorFromRequest(req)
    });
    const io = req.app.get("io");
    if (io) emitAreaCreada(io, id_operacion, area);
    res.json({ ok: true, area });
  } catch (err) {
    sendDbError(res, err, "Error creando area");
  }
});

router.put("/ops/:id/areas/:id_area", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_area = Number(req.params.id_area);

  if (!isInt(id_operacion) || !isInt(id_area)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  const { latitud, longitud } = req.body ?? {};
  if (latitud == null || longitud == null) {
    return res.status(400).json({ ok: false, mensaje: "Falta latitud/longitud" });
  }

  try {
    const currentRes = await pool.query(
      `SELECT * FROM area_interes
        WHERE id_area = $1
          AND id_operacion = $2
          AND estado = 'ACTIVA'
        LIMIT 1`,
      [id_area, id_operacion]
    );

    const current = currentRes.rows[0];
    if (!current) {
      return res.status(404).json({ ok: false, mensaje: "Area no existe" });
    }

    const geometria = current.geometria || {};
    const meta = geometria.meta || {};
    const radius = Number(meta.radius_m);
    if (meta.shape !== "circle" || !Number.isFinite(radius) || radius <= 0) {
      return res.status(400).json({ ok: false, mensaje: "Solo se pueden mover areas circulares" });
    }

    const lat = Number(latitud);
    const lng = Number(longitud);
    const geometriaActualizada = {
      ...geometria,
      coordinates: circleToPolygonCoordinates(lat, lng, radius),
      meta: {
        ...meta,
        center: [lng, lat]
      }
    };

    const { rows } = await pool.query(
      `UPDATE area_interes
          SET geometria = $1
        WHERE id_area = $2
          AND id_operacion = $3
      RETURNING *`,
      [JSON.stringify(geometriaActualizada), id_area, id_operacion]
    );

    const io = req.app.get("io");
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "area_actualizada",
      entidad_tipo: "area",
      entidad_id: rows[0].id_area,
      payload: rows[0],
      actor: getActorFromRequest(req)
    });
    if (io) emitAreaActualizada(io, id_operacion, rows[0]);

    res.json({ ok: true, area: rows[0] });
  } catch (err) {
    sendDbError(res, err, "Error actualizando area");
  }
});


// =========================================================
// DELETE /ops/:id/areas/:id_area
// Qué hace:
//   Elimina un área de interés de forma lógica.
// En realidad:
//   No borra físicamente; cambia estado a ELIMINADA.
// Validaciones:
//   - id_area válido
// Nota:
//   No valida aquí que el área pertenezca a la operación del path.
// =========================================================
router.delete("/ops/:id/areas/:id_area", requireAuth, async (req, res) => {
  // Convierte id_area
  const id_area = Number(req.params.id_area);

  // Valida entero
  if (!isInt(id_area)) {
    return res.status(400).json({ ok: false, mensaje: "id_area invalido" });
  }

  try {
    // Soft delete del área
    const { rows } = await pool.query(
      `UPDATE area_interes SET estado='ELIMINADA' WHERE id_area=$1 RETURNING *`,
      [id_area]
    );

    // Si no existe, 404
    if (!rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Area no existe" });
    }

    // Respuesta final
    const io = req.app.get("io");
    await logOperacionEvento(pool, {
      id_operacion: Number(req.params.id),
      tipo_evento: "area_eliminada",
      entidad_tipo: "area",
      entidad_id: id_area,
      payload: rows[0],
      actor: getActorFromRequest(req)
    });
    if (io) emitAreaEliminada(io, Number(req.params.id), id_area);
    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    sendDbError(res, err, "Error eliminando area");
  }
});


// ===============================
// MARCAS DE EDIFICIOS / ESTRUCTURAS
// ===============================


// =========================================================
// GET /ops/:id/edificios
// Qué hace:
//   Lista todas las estructuras/marcas de edificio activas
//   de una operación.
// Fuente:
//   Lee directo desde marca_edificio.
// Orden:
//   Las más recientes primero.
// =========================================================
router.get("/ops/:id/edificios", requireAuth, async (req, res) => {
  // Convierte id_operacion
  const id_operacion = Number(req.params.id);

  // Valida entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  try {
    // Consulta edificios activos
    const { rows } = await pool.query(
      `SELECT * FROM marca_edificio WHERE id_operacion=$1 AND estado='ACTIVO' ORDER BY fecha_creacion DESC`,
      [id_operacion]
    );

    // Respuesta final
    res.json({ ok: true, items: rows });
  } catch (err) {
    sendDbError(res, err, "Error obteniendo edificios");
  }
});


// =========================================================
// POST /ops/:id/edificios
// Qué hace:
//   Crea una nueva marca de estructura/edificio en la operación.
// Campos esperados:
//   - nombre
//   - tipo_estructura
//   - latitud
//   - longitud
//   - tipo_creador
//   - id_usuario / id_personal
// Validaciones:
//   - nombre obligatorio
//   - tipo_estructura obligatorio
//   - latitud/longitud obligatorias
//   - tipo_creador válido
//   - si el usuario tiene rol CELL, se bloquea con 403
// =========================================================
router.post("/ops/:id/edificios", requireAuth, async (req, res) => {
  // Convierte id_operacion
  const id_operacion = Number(req.params.id);

  // Valida entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  // Extrae datos del body
  const {
    nombre,
    tipo_estructura,
    latitud,
    longitud,
    tipo_creador,
    id_usuario,
    id_personal
  } = req.body ?? {};

  // Valida nombre
  if (!nombre?.toString().trim()) {
    return res.status(400).json({ ok: false, mensaje: "Falta nombre" });
  }

  // Valida tipo_estructura
  if (!tipo_estructura?.toString().trim()) {
    return res.status(400).json({ ok: false, mensaje: "Falta tipo_estructura" });
  }

  // Valida coordenadas
  if (latitud == null || longitud == null) {
    return res.status(400).json({ ok: false, mensaje: "Falta latitud/longitud" });
  }

  // Normaliza tipo_creador
  const tipo = (tipo_creador || "USUARIO").toString().toUpperCase();

  // Solo permite USUARIO o PERSONAL
  if (!["USUARIO", "PERSONAL"].includes(tipo)) {
    return res.status(400).json({ ok: false, mensaje: "tipo_creador invalido" });
  }

  // Regla de negocio: CELL no puede crear estructuras
  if (req.user.rol === "CELL") {
    return res.status(403).json({ ok: false, mensaje: "Las Celulas no pueden crear estructuras" });
  }

  try {
    // Inserta la marca de edificio
    const { rows } = await pool.query(
      `INSERT INTO marca_edificio (id_operacion, tipo_creador, id_usuario, id_personal, nombre, tipo_estructura, latitud, longitud)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        id_operacion,
        tipo,
        id_usuario ? Number(id_usuario) : null,
        id_personal ? Number(id_personal) : null,
        nombre.toString().trim(),
        tipo_estructura.toString().trim(),
        Number(latitud),
        Number(longitud)
      ]
    );

    // Devuelve el edificio creado
    const edificio = rows[0];
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "estructura_creada",
      entidad_tipo: "estructura",
      entidad_id: edificio.id_marca,
      payload: edificio,
      occurred_at: edificio.fecha_creacion,
      actor: getActorFromRequest(req)
    });
    const io = req.app.get("io");
    if (io) emitEstructuraCreada(io, id_operacion, edificio);
    res.json({ ok: true, edificio });
  } catch (err) {
    sendDbError(res, err, "Error creando edificio");
  }
});

router.put("/ops/:id/edificios/:id_marca", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_marca = Number(req.params.id_marca);

  if (!isInt(id_operacion) || !isInt(id_marca)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  const { latitud, longitud } = req.body ?? {};
  if (latitud == null || longitud == null) {
    return res.status(400).json({ ok: false, mensaje: "Falta latitud/longitud" });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE marca_edificio
          SET latitud = $1,
              longitud = $2
        WHERE id_marca = $3
          AND id_operacion = $4
          AND estado = 'ACTIVO'
      RETURNING *`,
      [Number(latitud), Number(longitud), id_marca, id_operacion]
    );

    if (!rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Edificio no existe" });
    }

    const io = req.app.get("io");
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "estructura_actualizada",
      entidad_tipo: "estructura",
      entidad_id: rows[0].id_marca,
      payload: rows[0],
      actor: getActorFromRequest(req)
    });
    if (io) emitEstructuraActualizada(io, id_operacion, rows[0]);

    res.json({ ok: true, edificio: rows[0] });
  } catch (err) {
    sendDbError(res, err, "Error actualizando edificio");
  }
});


// =========================================================
// DELETE /ops/:id/edificios/:id_marca
// Qué hace:
//   Elimina una marca de edificio de forma lógica.
// En realidad:
//   No borra físicamente; cambia estado a INACTIVO.
// Validaciones:
//   - id_marca válido
// Nota:
//   No valida aquí que la marca pertenezca a la operación del path.
// =========================================================
router.delete("/ops/:id/edificios/:id_marca", requireAuth, async (req, res) => {
  // Convierte id_marca
  const id_marca = Number(req.params.id_marca);

  // Valida entero
  if (!isInt(id_marca)) {
    return res.status(400).json({ ok: false, mensaje: "id_marca invalido" });
  }

  try {
    // Soft delete de la estructura
    const { rows } = await pool.query(
      `UPDATE marca_edificio SET estado='INACTIVO' WHERE id_marca=$1 RETURNING *`,
      [id_marca]
    );

    // Si no existe, 404
    if (!rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Edificio no existe" });
    }

    // Respuesta final
    const io = req.app.get("io");
    await logOperacionEvento(pool, {
      id_operacion: Number(req.params.id),
      tipo_evento: "estructura_eliminada",
      entidad_tipo: "estructura",
      entidad_id: id_marca,
      payload: rows[0],
      actor: getActorFromRequest(req)
    });
    if (io) emitEstructuraEliminada(io, Number(req.params.id), id_marca);
    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    sendDbError(res, err, "Error eliminando edificio");
  }
});

// ===============================
// CUADRICULA DE OPERACION
// ===============================

router.get(["/ops/:id/grid", "/ops/:id/cuadricula"], requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  try {
    const grid = await fetchOperationGrid(pool, id_operacion);
    if (!grid) {
      return res.status(404).json({ ok: false, mensaje: "Sin cuadricula guardada" });
    }

    return res.json({ ok: true, grid, cuadricula: grid });
  } catch (err) {
    return sendDbError(res, err, "Error obteniendo cuadricula");
  }
});

async function saveGridHandler(req, res) {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  const parsed = normalizeGridPayload(req.body);
  if (!parsed.ok) {
    return res.status(parsed.status).json({ ok: false, mensaje: parsed.mensaje });
  }

  const actor = getActorFromRequest(req);

  try {
    await ensureGridSchema(pool);

    const { rows } = await pool.query(
      `INSERT INTO operacion_cuadricula (
         id_operacion, size, filas, columnas, nombres, activo,
         creado_por_tipo, id_usuario, id_personal, fecha_actualizacion
       )
       VALUES ($1,$2,$3,$4,$5::jsonb,TRUE,$6,$7,$8,NOW())
       ON CONFLICT (id_operacion) DO UPDATE SET
         size = EXCLUDED.size,
         filas = EXCLUDED.filas,
         columnas = EXCLUDED.columnas,
         nombres = EXCLUDED.nombres,
         activo = TRUE,
         creado_por_tipo = EXCLUDED.creado_por_tipo,
         id_usuario = EXCLUDED.id_usuario,
         id_personal = EXCLUDED.id_personal,
         fecha_actualizacion = NOW()
       RETURNING id_cuadricula, id_operacion, size, filas AS rows, columnas AS cols,
                 nombres, nombres AS names,
                 activo, creado_por_tipo, id_usuario, id_personal,
                 fecha_creacion, fecha_actualizacion`,
      [
        id_operacion,
        parsed.size,
        parsed.rows,
        parsed.cols,
        JSON.stringify(parsed.nombres),
        actor.actor_tipo || null,
        actor.id_usuario ?? null,
        actor.id_personal ?? null
      ]
    );

    const grid = rows[0];
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "cuadricula_guardada",
      entidad_tipo: "cuadricula",
      entidad_id: grid.id_cuadricula,
      payload: grid,
      occurred_at: grid.fecha_actualizacion,
      actor
    });

    const io = req.app.get("io");
    if (io) emitCuadriculaActualizada(io, id_operacion, grid);

    return res.json({ ok: true, grid, cuadricula: grid });
  } catch (err) {
    return sendDbError(res, err, "Error guardando cuadricula");
  }
}

router.post(["/ops/:id/grid", "/ops/:id/cuadricula"], requireAuth, saveGridHandler);
router.put(["/ops/:id/grid", "/ops/:id/cuadricula"], requireAuth, saveGridHandler);

router.delete(["/ops/:id/grid", "/ops/:id/cuadricula"], requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  try {
    await ensureGridSchema(pool);

    const { rows } = await pool.query(
      `UPDATE operacion_cuadricula
          SET activo = FALSE,
              fecha_actualizacion = NOW()
        WHERE id_operacion = $1 AND activo = TRUE
        RETURNING id_cuadricula, id_operacion, size, filas AS rows, columnas AS cols,
                  nombres, nombres AS names,
                  activo, creado_por_tipo, id_usuario, id_personal,
                  fecha_creacion, fecha_actualizacion`,
      [id_operacion]
    );

    if (!rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Cuadricula no existe" });
    }

    const actor = getActorFromRequest(req);
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "cuadricula_eliminada",
      entidad_tipo: "cuadricula",
      entidad_id: rows[0].id_cuadricula,
      payload: rows[0],
      occurred_at: rows[0].fecha_actualizacion,
      actor
    });

    const io = req.app.get("io");
    if (io) emitCuadriculaEliminada(io, id_operacion);

    return res.json({ ok: true, grid: rows[0], cuadricula: rows[0] });
  } catch (err) {
    return sendDbError(res, err, "Error eliminando cuadricula");
  }
});


// ===============================
// MAPA COMPLETO — todas las capas de una operación
// ===============================


// =========================================================
// GET /ops/:id/mapa
// Qué hace:
//   Devuelve en una sola llamada casi todo el contexto táctico
//   necesario para renderizar el mapa/panel de una operación.
//
// Incluye:
//   - datos básicos de la operación
//   - zona_operacion
//   - capas base del mapa (POIs, áreas, rutas, edificios)
//   - personal asignado con grupo y tracking
//   - vehículos asignados con grupo y tracking
//   - equipos asignados con destino resuelto
//   - rutas de navegación activas
//
// Estrategia:
//   Ejecuta varias queries en paralelo con Promise.all.
// =========================================================
router.get("/ops/:id/mapa", requireAuth, async (req, res) => {
  // Convierte id_operacion
  const id_operacion = Number(req.params.id);

  // Valida entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id inválido" });
  }

  try {
    await ensureExtendedTrackingSchema();
    await ensurePoiVisibilitySchema();
    const mapOwner = poiOwner(req);

    // Ejecuta todas las consultas en paralelo
    const [
      operacionRes,
      zonaRes,
      capasRes,
      poisRes,
      personalRes,
      vehiculosRes,
      equiposRes,
      dispositivosRes,
      rutasNavegacionRes,
      grid
    ] = await Promise.all([

      // -------------------------------------------------
      // 1) Datos base de la operación
      // -------------------------------------------------
      pool.query(
        `SELECT id_operacion, codigo, nombre, descripcion, prioridad, estado,
                fecha_inicio, hora_inicio, fecha_fin, fecha_creacion, creada_por
         FROM operacion
         WHERE id_operacion = $1
         LIMIT 1`,
        [id_operacion]
      ),

      // -------------------------------------------------
      // 2) Zona principal de la operación
      // -------------------------------------------------
      pool.query(
        `SELECT id_zona, id_operacion, nombre, geometria, centroide_lat, centroide_lon, zoom_inicial, color,
                estado_operacion_creacion
         FROM zona_operacion
         WHERE id_operacion = $1
         ORDER BY id_zona ASC
         LIMIT 1`,
        [id_operacion]
      ),

      // -------------------------------------------------
      // 3) Capas unificadas del mapa
      //    Fuente: v_capas_mapa_operacion
      //    Incluye POIs, áreas, rutas y edificios activos
      // -------------------------------------------------
      pool.query(
        `SELECT
            poi.id_operacion, 'POI'::text AS tipo_capa, poi.id_poi::int AS id_elemento,
            poi.id_poi, NULL::int AS id_area, NULL::int AS id_ruta, NULL::int AS id_marca,
            poi.nombre, poi.tipo_poi AS subtipo, poi.tipo_poi, NULL::text AS tipo_estructura,
            poi.latitud, poi.longitud, NULL::jsonb AS geometria, poi.color,
            poi.activo::text AS estado, poi.fecha_creacion,
            poi.tipo_creador, poi.id_usuario, poi.id_personal,
            COALESCE(NULLIF(p.apodo, ''), NULLIF(TRIM(CONCAT_WS(' ', p.nombre, p.apellido)), ''), NULLIF(u.username, ''), NULLIF(TRIM(CONCAT_WS(' ', u.nombre, u.apellido)), ''), poi.tipo_creador::text) AS creador_nombre
         FROM puntos_interes poi
         LEFT JOIN personal p ON poi.tipo_creador = 'PERSONAL' AND poi.id_personal = p.id_personal
         LEFT JOIN usuario u ON poi.tipo_creador = 'USUARIO' AND poi.id_usuario = u.id_usuario
         WHERE poi.id_operacion = $1 AND poi.activo = TRUE
           AND (poi.visibilidad = 'PUBLICO'
             OR (poi.tipo_creador = $2 AND COALESCE(poi.id_usuario, poi.id_personal) = $3))

         UNION ALL

         SELECT
            a.id_operacion, 'AREA'::text, a.id_area,
            NULL::int, a.id_area, NULL::int, NULL::int,
            a.nombre, NULL::text, NULL::text, NULL::text,
            NULL::double precision, NULL::double precision, a.geometria, a.color,
            a.estado::text, a.fecha_creacion,
            a.tipo_creador, a.id_usuario, a.id_personal,
            COALESCE(NULLIF(p.apodo, ''), NULLIF(TRIM(CONCAT_WS(' ', p.nombre, p.apellido)), ''), NULLIF(u.username, ''), NULLIF(TRIM(CONCAT_WS(' ', u.nombre, u.apellido)), ''), a.tipo_creador::text) AS creador_nombre
         FROM area_interes a
         LEFT JOIN personal p ON a.tipo_creador = 'PERSONAL' AND a.id_personal = p.id_personal
         LEFT JOIN usuario u ON a.tipo_creador = 'USUARIO' AND a.id_usuario = u.id_usuario
         WHERE a.id_operacion = $1 AND a.estado = 'ACTIVA'

         UNION ALL

         SELECT
            r.id_operacion, 'RUTA'::text, r.id_ruta,
            NULL::int, NULL::int, r.id_ruta, NULL::int,
            r.nombre, NULL::text, NULL::text, NULL::text,
            NULL::double precision, NULL::double precision, r.geometria, r.color,
            r.estado::text, r.fecha_creacion,
            r.tipo_creador, r.id_usuario, r.id_personal,
            COALESCE(NULLIF(p.apodo, ''), NULLIF(TRIM(CONCAT_WS(' ', p.nombre, p.apellido)), ''), NULLIF(u.username, ''), NULLIF(TRIM(CONCAT_WS(' ', u.nombre, u.apellido)), ''), r.tipo_creador::text) AS creador_nombre
         FROM ruta_operacion r
         LEFT JOIN personal p ON r.tipo_creador = 'PERSONAL' AND r.id_personal = p.id_personal
         LEFT JOIN usuario u ON r.tipo_creador = 'USUARIO' AND r.id_usuario = u.id_usuario
         WHERE r.id_operacion = $1 AND r.estado IN ('PLANIFICADA','ACTIVA')

         UNION ALL

         SELECT
            e.id_operacion, 'EDIFICIO'::text, e.id_marca,
            NULL::int, NULL::int, NULL::int, e.id_marca,
            e.nombre, e.tipo_estructura, NULL::text, e.tipo_estructura,
            e.latitud, e.longitud, NULL::jsonb, NULL::text,
            e.estado::text, e.fecha_creacion,
            e.tipo_creador, e.id_usuario, e.id_personal,
            COALESCE(NULLIF(p.apodo, ''), NULLIF(TRIM(CONCAT_WS(' ', p.nombre, p.apellido)), ''), NULLIF(u.username, ''), NULLIF(TRIM(CONCAT_WS(' ', u.nombre, u.apellido)), ''), e.tipo_creador::text) AS creador_nombre
         FROM marca_edificio e
         LEFT JOIN personal p ON e.tipo_creador = 'PERSONAL' AND e.id_personal = p.id_personal
         LEFT JOIN usuario u ON e.tipo_creador = 'USUARIO' AND e.id_usuario = u.id_usuario
         WHERE e.id_operacion = $1 AND e.estado = 'ACTIVO'
         ORDER BY fecha_creacion DESC`,
        [id_operacion, mapOwner.tipo, mapOwner.id]
      ),

      // -------------------------------------------------
      // 3b) POIs dedicados
      //    Se envían aparte para clientes que no deben
      //    depender del shape de v_capas_mapa_operacion.
      // -------------------------------------------------
      pool.query(
        `SELECT v.*, poi.visibilidad AS visibilidad, p.puesto AS creador_puesto,
                COALESCE(poi.editor_nombre, '') AS editor_nombre,
                COALESCE(NULLIF(v.personal_nombre, ''), NULLIF(v.usuario_nombre, ''), v.tipo_creador::text) AS creador_nombre
           FROM v_poi_detalle v
           JOIN puntos_interes poi ON poi.id_poi = v.id_poi
           LEFT JOIN personal p
             ON v.tipo_creador='PERSONAL' AND v.id_personal=p.id_personal
          WHERE v.id_operacion = $1
            AND v.activo = TRUE
            AND (poi.visibilidad = 'PUBLICO'
              OR (v.tipo_creador = $2 AND COALESCE(v.id_usuario, v.id_personal) = $3))
          ORDER BY v.fecha_creacion DESC`,
        [id_operacion, mapOwner.tipo, mapOwner.id]
      ),

      // -------------------------------------------------
      // 4) Personal asignado
      //    Incluye:
      //      - identidad
      //      - rol_en_operacion
      //      - grupo directo
      //      - grupo padre
      //      - última posición conocida
      // -------------------------------------------------
      pool.query(
        `SELECT DISTINCT ON (p.id_personal)
            p.id_personal,
            p.apodo,
            p.nombre,
            p.apellido,
            p.rol,
            p.puesto,
            a.rol_en_operacion,
            a.estado_operacion_creacion,
            go.id_grupo_operacion,
            go.nombre          AS grupo_nombre,
            go.apodo           AS grupo_apodo,
            go.descripcion     AS grupo_flotilla,
            gp_padre.id_grupo_operacion AS grupo_padre_id,
            gp_padre.nombre    AS grupo_padre_nombre,
            gp_padre.apodo     AS grupo_padre_apodo,
            t.latitud,
            t.longitud,
            t.ultima_actualizacion,
            t.velocidad_kmh,
            t.rumbo_grados,
            t.rumbo_grados AS curso,
            t.rumbo_grados AS heading,
            COALESCE(t.frecuencia_cardiaca_bpm, sv.frecuencia_cardiaca_bpm) AS frecuencia_cardiaca_bpm,
            COALESCE(t.frecuencia_cardiaca, sv.frecuencia_cardiaca) AS frecuencia_cardiaca,
            COALESCE(t.fc, sv.fc) AS fc,
            COALESCE(t.heart_rate, sv.heart_rate) AS heart_rate,
            COALESCE(t.oxigenacion_spo2, sv.oxigenacion_spo2) AS oxigenacion_spo2,
            COALESCE(t.spo2, sv.spo2) AS spo2,
            COALESCE(t.temperatura_c, sv.temperatura_c) AS temperatura_c,
            COALESCE(t.frecuencia_respiratoria_rpm, sv.frecuencia_respiratoria_rpm) AS frecuencia_respiratoria_rpm,
            COALESCE(t.presion_sistolica_mmhg, sv.presion_sistolica_mmhg) AS presion_sistolica_mmhg,
            COALESCE(t.presion_diastolica_mmhg, sv.presion_diastolica_mmhg) AS presion_diastolica_mmhg,
            COALESCE(t.pasos, sv.pasos) AS pasos,
            COALESCE(t.presion_barometrica_hpa, sv.presion_barometrica_hpa) AS presion_barometrica_hpa,
            COALESCE(t.barometro, sv.barometro) AS barometro,
            COALESCE(t.baro, sv.baro) AS baro,
            COALESCE(t.bateria_pct, sv.bateria_pct) AS bateria_pct,
            COALESCE(t.bateria, sv.bateria) AS bateria,
            COALESCE(t.signos_actualizacion, sv.signos_actualizacion) AS signos_actualizacion,
            sv.dispositivo_id AS signos_dispositivo_id,
            sv.origen AS signos_origen,
            sv.metadata AS signos_metadata
         FROM asignacion_operacion_personal a
         JOIN personal p ON p.id_personal = a.id_personal

         -- Resuelve grupo del personal solo dentro de esta operación
         LEFT JOIN (
           SELECT gper2.id_personal, gper2.id_grupo_operacion
           FROM grupo_personal gper2
           JOIN grupo_operacion go2 ON go2.id_grupo_operacion = gper2.id_grupo_operacion
           WHERE go2.id_operacion = $1
         ) gper ON gper.id_personal = p.id_personal

         -- Grupo directo
         LEFT JOIN grupo_operacion go ON go.id_grupo_operacion = gper.id_grupo_operacion

         -- Grupo padre
         LEFT JOIN grupo_operacion gp_padre ON gp_padre.id_grupo_operacion = go.id_grupo_padre

         -- Última posición conocida
         LEFT JOIN v_ultima_posicion_personal t
           ON t.id_personal = a.id_personal AND t.id_operacion = a.id_operacion

         LEFT JOIN v_ultimos_signos_vitales_personal sv
           ON sv.id_personal = a.id_personal AND sv.id_operacion = a.id_operacion

         -- Solo personal no liberado
         WHERE a.id_operacion = $1 AND a.estado_asignacion NOT IN ('LIBERADO')

         -- Ordena por persona (requerido por DISTINCT ON) y por grupo
         ORDER BY p.id_personal,
                  CASE WHEN go.id_grupo_padre IS NOT NULL THEN 0 ELSE 1 END,
                  CASE WHEN go.id_grupo_operacion IS NULL THEN 1 ELSE 0 END,
                  go.id_grupo_operacion`,
        [id_operacion]
      ),

      // -------------------------------------------------
      // 5) Vehículos asignados
      //    Incluye:
      //      - identidad del vehículo
      //      - estado de asignación
      //      - persona asignada si aplica
      //      - grupo directo o inferido por pasajero/personal
      //      - tracking
      // -------------------------------------------------
      pool.query(
        `WITH personal_ctx AS (
            SELECT DISTINCT ON (p.id_personal)
              p.id_personal,
              p.apodo,
              p.nombre,
              p.apellido,
              p.puesto,
              aop.rol_en_operacion AS personal_rol,
              go.id_grupo_operacion AS grupo_personal_id,
              go.nombre AS grupo_personal_nombre,
              go.apodo AS grupo_personal_apodo,
              gp_padre.nombre AS grupo_personal_padre_nombre,
              gp_padre.apodo AS grupo_personal_padre_apodo,
              CASE
                WHEN p.rol = 'CET' THEN p.id_personal
                ELSE mo.id_cet
              END AS id_cet_ref,
              CASE
                WHEN p.rol = 'CET' THEN p.apodo
                ELSE cet.apodo
              END AS cet_apodo,
              CASE
                WHEN p.rol = 'CET' THEN CONCAT_WS(' ', p.nombre, p.apellido)
                ELSE CONCAT_WS(' ', cet.nombre, cet.apellido)
              END AS cet_nombre
            FROM asignacion_operacion_personal aop
            JOIN personal p
              ON p.id_personal = aop.id_personal
            LEFT JOIN grupo_personal gper
              ON gper.id_personal = p.id_personal
             AND EXISTS (
               SELECT 1
               FROM grupo_operacion gox
               WHERE gox.id_grupo_operacion = gper.id_grupo_operacion
                 AND gox.id_operacion = aop.id_operacion
             )
            LEFT JOIN grupo_operacion go
              ON go.id_grupo_operacion = gper.id_grupo_operacion
            LEFT JOIN grupo_operacion gp_padre
              ON gp_padre.id_grupo_operacion = go.id_grupo_padre
            LEFT JOIN mando_operacion mo
              ON mo.id_operacion = aop.id_operacion
             AND mo.id_cell = aop.id_personal
            LEFT JOIN personal cet
              ON cet.id_personal = mo.id_cet
            WHERE aop.id_operacion = $1
              AND aop.estado_asignacion NOT IN ('LIBERADO')
            ORDER BY
              p.id_personal,
              CASE WHEN go.id_grupo_padre IS NOT NULL THEN 0 ELSE 1 END,
              CASE WHEN go.id_grupo_operacion IS NULL THEN 1 ELSE 0 END,
              go.id_grupo_operacion
         )
         SELECT
            v.id_vehiculo,
            v.codigo_interno,
            v.tipo,
            v.alias,
            v.alias AS nombre,
            vo.estado_asignacion,
            vo.estado_operacion_creacion,
            vo.nivel_asignacion,
            vo.nivel_asignacion AS tipo_destino,
            vo.id_personal,
            per_ctx.apodo AS asignado_a_apodo,
            per_ctx.nombre AS asignado_a_nombre,
            per_ctx.apellido AS asignado_a_apellido,
            per_ctx.puesto AS personal_puesto,
            per_ctx.personal_rol,
            per_ctx.id_cet_ref,
            per_ctx.cet_apodo,
            per_ctx.cet_nombre,
            COALESCE(go_dest.nombre, per_ctx.grupo_personal_nombre, '') AS grupo_nombre,
            COALESCE(go_dest.apodo, per_ctx.grupo_personal_apodo, '') AS grupo_apodo,
            CASE
              WHEN go_dest.id_grupo_operacion IS NOT NULL THEN go_dest.nombre
              ELSE COALESCE(per_ctx.grupo_personal_nombre, '')
            END AS grupo_directo_nombre,
            CASE
              WHEN go_dest.id_grupo_operacion IS NOT NULL THEN COALESCE(gp_dest.nombre, '')
              ELSE COALESCE(per_ctx.grupo_personal_padre_nombre, '')
            END AS grupo_padre_nombre,
            tv.latitud,
            tv.longitud,
            tv.ultima_actualizacion
         FROM vehiculo_operacion vo
         JOIN vehiculo v
           ON v.id_vehiculo = vo.id_vehiculo
         LEFT JOIN personal_ctx per_ctx
           ON per_ctx.id_personal = vo.id_personal
         LEFT JOIN grupo_operacion go_dest
           ON go_dest.id_grupo_operacion = vo.id_grupo_operacion
         LEFT JOIN grupo_operacion gp_dest
           ON gp_dest.id_grupo_operacion = go_dest.id_grupo_padre
         LEFT JOIN v_ultima_posicion_vehiculo tv
           ON tv.id_vehiculo = vo.id_vehiculo AND tv.id_operacion = vo.id_operacion
         WHERE vo.id_operacion = $1
           AND vo.estado_asignacion != 'LIBERADO'
         ORDER BY
           v.tipo,
           v.codigo_interno,
           CASE per_ctx.personal_rol WHEN 'CET' THEN 0 ELSE 1 END,
           per_ctx.cet_nombre,
           per_ctx.nombre,
           per_ctx.apellido`,
        [id_operacion]
      ),

      // -------------------------------------------------
      // 6) Equipos asignados
      //    Incluye:
      //      - datos base
      //      - cantidad reservada
      //      - imagen consolidada
      //      - destino real resuelto desde uso_equipo_operacion
      // -------------------------------------------------
      pool.query(
        `WITH personal_ctx AS (
            SELECT DISTINCT ON (p.id_personal)
              p.id_personal,
              go.nombre AS grupo_nombre,
              gp_padre.nombre AS grupo_padre_nombre
            FROM asignacion_operacion_personal aop
            JOIN personal p ON p.id_personal = aop.id_personal
            LEFT JOIN grupo_personal gper
              ON gper.id_personal = p.id_personal
             AND EXISTS (
               SELECT 1
               FROM grupo_operacion gox
               WHERE gox.id_grupo_operacion = gper.id_grupo_operacion
                 AND gox.id_operacion = aop.id_operacion
             )
            LEFT JOIN grupo_operacion go ON go.id_grupo_operacion = gper.id_grupo_operacion
            LEFT JOIN grupo_operacion gp_padre ON gp_padre.id_grupo_operacion = go.id_grupo_padre
            WHERE aop.id_operacion = $1
              AND aop.estado_asignacion NOT IN ('LIBERADO')
            ORDER BY
              p.id_personal,
              CASE WHEN go.id_grupo_padre IS NOT NULL THEN 0 ELSE 1 END,
              CASE WHEN go.id_grupo_operacion IS NULL THEN 1 ELSE 0 END,
              go.id_grupo_operacion
          )
          SELECT
            e.id_equipo,
            e.numero_serie,
            e.nombre,
            e.categoria,
            e.estado,
            oe.cantidad,
            oe.uso_en_operacion,
            oe.estado_asignacion,
            oe.estado_operacion_creacion,
            ueo.estado_operacion_creacion AS uso_estado_operacion_creacion,
            COALESCE(ec.imagen_eqcom, et.imagen_eqtac) AS imagen_eq,
            ec.marca,
            ec.modelo,
            et.tipo_tactico,
            ueo.id_personal AS ueo_id_personal,
            ueo.id_vehiculo_contexto,
            ueo.id_grupo_operacion AS ueo_id_grupo_operacion,
            CASE
              WHEN UPPER(COALESCE(e.categoria, '')) = 'COMUNICACION'
                THEN COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ec.marca, ec.modelo)), ''), 'Equipo de comunicacion')
              WHEN UPPER(COALESCE(e.categoria, '')) = 'TACTICO'
                THEN COALESCE(NULLIF(TRIM(et.tipo_tactico), ''), 'Equipo tactico')
              ELSE COALESCE(NULLIF(TRIM(e.categoria), ''), 'Equipo')
            END AS tipo_equipo,

            -- Tipo de destino real del equipo
            CASE
              WHEN ueo.id_vehiculo_contexto IS NOT NULL THEN 'VEHICULO'
              WHEN ueo.id_grupo_operacion   IS NOT NULL THEN 'GRUPO'
              WHEN ueo.id_personal          IS NOT NULL THEN 'PERSONAL'
              ELSE NULL
            END AS tipo_destino,

            -- Persona responsable (siempre obligatoria)
            COALESCE(
              NULLIF(TRIM(CONCAT_WS(' ', p_ueo.puesto, p_ueo.nombre, p_ueo.apellido)), ''),
              p_ueo.apodo
            ) AS asignado_a_personal,
            p_ueo.rol AS personal_rol,

            -- Vehículo contexto si aplica
            v_ueo.codigo_interno AS asignado_a_vehiculo,
            v_ueo.alias          AS vehiculo_alias,

            -- Grupo si aplica
            go_ueo.nombre AS grupo_asignado,
            gp_ueo.nombre AS flotilla_asignada,
            per_ctx.grupo_nombre AS personal_grupo_nombre,
            per_ctx.grupo_padre_nombre AS personal_flotilla_nombre,
            veh_ctx.flotillas_vinculadas,
            veh_ctx.grupos_vinculados,
            te.latitud,
            te.longitud,
            te.altitud,
            te.velocidad_kmh,
            te.rumbo_grados,
            te.precision_m,
            te.ultima_actualizacion
          FROM operacion_equipo oe
          JOIN equipo e ON e.id_equipo = oe.id_equipo
          LEFT JOIN equipo_comunicacion ec ON ec.id_equipo = e.id_equipo
          LEFT JOIN equipo_tactico et ON et.id_equipo = e.id_equipo

          -- Uso real del equipo dentro de la operación
          LEFT JOIN uso_equipo_operacion ueo
            ON ueo.id_operacion = oe.id_operacion
           AND ueo.id_equipo    = oe.id_equipo
           AND ueo.fecha_devolucion IS NULL

          -- Resolución del destino según tipo_destino
          LEFT JOIN personal        p_ueo  ON p_ueo.id_personal          = ueo.id_personal
          LEFT JOIN vehiculo        v_ueo  ON v_ueo.id_vehiculo           = ueo.id_vehiculo_contexto
          LEFT JOIN grupo_operacion go_ueo ON go_ueo.id_grupo_operacion   = ueo.id_grupo_operacion
          LEFT JOIN grupo_operacion gp_ueo ON gp_ueo.id_grupo_operacion   = go_ueo.id_grupo_padre
          LEFT JOIN personal_ctx per_ctx   ON per_ctx.id_personal         = ueo.id_personal
          LEFT JOIN LATERAL (
            SELECT
              STRING_AGG(DISTINCT COALESCE(pc.grupo_padre_nombre, pc.grupo_nombre), ', ')
                FILTER (WHERE COALESCE(pc.grupo_padre_nombre, pc.grupo_nombre) IS NOT NULL) AS flotillas_vinculadas,
              STRING_AGG(DISTINCT pc.grupo_nombre, ', ')
                FILTER (WHERE pc.grupo_nombre IS NOT NULL) AS grupos_vinculados
            FROM vehiculo_operacion vo2
            LEFT JOIN personal_ctx pc ON pc.id_personal = vo2.id_personal
            WHERE vo2.id_operacion = oe.id_operacion
              AND vo2.id_vehiculo = ueo.id_vehiculo_contexto
              AND vo2.estado_asignacion NOT IN ('LIBERADO')
          ) veh_ctx ON TRUE
          LEFT JOIN v_ultima_posicion_equipo te
            ON te.id_operacion = oe.id_operacion
           AND te.id_equipo = oe.id_equipo

          -- Solo equipo no liberado
          WHERE oe.id_operacion = $1 AND oe.estado_asignacion != 'LIBERADO'
          ORDER BY
            CASE
              WHEN UPPER(COALESCE(e.categoria, '')) = 'COMUNICACION' THEN 0
              WHEN UPPER(COALESCE(e.categoria, '')) = 'TACTICO' THEN 1
              ELSE 2
            END,
            e.nombre,
            e.numero_serie`,
        [id_operacion]
      ),

      // -------------------------------------------------
      // 6b) Dispositivos asignados con ultima posicion
      // -------------------------------------------------
      pool.query(
        `SELECT
           od.id_operacion,
           od.id_dispositivo,
           d.imagen_disp,
           d.tipo,
           d.marca,
           d.modelo,
           d.numero_telefono,
           d.imei,
           d.numero_serie,
           d.sistema_operativo,
           d.estado AS dispositivo_estado,
           od.id_personal,
           p.apodo AS personal_apodo,
           p.nombre AS personal_nombre,
           p.apellido AS personal_apellido,
           p.puesto AS personal_puesto,
           od.estado_asignacion,
           od.fecha_asignacion,
           od.fecha_devolucion,
           od.estado_operacion_creacion,
           td.latitud,
           td.longitud,
           td.altitud,
           td.velocidad_kmh,
           td.rumbo_grados,
           td.precision_m,
           td.bateria_pct,
           td.ultima_actualizacion,
           CASE
             WHEN td.id_dispositivo IS NOT NULL THEN 'DISPOSITIVO'
             ELSE NULL
           END AS fuente_ubicacion
         FROM operacion_dispositivo od
         JOIN dispositivo d ON d.id_dispositivo = od.id_dispositivo
         JOIN personal p ON p.id_personal = od.id_personal
         LEFT JOIN v_ultima_posicion_dispositivo td
           ON td.id_operacion = od.id_operacion
          AND td.id_dispositivo = od.id_dispositivo
         WHERE od.id_operacion = $1
           AND od.estado_asignacion = 'ASIGNADO'
           AND od.fecha_devolucion IS NULL
         ORDER BY d.tipo, d.marca, d.modelo, d.numero_serie NULLS LAST`,
        [id_operacion]
      ),

      // -------------------------------------------------
      // 7) Rutas de navegación activas
      //    Incluye:
      //      - geometría
      //      - origen/destino
      //      - distancia/duración
      //      - quién la creó y su rol
      //
      // Filtro por rol:
      //   CELL → solo rutas generales (sin vehículo) o del vehículo
      //          al que están asignados en la operación.
      //   Otros → todas las rutas activas.
      // -------------------------------------------------
      (() => {
        const esCell   = (req.user?.rol || "").toUpperCase() === "CELL";
        const idPersonal = esCell ? (Number(req.user.sub) || null) : null;

        if (esCell && idPersonal) {
          return pool.query(
            `SELECT
                rn.id_ruta, rn.id_operacion, rn.geojson, rn.origen_lat, rn.origen_lon,
                rn.destino_lat, rn.destino_lon, rn.distancia_m, rn.duracion_s,
                rn.created_by_tipo, rn.id_usuario, rn.id_personal, rn.id_vehiculo,
                rn.estado_operacion_creacion, rn.fecha_creacion,
                COALESCE(u.rol::text, p.rol::text) AS rol_creador, p.puesto AS creador_puesto,
                COALESCE(NULLIF(p.apodo, ''), NULLIF(TRIM(CONCAT_WS(' ', p.nombre, p.apellido)), ''), NULLIF(u.username, ''), NULLIF(TRIM(CONCAT_WS(' ', u.nombre, u.apellido)), ''), rn.created_by_tipo::text) AS creador_nombre
             FROM ruta_navegacion rn
             LEFT JOIN usuario  u ON rn.created_by_tipo = 'USUARIO'   AND rn.id_usuario  = u.id_usuario
             LEFT JOIN personal p ON rn.created_by_tipo = 'PERSONAL'  AND rn.id_personal = p.id_personal
             WHERE rn.id_operacion = $1
               AND rn.activo = true
               AND (
                 rn.id_vehiculo IS NULL
                 OR rn.id_vehiculo IN (
                   SELECT vo.id_vehiculo
                   FROM vehiculo_operacion vo
                   WHERE vo.id_operacion = $1
                     AND vo.id_personal  = $2
                 )
               )`,
            [id_operacion, idPersonal]
          );
        }

        return pool.query(
          `SELECT
              rn.id_ruta, rn.id_operacion, rn.geojson, rn.origen_lat, rn.origen_lon,
              rn.destino_lat, rn.destino_lon, rn.distancia_m, rn.duracion_s,
              rn.created_by_tipo, rn.id_usuario, rn.id_personal, rn.id_vehiculo,
              rn.estado_operacion_creacion, rn.fecha_creacion,
              COALESCE(u.rol::text, p.rol::text) AS rol_creador, p.puesto AS creador_puesto,
              COALESCE(NULLIF(p.apodo, ''), NULLIF(TRIM(CONCAT_WS(' ', p.nombre, p.apellido)), ''), NULLIF(u.username, ''), NULLIF(TRIM(CONCAT_WS(' ', u.nombre, u.apellido)), ''), rn.created_by_tipo::text) AS creador_nombre
           FROM ruta_navegacion rn
           LEFT JOIN usuario  u ON rn.created_by_tipo = 'USUARIO'   AND rn.id_usuario  = u.id_usuario
           LEFT JOIN personal p ON rn.created_by_tipo = 'PERSONAL'  AND rn.id_personal = p.id_personal
           WHERE rn.id_operacion = $1 AND rn.activo = true`,
          [id_operacion]
        );
      })(),

      fetchOperationGrid(pool, id_operacion)
    ]);

    // Si la operación no existe, corta con 404
    if (!operacionRes.rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Operación no existe" });
    }

    // Devuelve todo el paquete de datos del mapa
    return res.json({
      ok: true,
      operacion: operacionRes.rows[0],
      zona_operacion: zonaRes.rows[0] || null,
      capas: capasRes.rows,
      pois: poisRes.rows,
      personal: personalRes.rows,
      vehiculos: vehiculosRes.rows,
      equipos: equiposRes.rows,
      dispositivos: dispositivosRes.rows,
      rutas_navegacion: rutasNavegacionRes.rows,
      cuadricula_operacion: grid,
      grid
    });
  } catch (err) {
    return sendDbError(res, err, "Error obteniendo mapa");
  }
});

// =========================================================
// GET /ops/:id/dibujos
// Devuelve todos los trazos de dibujo libre activos de la operación.
// =========================================================
router.get("/ops/:id/dibujos", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT
          d.id_dibujo, d.puntos, d.color, d.grosor, d.estado_operacion_creacion,
          d.tipo_creador, d.id_usuario, d.id_personal,
          COALESCE(
            NULLIF(p.apodo, ''),
            NULLIF(TRIM(CONCAT_WS(' ', p.nombre, p.apellido)), ''),
            NULLIF(u.username, ''),
            NULLIF(TRIM(CONCAT_WS(' ', u.nombre, u.apellido)), ''),
            d.tipo_creador::text
          ) AS creador_nombre
         FROM dibujo_libre_operacion d
         LEFT JOIN personal p ON d.tipo_creador = 'PERSONAL' AND d.id_personal = p.id_personal
         LEFT JOIN usuario u ON d.tipo_creador = 'USUARIO' AND d.id_usuario = u.id_usuario
        WHERE d.id_operacion = $1 AND d.activo = TRUE
        ORDER BY d.fecha_creacion ASC`,
      [id_operacion]
    );
    res.json({ ok: true, items: rows });
  } catch (err) {
    sendDbError(res, err, "Error obteniendo dibujos");
  }
});

// =========================================================
// POST /ops/:id/dibujos
// Guarda un nuevo trazo de dibujo libre.
// Campos esperados:
//   - puntos: array de {lat, lng}
//   - color: string CSS
//   - grosor: número
//   - tipo_creador: USUARIO o PERSONAL
//   - id_usuario / id_personal según corresponda
// =========================================================
router.post("/ops/:id/dibujos", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  const { puntos, color, grosor, tipo_creador, id_usuario, id_personal } = req.body ?? {};

  if (!Array.isArray(puntos) || puntos.length < 2) {
    return res.status(400).json({ ok: false, mensaje: "puntos invalidos (minimo 2)" });
  }

  const tipo = (tipo_creador || "USUARIO").toString().toUpperCase();
  if (!["USUARIO", "PERSONAL"].includes(tipo)) {
    return res.status(400).json({ ok: false, mensaje: "tipo_creador invalido" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO dibujo_libre_operacion
         (tipo_creador, id_usuario, id_personal, id_operacion, puntos, color, grosor)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING id_dibujo, id_operacion, puntos, color, grosor, activo,
                 tipo_creador, id_usuario, id_personal,
                 fecha_creacion, estado_operacion_creacion`,
      [
        tipo,
        id_usuario ? Number(id_usuario) : null,
        id_personal ? Number(id_personal) : null,
        id_operacion,
        JSON.stringify(puntos),
        color?.toString().trim() || "#FFFFFF",
        Number(grosor) || 3
      ]
    );
    const io = req.app.get("io");
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "dibujo_creado",
      entidad_tipo: "dibujo",
      entidad_id: rows[0].id_dibujo,
      payload: rows[0],
      occurred_at: rows[0].fecha_creacion,
      actor: getActorFromRequest(req)
    });
    if (io) emitDibujoCreado(io, id_operacion, rows[0]);
    res.json({ ok: true, dibujo: rows[0] });
  } catch (err) {
    sendDbError(res, err, "Error guardando dibujo");
  }
});

// =========================================================
// DELETE /ops/:id/dibujos/:id_dibujo
// Baja lógica de un trazo (activo = FALSE).
// =========================================================
router.delete("/ops/:id/dibujos/:id_dibujo", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_dibujo = Number(req.params.id_dibujo);

  if (!isInt(id_operacion) || !isInt(id_dibujo)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE dibujo_libre_operacion
          SET activo = FALSE
        WHERE id_dibujo = $1 AND id_operacion = $2 AND activo = TRUE
        RETURNING id_dibujo, id_operacion, puntos, color, grosor, activo,
                  fecha_creacion, estado_operacion_creacion`,
      [id_dibujo, id_operacion]
    );
    if (!rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Dibujo no encontrado" });
    }
    const io = req.app.get("io");
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "dibujo_eliminado",
      entidad_tipo: "dibujo",
      entidad_id: id_dibujo,
      payload: rows[0],
      actor: getActorFromRequest(req)
    });
    if (io) emitDibujoEliminado(io, id_operacion, id_dibujo);
    res.json({ ok: true });
  } catch (err) {
    sendDbError(res, err, "Error eliminando dibujo");
  }
});

// =========================================================
// PATCH /ops/:id/pois/:id_poi/restore
// Reactiva un POI que fue desactivado (undo de borrado lógico).
// =========================================================
router.patch("/ops/:id/pois/:id_poi/restore", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_poi = Number(req.params.id_poi);
  if (!isInt(id_operacion) || !isInt(id_poi)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE puntos_interes
          SET activo = TRUE
        WHERE id_poi = $1 AND id_operacion = $2
        RETURNING *`,
      [id_poi, id_operacion]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, mensaje: "POI no existe" });
    const io = req.app.get("io");
    if (io) emitPoiCreado(io, id_operacion, rows[0]);
    res.json({ ok: true });
  } catch (err) {
    sendDbError(res, err, "Error restaurando POI");
  }
});

// =========================================================
// PATCH /ops/:id/areas/:id_area/restore
// Reactiva un área que fue eliminada (undo de borrado lógico).
// =========================================================
router.patch("/ops/:id/areas/:id_area/restore", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_area = Number(req.params.id_area);
  if (!isInt(id_operacion) || !isInt(id_area)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE area_interes
          SET estado = 'ACTIVA'
        WHERE id_area = $1 AND id_operacion = $2
        RETURNING *`,
      [id_area, id_operacion]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, mensaje: "Area no existe" });
    const io = req.app.get("io");
    if (io) emitAreaCreada(io, id_operacion, rows[0]);
    res.json({ ok: true });
  } catch (err) {
    sendDbError(res, err, "Error restaurando area");
  }
});

// =========================================================
// PATCH /ops/:id/edificios/:id_marca/restore
// Reactiva una estructura que fue desactivada (undo de borrado lógico).
// =========================================================
router.patch("/ops/:id/edificios/:id_marca/restore", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_marca = Number(req.params.id_marca);
  if (!isInt(id_operacion) || !isInt(id_marca)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE marca_edificio
          SET estado = 'ACTIVO'
        WHERE id_marca = $1 AND id_operacion = $2
        RETURNING *`,
      [id_marca, id_operacion]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, mensaje: "Edificio no existe" });
    const io = req.app.get("io");
    if (io) emitEstructuraCreada(io, id_operacion, rows[0]);
    res.json({ ok: true });
  } catch (err) {
    sendDbError(res, err, "Error restaurando edificio");
  }
});

// =========================================================
// PATCH /ops/:id/dibujos/:id_dibujo/restore
// Reactiva un trazo de dibujo que fue desactivado (undo de borrado lógico).
// =========================================================
router.patch("/ops/:id/dibujos/:id_dibujo/restore", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_dibujo = Number(req.params.id_dibujo);
  if (!isInt(id_operacion) || !isInt(id_dibujo)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE dibujo_libre_operacion
          SET activo = TRUE
        WHERE id_dibujo = $1 AND id_operacion = $2
        RETURNING id_dibujo, estado_operacion_creacion`,
      [id_dibujo, id_operacion]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, mensaje: "Dibujo no existe" });
    const io = req.app.get("io");
    if (io) emitDibujoCreado(io, id_operacion, rows[0]);
    res.json({ ok: true });
  } catch (err) {
    sendDbError(res, err, "Error restaurando dibujo");
  }
});

// Exporta el router para montarlo en la app principal
export default router;
