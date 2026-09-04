// js/dashboard/dashboard.events.js

import { dom } from "./dashboard.dom.js";
import {
  getCurrentOperation,
  saveCurrentOperation,
  isOperationActive
} from "./dashboard.storage.js";
import { togglePanel, closeAllPanels, showPersonnelDetail } from "./dashboard.ui.js";
import { saveTacticalData } from "./dashboard.persistence.js";
import { clearPersonnelLiveCamera, refreshCameraPanelLayout } from "./dashboard.camera.js";
import { dashboardState } from "./dashboard.state.js";
import { markActiveChatRead, scrollChatToLatest } from "./dashboard.chat.js?v=20260728-web-alert-sound-4";

/**
 * Vincula los eventos de clic de los paneles laterales (Info, Ruta, Táctico, Chat).
 */
function bindPanelEvents() {
  if (dom.toggleInfoPanel) {
    dom.toggleInfoPanel.addEventListener("click", () => {
      togglePanel(dom.infoPanel, dom.toggleInfoPanel);
    });
  }

  if (dom.toggleRoutePanel) {
    dom.toggleRoutePanel.addEventListener("click", () => {
      togglePanel(dom.routePanel, dom.toggleRoutePanel);
    });
  }

  if (dom.toggleTacticalPanel) {
    dom.toggleTacticalPanel.addEventListener("click", () => {
      togglePanel(dom.tacticalPanel, dom.toggleTacticalPanel);
    });
  }

  if (dom.toggleChatPanel) {
    dom.toggleChatPanel.addEventListener("click", () => {
      if (!isOperationActive()) {
        alert("El chat táctico solo está disponible cuando la operación está activa automáticamente por fecha y hora.");
        return;
      }
      const isOpen = dom.chatPanel?.classList.contains("open") || dom.chatAudiencePanel?.classList.contains("open");
      if (isOpen) {
        dom.chatPanel?.classList.remove("open");
        dom.chatAudiencePanel?.classList.remove("open");
        dom.chatGroupMembersPanel?.classList.remove("open");
        if (dom.chatGroupMembersToggle) {
          dom.chatGroupMembersToggle.textContent = ">";
          dom.chatGroupMembersToggle.setAttribute("aria-expanded", "false");
        }
        dom.toggleChatPanel?.classList.remove("active");
        return;
      }
      closeAllPanels();
      dom.chatAudiencePanel?.classList.add("open");
      dom.chatPanel?.classList.add("open");
      dom.toggleChatPanel?.classList.add("active");
      markActiveChatRead();
      scrollChatToLatest();
    });
  }

  if (dom.toggleCameraPanel) {
    dom.toggleCameraPanel.addEventListener("click", () => {
      if (!isOperationActive()) {
        alert("El panel de cámaras solo está disponible cuando la operación está activa.");
        return;
      }

      const isOpen = dom.cameraPanel?.classList.contains("open");
      if (isOpen) {
        dom.cameraPanel?.classList.remove("open");
        dom.toggleCameraPanel?.classList.remove("active");
        return;
      }

      closeAllPanels();
      dom.cameraPanel?.classList.add("open");
      dom.toggleCameraPanel?.classList.add("active");
      refreshCameraPanelLayout();
    });
  }
}

/**
 * Vincula el evento de clic global para cerrar paneles al hacer clic fuera de ellos.
 * Comportamiento transversal de la interfaz (Shell UI).
 */
function bindGlobalClickEvents() {
  document.addEventListener("click", (e) => {
    const clickedInsidePanel = e.target.closest(".glassPanel");
    const clickedToolButton = e.target.closest(".toolFab");
    const clickedCesium = e.target.closest(".cesium-viewer");
    const clickedActionBtn = e.target.closest(".actionBtn");

    if (!clickedInsidePanel && !clickedToolButton && !clickedCesium && !clickedActionBtn) {
      closeAllPanels();
    }
  });
}

// Helper local para llamadas autenticadas al backend
async function apiFetchEstado(opId, nuevoEstado) {
  const token = localStorage.getItem("token");
  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const res = await fetch(`${API_BASE}/ops/${opId}/estado`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ estado: nuevoEstado })
  });
  return res;
}

async function apiFetchOperacion(path, method = "GET", body = null) {
  const token = localStorage.getItem("token");
  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }
  };

  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, options);
  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    throw new Error(data.mensaje || data.error || res.statusText || "No se pudo guardar la operacion.");
  }

  return data.items ?? data.operacion ?? data;
}

function normalizeOperationId(value) {
  const raw = String(value ?? "").trim();
  return /^\d+$/.test(raw) ? raw : null;
}

function getActiveOperationId(op) {
  return normalizeOperationId(localStorage.getItem("active_operation_id")) ||
    normalizeOperationId(op?.id_operacion) ||
    normalizeOperationId(op?.id) ||
    normalizeOperationId(op?.idOperacion) ||
    null;
}

function normalizeDateForApi(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (raw.includes("T")) return raw.split("T")[0];

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().split("T")[0];
}

function normalizeTimeForApi(op) {
  const raw =
    op?.hora_inicio ||
    op?.hora ||
    op?.time ||
    op?.operationTime ||
    op?.horaOperacion ||
    op?.hora_operacion ||
    "";

  if (/^\d{2}:\d{2}/.test(String(raw))) return String(raw).slice(0, 5);

  const dateValue = op?.fecha_inicio || op?.fechaHora || op?.datetime || op?.startAt;
  if (!dateValue || !String(dateValue).includes("T")) return "";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return (String(dateValue).split("T")[1] || "").slice(0, 5);
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function buildFechaInicioForApi(op) {
  const fecha = normalizeDateForApi(op?.fecha_inicio || op?.fecha || op?.date || op?.operationDate);
  const hora = normalizeTimeForApi(op);
  if (fecha && /^\d{2}:\d{2}$/.test(hora)) {
    return `${fecha}T${hora}:00-06:00`;
  }
  return fecha;
}

function normalizePriority(value) {
  const prioridad = String(value || "MEDIA").trim().toUpperCase();
  return ["BAJA", "MEDIA", "ALTA"].includes(prioridad) ? prioridad : "MEDIA";
}

function buildOperationPayload(op) {
  const nombre = op?.nombre || op?.title || op?.titulo || op?.name || "Operacion planificada";
  return {
    nombre,
    descripcion: op?.descripcion || op?.description || "",
    fecha_inicio: buildFechaInicioForApi(op),
    hora_inicio: normalizeTimeForApi(op),
    prioridad: normalizePriority(op?.prioridad)
  };
}

function normalizeSavedOperation(savedOp, fallback) {
  const id = savedOp?.id_operacion || savedOp?.id || getActiveOperationId(fallback);
  const nombre = savedOp?.nombre || fallback?.nombre || fallback?.title || fallback?.titulo || "Operacion planificada";
  const descripcion = savedOp?.descripcion || fallback?.descripcion || fallback?.description || "";

  return {
    ...fallback,
    ...savedOp,
    id,
    id_operacion: id,
    nombre,
    title: nombre,
    titulo: nombre,
    description: descripcion,
    descripcion,
    prioridad: savedOp?.prioridad || fallback?.prioridad || "MEDIA",
    fecha_inicio: normalizeDateForApi(savedOp?.fecha_inicio || fallback?.fecha_inicio),
    hora_inicio: normalizeTimeForApi({ ...fallback, ...savedOp }),
    estado: "PLANIFICADA",
    estado_operacion: "PLANIFICADA",
    phase: "planificada",
    created_at: savedOp?.fecha_creacion || fallback?.created_at || new Date().toISOString()
  };
}

async function savePlannedOperation(op) {
  const opId = getActiveOperationId(op);
  const payload = buildOperationPayload(op);
  const saved = opId
    ? await apiFetchOperacion(`/ops/${opId}`, "PUT", payload)
    : await apiFetchOperacion("/ops", "POST", payload);

  const normalized = normalizeSavedOperation(saved, op);
  if (!normalized.id_operacion) {
    throw new Error("El servidor no devolvio el ID de la operacion.");
  }

  localStorage.setItem("active_operation_id", normalized.id_operacion);
  saveCurrentOperation(normalized);
  dashboardState.currentOperation = normalized;
  saveTacticalData();
  return normalized;
}

async function changeOperationState(opId, estado) {
  const res = await apiFetchEstado(opId, estado);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data.mensaje || data.error || res.statusText || `No se pudo cambiar a ${estado}`);
  }
  return data;
}

function showConfirmationModal({ title, message, confirmText = "Confirmar", onConfirm }) {
  if (!dom.confirmationModal) {
    onConfirm?.();
    return;
  }

  dom.confirmationTitle.textContent = title;
  dom.confirmationMessage.textContent = message;
  dom.confirmationConfirmBtn.textContent = confirmText;
  dom.confirmationModal.classList.remove("hidden");

  const close = () => {
    dom.confirmationModal.classList.add("hidden");
    dom.confirmationConfirmBtn.removeEventListener("click", handleConfirm);
    dom.confirmationCancelBtn.removeEventListener("click", close);
  };

  const handleConfirm = () => {
    onConfirm?.();
    close();
  };

  dom.confirmationConfirmBtn.addEventListener("click", handleConfirm);
  dom.confirmationCancelBtn.addEventListener("click", close);
}

/**
 * Vincula los eventos de los botones de acción global (Guardar/Cancelar operación).
 *
 * Cuando la operación está en PLANIFICADA (los botones solo son visibles en ese estado):
 *   - Guardar  -> crea/actualiza la operacion y conserva estado PLANIFICADA
 *   - Cancelar -> PATCH /ops/:id/estado { estado: "CANCELADA" } libera lo asignado
 */
function bindOperationActionEvents() {
  if (dom.saveOpMapBtn) {
    dom.saveOpMapBtn.addEventListener("click", async () => {
      const op = getCurrentOperation();

      try {
        await savePlannedOperation(op);
        window.location.href = "menu_inicial.html";
      } catch (e) {
        console.error(e);
        alert(`Error al guardar la operacion: ${e.message}`);
      }
    });
  }

  if (dom.cancelOpMapBtn) {
    dom.cancelOpMapBtn.addEventListener("click", async () => {
      const op = getCurrentOperation();
      const opId = getActiveOperationId(op);
      const opName = op.nombre || op.title || op.titulo || "Operación";

      if (!opId) {
        alert("No se encontró la operación activa.");
        return;
      }



      showConfirmationModal({
        title: "¿Cancelar operación?",
        message: `¿Estás seguro de que quieres cancelar la operación "${opName}"? Se perderán todos los datos planificados.`,
        confirmText: "Cancelar Operación",
        onConfirm: async () => {
          try {
            const res = await apiFetchEstado(opId, "CANCELADA");
            if (res.ok) {
              window.location.href = "menu_inicial.html";
            } else {
              const data = await res.json().catch(() => ({}));
              alert(`Error al cancelar: ${data.mensaje || res.statusText}`);
            }
          } catch {
            alert("Error de conexión al intentar cancelar la operación.");
          }
        }
      });
    });
  }

  const activateOpBtn = document.getElementById("activateOpBtn");
  if (activateOpBtn) {
    activateOpBtn.addEventListener("click", async () => {
      const op = getCurrentOperation();
      const opId = getActiveOperationId(op);
      const opName = op.nombre || op.title || op.titulo || "Operacion";

      if (!opId) {
        alert("No se encontro la operacion activa.");
        return;
      }



      try {
        saveTacticalData();
        const res = await apiFetchEstado(opId, "ACTIVA");
        const data = await res.json().catch(() => ({}));

        if (res.ok) {
          const updatedOp = data.operacion || { ...op, estado: "ACTIVA", phase: "activa" };
          updatedOp.phase = "activa";
          localStorage.setItem("operacion_actual", JSON.stringify(updatedOp));
          localStorage.setItem("active_operation_id", updatedOp.id_operacion || opId);
          localStorage.setItem("force_open_chat", "true");
          window.location.reload();
        } else {
          alert(`Error al activar: ${data.mensaje || res.statusText}`);
        }
      } catch (e) {
        console.error(e);
        alert("Error de conexion al intentar activar la operacion.");
      }
    });
  }

  const closeActiveBtn = document.getElementById("closeActiveOpBtn");
  if (closeActiveBtn) {
    closeActiveBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const op = getCurrentOperation();
      const opId = getActiveOperationId(op);
      const opName = op.nombre || op.title || op.titulo || "Operacion";

      if (!opId) {
        alert("No se encontro la operacion activa.");
        return;
      }

      showConfirmationModal({
        title: "Terminar operación",
        message: `Quieres terminar la operación "${opName}"?`,
        confirmText: "Terminar operación",
        onConfirm: async () => {
          closeActiveBtn.disabled = true;
          try {
            const data = await changeOperationState(opId, "CERRADA");
            const updatedOp = data.operacion || { ...op, id_operacion: opId, id: opId, estado: "CERRADA", phase: "cerrada" };
            updatedOp.phase = "cerrada";
            localStorage.setItem("operacion_actual", JSON.stringify(updatedOp));
            localStorage.setItem("active_operation_id", updatedOp.id_operacion || updatedOp.id || opId);
            window.location.href = "menu_inicial.html";
          } catch (error) {
            console.error(error);
            alert(`Error al terminar la operación: ${error.message}`);
            closeActiveBtn.disabled = false;
          }
        }
      });
    }, true);

    closeActiveBtn.addEventListener("click", async () => {
      const op = getCurrentOperation();
      const opId = getActiveOperationId(op);
      const opName = op.nombre || op.title || op.titulo || "Operación";

      if (!opId) {
        alert("No se encontró la operación activa.");
        return;
      }



      showConfirmationModal({
        title: "¿Terminar operación?",
        message: `¿Estás seguro de que quieres terminar la operación "${opName}"?`,
        confirmText: "Terminar",
        onConfirm: async () => {
          try {
            const res = await apiFetchEstado(opId, "CERRADA");
            if (res.ok) {
              window.location.href = "menu_inicial.html";
            } else {
              const data = await res.json().catch(() => ({}));
              alert(`Error al cerrar: ${data.mensaje || res.statusText}`);
            }
          } catch {
            alert("Error de conexión al intentar cerrar la operación.");
          }
        }
      });
    });
  }
}

/**
 * Orquestador principal para vincular todos los eventos de la Shell UI del dashboard.
 * (Eventos que NO pertenecen a ningún dominio específico como mapa, chat o táctico).
 */
export function bindDashboardEvents() {
  bindPanelEvents();
  bindGlobalClickEvents();
  bindOperationActionEvents();
  bindPersonnelDetailEvents();
}

function bindPersonnelDetailEvents() {
  if (dom.infoPanel) {
    dom.infoPanel.addEventListener("click", (event) => {
      const link = event.target.closest(".person-link");
      if (!link) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showPersonnelDetail(link.dataset.personId || link.dataset.pid);
    });
  }

  const closeDetail = () => {
    dom.personnelDetailModal?.classList.add("hidden");
    dom.personnelDetailModal?.setAttribute("aria-hidden", "true");
    clearPersonnelLiveCamera();
  };

  dom.btnClosePersonnelDetail?.addEventListener("click", closeDetail);
  dom.personnelDetailBackdrop?.addEventListener("click", closeDetail);
}
