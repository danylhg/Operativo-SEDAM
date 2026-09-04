// Importa Router de Express para declarar rutas agrupadas
import { Router } from "express";

// Pool de PostgreSQL para ejecutar consultas
import { pool } from "../db.js";

// Middleware que exige autenticación
import { requireAuth } from "../middlewares/auth.js";

// Helper para responder errores HTTP simples
import { sendError } from "../utils/http.js";

// Helper para responder errores de BD/backend de forma uniforme
import { sendDbError } from "../utils/dbErrors.js";

// Helper para validar enteros
import { isInt } from "../utils/validators.js";

// Emit filtrado de rutas por rol
import {
  emitRutaCreada,
  emitRutaOperacionCreada,
  emitRutaOperacionEliminada
} from "../sockets/index.js";
import { getActorFromRequest, logOperacionEvento } from "../utils/timeline.js";

// Crea la instancia del router
const router = Router();


// ===============================
// RUTAS OPERACIONALES
// ===============================


// =========================================================
// GET /ops/:id/rutas
// Qué hace:
//   Lista las rutas operacionales de una operación.
// Solo devuelve:
//   rutas con estado PLANIFICADA o ACTIVA.
// Orden:
//   las más recientes primero.
// Fuente:
//   Lee directo desde ruta_operacion.
// =========================================================
router.get("/ops/:id/rutas", requireAuth, async (req, res) => {
  // Convierte id_operacion desde la URL
  const id_operacion = Number(req.params.id);

  // Valida que sea entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  try {
    // Consulta rutas activas o planificadas de la operación
    const { rows } = await pool.query(
      `SELECT * FROM ruta_operacion WHERE id_operacion=$1 AND estado IN ('PLANIFICADA','ACTIVA') ORDER BY fecha_creacion DESC`,
      [id_operacion]
    );

    // Responde con la lista
    res.json({ ok: true, items: rows });
  } catch (err) {
    // Manejo uniforme de error
    sendDbError(res, err, "Error obteniendo rutas");
  }
});


// =========================================================
// POST /ops/:id/rutas
// Qué hace:
//   Crea una nueva ruta operacional dentro de una operación.
// Campos esperados:
//   - nombre
//   - descripcion (opcional)
//   - geometria (GeoJSON LineString o similar)
//   - color (opcional)
//   - tipo_creador
//   - id_usuario / id_personal
// Validaciones:
//   - nombre obligatorio
//   - geometria obligatoria
//   - tipo_creador válido
// Nota:
//   Aquí la geometría se serializa con JSON.stringify.
// =========================================================
router.post("/ops/:id/rutas", requireAuth, async (req, res) => {
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

  // nombre obligatorio
  if (!nombre?.toString().trim()) {
    return res.status(400).json({ ok: false, mensaje: "Falta nombre" });
  }

  // geometria obligatoria
  if (!geometria) {
    return res.status(400).json({ ok: false, mensaje: "Falta geometria (GeoJSON LineString)" });
  }

  // Normaliza tipo_creador
  const tipo = (tipo_creador || "USUARIO").toString().toUpperCase();

  // Solo permite USUARIO o PERSONAL
  if (!["USUARIO", "PERSONAL"].includes(tipo)) {
    return res.status(400).json({ ok: false, mensaje: "tipo_creador invalido" });
  }

  try {
    // Inserta la ruta operacional
    const { rows } = await pool.query(
      `INSERT INTO ruta_operacion (id_operacion, tipo_creador, id_usuario, id_personal, nombre, descripcion, geometria, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        id_operacion,
        tipo,
        id_usuario ? Number(id_usuario) : null,
        id_personal ? Number(id_personal) : null,
        nombre.toString().trim(),
        descripcion?.toString().trim() || null,
        JSON.stringify(geometria),
        color || "#1E90FF"
      ]
    );

    const ruta = rows[0];
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "ruta_tactica_creada",
      entidad_tipo: "ruta_operacion",
      entidad_id: ruta.id_ruta,
      payload: ruta,
      occurred_at: ruta.fecha_creacion,
      actor: getActorFromRequest(req)
    });
    const io = req.app.get("io");
    if (io) emitRutaOperacionCreada(io, id_operacion, ruta);

    // Devuelve la ruta creada
    res.json({ ok: true, ruta });
  } catch (err) {
    sendDbError(res, err, "Error creando ruta");
  }
});

// =========================================================
// DELETE /ops/:id/rutas/:id_ruta
// Oculta una ruta operacional/tactica con baja logica.
// =========================================================
router.delete("/ops/:id/rutas/:id_ruta", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_ruta = Number(req.params.id_ruta);

  if (!isInt(id_operacion) || !isInt(id_ruta)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE ruta_operacion
          SET estado = 'CANCELADA'
        WHERE id_operacion = $1
          AND id_ruta = $2
          AND estado IN ('PLANIFICADA','ACTIVA')
      RETURNING id_ruta, estado`,
      [id_operacion, id_ruta]
    );

    if (!rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Ruta no existe" });
    }

    const io = req.app.get("io");
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "ruta_tactica_eliminada",
      entidad_tipo: "ruta_operacion",
      entidad_id: id_ruta,
      payload: rows[0],
      actor: getActorFromRequest(req)
    });
    if (io) emitRutaOperacionEliminada(io, id_operacion, id_ruta);

    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    sendDbError(res, err, "Error eliminando ruta");
  }
});

// =========================================================
// PATCH /ops/:id/rutas/:id_ruta/restore
// Reactiva una ruta operacional/tactica cancelada.
// =========================================================
router.patch("/ops/:id/rutas/:id_ruta/restore", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  const id_ruta = Number(req.params.id_ruta);

  if (!isInt(id_operacion) || !isInt(id_ruta)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE ruta_operacion
          SET estado = 'PLANIFICADA'
        WHERE id_operacion = $1
          AND id_ruta = $2
      RETURNING *`,
      [id_operacion, id_ruta]
    );

    if (!rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Ruta no existe" });
    }

    const ruta = rows[0];
    const io = req.app.get("io");
    if (io) emitRutaOperacionCreada(io, id_operacion, ruta);

    res.json({ ok: true, ruta });
  } catch (err) {
    sendDbError(res, err, "Error restaurando ruta");
  }
});


// =========================================================
// PATCH /ops/:id/rutas/:id_ruta/estado
// Qué hace:
//   Cambia el estado de una ruta operacional.
// Estados permitidos:
//   - PLANIFICADA
//   - ACTIVA
//   - COMPLETADA
//   - CANCELADA
// Validaciones:
//   - id_ruta válido
//   - estado válido
// Nota:
//   No valida aquí que la ruta pertenezca al :id de la operación.
// =========================================================
router.patch("/ops/:id/rutas/:id_ruta/estado", requireAuth, async (req, res) => {
  // Convierte id_ruta
  const id_ruta = Number(req.params.id_ruta);

  // Valida entero
  if (!isInt(id_ruta)) {
    return res.status(400).json({ ok: false, mensaje: "id_ruta invalido" });
  }

  // Estado nuevo de la ruta
  const estado = (req.body?.estado || "").toString().toUpperCase();

  // Valida catálogo permitido
  if (!["PLANIFICADA", "ACTIVA", "COMPLETADA", "CANCELADA"].includes(estado)) {
    return res.status(400).json({ ok: false, mensaje: "estado invalido" });
  }

  try {
    // Actualiza el estado de la ruta
    const { rows } = await pool.query(
      `UPDATE ruta_operacion SET estado=$1 WHERE id_ruta=$2 RETURNING id_ruta, estado`,
      [estado, id_ruta]
    );

    // Si no existe, 404
    if (!rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Ruta no existe" });
    }

    // Respuesta final
    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    sendDbError(res, err, "Error actualizando ruta");
  }
});


// ================================
// RUTAS DE NAVEGACIÓN
// ================================


// =========================================================
// GET /ops/:id/rutas/navegacion
// Devuelve todas las rutas de navegación activas de la operación.
// =========================================================
router.get("/ops/:id/rutas/navegacion", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return res.status(400).json({ ok: false, mensaje: "id inválido" });

  const rol       = (req.user?.rol || "").toUpperCase();
  const esCell    = rol === "CELL";
  const id_personal = esCell ? (Number(req.user.sub) || null) : null;

  try {
    let rows;

    if (esCell && id_personal) {
      // Células: solo rutas generales (sin vehículo) o del vehículo al que están asignadas
      ({ rows } = await pool.query(
        `SELECT r.id_ruta, r.id_operacion, r.geojson,
                r.origen_lat, r.origen_lon, r.destino_lat, r.destino_lon,
                r.distancia_m, r.duracion_s, r.id_vehiculo,
                r.estado_operacion_creacion,
                r.created_by_tipo, r.id_usuario, r.id_personal,
                r.fecha_creacion,
                COALESCE(u.nombre || ' ' || u.apellido, p.nombre || ' ' || p.apellido, 'Sistema') AS creador_nombre
         FROM ruta_navegacion r
         LEFT JOIN usuario  u ON u.id_usuario  = r.id_usuario
         LEFT JOIN personal p ON p.id_personal = r.id_personal
         WHERE r.id_operacion = $1
           AND r.activo = true
           AND (
             r.id_vehiculo IS NULL
             OR r.id_vehiculo IN (
               SELECT vo.id_vehiculo
               FROM vehiculo_operacion vo
               WHERE vo.id_operacion = $1
                 AND vo.id_personal  = $2
             )
           )
         ORDER BY r.fecha_creacion ASC`,
        [id_operacion, id_personal]
      ));
    } else {
      // Admin, CUT, CET: todas las rutas
      ({ rows } = await pool.query(
        `SELECT r.id_ruta, r.id_operacion, r.geojson,
                r.origen_lat, r.origen_lon, r.destino_lat, r.destino_lon,
                r.distancia_m, r.duracion_s, r.id_vehiculo,
                r.estado_operacion_creacion,
                r.created_by_tipo, r.id_usuario, r.id_personal,
                r.fecha_creacion,
                COALESCE(u.nombre || ' ' || u.apellido, p.nombre || ' ' || p.apellido, 'Sistema') AS creador_nombre
         FROM ruta_navegacion r
         LEFT JOIN usuario  u ON u.id_usuario  = r.id_usuario
         LEFT JOIN personal p ON p.id_personal = r.id_personal
         WHERE r.id_operacion = $1 AND r.activo = true
         ORDER BY r.fecha_creacion ASC`,
        [id_operacion]
      ));
    }

    return res.json({ ok: true, items: rows });
  } catch (err) {
    return sendDbError(res, err, "Error obteniendo rutas de navegación");
  }
});


// =========================================================
// POST /ops/:id/rutas/navegacion
// Qué hace:
//   Registra una ruta de navegación real dentro de una operación.
// Se usa para rutas calculadas, por ejemplo, con OSRM.
// Campos esperados:
//   - geojson (LineString válido)
//   - origen_lat
//   - origen_lon
//   - destino_lat
//   - destino_lon
//   - distancia_m (opcional)
//   - duracion_s (opcional)
//
// Flujo:
//   1. valida id_operacion
//   2. valida geojson y coordenadas
//   3. verifica que la operación exista y sea modificable
//   4. resuelve si el creador es USUARIO o PERSONAL
//   5. inserta la ruta_navegacion
//   6. emite socket "ruta_navegacion_creada"
// =========================================================
router.post("/ops/:id/rutas/navegacion", requireAuth, async (req, res) => {
  // Convierte id_operacion
  const id_operacion = Number(req.params.id);

  // Valida id positivo
  if (!Number.isInteger(id_operacion) || id_operacion <= 0) {
    return res.status(400).json({ ok: false, mensaje: "id_operacion inválido" });
  }

  // Extrae datos del body
  const {
    geojson,
    origen_lat,
    origen_lon,
    destino_lat,
    destino_lon,
    distancia_m,
    duracion_s,
    id_vehiculo
  } = req.body || {};

  // id_vehiculo opcional — si viene debe ser entero positivo
  const vehiculoId = id_vehiculo != null ? Number(id_vehiculo) : null;
  if (vehiculoId !== null && (!Number.isInteger(vehiculoId) || vehiculoId <= 0)) {
    return res.status(400).json({ ok: false, mensaje: "id_vehiculo inválido" });
  }

  // geojson obligatorio y debe ser objeto
  if (!geojson || typeof geojson !== "object") {
    return res.status(400).json({ ok: false, mensaje: "geojson es requerido" });
  }

  // Valida que sea un LineString con mínimo 2 coordenadas
  if (geojson.type !== "LineString" || !Array.isArray(geojson.coordinates) || geojson.coordinates.length < 2) {
    return res.status(400).json({ ok: false, mensaje: "geojson debe ser un LineString válido" });
  }

  // Valida coordenadas numéricas
  const nums = [origen_lat, origen_lon, destino_lat, destino_lon];
  if (nums.some(v => typeof v !== "number" || !Number.isFinite(v))) {
    return res.status(400).json({ ok: false, mensaje: "origen/destino inválidos" });
  }

  // Valida rango de latitudes
  if (origen_lat < -90 || origen_lat > 90 || destino_lat < -90 || destino_lat > 90) {
    return res.status(400).json({ ok: false, mensaje: "latitud fuera de rango" });
  }

  // Valida rango de longitudes
  if (origen_lon < -180 || origen_lon > 180 || destino_lon < -180 || destino_lon > 180) {
    return res.status(400).json({ ok: false, mensaje: "longitud fuera de rango" });
  }

  // distancia_m, si viene, debe ser numérica y no negativa
  if (distancia_m != null && (!Number.isFinite(distancia_m) || distancia_m < 0)) {
    return res.status(400).json({ ok: false, mensaje: "distancia_m inválida" });
  }

  // duracion_s, si viene, debe ser numérica y no negativa
  if (duracion_s != null && (!Number.isFinite(duracion_s) || duracion_s < 0)) {
    return res.status(400).json({ ok: false, mensaje: "duracion_s inválida" });
  }

  try {
    // Verifica que la operación exista y revisa su estado
    const opRes = await pool.query(
      `SELECT id_operacion, estado FROM operacion WHERE id_operacion = $1 LIMIT 1`,
      [id_operacion]
    );

    const operacion = opRes.rows[0];

    // Si no existe, 404
    if (!operacion) {
      return res.status(404).json({ ok: false, mensaje: "Operación no existe" });
    }

    // Si está cerrada o cancelada, bloquea
    if (["CERRADA", "CANCELADA"].includes(operacion.estado)) {
      return res.status(409).json({
        ok: false,
        mensaje: `No se pueden registrar rutas en una operación ${operacion.estado}`
      });
    }

    // Variables para identificar al creador
    let tipo_creador = null;
    let id_usuario = null;
    let id_personal = null;

    // Si el actor es usuario/admin, se registra como USUARIO
    if (req.user?.tabla === "usuario" || req.user?.tipo === "USUARIO" || req.user?.rol === "ADMIN") {
      tipo_creador = "USUARIO";
      id_usuario = Number(req.user.sub) || null;
    } else {
      // Si no, se registra como PERSONAL
      tipo_creador = "PERSONAL";
      id_personal = Number(req.user.sub) || null;
    }

    // Valida consistencia del creador
    if (tipo_creador === "USUARIO" && !id_usuario) {
      return res.status(401).json({ ok: false, mensaje: "No se pudo identificar el usuario creador" });
    }

    if (tipo_creador === "PERSONAL" && !id_personal) {
      return res.status(401).json({ ok: false, mensaje: "No se pudo identificar el personal creador" });
    }

    // Inserta la ruta de navegación
    const insertRes = await pool.query(
      `INSERT INTO ruta_navegacion (
         id_operacion, geojson, origen_lat, origen_lon,
         destino_lat, destino_lon, distancia_m, duracion_s,
         created_by_tipo, id_usuario, id_personal, id_vehiculo
       )
       VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING
         id_ruta, id_operacion, geojson, origen_lat, origen_lon,
         destino_lat, destino_lon, distancia_m, duracion_s,
         created_by_tipo, id_usuario, id_personal, id_vehiculo,
         estado_operacion_creacion, fecha_creacion`,
      [
        id_operacion,
        JSON.stringify(geojson),
        origen_lat,
        origen_lon,
        destino_lat,
        destino_lon,
        distancia_m ?? null,
        duracion_s ?? null,
        tipo_creador,
        id_usuario,
        id_personal,
        vehiculoId
      ]
    );

    // Toma la ruta recién creada
    const ruta = insertRes.rows[0];

    // Agrega rol_creador al payload con el rol del token
    ruta.rol_creador = req.user?.rol || "ADMIN";
    const creatorRes = tipo_creador === "PERSONAL"
      ? await pool.query(
          `SELECT TRIM(CONCAT_WS(' ', NULLIF(nombre, ''), NULLIF(apellido, ''))) AS nombre, puesto
             FROM personal WHERE id_personal = $1 LIMIT 1`,
          [id_personal]
        )
      : await pool.query(
          `SELECT TRIM(CONCAT_WS(' ', NULLIF(nombre, ''), NULLIF(apellido, ''))) AS nombre, rol
             FROM usuario WHERE id_usuario = $1 LIMIT 1`,
          [id_usuario]
        );
    const creatorRow = creatorRes.rows[0] || {};
    ruta.creador_nombre = creatorRow.nombre || req.user?.username || tipo_creador;
    ruta.creador_puesto = creatorRow.puesto || creatorRow.rol || "";
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "ruta_navegacion_creada",
      entidad_tipo: "ruta_navegacion",
      entidad_id: ruta.id_ruta,
      payload: ruta,
      occurred_at: ruta.fecha_creacion,
      actor: getActorFromRequest(req)
    });

    // Obtiene socket.io
    const io = req.app.get("io");

    // Emite la ruta nueva solo a quienes tienen permiso de verla
    await emitRutaCreada(io, id_operacion, ruta);

    // Respuesta final
    return res.status(201).json({
      ok: true,
      mensaje: "Ruta de navegación creada correctamente",
      ruta
    });
  } catch (err) {
    return sendDbError(res, err, "Error creando ruta de navegación");
  }
});


// =========================================================
// DELETE /ops/:id/rutas/navegacion/:id_ruta
// Qué hace:
//   Oculta/desactiva una ruta de navegación.
// En realidad:
//   No la borra físicamente; hace soft delete:
//   - activo = false
//   - fecha_eliminacion = NOW()
//   - guarda quién la eliminó
//
// Flujo:
//   1. valida ids
//   2. resuelve actor que elimina
//   3. actualiza la ruta si sigue activa
//   4. emite socket "ruta_navegacion_eliminada"
// =========================================================
router.delete("/ops/:id/rutas/navegacion/:id_ruta", requireAuth, async (req, res) => {
  // Convierte ids
  const id_operacion = Number(req.params.id);
  const id_ruta = Number(req.params.id_ruta);

  // Valida id_operacion
  if (!Number.isInteger(id_operacion) || id_operacion <= 0) {
    return res.status(400).json({ ok: false, mensaje: "id_operacion inválido" });
  }

  // Valida id_ruta
  if (!Number.isInteger(id_ruta) || id_ruta <= 0) {
    return res.status(400).json({ ok: false, mensaje: "id_ruta inválido" });
  }

  try {
    // Variables para registrar quién eliminó
    let eliminado_por_tipo = null;
    let id_usuario_elim = null;
    let id_personal_elim = null;

    // Si viene de usuario/admin, guarda como USUARIO
    if (req.user?.tabla === "usuario" || req.user?.tipo === "USUARIO" || req.user?.rol === "ADMIN") {
      eliminado_por_tipo = "USUARIO";
      id_usuario_elim = Number(req.user.sub) || null;
    } else {
      // Si no, guarda como PERSONAL
      eliminado_por_tipo = "PERSONAL";
      id_personal_elim = Number(req.user.sub) || null;
    }

    // Soft delete de la ruta, pero solo si coincide operación + id_ruta + activo=true
    const updRes = await pool.query(
      `UPDATE ruta_navegacion
       SET
         activo = false,
         fecha_eliminacion = NOW(),
         eliminado_por_tipo = $3,
         id_usuario_elim = $4,
         id_personal_elim = $5
       WHERE id_ruta = $1
         AND id_operacion = $2
         AND activo = true
         AND created_by_tipo = $3
         AND (
           ($3 = 'USUARIO' AND id_usuario = $4)
           OR ($3 = 'PERSONAL' AND id_personal = $5)
         )
       RETURNING id_ruta, id_operacion`,
      [id_ruta, id_operacion, eliminado_por_tipo, id_usuario_elim, id_personal_elim]
    );

    const rutaOcultada = updRes.rows[0];

    // Si no encontró ninguna, ya no existía o ya estaba inactiva
    if (!rutaOcultada) {
      return res.status(404).json({
        ok: false,
        mensaje: "Ruta no encontrada, no te pertenece o ya estaba inactiva"
      });
    }
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "ruta_navegacion_eliminada",
      entidad_tipo: "ruta_navegacion",
      entidad_id: rutaOcultada.id_ruta,
      payload: rutaOcultada,
      actor: getActorFromRequest(req)
    });

    // Obtiene socket.io
    const io = req.app.get("io");

    // Notifica al room que la ruta fue eliminada/ocultada
    io.to(`op_${id_operacion}`).emit("ruta_navegacion_eliminada", {
      id_ruta: rutaOcultada.id_ruta,
      id_operacion: rutaOcultada.id_operacion
    });

    // Respuesta final
    return res.json({
      ok: true,
      mensaje: "Ruta ocultada correctamente",
      id_ruta: rutaOcultada.id_ruta,
      id_operacion: rutaOcultada.id_operacion
    });
  } catch (err) {
    return sendDbError(res, err, "Error ocultando ruta de navegación");
  }
});


// ===============================
// PROXY OSRM — GET /route/osrm
// ===============================


// =========================================================
// GET /route/osrm
// Qué hace:
//   Funciona como proxy hacia el servidor público de OSRM.
// Entrada esperada por querystring:
//   - startLon
//   - startLat
//   - endLon
//   - endLat
//
// Flujo:
//   1. valida parámetros
//   2. arma URL de OSRM
//   3. hace fetch al servicio externo
//   4. regresa routes si OSRM encontró ruta
//
// Ventajas:
//   - evita que frontend pegue directo al upstream
//   - centraliza timeout y manejo de errores
// =========================================================
router.get("/route/osrm", requireAuth, async (req, res) => {
  // Toma coordenadas desde querystring
  const { startLon, startLat, endLon, endLat } = req.query;

  // Convierte todo a Number
  const coords = [startLon, startLat, endLon, endLat].map(Number);

  // Si alguna coordenada no es numérica, responde 400
  if (coords.some((n) => !Number.isFinite(n))) {
    return sendError(res, 400, "Parámetros inválidos. Se requieren: startLon, startLat, endLon, endLat");
  }

  // Desestructura coordenadas validadas
  const [sLon, sLat, eLon, eLat] = coords;

  // Arma URL del servicio OSRM público
  const osrmUrl =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${sLon},${sLat};${eLon},${eLat}` +
    `?overview=full&geometries=geojson&steps=false`;

  try {
    // Llama al upstream con timeout de 10 segundos
    const response = await fetch(osrmUrl, {
      headers: { "User-Agent": "TacticalDashboard/1.0" },
      signal: AbortSignal.timeout(10000)
    });

    // Si OSRM responde con error HTTP, se traduce a 502
    if (!response.ok) {
      console.error("[OSRM] upstream error:", response.status, osrmUrl);
      return sendError(res, 502, `Error del servidor de rutas OSRM: ${response.status}`);
    }

    // Parsea JSON de OSRM
    const data = await response.json();

    // Si no encontró rutas, responde 404
    if (!data.routes || data.routes.length === 0) {
      return sendError(res, 404, "OSRM no encontró una ruta entre esos puntos.");
    }

    // Respuesta exitosa con arreglo de rutas
    return res.json({ ok: true, routes: data.routes });

  } catch (err) {
    // Si fue timeout/abort, responde 504
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return sendError(res, 504, "El servidor de rutas OSRM tardó demasiado en responder.");
    }

    // Otros errores de red/upstream -> 502
    console.error("[OSRM] fetch error:", err.message);
    return sendError(res, 502, "No se pudo contactar al servidor de rutas OSRM. Intenta de nuevo.");
  }
});

// Exporta el router para montarlo en la app principal
export default router;
