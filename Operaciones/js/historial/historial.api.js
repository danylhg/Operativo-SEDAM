const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;

export async function loadReplay(operationId) {
  return apiFetch(`/ops/${encodeURIComponent(operationId)}/replay`);
}

export async function loadCesiumToken() {
  const payload = await apiFetch("/config/cesium-token");
  const token = payload?.token || "";

  if (token) {
    Cesium.Ion.defaultAccessToken = token;
    localStorage.setItem("CESIUM_TOKEN", token);
    return true;
  }

  localStorage.removeItem("CESIUM_TOKEN");
  return false;
}

export async function loadStreamRecordings(operationId) {
  return apiFetch(`/ops/${encodeURIComponent(operationId)}/streams/recordings`);
}

export async function downloadRecording(recording) {
  const response = await fetch(`${API_BASE}${recording.download_url}`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.mensaje || payload?.error || `Error HTTP ${response.status}`);
  }

  const blob = await response.blob();
  return {
    blob,
    filename: getFilename(response) || recording.original_filename || `recording_${recording.id_recording}.webm`,
  };
}

async function apiFetch(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: authHeaders(),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.mensaje || payload?.error || `Error HTTP ${response.status}`);
  }

  return payload;
}

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getFilename(response) {
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] || "";
}
