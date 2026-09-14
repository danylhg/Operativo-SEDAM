// Importa Router de Express para declarar rutas agrupadas
import { Router, raw } from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Pool de PostgreSQL para ejecutar consultas
import { pool } from "../db.js";

// Middleware que exige autenticación antes de entrar a estas rutas
import { requireAuth } from "../middlewares/auth.js";

// Helper para responder errores de BD/backend de forma uniforme
import { sendDbError } from "../utils/dbErrors.js";

// Helper para validar enteros
import { isInt } from "../utils/validators.js";

// Emisión filtrada de mensajes de chat por socket
import { emitChatMessage } from "../sockets/index.js";
import { getActorFromRequest, logOperacionEvento } from "../utils/timeline.js";

// Crea la instancia del router que se exportará al final
const router = Router();
const routesDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(routesDir, "..");
const chatStorageRoot = resolve(apiRoot, "storage", "chat");
const chatAttachmentContentTypes = new Set(["application/octet-stream"]);

// ── Filtro de visibilidad para historial ─────────────────────
// opParam, rolParam, actorParam: referencias a parámetros SQL ("$1", "$2", …)
// isPersonal: si el actor viene de tabla personal (usa id_personal) o usuario (usa id_usuario)
function chatVisibilityClause(opParam, rolParam, actorParam, isPersonal) {
  const colActor = isPersonal ? 'pc.id_personal' : 'pc.id_usuario';
  const destinatarioRol = `COALESCE(NULLIF(m.destinatario_rol, ''), 'GLOBAL')`;

  const groupClauses = isPersonal ? `
      OR (m.destino_tipo = 'CELL' AND (
        (${rolParam} = 'CELL' AND m.destino_id = ${actorParam}::text)
        OR (${rolParam} = 'CET' AND EXISTS (
          SELECT 1
          FROM grupo_personal gp_cell
          JOIN grupo_operacion g_cell ON g_cell.id_grupo_operacion = gp_cell.id_grupo_operacion
          JOIN grupo_personal gp_cet ON TRUE
          JOIN grupo_operacion g_cet ON g_cet.id_grupo_operacion = gp_cet.id_grupo_operacion
          WHERE g_cell.id_operacion       = ${opParam}
            AND g_cet.id_operacion        = ${opParam}
            AND gp_cell.id_personal::text = m.destino_id
            AND gp_cet.id_personal        = ${actorParam}
            AND COALESCE(g_cell.id_grupo_padre, g_cell.id_grupo_operacion) =
                COALESCE(g_cet.id_grupo_padre,  g_cet.id_grupo_operacion)
        ))
      ))
      OR (m.destino_tipo = 'CELL_LIST' AND (
        ${rolParam} = 'CUT'
        OR ${actorParam}::text = ANY(string_to_array(replace(COALESCE(m.destino_id, ''), ' ', ''), ','))
      ))
      OR (m.destino_tipo = 'VEHICULO' AND (
        ${rolParam} = 'CUT'
        OR EXISTS (
          SELECT 1
          FROM vehiculo_operacion vo
          WHERE vo.id_operacion = ${opParam}
            AND vo.id_vehiculo::text = m.destino_id
            AND vo.id_personal = ${actorParam}
            AND COALESCE(vo.estado_asignacion::text, '') <> 'LIBERADO'
        )
      ))
      OR (m.destino_tipo IN ('FLOTILLA', 'GRUPO') AND EXISTS (
        SELECT 1
        FROM grupo_personal gper
        JOIN grupo_operacion g  ON g.id_grupo_operacion  = gper.id_grupo_operacion
        LEFT JOIN grupo_operacion gp ON gp.id_grupo_operacion = g.id_grupo_padre
        WHERE g.id_operacion = ${opParam}
          AND gper.id_personal  = ${actorParam}
          AND (g.id_grupo_operacion::text = m.destino_id
               OR gp.id_grupo_operacion::text = m.destino_id
               OR g.nombre = m.destino_id OR g.apodo = m.destino_id
               OR gp.nombre = m.destino_id OR gp.apodo = m.destino_id)
      ))` : '';

  return `
    AND (
      ${colActor} = ${actorParam}
      OR (m.destino_tipo IS NULL AND (
            ${destinatarioRol} = 'GLOBAL'
            OR ${destinatarioRol} = ${rolParam}
            OR (${destinatarioRol} = 'CELL,CET' AND ${rolParam} IN ('CELL', 'CET'))
         ))
      OR m.destino_tipo = 'GLOBAL'
      OR m.destino_tipo = 'UBICACION'
      OR (m.destino_tipo = 'CETS' AND ${rolParam} IN ('CET', 'CUT'))
      OR (m.destino_tipo = 'CET'  AND m.destino_id = ${actorParam}::text AND ${rolParam} = 'CET')
      OR (m.destino_tipo = 'CUTS' AND ${rolParam} = 'CUT')
      OR (m.destino_tipo = 'CUT'  AND (
            (m.destino_id = ${actorParam}::text AND ${rolParam} = 'CUT')
            OR (pc.id_personal = ${actorParam} AND ${rolParam} = 'CET')
         ))
      ${groupClauses}
    )`;
}

let chatDestinationColumnsReady = false;

function isChatAttachmentContentType(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const mediaType = contentType.split(";")[0].trim();
  return (
    mediaType.startsWith("image/") ||
    mediaType.startsWith("video/") ||
    mediaType.startsWith("audio/") ||
    chatAttachmentContentTypes.has(mediaType)
  );
}

function normalizeAttachmentKind(value, mimeType = "") {
  const raw = String(value || "").trim().toUpperCase();
  if (["IMAGE", "VIDEO", "AUDIO", "VOICE", "FILE"].includes(raw)) {
    return raw === "VOICE" ? "AUDIO" : raw;
  }
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  return "FILE";
}

function defaultAttachmentText(kind) {
  if (kind === "IMAGE") return "Imagen adjunta";
  if (kind === "VIDEO") return "Video adjunto";
  if (kind === "AUDIO") return "Mensaje de voz";
  return "Archivo adjunto";
}

function extensionForMime(mimeType) {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "video/mp4") return ".mp4";
  if (mimeType === "video/webm") return ".webm";
  if (mimeType === "audio/mp4") return ".m4a";
  if (mimeType === "audio/aac") return ".aac";
  if (mimeType === "audio/mpeg") return ".mp3";
  if (mimeType === "audio/webm") return ".webm";
  return "";
}

function safeFilename(value, fallbackExt = "") {
  const input = String(value || "").trim() || `adjunto${fallbackExt}`;
  const raw = (() => {
    try {
      return decodeURIComponent(input);
    } catch {
      return input;
    }
  })();
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
  const withExt = cleaned || `adjunto${fallbackExt}`;
  return extname(withExt) ? withExt : `${withExt}${fallbackExt}`;
}

function shouldHideLegacySystemMessage(row) {
  const tipo = String(row?.tipo_mensaje || "").toUpperCase();
  const contenido = String(row?.contenido || "").toLowerCase();
  return tipo === "SISTEMA" && contenido.includes("automáticamente por trigger de bd");
}

async function ensureChatDestinationColumns() {
  if (chatDestinationColumnsReady) return;

  await pool.query(`
    ALTER TABLE mensaje_chat
      ADD COLUMN IF NOT EXISTS destino_tipo TEXT,
      ADD COLUMN IF NOT EXISTS destino_id TEXT,
      ADD COLUMN IF NOT EXISTS destino_label TEXT,
      ADD COLUMN IF NOT EXISTS attachment_kind TEXT,
      ADD COLUMN IF NOT EXISTS attachment_url TEXT,
      ADD COLUMN IF NOT EXISTS attachment_mime TEXT,
      ADD COLUMN IF NOT EXISTS attachment_name TEXT,
      ADD COLUMN IF NOT EXISTS attachment_size BIGINT,
      ADD COLUMN IF NOT EXISTS attachment_duration_ms BIGINT
  `);

  chatDestinationColumnsReady = true;
}

function shouldHideChatMessage(row) {
  const tipo = String(row?.tipo_mensaje || "").toUpperCase();
  const contenido = String(row?.contenido || "").toLowerCase();
  if (tipo !== "SISTEMA") return false;
  return (
    contenido.includes("trigger de bd") ||
    contenido.includes("operacion activada autom") ||
    contenido.includes("operación activada autom")
  );
}

function isSelfCetDestination(req, destinoTipo, destinoId) {
  return req.user?.tabla === "personal" &&
    String(req.user?.rol || "").toUpperCase() === "CET" &&
    String(destinoTipo || "").trim().toUpperCase() === "CET" &&
    destinoId != null &&
    String(destinoId).trim() === String(req.user.sub);
}

function rejectInvalidChatDestination(req, res, destinoTipo, destinoId) {
  if (isSelfCetDestination(req, destinoTipo, destinoId)) {
    res.status(400).json({ ok: false, mensaje: "No puedes crear un chat CET contigo mismo" });
    return true;
  }
  return false;
}


// ===============================
// CHAT / MENSAJES
// ===============================


// =========================================================
// GET /ops/:id/chat
// Qué hace:
//   Devuelve el feed de mensajes del chat de una operación.
// Además:
//   Aplica filtro de visibilidad según el rol del usuario autenticado.
// Reglas:
//   - ADMIN ve todo
//   - otros roles solo ven:
//       * mensajes GLOBAL
//       * mensajes dirigidos a su rol
//       * mensajes dirigidos a CELL,CET si son CELL o CET
//       * mensajes donde ellos mismos son el autor/actor
// Fuente:
//   Lee desde la vista v_chat_feed.
// =========================================================
router.get("/ops/:id/chat", requireAuth, async (req, res) => {
  // Convierte id de operación desde la URL
  const id_operacion = Number(req.params.id);

  // Valida que sea entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  // Id del actor autenticado
  const id_actor = Number(req.user.sub);

  // Rol del usuario autenticado
  const user_role = req.user.rol;

  // Indica si el actor pertenece a la tabla personal
  const isPersonal = req.user.tabla === "personal";

  try {
    // Query base: todos los mensajes del feed de esta operación
    await ensureChatDestinationColumns();

    let query = `
      SELECT
        m.id_mensaje,
        m.id_chat,
        co.id_operacion,
        m.contenido,
        m.tipo_mensaje,
        m.fecha_envio,
        m.destinatario_rol,
        m.destino_tipo,
        m.destino_id,
        m.destino_label,
        m.attachment_kind,
        m.attachment_url,
        m.attachment_mime,
        m.attachment_name,
        m.attachment_size,
        m.attachment_duration_ms,
        m.estado_operacion_creacion,
        pc.tipo AS tipo_participante,
        pc.id_usuario,
        pc.id_personal,
        COALESCE(u.rol::text, p.rol::text) AS autor_rol,
        COALESCE(
          u.nombre || ' ' || u.apellido,
          p.nombre || ' ' || p.apellido,
          'Sistema'
        ) AS autor_nombre
      FROM mensaje_chat m
      JOIN chat_operacion co ON co.id_chat = m.id_chat
      JOIN participante_chat pc ON pc.id_participante = m.id_participante
      LEFT JOIN usuario u ON u.id_usuario = pc.id_usuario
      LEFT JOIN personal p ON p.id_personal = pc.id_personal
      WHERE co.id_operacion = $1
    `;
    let params = [id_operacion];

    // Si no es ADMIN, aplica filtro de visibilidad
    if (user_role !== 'ADMIN') {
      query += chatVisibilityClause('$1', '$2', '$3', isPersonal);
      params.push(user_role, id_actor);
    }

    // Ordena cronológicamente ascendente
    query += ` ORDER BY m.fecha_envio ASC, m.id_mensaje ASC`;

    // Ejecuta la consulta final
    const { rows } = await pool.query(query, params);

    // Oculta mensajes legados generados por triggers de BD.
    res.json({ ok: true, items: rows.filter((row) => !shouldHideChatMessage(row)) });
  } catch (err) {
    // Manejo uniforme de error
    sendDbError(res, err, "Error obteniendo chat");
  }
});


// =========================================================
// POST /ops/:id/chat
// Qué hace:
//   Inserta un nuevo mensaje en el chat de la operación.
// Flujo:
//   1. valida operación
//   2. valida contenido, tipo_mensaje y destinatario
//   3. verifica que exista un chat activo
//   4. obtiene o crea participante_chat para el actor actual
//   5. inserta mensaje_chat
//   6. consulta el mensaje enriquecido desde v_chat_feed
//   7. emite evento socket "chat_message" al room de la operación
// Nota:
//   Esta es la versión vieja del endpoint de chat.
// =========================================================
router.post("/ops/:id/chat", requireAuth, async (req, res) => {
  // Convierte id de operación a número
  const id_operacion = Number(req.params.id);

  // Valida entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  // Contenido del mensaje, limpio
  const contenido = (req.body?.contenido || "").toString().trim();

  // Tipo de mensaje: NORMAL, URGENTE o SISTEMA
  const tipo_mensaje = (req.body?.tipo_mensaje || "NORMAL").toString().toUpperCase();

  // Rol destinatario del mensaje; por default GLOBAL
  const destinatario_rol = (req.body?.destinatario_rol || "GLOBAL").toString().toUpperCase();
  const destino_tipo = String(req.body?.destino_tipo || "").trim().toUpperCase() || null;
  const destino_id = req.body?.destino_id != null ? String(req.body.destino_id).trim() : null;
  const destino_label = req.body?.destino_label != null ? String(req.body.destino_label).trim() : null;

  // contenido es obligatorio
  if (!contenido) {
    return res.status(400).json({ ok: false, mensaje: "Falta contenido" });
  }

  // Valida catálogo de tipo_mensaje
  if (!["NORMAL", "URGENTE", "SISTEMA"].includes(tipo_mensaje)) {
    return res.status(400).json({ ok: false, mensaje: "tipo_mensaje invalido" });
  }

  // Detecta si el actor es personal
  const esPersonal = req.user.tabla === "personal";

  // Id del actor autenticado
  const id_actor = Number(req.user.sub);

  if (rejectInvalidChatDestination(req, res, destino_tipo, destino_id)) {
    return;
  }

  // Conexión manual por transacción
  const client = await pool.connect();

  try {
    await ensureChatDestinationColumns();

    // Inicia transacción
    await client.query("BEGIN");

    // Busca chat activo de la operación
    const { rows: cr } = await client.query(
      `SELECT id_chat FROM chat_operacion WHERE id_operacion=$1 AND activo=TRUE LIMIT 1`,
      [id_operacion]
    );

    // Si no hay chat activo, responde 409
    if (!cr[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, mensaje: "El chat no esta activo o no existe" });
    }

    // Id del chat encontrado
    const id_chat = cr[0].id_chat;

    // Según el tipo de actor se usa id_personal o id_usuario
    const col = esPersonal ? "id_personal" : "id_usuario";
    const tipo = esPersonal ? "PERSONAL" : "USUARIO";

    // Intenta insertar participante_chat para este actor
    const { rows: pr } = await client.query(
      `INSERT INTO participante_chat (id_chat, tipo, ${col}) VALUES ($1,$2,$3)
       ON CONFLICT (id_chat, ${col}) DO NOTHING RETURNING id_participante`,
      [id_chat, tipo, id_actor]
    );

    // Si se insertó, toma el id nuevo
    let id_participante = pr[0]?.id_participante;

    // Si no se insertó, es porque ya existía; entonces lo consulta
    if (!id_participante) {
      const { rows: ex } = await client.query(
        `SELECT id_participante FROM participante_chat WHERE id_chat=$1 AND ${col}=$2 LIMIT 1`,
        [id_chat, id_actor]
      );
      id_participante = ex[0]?.id_participante;
    }

    // Inserta el mensaje en la tabla mensaje_chat
    const { rows: msgRows } = await client.query(
      `INSERT INTO mensaje_chat (
         id_chat, id_participante, contenido, tipo_mensaje, destinatario_rol,
         destino_tipo, destino_id, destino_label
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        id_chat,
        id_participante,
        contenido,
        tipo_mensaje,
        destinatario_rol,
        destino_tipo,
        destino_id,
        destino_label
      ]
    );

    // Confirma transacción
    await client.query("COMMIT");

    // Busca el mensaje ya enriquecido desde la vista v_chat_feed
    const { rows: feedRows } = await pool.query(
      `SELECT * FROM v_chat_feed WHERE id_mensaje = $1 LIMIT 1`,
      [msgRows[0].id_mensaje]
    );

    // Usa la versión enriquecida si existe; si no, usa la cruda
    const messageToBroadcast = feedRows[0] || msgRows[0];
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "chat_mensaje",
      entidad_tipo: "mensaje_chat",
      entidad_id: messageToBroadcast.id_mensaje,
      payload: { ...messageToBroadcast, autor_rol: req.user.rol },
      occurred_at: messageToBroadcast.fecha_envio,
      actor: getActorFromRequest(req)
    });

    // Obtiene instancia de socket.io guardada en la app
    const io = req.app.get("io");

    // Emite el evento solo a quienes deben recibirlo según destino_tipo/destino_id
    await emitChatMessage(io, id_operacion, { ...messageToBroadcast, autor_rol: req.user.rol });

    // Devuelve el mensaje enviado
    res.json({ ok: true, mensaje: { ...messageToBroadcast, autor_rol: req.user.rol } });
  } catch (err) {
    // Revierte si algo falla
    await client.query("ROLLBACK");
    sendDbError(res, err, "Error enviando mensaje");
  } finally {
    // Libera conexión
    client.release();
  }
});


// ===============================
// AVISOS OPERACIONALES
// ===============================


// =========================================================
// GET /ops/:id/avisos
// Qué hace:
//   Lista todos los avisos operacionales de una operación.
// Además:
//   Enriquecer el resultado con:
//   - apodo y rol del emisor
//   - apodo del receptor personal
//   - nombre del receptor usuario
// Orden:
//   más recientes primero.
// =========================================================
router.get("/ops/:id/avisos", requireAuth, async (req, res) => {
  // Convierte id_operacion
  const id_operacion = Number(req.params.id);

  // Valida entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  try {
    // Consulta avisos con joins para emisor y receptores
    const { rows } = await pool.query(
      `SELECT a.*,
              pe.apodo AS emisor_apodo, pe.rol AS emisor_rol,
              pr.apodo AS receptor_personal_apodo,
              u.nombre || ' ' || u.apellido AS receptor_usuario_nombre
       FROM aviso_operacion a
       JOIN personal pe ON pe.id_personal = a.id_personal_emisor
       LEFT JOIN personal pr ON pr.id_personal = a.id_personal_receptor
       LEFT JOIN usuario u ON u.id_usuario = a.id_usuario_receptor
       WHERE a.id_operacion = $1
       ORDER BY a.fecha_envio DESC`,
      [id_operacion]
    );

    // Devuelve lista de avisos
    res.json({ ok: true, items: rows });
  } catch (err) {
    // Manejo uniforme de error
    sendDbError(res, err, "Error obteniendo avisos");
  }
});


// =========================================================
// POST /ops/:id/avisos
// Qué hace:
//   Crea un nuevo aviso operacional dentro de una operación.
// Campos esperados:
//   - id_personal_emisor
//   - tipo_aviso
//   - contenido
//   - tipo_receptor (opcional)
//   - id_personal_receptor (opcional)
//   - id_usuario_receptor (opcional)
// Validaciones:
//   - id_personal_emisor obligatorio
//   - contenido obligatorio
//   - tipo_aviso dentro del catálogo permitido
// Nota:
//   Aquí no se valida si el emisor realmente pertenece a la operación.
// =========================================================
router.post("/ops/:id/avisos", requireAuth, async (req, res) => {
  // Convierte id_operacion
  const id_operacion = Number(req.params.id);

  // Valida entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  // Extrae datos del body
  const {
    id_personal_emisor,
    tipo_aviso,
    contenido,
    tipo_receptor,
    id_personal_receptor,
    id_usuario_receptor
  } = req.body ?? {};

  // Emisor obligatorio
  if (!isInt(Number(id_personal_emisor))) {
    return res.status(400).json({ ok: false, mensaje: "Falta id_personal_emisor" });
  }

  // Contenido obligatorio
  if (!contenido?.toString().trim()) {
    return res.status(400).json({ ok: false, mensaje: "Falta contenido" });
  }

  // Catálogo de tipos válidos
  const tiposValidos = ["NOVEDAD", "CONTACTO", "EMERGENCIA", "INFORMATIVO"];

  // Normaliza tipo_aviso
  const tipo = (tipo_aviso || "INFORMATIVO").toString().toUpperCase();

  // Valida catálogo
  if (!tiposValidos.includes(tipo)) {
    return res.status(400).json({ ok: false, mensaje: "tipo_aviso invalido" });
  }

  try {
    // Inserta el aviso en la tabla aviso_operacion
    const { rows } = await pool.query(
      `INSERT INTO aviso_operacion
         (id_operacion, id_personal_emisor, tipo_aviso, contenido, tipo_receptor, id_personal_receptor, id_usuario_receptor)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        id_operacion,
        Number(id_personal_emisor),
        tipo,
        contenido.toString().trim(),
        tipo_receptor || null,
        id_personal_receptor ? Number(id_personal_receptor) : null,
        id_usuario_receptor ? Number(id_usuario_receptor) : null
      ]
    );

    // Respuesta con el aviso creado
    res.json({ ok: true, aviso: rows[0] });
  } catch (err) {
    // Manejo uniforme de error
    sendDbError(res, err, "Error creando aviso");
  }
});


// =========================================================
// PATCH /ops/:id/avisos/:id_aviso
// Qué hace:
//   Actualiza el estado de un aviso operacional.
// Estados permitidos:
//   - RECIBIDO
//   - ATENDIDO
// Además:
//   guarda fecha_atencion = NOW()
// Nota:
//   No valida aquí que el aviso pertenezca a la operación del path.
// =========================================================
router.patch("/ops/:id/avisos/:id_aviso", requireAuth, async (req, res) => {
  // Convierte id_aviso
  const id_aviso = Number(req.params.id_aviso);

  // Valida entero
  if (!isInt(id_aviso)) {
    return res.status(400).json({ ok: false, mensaje: "id_aviso invalido" });
  }

  // Toma estado nuevo desde body y lo normaliza
  const estado = (req.body?.estado || "ATENDIDO").toString().toUpperCase();

  // Solo permite RECIBIDO o ATENDIDO
  if (!["RECIBIDO", "ATENDIDO"].includes(estado)) {
    return res.status(400).json({ ok: false, mensaje: "estado invalido" });
  }

  try {
    // Actualiza estado y fecha_atencion
    const { rows } = await pool.query(
      `UPDATE aviso_operacion SET estado=$1, fecha_atencion=NOW()
       WHERE id_aviso=$2 RETURNING *`,
      [estado, id_aviso]
    );

    // Si no existe el aviso, 404
    if (!rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Aviso no existe" });
    }

    // Responde con el aviso actualizado
    res.json({ ok: true, aviso: rows[0] });
  } catch (err) {
    // Manejo uniforme de error
    sendDbError(res, err, "Error actualizando aviso");
  }
});


// ===============================
// MENSAJES (patrón nuevo /chat/messages)
// ===============================


// =========================================================
// GET /ops/:id/chat/messages
// Qué hace:
//   Devuelve los mensajes del chat de una operación usando
//   un formato más directo que el endpoint viejo.
// Flujo:
//   1. busca el chat de la operación
//   2. si no existe, regresa arreglo vacío
//   3. trae mensajes con autor resuelto
// Orden:
//   por fecha_envio e id_mensaje ascendente.
// Nota:
//   Este endpoint no aplica el filtro de visibilidad por rol
//   que sí tiene GET /ops/:id/chat.
// =========================================================
router.get("/ops/:id/chat/messages", requireAuth, async (req, res) => {
  // Convierte id_operacion
  const id_operacion = Number(req.params.id);

  // Valida entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id inválido" });
  }

  try {
    await ensureChatDestinationColumns();
    // Busca el chat asociado a la operación
    const chatRes = await pool.query(
      `SELECT id_chat FROM chat_operacion WHERE id_operacion = $1 LIMIT 1`,
      [id_operacion]
    );

    // Si no hay chat, devuelve lista vacía
    if (chatRes.rowCount === 0) {
      return res.json({ ok: true, items: [] });
    }

    // Id del chat encontrado
    const id_chat = chatRes.rows[0].id_chat;

    // Info de visibilidad del usuario actual
    const gm_role      = req.user.rol;
    const gm_isPersonal = req.user.tabla === "personal";
    const gm_actor     = Number(req.user.sub);

    // Query base con filtros de contenido
    let msgQuery = `
      SELECT
        m.id_mensaje,
        m.id_chat,
        m.contenido,
        m.tipo_mensaje,
        m.fecha_envio,
        m.destinatario_rol,
        m.destino_tipo,
        m.destino_id,
        m.destino_label,
        m.attachment_kind,
        m.attachment_url,
        m.attachment_mime,
        m.attachment_name,
        m.attachment_size,
        m.attachment_duration_ms,
        m.estado_operacion_creacion,
        pc.tipo AS tipo_participante,
        pc.id_usuario,
        pc.id_personal,
        COALESCE(u.rol::text, p.rol::text) AS autor_rol,
        COALESCE(
          u.nombre || ' ' || u.apellido,
          p.nombre || ' ' || p.apellido,
          'Sistema'
        ) AS autor_nombre
      FROM mensaje_chat m
      JOIN participante_chat pc
        ON pc.id_participante = m.id_participante
      LEFT JOIN usuario u
        ON u.id_usuario = pc.id_usuario
      LEFT JOIN personal p
        ON p.id_personal = pc.id_personal
      WHERE m.id_chat = $1
    `;
    let msgParams = [id_chat];

    // Aplica visibilidad si no es ADMIN
    if (gm_role !== 'ADMIN') {
      msgParams.push(id_operacion, gm_role, gm_actor); // $2, $3, $4
      msgQuery += chatVisibilityClause('$2', '$3', '$4', gm_isPersonal);
    }

    msgQuery += ` ORDER BY m.fecha_envio ASC, m.id_mensaje ASC`;
    const { rows } = await pool.query(msgQuery, msgParams);

    // Oculta mensajes legados generados por triggers de BD.
    return res.json({ ok: true, items: rows.filter((row) => !shouldHideChatMessage(row)) });
  } catch (err) {
    return sendDbError(res, err, "Error obteniendo mensajes del chat");
  }
});


// =========================================================
// POST /ops/:id/chat/messages
// Qué hace:
//   Inserta un nuevo mensaje usando el patrón nuevo /chat/messages.
// Flujo:
//   1. valida operación
//   2. valida contenido y tipo_mensaje
//   3. busca el chat de la operación
//   4. crea/actualiza participante_chat del actor actual
//   5. inserta mensaje_chat
//   6. resuelve datos del autor
//   7. emite socket "chat_message"
// =========================================================
router.post("/ops/:id/chat/messages", requireAuth, async (req, res) => {
  // Convierte id_operacion
  const id_operacion = Number(req.params.id);

  // Valida entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id inválido" });
  }

  try {
    await ensureChatDestinationColumns();

    // Limpia contenido
    const contenido = String(req.body?.contenido || "").trim();

    // Tipo de mensaje normalizado
    const tipo_mensaje = String(req.body?.tipo_mensaje || "NORMAL").toUpperCase();

    // Destinatario del mensaje (tab activo del dashboard)
    const destinatario_rol = String(req.body?.destinatario_rol || "GLOBAL").toUpperCase();
    const destino_tipo = String(req.body?.destino_tipo || "").trim().toUpperCase() || null;
    const destino_id = req.body?.destino_id != null ? String(req.body.destino_id).trim() : null;
    const destino_label = req.body?.destino_label != null ? String(req.body.destino_label).trim() : null;

    if (rejectInvalidChatDestination(req, res, destino_tipo, destino_id)) {
      return;
    }

    // contenido obligatorio
    if (!contenido) {
      return res.status(400).json({ ok: false, mensaje: "contenido vacío" });
    }

    // Valida catálogo de tipo_mensaje
    if (!["NORMAL", "SISTEMA", "URGENTE"].includes(tipo_mensaje)) {
      return res.status(400).json({ ok: false, mensaje: "tipo_mensaje inválido" });
    }

    // Busca el chat asociado a la operación
    const chatRes = await pool.query(
      `SELECT id_chat FROM chat_operacion WHERE id_operacion = $1 LIMIT 1`,
      [id_operacion]
    );

    // Si no hay chat, responde 404
    if (chatRes.rowCount === 0) {
      return res.status(404).json({ ok: false, mensaje: "La operación no tiene chat" });
    }

    // Id del chat
    const id_chat = chatRes.rows[0].id_chat;

    // Aquí se guardará el participante del actor actual
    let id_participante = null;

    // Si el actor viene de tabla usuario
    if (req.user.tabla === "usuario") {
      // Inserta/actualiza participante_chat por id_usuario
      const partRes = await pool.query(
        `
        INSERT INTO participante_chat (id_chat, tipo, id_usuario, id_personal)
        VALUES ($1, 'USUARIO', $2, NULL)
        ON CONFLICT (id_chat, id_usuario) DO UPDATE
          SET id_usuario = EXCLUDED.id_usuario
        RETURNING id_participante
        `,
        [id_chat, Number(req.user.sub)]
      );

      id_participante = partRes.rows[0].id_participante;
    } else {
      // Si el actor viene de tabla personal
      // inserta/actualiza participante_chat por id_personal
      const partRes = await pool.query(
        `
        INSERT INTO participante_chat (id_chat, tipo, id_usuario, id_personal)
        VALUES ($1, 'PERSONAL', NULL, $2)
        ON CONFLICT (id_chat, id_personal) DO UPDATE
          SET id_personal = EXCLUDED.id_personal
        RETURNING id_participante
        `,
        [id_chat, Number(req.user.sub)]
      );

      id_participante = partRes.rows[0].id_participante;
    }

    // Inserta mensaje en mensaje_chat
    const ins = await pool.query(
      `
      INSERT INTO mensaje_chat (
        id_chat, id_participante, contenido, tipo_mensaje, destinatario_rol,
        destino_tipo, destino_id, destino_label
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id_mensaje, id_chat, contenido, tipo_mensaje, fecha_envio,
                destinatario_rol, destino_tipo, destino_id, destino_label,
                attachment_kind, attachment_url, attachment_mime, attachment_name,
                attachment_size, attachment_duration_ms,
                estado_operacion_creacion
      `,
      [
        id_chat,
        id_participante,
        contenido,
        tipo_mensaje,
        destinatario_rol,
        destino_tipo,
        destino_id,
        destino_label
      ]
    );

    // Consulta información del autor
    const autorRes = await pool.query(
      `
      SELECT
        pc.tipo AS tipo_participante,
        pc.id_usuario,
        pc.id_personal,
        COALESCE(u.rol::text, p.rol::text) AS autor_rol,
        COALESCE(
          u.nombre || ' ' || u.apellido,
          p.nombre || ' ' || p.apellido,
          'Sistema'
        ) AS autor_nombre
      FROM participante_chat pc
      LEFT JOIN usuario u ON u.id_usuario = pc.id_usuario
      LEFT JOIN personal p ON p.id_personal = pc.id_personal
      WHERE pc.id_participante = $1
      LIMIT 1
      `,
      [id_participante]
    );

    // Construye payload final mezclando mensaje + autor
    const payload = {
      ...ins.rows[0],
      ...(autorRes.rows[0] || {})
    };
    await logOperacionEvento(pool, {
      id_operacion,
      tipo_evento: "chat_mensaje",
      entidad_tipo: "mensaje_chat",
      entidad_id: payload.id_mensaje,
      payload,
      occurred_at: payload.fecha_envio,
      actor: getActorFromRequest(req)
    });

    // Emite solo a sockets con permiso según destino_tipo/destino_id
    const io = req.app.get("io");
    await emitChatMessage(io, id_operacion, payload);

    // Respuesta final
    return res.json({ ok: true, item: payload });
  } catch (err) {
    return sendDbError(res, err, "Error enviando mensaje");
  }
});

router.get("/storage/chat/:operationDir/:file", requireAuth, async (req, res) => {
  const operationDir = String(req.params.operationDir || "");
  const file = String(req.params.file || "");
  if (!/^op_\d+$/.test(operationDir) || file.includes("..") || file.includes("/") || file.includes("\\")) {
    return res.status(400).json({ ok: false, mensaje: "archivo invalido" });
  }
  const filePath = resolve(chatStorageRoot, operationDir, file);
  return res.sendFile(filePath, { dotfiles: "deny" }, (err) => {
    if (err && !res.headersSent) res.status(err.statusCode === 404 ? 404 : 500).json({ ok: false, mensaje: "archivo no encontrado" });
  });
});

router.post(
  "/ops/:id/chat/attachments",
  requireAuth,
  raw({ type: isChatAttachmentContentType, limit: "500mb" }),
  async (req, res) => {
    const id_operacion = Number(req.params.id);
    if (!isInt(id_operacion)) {
      return res.status(400).json({ ok: false, mensaje: "id invalido" });
    }

    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ ok: false, mensaje: "archivo vacio" });
    }

    const mimeType = String(req.headers["content-type"] || "application/octet-stream")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const attachmentKind = normalizeAttachmentKind(req.headers["x-attachment-kind"], mimeType);
    const originalName = safeFilename(req.headers["x-file-name"], extensionForMime(mimeType));
    const durationMsRaw = Number(req.headers["x-duration-ms"] || req.query.duration_ms);
    const durationMs = Number.isFinite(durationMsRaw) && durationMsRaw >= 0 ? Math.round(durationMsRaw) : null;

    const contenido = String(req.query.contenido || req.headers["x-attachment-caption"] || "").trim() || defaultAttachmentText(attachmentKind);
    const tipo_mensaje = String(req.query.tipo_mensaje || "NORMAL").toUpperCase();
    const destinatario_rol = String(req.query.destinatario_rol || "GLOBAL").toUpperCase();
    const destino_tipo = String(req.query.destino_tipo || "").trim().toUpperCase() || null;
    const destino_id = req.query.destino_id != null ? String(req.query.destino_id).trim() : null;
    const destino_label = req.query.destino_label != null ? String(req.query.destino_label).trim() : null;

    if (rejectInvalidChatDestination(req, res, destino_tipo, destino_id)) {
      return;
    }

    if (!["NORMAL", "SISTEMA", "URGENTE"].includes(tipo_mensaje)) {
      return res.status(400).json({ ok: false, mensaje: "tipo_mensaje invalido" });
    }

    const client = await pool.connect();

    try {
      await ensureChatDestinationColumns();

      const dir = resolve(chatStorageRoot, `op_${id_operacion}`);
      await mkdir(dir, { recursive: true });

      const storedName = `${Date.now()}_${randomUUID()}_${originalName}`;
      const storagePath = resolve(dir, storedName);
      await writeFile(storagePath, buffer);
      const attachmentUrl = `/storage/chat/op_${id_operacion}/${storedName}`;

      await client.query("BEGIN");

      const chatRes = await client.query(
        `SELECT id_chat FROM chat_operacion WHERE id_operacion = $1 LIMIT 1`,
        [id_operacion]
      );

      if (chatRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, mensaje: "La operacion no tiene chat" });
      }

      const id_chat = chatRes.rows[0].id_chat;
      let id_participante = null;

      if (req.user.tabla === "usuario") {
        const partRes = await client.query(
          `
          INSERT INTO participante_chat (id_chat, tipo, id_usuario, id_personal)
          VALUES ($1, 'USUARIO', $2, NULL)
          ON CONFLICT (id_chat, id_usuario) DO UPDATE
            SET id_usuario = EXCLUDED.id_usuario
          RETURNING id_participante
          `,
          [id_chat, Number(req.user.sub)]
        );
        id_participante = partRes.rows[0].id_participante;
      } else {
        const partRes = await client.query(
          `
          INSERT INTO participante_chat (id_chat, tipo, id_usuario, id_personal)
          VALUES ($1, 'PERSONAL', NULL, $2)
          ON CONFLICT (id_chat, id_personal) DO UPDATE
            SET id_personal = EXCLUDED.id_personal
          RETURNING id_participante
          `,
          [id_chat, Number(req.user.sub)]
        );
        id_participante = partRes.rows[0].id_participante;
      }

      const ins = await client.query(
        `
        INSERT INTO mensaje_chat (
          id_chat, id_participante, contenido, tipo_mensaje, destinatario_rol,
          destino_tipo, destino_id, destino_label,
          attachment_kind, attachment_url, attachment_mime, attachment_name,
          attachment_size, attachment_duration_ms
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING id_mensaje, id_chat, contenido, tipo_mensaje, fecha_envio,
                  destinatario_rol, destino_tipo, destino_id, destino_label,
                  attachment_kind, attachment_url, attachment_mime, attachment_name,
                  attachment_size, attachment_duration_ms,
                  estado_operacion_creacion
        `,
        [
          id_chat,
          id_participante,
          contenido,
          tipo_mensaje,
          destinatario_rol,
          destino_tipo,
          destino_id,
          destino_label,
          attachmentKind,
          attachmentUrl,
          mimeType,
          originalName,
          buffer.length,
          durationMs
        ]
      );

      const autorRes = await client.query(
        `
        SELECT
          pc.tipo AS tipo_participante,
          pc.id_usuario,
          pc.id_personal,
          COALESCE(u.rol::text, p.rol::text) AS autor_rol,
          COALESCE(
            u.nombre || ' ' || u.apellido,
            p.nombre || ' ' || p.apellido,
            'Sistema'
          ) AS autor_nombre
        FROM participante_chat pc
        LEFT JOIN usuario u ON u.id_usuario = pc.id_usuario
        LEFT JOIN personal p ON p.id_personal = pc.id_personal
        WHERE pc.id_participante = $1
        LIMIT 1
        `,
        [id_participante]
      );

      const payload = {
        ...ins.rows[0],
        ...(autorRes.rows[0] || {})
      };

      await client.query("COMMIT");

      await logOperacionEvento(pool, {
        id_operacion,
        tipo_evento: "chat_adjunto",
        entidad_tipo: "mensaje_chat",
        entidad_id: payload.id_mensaje,
        payload,
        occurred_at: payload.fecha_envio,
        actor: getActorFromRequest(req)
      });

      const io = req.app.get("io");
      await emitChatMessage(io, id_operacion, payload);

      return res.status(201).json({ ok: true, item: payload });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      return sendDbError(res, err, "Error enviando adjunto");
    } finally {
      client.release();
    }
  }
);

// Exporta el router para montarlo en app/server
export default router;
