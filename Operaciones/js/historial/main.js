import { loadCesiumToken, loadReplay, loadStreamRecordings, downloadRecording } from "./historial.api.js";
import { readHistoryDom, dom } from "./historial.dom.js";
import { initHistoryMap, buildMapEntities, setHistoryLayerVisibility } from "./historial.map.js";
import { replayState } from "./historial.state.js";
import { initTimeline, setReplayData } from "./historial.timeline.js";
import {
  renderChatMessages,
  renderError,
  renderEventLog,
  renderOperationInfo,
  renderTopbar,
} from "./historial.ui.js";

readHistoryDom();
bindShell();
initTimeline();
main();

async function main() {
  const operationId = getOperationId();
  if (!operationId) {
    renderError("No se encontro el id de operacion. Abre historial.html?id=3 o selecciona una operacion cerrada.");
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
    attachRecordingDownloads();
  } catch (error) {
    console.error("Error cargando historial", error);
    renderError(error.message || "No se pudo cargar el historial de la operacion.");
  }
}

function bindShell() {
  dom.backBtn?.addEventListener("click", () => {
    window.location.href = "menu_inicial.html";
  });

  document.querySelectorAll(".tabBtn").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tabBtn").forEach(btn => btn.classList.remove("active"));
      document.querySelectorAll(".tabContent").forEach(content => content.classList.add("hidden"));
      button.classList.add("active");
      document.getElementById(`${button.dataset.tab}Tab`)?.classList.remove("hidden");
    });
  });

  dom.panelToggle?.addEventListener("click", () => {
    dom.sidePanel?.classList.toggle("collapsed");
  });

  document.querySelectorAll("[data-history-layer]").forEach((input) => {
    input.addEventListener("change", () => {
      setHistoryLayerVisibility(input.dataset.historyLayer, input.checked);
    });
  });

  const filterToggleBtn = document.getElementById("historyFilterToggleBtn");
  const mapFilters = document.getElementById("historyMapFilters");

  if (filterToggleBtn && mapFilters) {
    filterToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isShowing = mapFilters.classList.toggle("show");
      filterToggleBtn.classList.toggle("active", isShowing);
    });

    document.addEventListener("click", (e) => {
      if (!mapFilters.contains(e.target) && !filterToggleBtn.contains(e.target)) {
        mapFilters.classList.remove("show");
        filterToggleBtn.classList.remove("active");
      }
    });
  }
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
        alert(error.message || "No se pudo descargar la grabacion.");
      } finally {
        button.disabled = false;
      }
    });
  });
}
