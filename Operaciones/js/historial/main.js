import { loadCesiumToken, loadReplay, loadStreamRecordings, downloadRecording } from "./historial.api.js";
import { readHistoryDom, dom } from "./historial.dom.js";
import { initHistoryMap, buildMapEntities, setHistoryLayerVisibility, getLayerCounts, flyToLocation } from "./historial.map.js";
import { LAYERS } from "./historial.meta.js";
import { replayState } from "./historial.state.js";
import { initTimeline, setReplayData, seekTo } from "./historial.timeline.js";
import {
  renderChatMessages,
  renderError,
  renderEventLog,
  renderOperationInfo,
  renderTopbar,
} from "./historial.ui.js";

readHistoryDom();
renderLayerLegend();
bindShell();
initTimeline();
main();

async function main() {
  const operationId = getOperationId();
  if (!operationId) {
    renderError("No se encontró el id de operación. Abre historial.html?id=3 o selecciona una operación cerrada.");
    return;
  }

  try {
    await loadCesiumToken();
  } catch (error) {
    console.warn("No se pudo cargar token Cesium para historial", error);
  }

  try {
    const replay = await loadReplay(operationId);

    await attachRecordings(operationId, replay);
    initHistoryMap(replay?.zona_operacion || replay?.snapshots?.zonas?.[0] || null);
    setReplayData(replay);
    renderTopbar(replay);
    renderOperationInfo(replay);
    renderChatMessages(replayState.events);
    renderEventLog(replayState.events);
    buildMapEntities(replay);
    renderLayerCounts();
    attachRecordingDownloads();
  } catch (error) {
    console.error("Error cargando historial", error);
    renderError(error.message || "No se pudo cargar el historial de la operación.");
  }
}

// Leyenda de capas: interruptor + color + cantidad de elementos de cada tipo.
function renderLayerLegend() {
  if (!dom.layerList) return;

  dom.layerList.innerHTML = LAYERS.map(layer => `
    <label class="hLayer empty" data-layer="${layer.key}" style="--c:${layer.color}">
      <input type="checkbox" data-history-layer="${layer.key}" checked>
      <span class="hLayerSwitch" aria-hidden="true"></span>
      <span class="hLayerName">${layer.label}</span>
      <span class="hLayerCount">0</span>
    </label>
  `).join("");
}

function renderLayerCounts() {
  const counts = getLayerCounts();
  for (const layer of LAYERS) {
    const row = dom.layerList?.querySelector(`[data-layer="${layer.key}"]`);
    if (!row) continue;
    const count = counts[layer.key] || 0;
    row.classList.toggle("empty", count === 0);
    row.querySelector(".hLayerCount").textContent = String(count);
  }
}

function bindShell() {
  dom.backBtn?.addEventListener("click", () => {
    window.location.href = "menu_inicial.html";
  });

  document.querySelectorAll(".hTab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".hTab").forEach(btn => btn.classList.remove("active"));
      document.querySelectorAll(".hPane").forEach(content => content.classList.add("hidden"));
      button.classList.add("active");
      document.getElementById(`${button.dataset.tab}Tab`)?.classList.remove("hidden");
    });
  });

  dom.layerList?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-history-layer]");
    if (input) setHistoryLayerVisibility(input.dataset.historyLayer, input.checked);
  });

  dom.layersToggle?.addEventListener("click", () => {
    const collapsed = dom.layers.classList.toggle("collapsed");
    dom.layersToggle.setAttribute("aria-expanded", String(!collapsed));
  });

  // Actividad: saltar al instante del evento y centrar el mapa en su ubicación.
  dom.eventLog?.addEventListener("click", (event) => {
    const item = event.target.closest(".hEvent");
    if (!item) return;
    seekTo(Number(item.dataset.ms));
    if (item.dataset.lat) flyToLocation(Number(item.dataset.lat), Number(item.dataset.lng));
  });
}

function getOperationId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id") || params.get("op") || localStorage.getItem("active_operation_id");
}

async function attachRecordings(operationId, replay) {
  try {
    const payload = await loadStreamRecordings(operationId);
    replay.recordings = payload?.items || [];
    replay.recordingsError = "";
  } catch (error) {
    replay.recordings = [];
    replay.recordingsError = error.message || "No se pudieron cargar";
  }
}

function attachRecordingDownloads() {
  document.querySelectorAll(".historyRecordingDownload").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.recordingId);
      const recording = (replayState.replay?.recordings || []).find(item => Number(item.id_recording) === id);
      if (!recording) return;

      button.disabled = true;
      try {
        const { blob, filename } = await downloadRecording(recording);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch (error) {
        console.error("No se pudo descargar grabacion", error);
        alert(error.message || "No se pudo descargar la grabación.");
      } finally {
        button.disabled = false;
      }
    });
  });
}
