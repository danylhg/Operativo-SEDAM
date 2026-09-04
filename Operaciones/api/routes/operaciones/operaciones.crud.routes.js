// Importa Router de Express para declarar endpoints modulares
import { Router } from "express";

// Pool de PostgreSQL para ejecutar consultas
import { pool } from "../../db.js";

// Middleware que obliga a que el usuario esté autenticado
import { requireAuth } from "../../middlewares/auth.js";

// Helper para responder errores de BD / backend de forma consistente
import { sendDbError } from "../../utils/dbErrors.js";

// Helper para validar si un valor es entero válido
import { isInt } from "../../utils/validators.js";
import { deleteOperationStreamFiles, deleteRecordingFiles } from "../../utils/streamRecordings.js";

// Crea una instancia de router para exportar este módulo
const router = Router();

const ESTADOS_ELIMINABLES = new Set(["CERRADA", "CANCELADA", "PLANIFICADA"]);
const TRIGGER_MENSAJE_CHAT_MODIFICABLE = "tr_mensaje_chat_operacion_modificable";

function normalizeHoraInicio(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}


// =========================================================
// GET /ops
// Qué hace:
//   Lista todas las operaciones registradas en la tabla operacion.
// Qué devuelve:
//   Campos básicos de cada operación:
//   - id_operacion
//   - codigo
//   - nombre
//   - descripcion
//   - prioridad
//   - estado
//   - fechas
//   - creada_por
// Orden:
//   Las más recientes primero según id_operacion DESC.
// Uso típico:
//   menú inicial / listado de operaciones.
// =========================================================
router.get("/ops", requireAuth, async (req, res) => {
  try {
    const idPersonal = req.user?.tabla === "personal" ? Number(req.user.sub) : null;
    // Consulta todas las operaciones con sus datos principales
    const { rows } = await pool.query(
      `SELECT o.id_operacion, o.codigo, o.nombre, o.descripcion, o.prioridad, o.estado,
              o.fecha_inicio, o.hora_inicio, o.fecha_fin, o.fecha_creacion, o.creada_por,
              CASE
                WHEN $1::INTEGER IS NULL THEN FALSE
                ELSE EXISTS (
                  SELECT 1
                  FROM asignacion_operacion_personal a
                  WHERE a.id_operacion = o.id_operacion
                    AND a.id_personal = $1
                    AND a.estado_asignacion <> 'LIBERADO'
                )
              END AS asignada_al_usuario
       FROM operacion o
       ORDER BY o.id_operacion DESC`,
      [Number.isInteger(idPersonal) ? idPersonal : null]
    );

    // Respuesta con arreglo de operaciones
    res.json({ ok: true, items: rows });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(409).json({
        ok: false,
        mensaje: "Ya existe una operación con ese nombre."
      });
    }
    if (err?.code === "23505") {
      return res.status(409).json({
        ok: false,
        mensaje: "Ya existe una operación con ese nombre."
      });
    }
    // Manejo uniforme de error
    sendDbError(res, err, "Error listando ops");
  }
});


// =========================================================
// GET /ops/by-codigo/:codigo
// Qué hace:
//   Busca una operación específica por su código único.
// Qué devuelve:
//   Una sola operación si existe.
// Si no existe:
//   Responde 404.
// Uso típico:
//   búsquedas por código tipo OP-XXXX.
// =========================================================
router.get("/ops/by-codigo/:codigo", requireAuth, async (req, res) => {
  // Toma el código desde la URL
  const codigo = req.params.codigo;

  try {
    // Busca una operación exacta por código
    const { rows } = await pool.query(
      `SELECT id_operacion, codigo, nombre, descripcion, prioridad, estado,
              fecha_inicio, hora_inicio, fecha_fin, fecha_creacion, creada_por
       FROM operacion
       WHERE codigo = $1
       LIMIT 1`,
      [codigo]
    );

    // Si no encontró ninguna, responde 404
    if (!rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Operación no existe" });
    }

    // Devuelve directamente el objeto de la operación
    res.json(rows[0]);
  } catch (err) {
    // Manejo uniforme de error
    sendDbError(res, err, "Error por código");
  }
});


// =========================================================
// GET /ops/:id
// Qué hace:
//   Busca una operación específica por id_operacion.
// Qué devuelve:
//   Una sola operación si existe.
// Validaciones:
//   - el id debe ser entero
//   - si no existe, responde 404
// Uso típico:
//   cargar detalle básico de una operación.
// =========================================================
router.get("/ops/:id", requireAuth, async (req, res) => {
  // Convierte :id a número
  const id = Number(req.params.id);

  // Valida que sea entero
  if (!isInt(id)) {
    return res.status(400).json({ ok: false, mensaje: "id inválido" });
  }

  try {
    // Busca la operación por id primario
    const { rows } = await pool.query(
      `SELECT id_operacion, codigo, nombre, descripcion, prioridad, estado,
              fecha_inicio, hora_inicio, fecha_fin, fecha_creacion, creada_por
       FROM operacion
       WHERE id_operacion = $1
       LIMIT 1`,
      [id]
    );

    // Si no existe, responde 404
    if (!rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Operación no existe" });
    }

    // Devuelve directamente la operación encontrada
    res.json(rows[0]);
  } catch (err) {
    // Manejo uniforme de error
    sendDbError(res, err, "Error obteniendo operación");
  }
});


// =========================================================
// POST /ops
// Qué hace:
//   Crea una nueva operación en la tabla operacion.
// Campos esperados en body:
//   - nombre (obligatorio)
//   - descripcion (opcional)
//   - prioridad (opcional; default MEDIA)
//   - fecha_inicio (opcional)
// Lógica extra:
//   - genera automáticamente un código tipo OP-{timestamp}
//   - toma creada_por desde el usuario autenticado
//   - fecha_fin se guarda inicialmente como null
// Validaciones:
//   - nombre obligatorio
//   - prioridad debe ser BAJA/MEDIA/ALTA
//   - fecha_inicio debe ser válida si viene
// =========================================================
router.post("/ops", requireAuth, async (req, res) => {
  try {
    // Extrae datos desde el body
    const { nombre, descripcion, prioridad, fecha_inicio, hora_inicio } = req.body ?? {};

    // nombre es obligatorio
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ ok: false, mensaje: "Falta nombre" });
    }

    // Normaliza prioridad a mayúsculas y pone MEDIA por default
    const prio = (prioridad || "MEDIA").toString().toUpperCase();

    // Valida catálogo permitido de prioridad
    if (!["BAJA", "MEDIA", "ALTA"].includes(prio)) {
      return res.status(400).json({
        ok: false,
        mensaje: "prioridad inválida (BAJA|MEDIA|ALTA)"
      });
    }

    // Intenta convertir fecha_inicio a Date si viene
    const fi = fecha_inicio ? new Date(fecha_inicio) : null;

    // Si vino una fecha inválida, corta
    if (fi && Number.isNaN(fi.getTime())) {
      return res.status(400).json({ ok: false, mensaje: "fecha_inicio inválida" });
    }

    // Genera un código único simple con timestamp actual
    const codigo = `OP-${Date.now()}`;

    // El usuario autenticado será el creador
    const idAutenticado = Number(req.user.sub);
    const esPersonal = req.user?.tabla === "personal";
    const id_cut = null;

    let creada_por = idAutenticado;
    if (esPersonal) {
      const { rows: adminRows } = await pool.query(
        `SELECT id_usuario
         FROM usuario
         WHERE rol = 'ADMIN' AND activo = TRUE
         ORDER BY id_usuario ASC
         LIMIT 1`
      );
      if (!adminRows[0]) {
        return res.status(409).json({
          ok: false,
          mensaje: "No hay un administrador activo para registrar la operacion."
        });
      }
      creada_por = adminRows[0].id_usuario;
    }

    // Inserta la operación nueva
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO operacion (codigo, nombre, descripcion, prioridad, fecha_inicio, hora_inicio, fecha_fin, creada_por, id_cut)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id_operacion, codigo, nombre, descripcion, prioridad, estado, fecha_inicio, hora_inicio, fecha_fin, fecha_creacion`,
      [
        codigo,                                // código generado automáticamente
        nombre.trim(),                         // nombre limpio
        (descripcion || "").trim() || null,    // descripción opcional
        prio,                                  // prioridad validada
        fi ? fi.toISOString() : null,
        normalizeHoraInicio(hora_inicio),
        null,
        creada_por,
        id_cut
      ]
    );

    // Devuelve la operación recién creada
    await client.query("COMMIT");
    res.json(rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    // Manejo uniforme de error
    sendDbError(res, err, "Error creando operación");
  }
});


// =========================================================
// PUT /ops/:id
// Qué hace:
//   Actualiza una operación existente.
// Restricción importante:
//   Solo permite editar operaciones en estado PLANIFICADA.
// Campos editables:
//   - nombre
//   - descripcion
//   - prioridad
//   - fecha_inicio
// No cambia:
//   - código
//   - fecha_fin
//   - creada_por
//   - estado (aquí no se toca)
// Validaciones:
//   - id válido
//   - operación existente
//   - estado PLANIFICADA
//   - nombre obligatorio
//   - prioridad válida
//   - fecha_inicio válida
// =========================================================
router.put("/ops/:id", requireAuth, async (req, res) => {
  // Convierte id de la URL a número
  const id_operacion = Number(req.params.id);

  // Valida que sea entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id inválido" });
  }

  try {
    // Extrae los datos editables desde el body
    const { nombre, descripcion, prioridad, fecha_inicio, hora_inicio } = req.body ?? {};

    // Primero revisa si la operación existe y cuál es su estado
    const { rows: currentRows } = await pool.query(
      "SELECT id_operacion, estado, fecha_fin FROM operacion WHERE id_operacion = $1",
      [id_operacion]
    );

    // Si no existe, responde 404
    if (currentRows.length === 0) {
      return res.status(404).json({ ok: false, mensaje: "La operación no existe" });
    }

    // Solo deja editar operaciones planificadas
    if (currentRows[0].estado !== "PLANIFICADA") {
      return res.status(400).json({
        ok: false,
        mensaje: "Solo se pueden editar operaciones en estado PLANIFICADA"
      });
    }

    // nombre sigue siendo obligatorio
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ ok: false, mensaje: "Falta nombre" });
    }

    // Normaliza prioridad y pone MEDIA por default si no vino
    const prio = (prioridad || "MEDIA").toString().toUpperCase();

    // Valida catálogo permitido
    if (!["BAJA", "MEDIA", "ALTA"].includes(prio)) {
      return res.status(400).json({
        ok: false,
        mensaje: "prioridad inválida (BAJA|MEDIA|ALTA)"
      });
    }

    // Convierte fecha_inicio si viene
    const fi = fecha_inicio ? new Date(fecha_inicio) : null;

    // Si la fecha es inválida, corta
    if (fi && Number.isNaN(fi.getTime())) {
      return res.status(400).json({ ok: false, mensaje: "fecha_inicio inválida" });
    }

    // Si la nueva fecha_inicio supera la fecha_fin almacenada, limpia fecha_fin para
    // evitar violar CHECK (fecha_fin >= fecha_inicio). El usuario deberá reasignarla.
    const currentFechaFin = currentRows[0].fecha_fin ? new Date(currentRows[0].fecha_fin) : null;
    const newFechaFin = (fi && currentFechaFin && fi > currentFechaFin) ? null : currentFechaFin;

    // Actualiza solo los campos permitidos
    const { rows } = await pool.query(
      `UPDATE operacion
       SET nombre = $1, descripcion = $2, prioridad = $3, fecha_inicio = $4, hora_inicio = $5, fecha_fin = $6
       WHERE id_operacion = $7
       RETURNING id_operacion, codigo, nombre, descripcion, prioridad, fecha_inicio, hora_inicio, fecha_fin, fecha_creacion, estado`,
      [
        nombre.trim(),                              // nuevo nombre
        (descripcion || "").trim() || null,         // nueva descripción o null
        prio,                                       // prioridad validada
        fi ? fi.toISOString() : null,               // nueva fecha_inicio
        normalizeHoraInicio(hora_inicio),
        newFechaFin ? newFechaFin.toISOString() : null, // fecha_fin ajustada
        id_operacion                                // id a modificar
      ]
    );

    // Devuelve la operación actualizada
    res.json(rows[0]);
  } catch (err) {
    // Manejo uniforme de error
    sendDbError(res, err, "Error actualizando operación");
  }
});

// DELETE /ops/:id/remove
// Elimina permanentemente una operacion y sus datos relacionados por cascada.
router.delete("/ops/:id/remove", requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  if (!isInt(id)) {
    return res.status(400).json({ ok: false, mensaje: "id inválido" });
  }

  const client = await pool.connect();
  let recordingStoragePaths = [];

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id_operacion, estado
       FROM operacion
       WHERE id_operacion = $1
       FOR UPDATE`,
      [id]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, mensaje: "La operación no existe" });
    }

    if (!ESTADOS_ELIMINABLES.has(rows[0].estado)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        ok: false,
        mensaje: "Solo se pueden eliminar operaciones planificadas, cerradas o canceladas."
      });
    }

    const { rows: recordingTableRows } = await client.query(
      "SELECT to_regclass('public.media_stream_recording') AS table_name"
    );
    if (recordingTableRows[0]?.table_name) {
      const { rows: recordingRows } = await client.query(
        `SELECT storage_path
         FROM media_stream_recording
         WHERE id_operacion = $1`,
        [id]
      );
      recordingStoragePaths = recordingRows.map((row) => row.storage_path).filter(Boolean);
    }

    // El cascade de operacion puede borrar chat_operacion antes de mensaje_chat.
    // Ese trigger resuelve la operacion por chat_operacion, asi que se desactiva
    // solo durante este borrado definitivo y se vuelve a activar antes del COMMIT.
    await client.query(
      `ALTER TABLE mensaje_chat DISABLE TRIGGER ${TRIGGER_MENSAJE_CHAT_MODIFICABLE}`
    );
    try {
      await client.query(
        `ALTER TABLE participante_chat DISABLE TRIGGER tr_participante_chat_operacion_modificable`
      );
    } catch (e) {
      console.warn("No se pudo desactivar el trigger de participante_chat:", e.message);
    }

    await client.query(
      "DELETE FROM operacion WHERE id_operacion = $1",
      [id]
    );

    await client.query(
      `ALTER TABLE mensaje_chat ENABLE TRIGGER ${TRIGGER_MENSAJE_CHAT_MODIFICABLE}`
    );
    try {
      await client.query(
        `ALTER TABLE participante_chat ENABLE TRIGGER tr_participante_chat_operacion_modificable`
      );
    } catch (e) {
      console.warn("No se pudo activar el trigger de participante_chat:", e.message);
    }

    await client.query("COMMIT");

    let storageCleanup = null;
    try {
      const recordingCleanup = await deleteRecordingFiles(recordingStoragePaths);
      const operationCleanup = await deleteOperationStreamFiles(id);
      storageCleanup = {
        recordings: recordingCleanup,
        operation_dir: operationCleanup.path
      };
      if (recordingCleanup.errors.length > 0) {
        console.warn("[STREAMING] Errores limpiando archivos de grabacion:", recordingCleanup.errors);
      }
    } catch (cleanupErr) {
      storageCleanup = { error: cleanupErr.message };
      console.warn("[STREAMING] No se pudo limpiar storage de grabaciones:", cleanupErr);
    }

    res.json({
      ok: true,
      mensaje: "Operación eliminada correctamente",
      storage_cleanup: storageCleanup
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("[DB ERROR] rollback eliminando operacion:", rollbackErr);
    }
    sendDbError(res, err, "Error eliminando operación");
  } finally {
    client.release();
  }
});

// Exporta el router para usarlo en el archivo principal de rutas
export default router;
