// js/dashboard/dashboard.storage.js

// ============================================================
// BACKEND: Estas constantes de localStorage desaparecen.
// La operación viene de GET /ops/:id/mapa, el chat de GET /ops/:id/chat/messages,
// y la asignación ya está en la BD (no se lee de localStorage en dashboard).
// ============================================================
const OPERACION_ACTUAL_KEY = "operacion_actual";
const ASIGNACION_ACTUAL_KEY = "asignacion_actual";

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

// ============================================================
// BACKEND: getJsonStorage / setJsonStorage se eliminan.
// Toda la data de operación viene de GET /ops/:id/mapa que
// devuelve operacion, personal, vehiculos, equipos y rutas
// en una sola llamada. No se persiste nada en localStorage
// excepto el token de sesión.
// ============================================================
export function getJsonStorage(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function setJsonStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getOperationDateTime(op) {
  if (!op) return null;

  const directDateTime = op.fechaHora || op.datetime || op.fecha_hora || op.startAt;
  if (directDateTime) {
    const dt = new Date(directDateTime);
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  const dateValue =
    op.fecha ||
    op.date ||
    op.operationDate ||
    op.fechaOperacion ||
    op.fecha_operacion ||
    op.fecha_inicio;

  const timeValue =
    op.hora ||
    op.time ||
    op.operationTime ||
    op.horaOperacion ||
    op.hora_operacion ||
    op.hora_inicio;

  if (dateValue && timeValue) {
    const datePart = String(dateValue).includes("T")
      ? String(dateValue).split("T")[0]
      : String(dateValue).slice(0, 10);
    const timePart = String(timeValue).slice(0, 5);
    const dt = new Date(`${datePart}T${timePart}:00-06:00`);
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  return null;
}

// ============================================================
// BACKEND: ensureOperationPhase() calcula la fase en cliente.
// Con backend: el campo `estado` de GET /ops/:id ya viene
// calculado como 'ACTIVA' | 'PLANIFICADA' | 'TERMINADA' |
// 'CANCELADA'. Esta función desaparece — se usa op.estado
// directamente (normalizado a minúsculas para los estilos).
// ============================================================
export function ensureOperationPhase(op) {
  const current = { ...(op || {}) };

  // El backend devuelve `estado` en mayúsculas (ACTIVA, PLANIFICADA, TERMINADA, CANCELADA).
  // Si existe, usarlo como fuente de verdad en lugar de recalcular desde fecha_inicio.
  if (current.estado) {
    current.phase = current.estado.toLowerCase();
    return current;
  }

  if (current.phase) return current;

  const scheduled = getOperationDateTime(current);
  if (!scheduled) {
    current.phase = current.phase || "planificada";
    current.estado = current.estado || "PLANIFICADA";
    return current;
  }

  if (new Date() >= scheduled) {
    current.phase = "activa";
    current.estado = "ACTIVA";
  } else {
    current.phase = "planificada";
    current.estado = "PLANIFICADA";
  }

  return current;
}

// ============================================================
// BACKEND: getCurrentOperation() lee de localStorage hoy.
// Se reemplaza por: GET /ops/:id/mapa
// → { operacion, zona_operacion, personal, vehiculos,
//     equipos, rutas_navegacion, capas }
// El id_operacion viene de localStorage("active_operation_id").
// ============================================================
export function getCurrentOperation() {
  const op = getJsonStorage(OPERACION_ACTUAL_KEY, {}) || {};
  return ensureOperationPhase(op);
}

// ============================================================
// BACKEND: saveCurrentOperation() escribe en localStorage hoy.
// Con backend: PUT /ops/:id  (solo si estado === 'PLANIFICADA')
// La fase (activa/planificada) la calcula el servidor
// automáticamente comparando fecha_inicio con NOW().
// La sincronización con la lista "operations" desaparece
// porque el menú consulta GET /ops directamente.
// ============================================================
export function saveCurrentOperation(op) {
  const finalOp = ensureOperationPhase(op || {});
  setJsonStorage(OPERACION_ACTUAL_KEY, finalOp);

  // Sincronizar con la lista de operaciones (operations)
  try {
    const opsList = JSON.parse(localStorage.getItem("operations") || "[]");
    const idx = opsList.findIndex(x => x.id === finalOp.id);
    if (idx !== -1) {
      opsList[idx].phase = finalOp.phase || "planificada";
      opsList[idx].fecha_inicio = finalOp.fecha_inicio || opsList[idx].fecha_inicio;
      opsList[idx].hora_inicio = finalOp.hora_inicio || opsList[idx].hora_inicio;
      opsList[idx].name = finalOp.title || finalOp.titulo || opsList[idx].name;
    } else if (finalOp.id && (finalOp.title || finalOp.titulo)) {
      // Agregar entrada nueva si no existe
      opsList.push({
        id: finalOp.id,
        name: finalOp.title || finalOp.titulo,
        phase: finalOp.phase || "planificada",
        fecha_inicio: finalOp.fecha_inicio || "",
        hora_inicio: finalOp.hora_inicio || "",
        created_at: finalOp.created_at || new Date().toISOString()
      });
    }
    localStorage.setItem("operations", JSON.stringify(opsList));
  } catch { }

  // Sincronizar asignacion_actual al slot por ID
  if (finalOp.id) {
    try {
      const asig = localStorage.getItem(ASIGNACION_ACTUAL_KEY);
      if (asig) localStorage.setItem(`asignacion_op_${finalOp.id}`, asig);
    } catch { }
  }
}

export function getOperationPhase() {
  const op = getCurrentOperation();
  return op.phase || "planificada";
}

export function isOperationActive() {
  return getOperationPhase() === "activa";
}

export function getPhaseLabel(phase) {
  if (phase === "activa") return "Activa";
  if (phase === "terminada") return "Terminada";
  return "Planificada";
}

// ============================================================
// BACKEND: getChatMessages() y saveChatMessages() leen/escriben
// en localStorage hoy. Con backend se reemplazan por:
//   GET  /ops/:id/chat/messages
//   → { ok, items: [{ id_mensaje, contenido, autor_nombre,
//                     tipo_mensaje, fecha_envio }] }
//   POST /ops/:id/chat/messages
//   → body: { contenido, tipo_mensaje }
// Los mensajes nuevos llegan en tiempo real por Socket.IO:
//   socket.on("chat_message", msg => renderChatMessages())
// ============================================================
export function getChatKey() {
  const op = getCurrentOperation();
  const opId = op?.id || "default";
  return `tactical_chat_${opId}`;
}

// BACKEND: getChatMessages() / saveChatMessages() leen/escriben en localStorage.
// Con backend se reemplazan por:
//   GET /ops/:id/chat/messages → cargar historial al init
//   POST /ops/:id/chat/messages { texto, tipo_mensaje } → enviar mensaje
//   socket.on("chat_message", msg => renderChatMessages()) → recibir en tiempo real
export function getChatMessages() {
  return getJsonStorage(getChatKey(), []);
}

export function saveChatMessages(messages) {
  setJsonStorage(getChatKey(), messages);
}

export {
  OPERACION_ACTUAL_KEY,
  ASIGNACION_ACTUAL_KEY
};
