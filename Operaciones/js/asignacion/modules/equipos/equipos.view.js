import { panel, btnAccion, vehiculosLeftEl } from "../../core/dom.js";
import { state } from "../../core/state.js";
import { getGrupoDeCelula } from "../personal/personal.helpers.js";
import { saveAsignacionActual } from "../asignacion/asignacion.service.js";
import {
  clearPanel,
  showBack,
  showVehiculosLeftPanel,
  setHeader,
  setAccion,
  renderAssignmentCompleteActions,
  restoreScrollTop
} from "../../core/ui.js";
import { renderHome } from "../../views/home.view.js";
import {
  getEquipoAssignmentsBucket as getBucket,
  getEquipoListByCategoria as getList,
  formatEquipoAsignado
} from "./equipos.helpers.js";
import { asignarEquipo, removerAsignacionEquipo } from "./equipos.service.js";
import {
  getResumenVehiculoDetallado,
  getVehiclesUsedInAssignments
} from "../vehiculos/vehiculos.helpers.js";
import { saveOperacionActual, syncOperacionCompleta } from "../operacion/operacion.service.js";
import { readObjectStorage } from "../../core/storage.js";
import { STORAGE_OPERACION_ACTUAL } from "../../core/constants.js";

const logAlert = (message) => {
  if (message) console.warn(message);
};

function escapeHtml(text) {
  return (text ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getNombrePersonalById(idPersonal) {
  for (const [nombre, id] of Object.entries(state.personalMap)) {
    if (id === idPersonal) return nombre;
  }
  return null;
}

function getPersonDetails(key) {
  return state.personalDetails?.[key] || { apodo: key };
}

function abbreviatePuesto(puesto = "") {
  const normalized = puesto.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const abbreviations = {
    "sargento primero": "Sgto. 1/o",
    "sargento segundo": "Sgto. 2/o",
    "sargento": "Sgto.",
    "cabo": "Cbo.",
    "soldado": "Sldo.",
    "marinero": "Mro.",
    "soldado / marinero": "Sldo./Mro.",
    "teniente": "Tte.",
    "subteniente": "Subtte.",
    "capitan primero": "Cap. 1/o",
    "capitan segundo": "Cap. 2/o",
    "capitan": "Cap.",
    "mayor": "May.",
    "coronel": "Cor.",
    "comandante": "Cmdte."
  };
  return abbreviations[normalized] || puesto;
}

function getPersonDisplayName(key) {
  const person = getPersonDetails(key);
  return [abbreviatePuesto(person.puesto), person.nombre, person.apellido].filter(Boolean).join(" ").trim() || key;
}

function enfocarDestinoAsignado(asignacion) {
  if (!asignacion) return;

  if (asignacion.tipo_destino === "vehiculo") {
    const veh = state.vehiclesList.find(v => v.id === asignacion.id_vehiculo);
    if (!veh) return;

    state.equipoDestino = "vehiculo";
    state.equipoSelectedCet = null;
    state.equipoSelectedGrupo = null;
    state.equipoSelectedResource = veh.name;
    return;
  }

  if (asignacion.tipo_destino !== "personal") return;

  const personaNombre = getNombrePersonalById(asignacion.id_personal);
  if (!personaNombre) return;

  if (state.cetSeleccionados.includes(personaNombre)) {
    state.equipoDestino = "personal";
    state.equipoSelectedCet = personaNombre;
    state.equipoSelectedGrupo = null;
    state.equipoSelectedResource = `${personaNombre} - CET: ${personaNombre}`;
    return;
  }

  for (const cet of state.cetSeleccionados) {
    const celulas = state.asignacionCelulas[cet] || [];
    if (!celulas.includes(personaNombre)) continue;

    state.equipoDestino = "personal";
    state.equipoSelectedCet = cet;
    state.equipoSelectedGrupo = getGrupoDeCelula(cet, personaNombre) || null;
    state.equipoSelectedResource = `${cet} - ${personaNombre}`;
    return;
  }
}

function destinoActualCoincide(asignacion) {
  if (!asignacion || !state.equipoSelectedResource) return false;

  if (asignacion.tipo_destino === "vehiculo") {
    if (state.equipoDestino !== "vehiculo") return false;
    const veh = state.vehiclesList.find(v => v.id === asignacion.id_vehiculo);
    return !!veh && veh.name === state.equipoSelectedResource;
  }

  if (asignacion.tipo_destino !== "personal" || state.equipoDestino !== "personal") {
    return false;
  }

  const personaNombre = getNombrePersonalById(asignacion.id_personal);
  if (!personaNombre) return false;

  if (state.cetSeleccionados.includes(personaNombre)) {
    return state.equipoSelectedResource === `${personaNombre} - CET: ${personaNombre}`;
  }

  for (const cet of state.cetSeleccionados) {
    const celulas = state.asignacionCelulas[cet] || [];
    if (celulas.includes(personaNombre)) {
      return state.equipoSelectedResource === `${cet} - ${personaNombre}`;
    }
  }

  return false;
}

function assignmentMatchesResource(asignacion, tipoDestino, resourceKey) {
  if (!asignacion || !resourceKey) return false;

  if (tipoDestino === "vehiculo") {
    if (asignacion.tipo_destino !== "vehiculo") return false;
    const veh = state.vehiclesList.find(v => v.id === asignacion.id_vehiculo);
    return !!veh && veh.name === resourceKey;
  }

  if (tipoDestino !== "personal" || asignacion.tipo_destino !== "personal") {
    return false;
  }

  const personaNombre = getNombrePersonalById(asignacion.id_personal);
  if (!personaNombre) return false;

  if (state.cetSeleccionados.includes(personaNombre)) {
    return resourceKey === `${personaNombre} - CET: ${personaNombre}`;
  }

  for (const cet of state.cetSeleccionados) {
    const celulas = state.asignacionCelulas[cet] || [];
    if (celulas.includes(personaNombre)) {
      return resourceKey === `${cet} - ${personaNombre}`;
    }
  }

  return false;
}

function removerAsignacionActualDeEquipo(eqId) {
  const asignacion = state.asignacionEquipos.find(a => a.id_equipo === eqId);
  if (!asignacion) return false;

  removerAsignacionEquipo(
    eqId,
    asignacion.tipo_destino,
    asignacion.id_personal ?? null,
    asignacion.id_vehiculo ?? null
  );
  if (!state.equiposLiberadosLocalmente.includes(eqId)) {
    state.equiposLiberadosLocalmente.push(eqId);
  }
  return true;
}

function removerAsignacionDeSeleccionActual(tipoDestino, resourceKey) {
  let removioAlgo = false;

  state.equipoSelectedItems.forEach(eqId => {
    const asignacion = state.asignacionEquipos.find(a => a.id_equipo === eqId);
    if (!assignmentMatchesResource(asignacion, tipoDestino, resourceKey)) return;
    removioAlgo = removerAsignacionActualDeEquipo(eqId) || removioAlgo;
  });

  return removioAlgo;
}

async function finalizarAsignacionCompleta() {
  saveOperacionActual(); 
  
  btnAccion.disabled = true;
  btnAccion.textContent = "Sincronizando...";

  const opLoc = readObjectStorage(STORAGE_OPERACION_ACTUAL, {});
  if (opLoc.id) {
    try {
      const result = await syncOperacionCompleta(opLoc.id);
      if (result?.ok === false) throw new Error(result.error || "No se pudieron guardar las asignaciones.");
    } catch (e) {
      console.error(e);
      btnAccion.disabled = false;
      btnAccion.textContent = "Finalizar";
      alert(e?.message || "No se pudieron guardar las asignaciones. Intenta nuevamente.");
      return;
    }
  }

  renderHome();
  renderAssignmentCompleteActions();
}

export function renderEquipoAsignacion() {
  clearPanel();
  panel.classList.add("resourceWidePanel");
  panel.closest(".rightCard")?.classList.add("resourceWideMode");
  panel.closest(".cols")?.classList.add("resourceWideMode");
  panel.closest(".shell")?.classList.add("resourceWideMode");
  document.body.classList.add("resourceWideMode");
  showBack(true);
  showVehiculosLeftPanel("Asignación de equipos");
  vehiculosLeftEl.closest(".leftCard")?.classList.add("equipmentAssignLeftMode");

  setHeader("Selecciona equipo", "");
  setAccion("Finalizar", false);

  vehiculosLeftEl.innerHTML = "";

  const leftHeader = document.createElement("div");
  leftHeader.className = "chipRow";

  const chipPersonal = document.createElement("button");
  chipPersonal.className = "chip" + (state.equipoDestino === "personal" ? " active" : "");
  chipPersonal.textContent = "Asignar a personal";
  chipPersonal.addEventListener("click", () => {
    state.equipoDestino = "personal";
    state.equipoSelectedResource = null;
    state.equipoSelectedItems = [];
    state.equipoSelectedCet = state.cetSeleccionados[0] || null;
    state.equipoSelectedGrupo = null;

    saveAsignacionActual(); // BACKEND: saveAsignacionActual() se vuelve async con POST /ops/:id/personal, /grupos, /vehiculos, /equipos
    renderEquipoAsignacion();
  });

  const chipVehiculo = document.createElement("button");
  chipVehiculo.className = "chip" + (state.equipoDestino === "vehiculo" ? " active" : "");
  chipVehiculo.textContent = "Asignar a vehículo";
  chipVehiculo.addEventListener("click", () => {
    state.equipoDestino = "vehiculo";
    state.equipoSelectedResource = null;
    state.equipoSelectedItems = [];
    state.equipoSelectedCet = null;
    state.equipoSelectedGrupo = null;
    saveAsignacionActual();
    renderEquipoAsignacion();
  });

  leftHeader.appendChild(chipPersonal);
  leftHeader.appendChild(chipVehiculo);
  vehiculosLeftEl.appendChild(leftHeader);

  if (state.equipoDestino === "personal") {
    renderEquipoLeftPersonal();
  } else {
    renderEquipoLeftVehiculo();
  }

  const rightHeaderBox = document.createElement("div");
  rightHeaderBox.className = "chipRow";
  rightHeaderBox.style.marginBottom = "10px";

  const chipComunicacion = document.createElement("button");
  chipComunicacion.className = "chip" + (state.equipoCategoria === "comunicacion" ? " active" : "");
  chipComunicacion.textContent = "Comunicación";
  chipComunicacion.addEventListener("click", () => {
    state.equipoCategoria = "comunicacion";
    saveAsignacionActual(); // BACKEND: saveAsignacionActual() se vuelve async con POST /ops/:id/personal, /grupos, /vehiculos, /equipos
    renderEquipoAsignacion();
  });
  chipComunicacion.textContent = "Comunicaci\u00f3n";

  const chipTactico = document.createElement("button");
  chipTactico.className = "chip" + (state.equipoCategoria === "tactico" ? " active" : "");
  chipTactico.textContent = "Táctico";
  chipTactico.addEventListener("click", () => {
    state.equipoCategoria = "tactico";
    saveAsignacionActual(); // BACKEND: saveAsignacionActual() se vuelve async con POST /ops/:id/personal, /grupos, /vehiculos, /equipos
    renderEquipoAsignacion();
  });
  chipTactico.textContent = "T\u00e1ctico";

  const chipDispositivos = document.createElement("button");
  chipDispositivos.className = "chip";
  chipDispositivos.textContent = "Dispositivos";
  chipDispositivos.addEventListener("click", async () => {
    state.categoria = "dispositivos";
    state.dispositivoSelectedItems = [];
    state.dispositivoSelectedResource = null;
    state.dispositivoSelectedCet = state.cetSeleccionados[0] || null;
    state.dispositivoSelectedGrupo = null;
    saveAsignacionActual();
    const { renderDispositivoAsignacion } = await import("../dispositivos/dispositivos.view.js");
    renderDispositivoAsignacion();
  });

  rightHeaderBox.appendChild(chipComunicacion);
  rightHeaderBox.appendChild(chipTactico);
  rightHeaderBox.appendChild(chipDispositivos);
  panel.appendChild(rightHeaderBox);

  const listBox = document.createElement("div");
  listBox.className = "listBox";

  const equipTitle = document.createElement("div");
  equipTitle.className = "lbl";
  equipTitle.style.marginBottom = "10px";
  equipTitle.textContent = "Selecciona equipo";

  const eqWrap = document.createElement("div");
  eqWrap.className = "equipmentGrid";
  eqWrap.addEventListener("scroll", () => {
    state.equiposRightScrollTop = eqWrap.scrollTop;
  });

  const bucket = getBucket(state.equipoCategoria);
  console.log("[EQUIPOS VIEW] asignacionEquipos en state:", JSON.stringify(state.asignacionEquipos, null, 2));

  getList(state.equipoCategoria).forEach((eq) => {
    const eqId = eq.id;
    // ¿Tiene registro en el flujo de ESTA operación?
    const asigActual = state.asignacionEquipos.find(a => a.id_equipo === eqId);
    const assignedInFlow = formatEquipoAsignado(eqId);
    const isAssignedInFlow = !!asigActual;
    const fueLiberadoLocalmente = state.equiposLiberadosLocalmente.includes(eqId);
    // Si NO está en esta op pero el catálogo lo marca como no disponible → otra operación
    const isEnOtraOperacion = !isAssignedInFlow && !fueLiberadoLocalmente && eq.estado && eq.estado !== "DISPONIBLE";
    const isDisabled = isEnOtraOperacion;
    const badgeText = isAssignedInFlow
      ? assignedInFlow
      : (isEnOtraOperacion ? "En otra operación" : "Disponible");
    const isSelected = state.equipoSelectedItems.includes(eqId);

    const card = document.createElement("div");
    card.className = "vehicleCard equipmentCard"
      + (isSelected ? " selected" : "")
      + (isDisabled ? " disabled" : "");
    card.style.cursor = isDisabled ? "not-allowed" : "pointer";

    const media = document.createElement("div");
    media.className = "equipmentMedia";
    if (eq.image) {
      const img = document.createElement("img");
      img.src = eq.image;
      img.alt = eq.nombre;
      media.appendChild(img);
    }
    card.appendChild(media);

    const content = document.createElement("div");
    content.className = "equipmentCardContent";

    const nameP = document.createElement("p");
    nameP.className = "equipmentTitle";
    nameP.textContent = eq.nombre;

    const meta = document.createElement("p");
    meta.className = "equipmentMeta";
    meta.innerHTML = [
      eq.numeroSerie ? `<span>Serie: ${escapeHtml(eq.numeroSerie)}</span>` : "",
      eq.estado ? `<span>Estado: ${escapeHtml(eq.estado)}</span>` : ""
    ].filter(Boolean).join("");

    const badge = document.createElement("p");
    badge.className = "vehicleMeta equipmentBadge";
    if (isEnOtraOperacion) badge.classList.add("danger");
    else if (isAssignedInFlow) badge.classList.add("success");
    badge.textContent = badgeText;

    content.appendChild(nameP);
    if (meta.textContent) content.appendChild(meta);
    content.appendChild(badge);
    card.appendChild(content);

    card.addEventListener("click", () => {
      if (isDisabled) return;

      const hasSelectedResource = !!state.equipoSelectedResource;

      if (hasSelectedResource) {
        if (asigActual) {
          if (destinoActualCoincide(asigActual)) {
            // Si ya está asignado al recurso seleccionado -> DESASIGNAR
            removerAsignacionActualDeEquipo(eqId);
            state.equipoSelectedItems = state.equipoSelectedItems.filter(x => x !== eqId);
          } else {
            // Si está asignado a otro recurso -> REASIGNAR
            let tipoDestino, idPersonal = null, idVehiculo = null;
            if (state.equipoDestino === "personal") {
              tipoDestino = "personal";
              const parts = state.equipoSelectedResource.split(" - ");
              if (parts.length === 2) {
                const cet = parts[0];
                const personaNombre = parts[1];
                const nombreNorm = personaNombre.replace(/^CET: /, "");
                const idFromMap = state.personalMap[nombreNorm] || state.personalMap[personaNombre];
                if (idFromMap) idPersonal = idFromMap;
              }
            } else {
              tipoDestino = "vehiculo";
              const veh = state.vehiclesList.find(v => v.name === state.equipoSelectedResource);
              if (veh) idVehiculo = veh.id;
            }

            if (idPersonal || idVehiculo) {
              removerAsignacionActualDeEquipo(eqId);
              asignarEquipo(eqId, tipoDestino, idPersonal, idVehiculo, state.equipoCategoria);
              state.equiposLiberadosLocalmente = state.equiposLiberadosLocalmente.filter(id => id !== eqId);
              state.equipoSelectedItems = [];
            }
          }
        } else {
          // Si está disponible -> ASIGNAR
          let tipoDestino, idPersonal = null, idVehiculo = null;
          if (state.equipoDestino === "personal") {
            tipoDestino = "personal";
            const parts = state.equipoSelectedResource.split(" - ");
            if (parts.length === 2) {
              const cet = parts[0];
              const personaNombre = parts[1];
              const nombreNorm = personaNombre.replace(/^CET: /, "");
              const idFromMap = state.personalMap[nombreNorm] || state.personalMap[personaNombre];
              if (idFromMap) idPersonal = idFromMap;
            }
          } else {
            tipoDestino = "vehiculo";
            const veh = state.vehiclesList.find(v => v.name === state.equipoSelectedResource);
            if (veh) idVehiculo = veh.id;
          }

          if (idPersonal || idVehiculo) {
            asignarEquipo(eqId, tipoDestino, idPersonal, idVehiculo, state.equipoCategoria);
            state.equiposLiberadosLocalmente = state.equiposLiberadosLocalmente.filter(id => id !== eqId);
            state.equipoSelectedItems = [];
          }
        }
      } else {
        if (isSelected) {
          state.equipoSelectedItems = state.equipoSelectedItems.filter(x => x !== eqId);
          if (asigActual) {
            removerAsignacionActualDeEquipo(eqId);
          }
        } else {
          state.equipoSelectedItems.push(eqId);
          if (asigActual) enfocarDestinoAsignado(asigActual);
        }
      }
      renderEquipoAsignacion();
    });

    eqWrap.appendChild(card);
  });

  // Función para intentar asignación automática
  function tryAutoAssignment() {
    if (!state.equipoSelectedResource || state.equipoSelectedItems.length === 0) return false;

    const hasUnassigned = state.equipoSelectedItems.some(eqId => {
      const asigActual = state.asignacionEquipos.find(a => a.id_equipo === eqId);
      return !destinoActualCoincide(asigActual);
    });
    if (!hasUnassigned) return false;

    if (!state.equipoCategoria) return false;

    // Mapear destino a ids
    let tipoDestino, idPersonal = null, idVehiculo = null;
    if (state.equipoDestino === "personal") {
      tipoDestino = "personal";
      const parts = state.equipoSelectedResource.split(" - ");
      if (parts.length === 2) {
        const cet = parts[0];
        const personaNombre = parts[1];
        const nombreNorm = personaNombre.replace(/^CET: /, "");
        const idFromMap = state.personalMap[nombreNorm] || state.personalMap[personaNombre];
        if (idFromMap) idPersonal = idFromMap;
      }
    } else {
      tipoDestino = "vehiculo";
      const veh = state.vehiclesList.find(v => v.name === state.equipoSelectedResource);
      if (veh) idVehiculo = veh.id;
    }

    if (!idPersonal && !idVehiculo) return false;

    // Asignar automáticamente
    state.equipoSelectedItems.forEach(eqId => {
      try {
        removerAsignacionActualDeEquipo(eqId);
        asignarEquipo(eqId, tipoDestino, idPersonal, idVehiculo, state.equipoCategoria);
        state.equiposLiberadosLocalmente = state.equiposLiberadosLocalmente.filter(id => id !== eqId);
      } catch (e) {
        logAlert(`Error asignando equipo: ${e.message}`);
      }
    });

    state.equipoSelectedItems = [];
    renderEquipoAsignacion();
    return true;
  }

  // Intentar asignación automática
  if (tryAutoAssignment()) return;

  const footer = document.createElement("div");
  footer.className = "rightFooter";

  listBox.appendChild(equipTitle);
  listBox.appendChild(eqWrap);
  panel.appendChild(listBox);
  panel.appendChild(footer);
  restoreScrollTop(eqWrap, state.equiposRightScrollTop || 0);

  btnAccion.onclick = async () => {
    state.categoria = null;
    state.pasoPersonal = "home";
    state.equipoCategoria = null;
    state.equipoDestino = null;
    state.equipoSelectedItems = [];
    state.equipoSelectedResource = null;
    state.equipoSelectedCet = null;
    state.equipoSelectedGrupo = null;

    await finalizarAsignacionCompleta();
  };
}

export function renderEquipoLeftPersonal() {
  const box = document.createElement("div");
  box.className = "listBox";
  box.style.gap = "12px";

  if (!state.cetSeleccionados.length) {
    const empty = document.createElement("div");
    empty.className = "item";
    empty.textContent = "No hay personal disponible.";
    box.appendChild(empty);
    vehiculosLeftEl.appendChild(box);
    return;
  }

  if (!state.equipoSelectedCet || !state.cetSeleccionados.includes(state.equipoSelectedCet)) {
    state.equipoSelectedCet = state.cetSeleccionados[0];
  }

  const cet = state.equipoSelectedCet;
  const ginfo = state.gruposByCet[cet] || { names: [], map: {} };

  // 1. CHIPS DE CET (Flotillas)
  const cetRow = document.createElement("div");
  cetRow.className = "chipRow equipmentFlotillaRow";

  state.cetSeleccionados.forEach((c) => {
    const flotName = state.flotillaByCet[c] || c;
    const chip = document.createElement("button");
    chip.className = "chip" + (state.equipoSelectedCet === c ? " active" : "");
    chip.textContent = flotName;

    chip.addEventListener("click", () => {
      state.equipoSelectedCet = c;
      state.equipoSelectedResource = null;
      state.equipoSelectedGrupo = null;
      saveAsignacionActual();
      renderEquipoAsignacion();
    });
    cetRow.appendChild(chip);
  });
  box.appendChild(cetRow);

  // 2. HEADER BOX (CET a cargo y Grupos)
  const headerBox = document.createElement("div");
  headerBox.style.padding = "0 0 10px";
  headerBox.style.borderBottom = "1px solid #d7e3ff";
  headerBox.style.marginBottom = "10px";

  // CET a cargo
  const cetLbl = document.createElement("div");
  cetLbl.className = "lbl";
  cetLbl.style.marginBottom = "8px";
  cetLbl.textContent = "CET a cargo";
  headerBox.appendChild(cetLbl);

  const cetKey = `${cet} - CET: ${cet}`;
  const cetItem = document.createElement("div");
  cetItem.className = "item" + (state.equipoSelectedResource === cetKey ? " selected" : "");
  cetItem.style.padding = "10px";
  cetItem.style.marginBottom = "10px";
  cetItem.style.cursor = "pointer";
  cetItem.textContent = `CET: ${getPersonDisplayName(cet)}`;
  cetItem.addEventListener("click", () => {
    if (state.equipoSelectedResource === cetKey) {
      removerAsignacionDeSeleccionActual("personal", cetKey);
      state.equipoSelectedResource = null;
    } else {
      state.equipoSelectedResource = cetKey;
    }
    saveAsignacionActual();
    renderEquipoAsignacion();
  });
  headerBox.appendChild(cetItem);

  // Cálculo de personas sin grupo para visibilidad de botón
  const celulasParaCet = (state.asignacionCelulas[cet] || []).map(p => p.nombre ?? p);
  const cellsSinGrupo = celulasParaCet.filter(c => !getGrupoDeCelula(cet, c));
  const hasUnassigned = cellsSinGrupo.length > 0;
  const hasGroups = (ginfo.names || []).length > 0;

  if (!hasGroups) {
    state.equipoSelectedGrupo = null;
  } else if (state.equipoSelectedGrupo && !ginfo.names.includes(state.equipoSelectedGrupo)) {
    state.equipoSelectedGrupo = hasUnassigned ? null : ginfo.names[0];
  } else if (!hasUnassigned && state.equipoSelectedGrupo === null) {
    state.equipoSelectedGrupo = ginfo.names[0];
  }

  // Solo mostrar sección de grupos si hay grupos o personas sueltas
  if (hasGroups) {
    const gruposLbl = document.createElement("div");
    gruposLbl.className = "lbl";
    gruposLbl.style.margin = "12px 0 8px";
    gruposLbl.textContent = "Grupos";
    headerBox.appendChild(gruposLbl);

    const gruposRow = document.createElement("div");
    gruposRow.className = "groupsRow";
    gruposRow.style.display = "flex";
    gruposRow.style.gap = "8px";
    gruposRow.style.flexWrap = "wrap";

    // Botones de grupos
    ginfo.names.forEach((gName) => {
      const chip = document.createElement("button");
      chip.className = "chip" + (state.equipoSelectedGrupo === gName ? " active" : "");
      chip.textContent = gName;
      chip.addEventListener("click", () => {
        state.equipoSelectedGrupo = gName;
        state.equipoSelectedResource = null;
        saveAsignacionActual();
        renderEquipoAsignacion();
      });
      gruposRow.appendChild(chip);
    });

    // Botón "Sin grupo" solo si hay personas sueltas
    if (hasUnassigned) {
      const sinGrupoBtn = document.createElement("button");
      sinGrupoBtn.className = "chip" + (state.equipoSelectedGrupo === null ? " active" : "");
      sinGrupoBtn.textContent = "Sin grupo";
      sinGrupoBtn.addEventListener("click", () => {
        state.equipoSelectedGrupo = null;
        state.equipoSelectedResource = null;
        saveAsignacionActual();
        renderEquipoAsignacion();
      });
      gruposRow.insertBefore(sinGrupoBtn, gruposRow.firstChild);
    }

    headerBox.appendChild(gruposRow);
  }

  box.appendChild(headerBox);

  // 3. LISTA DE PERSONAL
  const personasWrap = document.createElement("div");
  personasWrap.style.display = "flex";
  personasWrap.style.flexDirection = "column";
  personasWrap.style.gap = "10px";
  personasWrap.style.maxHeight = "340px";
  personasWrap.style.overflowY = "auto";
  personasWrap.addEventListener("scroll", () => {
    state.equiposLeftScrollTop = personasWrap.scrollTop;
  });

  let personas = [];
  if (state.equipoSelectedGrupo) {
    personas = Array.from(ginfo.map[state.equipoSelectedGrupo] || []);
  } else {
    // Modo "Sin grupo"
    personas = cellsSinGrupo;
  }

  if (!personas.length) {
    const empty = document.createElement("div");
    empty.className = "item";
    empty.style.opacity = "0.6";
    empty.textContent = "No hay personas en esta selección.";
    personasWrap.appendChild(empty);
  } else {
    personas.forEach((persona) => {
      const key = `${cet} - ${persona}`;
      const row = document.createElement("div");
      row.className = "item" + (state.equipoSelectedResource === key ? " selected" : "");
      row.style.cursor = "pointer";

      const left = document.createElement("div");
      left.className = "itemName";
      left.textContent = getPersonDisplayName(persona);

      row.appendChild(left);

      row.addEventListener("click", () => {
        if (state.equipoSelectedResource === key) {
          removerAsignacionDeSeleccionActual("personal", key);
          state.equipoSelectedResource = null;
        } else {
          state.equipoSelectedResource = key;
        }
        saveAsignacionActual();
        renderEquipoAsignacion();
      });

      personasWrap.appendChild(row);
    });
  }

  box.appendChild(personasWrap);
  vehiculosLeftEl.appendChild(box);
  restoreScrollTop(personasWrap, state.equiposLeftScrollTop || 0);
}

export function renderEquipoLeftVehiculo() {
  const box = document.createElement("div");
  box.className = "listBox equipmentVehicleTargetList";
  box.addEventListener("scroll", () => {
    state.equiposLeftScrollTop = box.scrollTop;
  });

  const usados = getVehiclesUsedInAssignments();

  if (usados.length === 0) {
    const empty = document.createElement("div");
    empty.className = "item";
    empty.textContent = "No hay vehículos asignados todavía.";
    box.appendChild(empty);
    vehiculosLeftEl.appendChild(box);
    return;
  }

  usados.forEach(v => {
    const resumen = getResumenVehiculoDetallado(v.id);

    const card = document.createElement("div");
    card.className = "item equipmentVehicleTargetCard" + (state.equipoSelectedResource === v.name ? " selected" : "");
    card.style.display = "flex";
    card.style.alignItems = "flex-start";
    card.style.gap = "12px";
    card.style.cursor = "pointer";

    if (v.image) {
      const img = document.createElement("img");
      img.className = "equipmentVehicleTargetImage";
      img.src = v.image;
      img.alt = v.name;
      img.style.width = "72px";
      img.style.height = "72px";
      img.style.objectFit = "cover";
      img.style.borderRadius = "12px";
      img.style.border = "1px solid #d7e3ff";
      card.appendChild(img);
    }

    const content = document.createElement("div");
    content.className = "equipmentVehicleTargetContent";
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.gap = "6px";
    content.style.flex = "1";

    const title = document.createElement("div");
    title.className = "itemName equipmentVehicleTargetTitle";
    title.textContent = v.name;

    const sub = document.createElement("div");
    sub.className = "equipmentVehicleTargetMeta";
    sub.style.fontSize = "12px";
    sub.style.opacity = "0.8";
    sub.textContent = [
      v.serialNumber ? `Código: ${v.serialNumber}` : "",
      v.status ? `Estado: ${v.status}` : ""
    ].filter(Boolean).join(" | ");

    const info1 = document.createElement("div");
    info1.className = "equipmentVehicleTargetDetail";
    info1.textContent = `Flotilla: ${resumen.flotilla}`;

    const info2 = document.createElement("div");
    info2.className = "equipmentVehicleTargetDetail";
    info2.textContent = `Grupo: ${resumen.grupo}`;

    const info3 = document.createElement("div");
    info3.className = "equipmentVehicleTargetDetail";
    info3.textContent = `Personas: ${resumen.personas}`;

    const estadoAsignado = document.createElement("div");
    estadoAsignado.className = "equipmentVehicleTargetBadge";
    estadoAsignado.textContent = "Asignado";
    estadoAsignado.style.width = "max-content";
    estadoAsignado.style.padding = "3px 8px";
    estadoAsignado.style.borderRadius = "999px";
    estadoAsignado.style.background = "#e9f8ee";
    estadoAsignado.style.color = "#1f7a3f";
    estadoAsignado.style.fontSize = "12px";
    estadoAsignado.style.fontWeight = "800";

    content.appendChild(title);
    content.appendChild(sub);
    content.appendChild(estadoAsignado);
    content.appendChild(info1);
    content.appendChild(info2);
    content.appendChild(info3);

    card.appendChild(content);

    card.addEventListener("click", () => {
      if (state.equipoSelectedResource === v.name) {
        removerAsignacionDeSeleccionActual("vehiculo", v.name);
        state.equipoSelectedResource = null;
      } else {
        state.equipoSelectedResource = v.name;
      }
      saveAsignacionActual();
      renderEquipoAsignacion();
    });

    box.appendChild(card);
  });

  vehiculosLeftEl.appendChild(box);
  restoreScrollTop(box, state.equiposLeftScrollTop || 0);
}
