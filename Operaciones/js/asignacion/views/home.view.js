import { panel } from "../core/dom.js";
import { state } from "../core/state.js";
import { readObjectStorage } from "../core/storage.js";
import { STORAGE_OPERACION_ACTUAL } from "../core/constants.js";
import {
  showOperacionInfo,
  hideDashboardButton,
  setHeader,
  setAccion,
  showBack,
  clearPanel,
  mkOpt
} from "../core/ui.js";
import { saveAsignacionActual } from "../modules/asignacion/asignacion.service.js";
import { renderCUT } from "../modules/personal/personal.views.js";
import { renderVehiculos } from "../modules/vehiculos/vehiculos.view.js";
import { renderEquipoAsignacion } from "../modules/equipos/equipos.view.js";

export function renderHome() {
  // BACKEND: La verificación esExistente se simplifica a: if (state.id_operacion) showDashboardButton();
  // state.id_operacion viene de localStorage("active_operation_id") o de POST /ops.
  const opActual = readObjectStorage(STORAGE_OPERACION_ACTUAL, {});
  const esExistente = !!(opActual.id && (opActual.title || opActual.titulo));

  if (!esExistente) {
    hideDashboardButton();
  }

  showOperacionInfo();
  clearPanel();
  panel.classList.add("homePanel");

  state.categoria = null;
  state.pasoPersonal = "home";

  setHeader("Asignar recursos", "");
  setAccion("Siguiente", true);
  showBack(false);

  const intro = document.createElement("p");
  intro.className = "rightIntro";
  intro.textContent = "Selecciona los recursos que participaran en esta operacion.";
  panel.appendChild(intro);

  const grid = document.createElement("div");
  grid.className = "optGrid";

  const btnPersonal = mkOpt("Personal");
  const btnEquipo = mkOpt("Equipo");
  const btnVehiculos = mkOpt("Vehículos");

  btnPersonal.addEventListener("click", () => {
    state.categoria = "personal";
    state.pasoPersonal = "cut";
    renderCUT();
  });

  btnEquipo.addEventListener("click", () => {
    state.categoria = "equipo";
    state.equipoCategoria = "comunicacion";
    state.equipoDestino = "personal";
    state.equipoSelectedItems = [];
    state.equipoSelectedResource = null;
    state.equipoSelectedCet = state.cetSeleccionados[0] || null;

    const primerCet = state.equipoSelectedCet;
    if (primerCet) {
      const ginfo = state.gruposByCet[primerCet] || { names: [], map: {} };
      state.equipoSelectedGrupo =
        ginfo.names && ginfo.names.length > 0 ? ginfo.names[0] : null;
    } else {
      state.equipoSelectedGrupo = null;
    }

    saveAsignacionActual();
    renderEquipoAsignacion();
  });

  btnVehiculos.addEventListener("click", () => {
    state.categoria = "vehiculos";
    renderVehiculos();
  });

  grid.append(btnPersonal, btnVehiculos, btnEquipo);
  panel.appendChild(grid);
}
