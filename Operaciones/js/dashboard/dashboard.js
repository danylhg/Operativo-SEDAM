// js/dashboard/dashboard.js

import { dashboardState } from "./dashboard.state.js";
import { dom } from "./dashboard.dom.js?v=20260728-web-alert-sound-4";
import {
  getCurrentOperation,
  getOperationDateTime,
  saveCurrentOperation
} from "./dashboard.storage.js";
import {
  renderInfoPanel,
  updateChatAvailability,
  openPanel
} from "./dashboard.ui.js";
import { bindDashboardEvents } from "./dashboard.events.js";
import { initChat, bindChatEvents } from "./dashboard.chat.js?v=20260728-web-alert-sound-4";
import {
  setTacticalUI,
  bindTacticalEvents,
  initPoiSocket,
  loadPoisFromBackend,
  loadAreasFromBackend,
  loadStructuresFromBackend,
  loadRoutesFromBackend,
  loadOperationZoneFromBackend,
  restoreGridFromBackend
} from "./dashboard.tactical.js";
import { initCesium, centerMapOnOperationZone } from "./dashboard.map.js";
import { bindAreaEvents } from "./dashboard.area.js";
import { restoreTacticalData } from "./dashboard.persistence.js";
import {
  populateRouteVehicleSelect,
  loadRouteForSelectedVehicle,
  initRoutes
} from "./dashboard.routes.js";
import { loadTrackingFromBackend, loadTrackingFromMapaData, initTrackingSocket, startTrackingPolling } from "./dashboard.tracking.js";
import { bindDrawingEvents, loadDrawingsFromBackend, initDrawingSocket } from "./dashboard.drawing.js";
import { initCameraFeeds } from "./dashboard.camera.js";
import { initPttAlerts } from "./dashboard.ptt.js";

const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
const CONNECTION_LOST_MESSAGE = "Se perdio la conexion con el servidor.";
let connectionBanner = null;
let operationClosedHandled = false;
let autoActivationTimer = null;
let autoActivationInFlight = false;

function ensureConnectionBanner() {
  if (connectionBanner) return connectionBanner;

  connectionBanner = document.createElement("div");
  connectionBanner.id = "serverConnectionBanner";
  connectionBanner.textContent = CONNECTION_LOST_MESSAGE;
  Object.assign(connectionBanner.style, {
    position: "fixed",
    top: "18px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "99999",
    display: "none",
    padding: "10px 16px",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(127,29,29,0.94)",
    color: "#fff",
    fontWeight: "700",
    fontSize: "14px",
    boxShadow: "0 10px 28px rgba(0,0,0,0.28)"
  });

  document.body.appendChild(connectionBanner);
  return connectionBanner;
}

function setServerConnectionState(isConnected, message = CONNECTION_LOST_MESSAGE) {
  const banner = ensureConnectionBanner();
  banner.textContent = message;
  banner.style.display = isConnected ? "none" : "block";
}

function hasCesiumRuntime() {
  return Boolean(window.Cesium?.Viewer);
}

function showMapFallback(message) {
  const map = document.getElementById("map");
  if (!map) return;
  map.classList.add("mapUnavailable");
  map.innerHTML = `
    <div class="mapUnavailableCard">
      <strong>Mapa no disponible</strong>
      <span>${message}</span>
    </div>
  `;
}

async function loadCesiumToken() {
  if (!hasCesiumRuntime()) {
    setServerConnectionState(false, "No se pudo cargar Cesium. Revisa la conexion a internet o el CDN.");
    showMapFallback("No se pudo cargar Cesium. La informacion de la operacion sigue disponible.");
    return false;
  }

  const data = await apiFetch("/config/cesium-token");

  if (data?.token) {
    Cesium.Ion.defaultAccessToken = data.token;
    localStorage.setItem("CESIUM_TOKEN", data.token);
    return true;
  }

  localStorage.removeItem("CESIUM_TOKEN");
  console.warn("[MAP] Token de Cesium no configurado. Se usaran capas publicas del mapa.");
  return true;
}

async function apiFetchEstado(opId, nuevoEstado) {
  const token = localStorage.getItem("token");
  try {
    return await fetch(`${API_BASE}/ops/${opId}/estado`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ estado: nuevoEstado })
    });
  } catch {
    return null;
  }
}

function normalizeOperationPhase(op) {
  return String(op?.phase || op?.estado || "").toLowerCase();
}

function isOperationDueForActivation(op, now = new Date()) {
  const phase = normalizeOperationPhase(op);
  if (phase && phase !== "planificada") return false;

  const scheduled = getOperationDateTime(op);
  if (!scheduled || Number.isNaN(scheduled.getTime())) return false;

  return now >= scheduled;
}

async function tryAutoActivateCurrentOperation() {
  if (autoActivationInFlight) return;

  const op = getCurrentOperation();
  if (!isOperationDueForActivation(op)) return;

  const opId = localStorage.getItem("active_operation_id") || op?.id_operacion || op?.id;
  if (!opId) return;

  autoActivationInFlight = true;
  try {
    const res = await apiFetchEstado(opId, "ACTIVA");
    if (!res?.ok) return;

    const data = await res.json().catch(() => ({}));
    const updatedOp = data.operacion || { ...op, id_operacion: opId, id: opId, estado: "ACTIVA" };
    saveCurrentOperation({
      ...op,
      ...updatedOp,
      id: updatedOp.id_operacion || updatedOp.id || opId,
      phase: "activa",
      estado: "ACTIVA"
    });
    dashboardState.currentOperation = getCurrentOperation();
    renderInfoPanel();
    updateChatAvailability();
    setTacticalUI();
  } finally {
    autoActivationInFlight = false;
  }
}

function startDashboardAutoActivationWatcher() {
  if (autoActivationTimer) return;
  void tryAutoActivateCurrentOperation();
  autoActivationTimer = setInterval(() => {
    void tryAutoActivateCurrentOperation();
  }, 15000);
}

function showPlanningExitModal() {
  const modal = document.getElementById("planningExitModal");
  const backdrop = document.getElementById("planningExitBackdrop");
  const saveBtn = document.getElementById("planningExitSaveBtn");
  const discardBtn = document.getElementById("planningExitDiscardBtn");
  const cancelBtn = document.getElementById("planningExitCancelBtn");

  if (!modal || !saveBtn || !discardBtn || !cancelBtn) {
    return Promise.resolve("save");
  }

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
      saveBtn.removeEventListener("click", onSave);
      discardBtn.removeEventListener("click", onDiscard);
      cancelBtn.removeEventListener("click", onCancel);
      backdrop?.removeEventListener("click", onCancel);
      document.removeEventListener("keydown", onKeyDown);
      resolve(value);
    };

    const onSave = () => finish("save");
    const onDiscard = () => finish("discard");
    const onCancel = () => finish("cancel");
    const onKeyDown = (event) => {
      if (event.key === "Escape") finish("cancel");
    };

    saveBtn.addEventListener("click", onSave);
    discardBtn.addEventListener("click", onDiscard);
    cancelBtn.addEventListener("click", onCancel);
    backdrop?.addEventListener("click", onCancel);
    document.addEventListener("keydown", onKeyDown);
  });
}

function handleClosedOperation(operacion) {
  if (operationClosedHandled || !operacion) return false;

  const estado = String(operacion.estado || operacion.phase || "").toLowerCase();
  if (!["cerrada", "cancelada"].includes(estado)) return false;

  operationClosedHandled = true;
  alert(`La operacion "${operacion.nombre || operacion.titulo || "actual"}" ya fue ${estado}.`);
  window.location.href = "menu_inicial.html";
  return true;
}

async function apiFetch(path) {
  const token = localStorage.getItem("token");
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ok !== false ? (data.items ?? data) : null;
  } catch {
    return null;
  }
}

async function loadDashboardFromBD() {
  const opId = localStorage.getItem("active_operation_id");
  if (!opId) return null;

  const token = localStorage.getItem("token");
  try {
    const requestOptions = {
      headers: { "Authorization": `Bearer ${token}` }
    };
    const [res, ...personalCatalogResponses] = await Promise.all([
      fetch(`${API_BASE}/ops/${opId}/mapa`, requestOptions),
      ...["CUT", "CET", "CELL"].map((rol) =>
        fetch(`${API_BASE}/catalog/personal?rol=${rol}`, requestOptions).catch(() => null)
      )
    ]);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.ok) return null;

    let personal = Array.isArray(data.personal) ? data.personal : [];
    const catalogPeople = [];
    for (const catalogResponse of personalCatalogResponses) {
      if (!catalogResponse?.ok) continue;
      const catalogData = await catalogResponse.json();
      catalogPeople.push(...(catalogData.items || []));
    }

    if (catalogPeople.length) {
      const catalogById = new Map(
        catalogPeople.map((person) => [String(person.id_personal), person])
      );

      personal = personal.map((person) => {
        const identity = catalogById.get(String(person.id_personal));
        if (!identity) return person;
        return {
          ...person,
          nombre: identity.nombre || person.nombre || "",
          apellido: identity.apellido || person.apellido || "",
          apodo: identity.apodo || person.apodo || ""
        };
      });
    }

    return {
      operacion: data.operacion,
      zona_operacion: data.zona_operacion || null,
      personal,
      vehiculos: data.vehiculos || [],
      equipos: data.equipos || [],
      dispositivos: data.dispositivos || [],
      grid: data.grid || data.cuadricula_operacion || null,
      cuadricula_operacion: data.cuadricula_operacion || data.grid || null,
      _mapaData: data   // para tracking
    };
  } catch {
    return null;
  }
}

function runDashboardStep(label, fn) {
  try {
    return fn();
  } catch (error) {
    console.error(`[DASHBOARD] Error en ${label}:`, error);
    return null;
  }
}

async function runDashboardAsyncStep(label, fn) {
  try {
    return await fn();
  } catch (error) {
    console.error(`[DASHBOARD] Error en ${label}:`, error);
    return null;
  }
}

async function checkServerHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const ok = data?.ok !== false;
    setServerConnectionState(ok);
    return ok;
  } catch {
    setServerConnectionState(false);
    return false;
  }
}

// ── User info bar ────────────────────────────────────────────
if (dom.logout) {
  dom.logout.onclick = async () => {
    window.location.href = "menu_inicial.html";
  };
}

// ── Map / tactical load ──────────────────────────────────────
function loadCurrentOperationOnMap() {
  const op = getCurrentOperation();
  dashboardState.currentOperation = op;
  if (!op || !dashboardState.viewer) return;
  populateRouteVehicleSelect(op?.vehiculos || []);
  loadRouteForSelectedVehicle();
  restoreTacticalData();
}

// ── Socket.io connection ─────────────────────────────────────
function loadSocketIOScript() {
  return new Promise((resolve, reject) => {
    if (window.io) return resolve();
    const script = document.createElement("script");
    script.src = `${API_BASE}/socket.io/socket.io.js`;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`No se pudo cargar socket.io desde ${API_BASE}`));
    document.head.appendChild(script);
  });
}

function getSocketJoinPayload(opId) {
  let stored = {};
  let tokenPayload = {};
  try {
    stored = JSON.parse(localStorage.getItem("userData") || "{}");
  } catch {
    stored = {};
  }
  try {
    const token = localStorage.getItem("token") || "";
    tokenPayload = JSON.parse(atob(token.split(".")[1] || ""));
  } catch {
    tokenPayload = {};
  }

  const tabla = String(tokenPayload.tabla || stored.tabla || "").toLowerCase();
  const rol = String(tokenPayload.rol || stored.rol || "").toUpperCase();
  const idPersonal = tokenPayload.id_personal || stored.id_personal ||
    (tabla === "personal" ? tokenPayload.sub : null);
  const payload = { id_operacion: Number(opId) };

  if (idPersonal) payload.id_personal = Number(idPersonal);
  if (rol) payload.rol = rol;

  return payload;
}

async function connectSocket(opId) {
  try {
    await loadSocketIOScript();
  } catch (err) {
    console.warn("[SOCKET] socket.io client no disponible:", err.message);
    return null;
  }
  const socket = window.io(API_BASE, { transports: ["websocket", "polling"] });

  socket.on("connect", () => {
    console.log("[SOCKET] conectado:", socket.id);
    setServerConnectionState(true);
    socket.emit("join_operacion", getSocketJoinPayload(opId));
  });

  socket.on("connect_error", (err) => {
    setServerConnectionState(false);
    console.error("[SOCKET] error de conexión:", err.message);
  });

  socket.on("disconnect", (reason) => {
    console.log("[SOCKET] desconectado:", reason);
    setServerConnectionState(false);
  });

  socket.on("operacion_estado_actualizado", ({ operacion }) => {
    const activeId = localStorage.getItem("active_operation_id");
    if (!operacion || String(operacion.id_operacion) !== String(activeId)) return;

    const current = getCurrentOperation();
    saveCurrentOperation({
      ...current,
      ...operacion,
      id: operacion.id_operacion
    });
    dashboardState.currentOperation = getCurrentOperation();
    if (handleClosedOperation(dashboardState.currentOperation)) return;
    renderInfoPanel();
    updateChatAvailability();
    setTacticalUI();
  });

  return socket;
}

// ── Main init ────────────────────────────────────────────────
function bindPlanningLogoutChoice() {
  if (!dom.logout) return;

  dom.logout.onclick = async () => {
    const op = getCurrentOperation();
    const esPlanificada = (op.phase || "planificada") === "planificada";

    if (esPlanificada) {
      const decision = await showPlanningExitModal();
      if (decision === "cancel") return;

      if (decision === "discard") {
        window.location.href = "menu_inicial.html";
        return;
      }
    }

    window.location.href = "menu_inicial.html";
  };
}

function updateRangeVisual(range) {
  if (!range) return;

  const min = Number(range.min || 0);
  const max = Number(range.max || 100);
  const value = Number(range.value || min);
  const progress = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const clamped = Math.max(0, Math.min(100, progress));
  range.style.setProperty("--range-fill", `${clamped}%`);

  const outputId = range.dataset?.output;
  const output = outputId ? document.getElementById(outputId) : null;
  if (output) output.textContent = formatRangeValue(range);
}

function formatRangeValue(range) {
  const value = Number(range.value || 0);

  if (range.id === "opacityRange") {
    return `${Math.round(value * 100)}%`;
  }

  if (range.id === "widthRange" || range.id === "zoneWidthRange") {
    return `${value} px`;
  }

  return String(range.value || "");
}

function bindDashboardRangeVisuals() {
  [dom.zoneWidthRange, dom.opacityRange, dom.widthRange]
    .filter(Boolean)
    .forEach((range) => {
      updateRangeVisual(range);
      range.addEventListener("input", () => updateRangeVisual(range));
      range.addEventListener("change", () => updateRangeVisual(range));
    });
}

async function initDashboard() {
  ensureConnectionBanner();
  runDashboardStep("abrir panel de informacion", () => openPanel(dom.infoPanel, dom.toggleInfoPanel));
  runDashboardStep("pintar informacion inicial", () => renderInfoPanel());
  runDashboardStep("actualizar estado inicial", () => updateChatAvailability());
  runDashboardStep("preparar salida", () => bindPlanningLogoutChoice());
  runDashboardStep("vigilar autoactivacion", () => startDashboardAutoActivationWatcher());

  const canUseCesium = await runDashboardAsyncStep("cargar Cesium", () => loadCesiumToken());
  if (canUseCesium) {
    try {
      initCesium();
    } catch (error) {
      console.error("[MAP] No se pudo inicializar Cesium:", error);
      showMapFallback("No se pudo inicializar el mapa. La informacion de la operacion sigue disponible.");
    }
  }
  runDashboardStep("controles de rango", () => bindDashboardRangeVisuals());
  runDashboardStep("eventos de chat", () => bindChatEvents());
  runDashboardStep("eventos tacticos", () => bindTacticalEvents());
  runDashboardStep("eventos de area", () => bindAreaEvents());
  runDashboardStep("eventos del dashboard", () => bindDashboardEvents());
  runDashboardStep("eventos de dibujo", () => bindDrawingEvents());
  runDashboardStep("ui tactica", () => setTacticalUI());
  if (dashboardState.viewer) {
    runDashboardStep("cargar operacion en mapa", () => loadCurrentOperationOnMap());
  }

  if (dom.recenterMapBtn) {
    dom.recenterMapBtn.onclick = () => {
      if (!dashboardState.viewer) return;

      const currentOperation = getCurrentOperation();
      const operationZone =
        dashboardState.currentOperationZone ||
        currentOperation?.zona_operacion ||
        dashboardState.currentOperation?.zona_operacion;

      if (operationZone) {
        centerMapOnOperationZone(operationZone);
        return;
      }

      if (dashboardState.areaPoints && dashboardState.areaPoints.length > 0) {
        const lats = dashboardState.areaPoints.map(p => p.lat);
        const lngs = dashboardState.areaPoints.map(p => p.lng);
        const centerLat = lats.reduce((a, b) => a + b, 0) / lats.length;
        const centerLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;

        dashboardState.viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(centerLng, centerLat, 12000)
        });
        return;
      }
    };
  }

  // Abrir panel de info al cargar
  runDashboardStep("asegurar panel de informacion", () => openPanel(dom.infoPanel, dom.toggleInfoPanel));

  // Cargar datos de la operación desde BD
  const bdData = await runDashboardAsyncStep("cargar datos de operacion", () => loadDashboardFromBD());
  if (bdData) {
    if (handleClosedOperation(bdData.operacion)) return;
    saveCurrentOperation({
      ...bdData.operacion,
      id: bdData.operacion.id_operacion,
      zona_operacion: bdData.zona_operacion || null,
      personal: bdData.personal || [],
      vehiculos: bdData.vehiculos || [],
      equipos: bdData.equipos || [],
      dispositivos: bdData.dispositivos || []
    });
    dashboardState.currentOperation = getCurrentOperation();
    runDashboardStep("pintar informacion de BD", () => renderInfoPanel(bdData));
    runDashboardStep("inicializar camaras", () => initCameraFeeds());
    runDashboardStep("actualizar ui tactica", () => setTacticalUI());
    if (dashboardState.viewer && bdData.zona_operacion) {
      runDashboardStep("centrar zona de operacion", () => centerMapOnOperationZone(bdData.zona_operacion));
    }
  } else {
    runDashboardStep("pintar informacion local", () => renderInfoPanel());
    runDashboardStep("inicializar camaras locales", () => initCameraFeeds());
  }
  runDashboardStep("actualizar disponibilidad", () => updateChatAvailability());

  if (dashboardState.viewer) {
    // Cargar POIs existentes desde la BD
    await runDashboardAsyncStep("cargar POIs", () => loadPoisFromBackend());
    await runDashboardAsyncStep("cargar areas", () => loadAreasFromBackend());
    await runDashboardAsyncStep("cargar estructuras", () => loadStructuresFromBackend());
    await runDashboardAsyncStep("cargar rutas", () => loadRoutesFromBackend());
    await runDashboardAsyncStep("cargar zona", () => loadOperationZoneFromBackend());
    await runDashboardAsyncStep("restaurar cuadricula", () => restoreGridFromBackend(bdData?.grid || bdData?.cuadricula_operacion));
    await runDashboardAsyncStep("cargar dibujos", () => loadDrawingsFromBackend());

    // Cargar posiciones de tracking usando datos ya obtenidos (evita segunda llamada a /mapa)
    if (bdData?._mapaData) {
      runDashboardStep("cargar tracking desde mapa", () => loadTrackingFromMapaData(bdData._mapaData));
    } else {
      await runDashboardAsyncStep("cargar tracking", () => loadTrackingFromBackend());
    }
    runDashboardStep("iniciar tracking", () => startTrackingPolling(5000));
  }

  // Conectar Socket.io — chat y rutas en tiempo real
  const opId = localStorage.getItem("active_operation_id");
  if (opId) {
    const socket = await runDashboardAsyncStep("conectar socket", () => connectSocket(opId));
    if (socket) {
      runDashboardStep("iniciar alertas PTT", () => initPttAlerts(socket));
      runDashboardStep("iniciar chat", () => initChat(opId, socket));
      if (dashboardState.viewer) {
        runDashboardStep("iniciar rutas", () => initRoutes(socket));
        runDashboardStep("iniciar POIs", () => initPoiSocket(socket));
        runDashboardStep("iniciar tracking socket", () => initTrackingSocket(socket));
        runDashboardStep("iniciar dibujo socket", () => initDrawingSocket(socket));
      }
      runDashboardStep("iniciar camaras socket", () => initCameraFeeds(opId, socket));
    }
  }

  // Poblar selector de vehículos con datos del backend
  if (bdData?.vehiculos?.length) {
    runDashboardStep("poblar vehiculos de ruta", () => populateRouteVehicleSelect(bdData.vehiculos));
  }

  // Refresco periódico solo del panel de info (chat ya va por socket)
  setInterval(async () => {
    const fresh = await runDashboardAsyncStep("refrescar datos de operacion", () => loadDashboardFromBD());
    if (fresh) {
      if (handleClosedOperation(fresh.operacion)) return;
      saveCurrentOperation({
        ...fresh.operacion,
        id: fresh.operacion.id_operacion,
        zona_operacion: fresh.zona_operacion || null,
        personal: fresh.personal || [],
        vehiculos: fresh.vehiculos || [],
        equipos: fresh.equipos || [],
        dispositivos: fresh.dispositivos || []
      });
      dashboardState.currentOperation = getCurrentOperation();
      runDashboardStep("refrescar informacion", () => renderInfoPanel(fresh));
      runDashboardStep("refrescar camaras", () => initCameraFeeds());
      runDashboardStep("refrescar ui tactica", () => setTacticalUI());
    }
    runDashboardStep("refrescar disponibilidad", () => updateChatAvailability());
  }, 30000);

  runDashboardAsyncStep("verificar servidor", () => checkServerHealth());
  setInterval(() => runDashboardAsyncStep("verificar servidor", () => checkServerHealth()), 10000);
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  initDashboard();
} else {
  window.addEventListener("load", initDashboard);
}
