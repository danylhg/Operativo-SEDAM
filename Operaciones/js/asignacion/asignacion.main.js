import {
  lblOperacion,
  lblUsuario,
  btnHoy,
  opNombreEl,
  opDescEl,
  opInicioEl,
  opHoraInicioEl,
  opPrioridadEl,
  btnUserMenu,
  userDropdown,
  btnLogout

} from "./core/dom.js";

import { state } from "./core/state.js";
import { readObjectStorage, writeStorage } from "./core/storage.js";
import {
  STORAGE_OPERACION_ACTUAL,
  STORAGE_ASIGNACION_ACTUAL,
  DEFAULT_GROUP_INFO
} from "./core/constants.js";

import { validateDateTime } from "./core/utils.js";
import { showDashboardButton } from "./core/ui.js";

import {
  saveOperacionActual,
  loadOperacionActualIntoForm,
  cargarOperacionRemota
} from "./modules/operacion/operacion.service.js";
import { startAsignacionPresenceHeartbeat } from "./modules/operacion/operacion.presence.js";
import { releaseAsignacionPresence } from "./modules/operacion/operacion.presence.js";

import { hydrateCatalogsFromControl, hydrateAsignacionFromBD } from "./modules/catalogos/catalogos.service.js";
import { bindNavigation } from "./modules/navigation/asignacion.navigation.js";
import { saveAsignacionActual } from "./modules/asignacion/asignacion.service.js";
import { renderHome } from "./views/home.view.js";

function bindFormEvents() {
  if (btnHoy && opInicioEl) {
    btnHoy.addEventListener("click", () => {
      const d = new Date();
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      opInicioEl.value = `${yyyy}-${mm}-${dd}`;
      saveOperacionActual(); // BACKEND: saveOperacionActual() se vuelve async y llama PUT /ops/:id con debounce
    });
  }

  if (opHoraInicioEl) {
    const hourOptions = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
    const timeDropdown = document.createElement("div");
    timeDropdown.className = "timeDropdown hidden";
    timeDropdown.setAttribute("role", "listbox");
    opHoraInicioEl.removeAttribute("list");
    opHoraInicioEl.parentElement?.appendChild(timeDropdown);

    function hideTimeDropdown() {
      timeDropdown.classList.add("hidden");
    }

    function showTimeDropdown(options = hourOptions) {
      timeDropdown.innerHTML = "";
      options.forEach((hour) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "timeOption" + (opHoraInicioEl.value === hour ? " active" : "");
        option.textContent = hour;
        option.setAttribute("role", "option");
        option.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          opHoraInicioEl.value = hour;
          validateDateTime(opInicioEl, opHoraInicioEl);
          saveOperacionActual();
          hideTimeDropdown();
          opHoraInicioEl.focus();
        });
        timeDropdown.appendChild(option);
      });
      timeDropdown.classList.remove("hidden");
    }

    opHoraInicioEl.addEventListener("focus", () => showTimeDropdown(hourOptions));
    opHoraInicioEl.addEventListener("click", () => showTimeDropdown(hourOptions));

    opHoraInicioEl.addEventListener("input", function (e) {
      let v = e.target.value.replace(/[^\d:]/g, "");
      const firstColon = v.indexOf(":");
      if (firstColon !== -1) {
        v = v.slice(0, firstColon + 1) + v.slice(firstColon + 1).replace(/:/g, "");
      }
      if (!v.includes(":") && v.length > 2) {
        v = v.substring(0, 2) + ":" + v.substring(2, 4);
      }
      v = v.substring(0, 5);
      e.target.value = v;
      const filtered = hourOptions.filter((hour) => hour.startsWith(v));
      showTimeDropdown(filtered.length ? filtered : hourOptions);
      saveOperacionActual(); // BACKEND: saveOperacionActual() se vuelve async y llama PUT /ops/:id con debounce
    });

    opHoraInicioEl.addEventListener("blur", function (e) {
      let v = e.target.value;
      if (/^\d{1,2}(:\d{0,2})?$/.test(v)) {
        let [h, m] = v.split(":");
        h = Math.min(23, parseInt(h) || 0);
        m = Math.min(59, parseInt(m) || 0);
        e.target.value = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
        validateDateTime(opInicioEl, opHoraInicioEl);
        saveOperacionActual(); // BACKEND: saveOperacionActual() se vuelve async y llama PUT /ops/:id con debounce
      }
    });

    opHoraInicioEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideTimeDropdown();
    });

    document.addEventListener("pointerdown", (event) => {
      if (event.target === opHoraInicioEl || timeDropdown.contains(event.target)) return;
      hideTimeDropdown();
    });
  }

  const inputFields = [opNombreEl, opDescEl, opInicioEl, opHoraInicioEl, opPrioridadEl];
  inputFields.forEach((field) => {
    if (!field) return;

    const eventType = field.tagName === "SELECT" ? "change" : "input";
    field.addEventListener(eventType, () => {
      if (field === opInicioEl) validateDateTime(opInicioEl, opHoraInicioEl);

      // Limpiar error visual si el usuario escribe
      if (field.value.trim()) {
        field.style.borderColor = "";
        const errDiv = field.nextElementSibling;
        if (errDiv && errDiv.classList.contains('op-inline-error')) {
          errDiv.style.display = 'none';
        }
      }

      saveOperacionActual(); // BACKEND: saveOperacionActual() se vuelve async y llama PUT /ops/:id con debounce
      if (field === opNombreEl && lblOperacion) {
        lblOperacion.textContent = opNombreEl.value || "—";
      }
    });
  });
}

function bindUserMenu() {
  btnUserMenu?.addEventListener("click", () => {
    if (!userDropdown) return;
    const isOpen = !userDropdown.classList.contains("hidden");
    userDropdown.classList.toggle("hidden", isOpen);
    btnUserMenu.setAttribute("aria-expanded", String(!isOpen));
  });

  document.addEventListener("click", (event) => {
    if (!btnUserMenu || !userDropdown) return;
    if (btnUserMenu.contains(event.target) || userDropdown.contains(event.target)) return;

    userDropdown.classList.add("hidden");
    btnUserMenu.setAttribute("aria-expanded", "false");
  });

  btnLogout?.addEventListener("click", async () => {
    await releaseAsignacionPresence();
    [
      "session",
      "token",
      "username",
      "rol",
      "nombre",
      "active_operation_id"
    ].forEach((key) => localStorage.removeItem(key));
    window.location.href = "login.html";
  });
}

function applySavedAssignment(savedAsig) {
  if (!savedAsig || typeof savedAsig !== "object") return false;
  if (!Array.isArray(savedAsig.cets) || !Array.isArray(savedAsig.personal)) return false;

  state.cutSeleccionado = savedAsig.cut || null;
  state.cetSeleccionados = savedAsig.cets;
  if (savedAsig.flotillaByCet && typeof savedAsig.flotillaByCet === "object" && !Array.isArray(savedAsig.flotillaByCet)) {
    state.flotillaByCet = savedAsig.flotillaByCet;
  }
  if (savedAsig.asignacionCelulas && typeof savedAsig.asignacionCelulas === "object" && !Array.isArray(savedAsig.asignacionCelulas)) {
    state.asignacionCelulas = savedAsig.asignacionCelulas;
  }
  if (Array.isArray(savedAsig.asignacionVehiculos)) state.asignacionVehiculos = savedAsig.asignacionVehiculos;
  if (Array.isArray(savedAsig.asignacionEquipos)) state.asignacionEquipos = savedAsig.asignacionEquipos;
  if (Array.isArray(savedAsig.asignacionDispositivos)) state.asignacionDispositivos = savedAsig.asignacionDispositivos;

  state.gruposByCet = {};
  state.cetSeleccionados.forEach((cet) => {
    state.gruposByCet[cet] = structuredClone(DEFAULT_GROUP_INFO);
  });
  savedAsig.personal.forEach((persona) => {
    const cet = persona?.cet;
    const grupo = persona?.grupo;
    const nombre = persona?.nombre;
    if (!cet || !grupo || !nombre || !state.gruposByCet[cet]) return;
    const ginfo = state.gruposByCet[cet];
    if (!ginfo.names.includes(grupo)) {
      ginfo.names.push(grupo);
      ginfo.map[grupo] = new Set();
    }
    ginfo.map[grupo].add(nombre);
  });

  return true;
}

function restoreSavedState() {
  // BACKEND: Esta funcion desaparece. La asignacion se carga del servidor via GET /ops/:id/personal, GET /ops/:id/vehiculos-asignados y GET /ops/:id/equipos-asignados.
  const storedOp = readObjectStorage(STORAGE_OPERACION_ACTUAL, {});
  const asigKey = storedOp.id ? `asignacion_op_${storedOp.id}` : STORAGE_ASIGNACION_ACTUAL;
  const savedAsig =
    readObjectStorage(asigKey, null) ||
    readObjectStorage(STORAGE_ASIGNACION_ACTUAL, {});

  applySavedAssignment(savedAsig);

  return storedOp;
}

async function init() {
  // ── Validación de entrada ────────────────────────────────────
  // Entradas válidas:
  //   "create"  → viene del botón "Crear operación" del menú inicial
  //   "edit"    → viene del botón "Editar" del dashboard
  // Cualquier otra entrada es inválida y se redirige.
  const entry = sessionStorage.getItem("asignacion_entry");
  sessionStorage.removeItem("asignacion_entry");

  if (!entry) {
    const hasActiveOp = !!localStorage.getItem("active_operation_id");
    window.location.href = hasActiveOp ? "dashboard.html?v=20260629-restore-tactical-fix" : "menu_inicial.html";
    return;
  }

  if (entry === "edit" && !localStorage.getItem("active_operation_id")) {
    window.location.href = "menu_inicial.html";
    return;
  }
  // ─────────────────────────────────────────────────────────────

  const qs = new URLSearchParams(window.location.search);
  const op = qs.get("op");
  if (op) lblOperacion.textContent = op;

  if (lblUsuario) {
    const user = localStorage.getItem("username"); // BACKEND: Reemplazar por GET /me con Bearer token → { nombre, apellido, username, rol }
    lblUsuario.textContent = user
      ? user.charAt(0).toUpperCase() + user.slice(1)
      : "Invitado";
  }

  // En modo edición se excluye la operación actual del chequeo de ocupación
  const excludeOpId = entry === "edit" ? localStorage.getItem("active_operation_id") : null;
  await hydrateCatalogsFromControl(excludeOpId); // BACKEND: await Promise.all([GET /catalog/personal?rol=CUT, GET /catalog/personal?rol=CET, GET /catalog/personal?rol=CELL, GET /catalog/vehiculos, GET /catalog/equipos])

  let storedOp = {};
  if (entry === "edit") {
    const opId = localStorage.getItem("active_operation_id");
    storedOp = { id: opId };

    if (opId) {
      // Cargar operación desde BD y normalizar keys para el formulario
      const opData = await cargarOperacionRemota(opId);
      if (opData) {
        let fExtracted = "";
        let hExtracted = "";
        if (opData.fecha_inicio) {
          const d = new Date(opData.fecha_inicio);
          if (!isNaN(d)) {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            fExtracted = `${yyyy}-${mm}-${dd}`;

            const hh = String(d.getHours()).padStart(2, "0");
            const min = String(d.getMinutes()).padStart(2, "0");
            hExtracted = `${hh}:${min}`;
          }
        }
        if (opData.hora_inicio) {
          hExtracted = String(opData.hora_inicio).slice(0, 5);
        }

        const opNorm = {
          id: opData.id_operacion,
          title: opData.nombre,
          titulo: opData.nombre,
          description: opData.descripcion,
          descripcion: opData.descripcion,
          fecha_inicio: fExtracted,
          hora_inicio: hExtracted,
          prioridad: opData.prioridad,
          estado: opData.estado
        };
        writeStorage(STORAGE_OPERACION_ACTUAL, opNorm);
        storedOp = opNorm;
      }
      loadOperacionActualIntoForm();
      try {
        await hydrateAsignacionFromBD(Number(opId));
      } catch (error) {
        console.error("No se pudo cargar la asignacion para editar:", error);
        const cachedAssignment = readObjectStorage(`asignacion_op_${opId}`, null);
        if (!applySavedAssignment(cachedAssignment)) {
          alert("No fue posible cargar las asignaciones de esta operaciÃ³n. No se realizÃ³ ningÃºn cambio.");
          window.location.href = "dashboard.html?v=20260629-restore-tactical-fix";
          return;
        }
      }
      saveAsignacionActual();
    } else {
      loadOperacionActualIntoForm();
    }
  } else {
    storedOp = restoreSavedState();
    loadOperacionActualIntoForm();
  }

  renderHome();
  bindNavigation();
  bindFormEvents();
  bindUserMenu();
  startAsignacionPresenceHeartbeat();

  const tieneNombre = !!(storedOp.title || storedOp.titulo);
  const tieneId = !!storedOp.id;

  if (tieneId && tieneNombre) {
    showDashboardButton();
  }
}

init();
