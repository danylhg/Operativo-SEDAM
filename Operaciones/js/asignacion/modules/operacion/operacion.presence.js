const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
const PRESENCE_INTERVAL_MS = 10000;

let presenceTimer = null;
let lastOperationId = null;
let listenersBound = false;

function readOperacionActualId() {
  try {
    const stored = JSON.parse(localStorage.getItem("operacion_actual") || "{}");
    return stored.id_operacion || stored.id || null;
  } catch {
    return null;
  }
}

function getCurrentOperationId() {
  return localStorage.getItem("active_operation_id") || readOperacionActualId();
}

function buildPresenceRequestOptions(method, { keepalive = false } = {}) {
  const token = localStorage.getItem("token");
  if (!token) return null;

  return {
    method,
    keepalive,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: method === "POST" ? "{}" : undefined
  };
}

export async function touchAsignacionPresence(opId = getCurrentOperationId(), options = {}) {
  if (!opId) return false;

  const requestOptions = buildPresenceRequestOptions("POST", options);
  if (!requestOptions) return false;

  try {
    await fetch(`${API_BASE}/ops/${opId}/asignacion-presence`, requestOptions);
    lastOperationId = opId;
    return true;
  } catch {
    return false;
  }
}

export async function releaseAsignacionPresence(opId = getCurrentOperationId(), options = {}) {
  const id = opId || lastOperationId;
  if (!id) return false;

  const requestOptions = buildPresenceRequestOptions("DELETE", options);
  if (!requestOptions) return false;

  try {
    await fetch(`${API_BASE}/ops/${id}/asignacion-presence`, requestOptions);
    if (String(lastOperationId) === String(id)) lastOperationId = null;
    return true;
  } catch {
    return false;
  }
}

function tickPresence() {
  const opId = getCurrentOperationId();
  if (opId) void touchAsignacionPresence(opId);
}

function handleBeforeUnload() {
  const opId = getCurrentOperationId() || lastOperationId;
  if (opId) void releaseAsignacionPresence(opId, { keepalive: true });
}

function bindLifecycleListeners() {
  if (listenersBound) return;
  listenersBound = true;

  window.addEventListener("beforeunload", handleBeforeUnload);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tickPresence();
  });
}

export function startAsignacionPresenceHeartbeat() {
  bindLifecycleListeners();
  if (presenceTimer) return;

  tickPresence();
  presenceTimer = window.setInterval(tickPresence, PRESENCE_INTERVAL_MS);
}

export async function stopAsignacionPresenceHeartbeat({ release = true } = {}) {
  if (presenceTimer) {
    window.clearInterval(presenceTimer);
    presenceTimer = null;
  }

  if (release) {
    await releaseAsignacionPresence();
  }
}
