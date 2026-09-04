import { panel, btnAccion, vehiculosLeftEl } from "../../core/dom.js";
import { state } from "../../core/state.js";
import { getGrupoDeCelula, getPersonDisplayName } from "../personal/personal.helpers.js";
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
import { saveOperacionActual, syncOperacionCompleta } from "../operacion/operacion.service.js";
import { readObjectStorage } from "../../core/storage.js";
import { STORAGE_OPERACION_ACTUAL } from "../../core/constants.js";
import {
  asignarDispositivo,
  removerAsignacionDispositivo,
  getAsignacionDispositivo,
  getDestinoDispositivo,
  getNombrePersonalById
} from "./dispositivos.service.js";

const logAlert = (message) => {
  if (message) console.warn(message);
};

function assignmentMatchesResource(asignacion, resourceKey) {
  if (!asignacion || !resourceKey) return false;
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

function destinoActualCoincide(asignacion) {
  return assignmentMatchesResource(asignacion, state.dispositivoSelectedResource);
}

function enfocarDestinoAsignado(asignacion) {
  const personaNombre = getNombrePersonalById(asignacion?.id_personal);
  if (!personaNombre) return;

  if (state.cetSeleccionados.includes(personaNombre)) {
    state.dispositivoSelectedCet = personaNombre;
    state.dispositivoSelectedGrupo = null;
    state.dispositivoSelectedResource = `${personaNombre} - CET: ${personaNombre}`;
    return;
  }

  for (const cet of state.cetSeleccionados) {
    const celulas = state.asignacionCelulas[cet] || [];
    if (!celulas.includes(personaNombre)) continue;
    state.dispositivoSelectedCet = cet;
    state.dispositivoSelectedGrupo = getGrupoDeCelula(cet, personaNombre) || null;
    state.dispositivoSelectedResource = `${cet} - ${personaNombre}`;
    return;
  }
}

function removerAsignacionDeSeleccionActual(resourceKey) {
  let removioAlgo = false;

  state.dispositivoSelectedItems.forEach(idDispositivo => {
    const asignacion = getAsignacionDispositivo(idDispositivo);
    if (!assignmentMatchesResource(asignacion, resourceKey)) return;
    removioAlgo = removerAsignacionDispositivo(idDispositivo) || removioAlgo;
    if (!state.dispositivosLiberadosLocalmente.includes(idDispositivo)) {
      state.dispositivosLiberadosLocalmente.push(idDispositivo);
    }
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

function getIdPersonalFromResource(resourceKey) {
  if (!resourceKey) return null;
  const parts = resourceKey.split(" - ");
  if (parts.length !== 2) return null;

  const personaNombre = parts[1].replace(/^CET: /, "");
  return state.personalMap[personaNombre] || state.personalMap[parts[1]] || null;
}

async function switchToEquipoTab(categoria) {
  state.categoria = "equipo";
  state.equipoCategoria = categoria;
  state.equipoSelectedItems = [];
  state.equipoSelectedResource = null;
  saveAsignacionActual();
  const { renderEquipoAsignacion } = await import("../equipos/equipos.view.js");
  renderEquipoAsignacion();
}

function renderEquipoTabs() {
  const tabs = document.createElement("div");
  tabs.className = "chipRow";
  tabs.style.marginBottom = "10px";

  const chipComunicacion = document.createElement("button");
  chipComunicacion.className = "chip";
  chipComunicacion.textContent = "Comunicaci\u00f3n";
  chipComunicacion.addEventListener("click", () => switchToEquipoTab("comunicacion"));

  const chipTactico = document.createElement("button");
  chipTactico.className = "chip";
  chipTactico.textContent = "T\u00e1ctico";
  chipTactico.addEventListener("click", () => switchToEquipoTab("tactico"));

  const chipDispositivos = document.createElement("button");
  chipDispositivos.className = "chip active";
  chipDispositivos.textContent = "Dispositivos";

  tabs.appendChild(chipComunicacion);
  tabs.appendChild(chipTactico);
  tabs.appendChild(chipDispositivos);
  return tabs;
}

export function renderDispositivoAsignacion() {
  clearPanel();
  panel.classList.add("resourceWidePanel");
  panel.closest(".rightCard")?.classList.add("resourceWideMode");
  panel.closest(".cols")?.classList.add("resourceWideMode");
  panel.closest(".shell")?.classList.add("resourceWideMode");
  document.body.classList.add("resourceWideMode");
  showBack(true);
  showVehiculosLeftPanel("Asignación de equipos");

  setHeader("Selecciona equipo", "");
  setAccion("Finalizar", false);

  vehiculosLeftEl.innerHTML = "";
  renderDispositivoLeftPersonal();

  const listBox = document.createElement("div");
  listBox.className = "listBox";

  const wrap = document.createElement("div");
  wrap.className = "equipmentGrid";
  wrap.addEventListener("scroll", () => {
    state.dispositivosRightScrollTop = wrap.scrollTop;
  });

  state.dispositivosList.forEach((disp) => {
    const asigActual = getAsignacionDispositivo(disp.id);
    const assignedInFlow = getDestinoDispositivo(asigActual);
    const isAssignedInFlow = !!asigActual;
    const fueLiberadoLocalmente = state.dispositivosLiberadosLocalmente.includes(disp.id);
    const isEnOtraOperacion = !isAssignedInFlow && !fueLiberadoLocalmente && disp.estado && disp.estado !== "DISPONIBLE";
    const isSelected = state.dispositivoSelectedItems.includes(disp.id);

    const card = document.createElement("div");
    card.className = "vehicleCard deviceCard"
      + (isSelected ? " selected" : "")
      + (isEnOtraOperacion ? " disabled" : "");
    card.style.cursor = isEnOtraOperacion ? "not-allowed" : "pointer";

    const media = document.createElement("div");
    media.className = "equipmentMedia deviceMedia";
    if (disp.image) {
      const img = document.createElement("img");
      img.src = disp.image;
      img.alt = [disp.tipo, disp.marca, disp.modelo].filter(Boolean).join(" ") || "Dispositivo";
      media.appendChild(img);
    } else {
      media.classList.add("deviceIcon");
      media.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.8" width="10" height="18.4" rx="2.2"></rect><path d="M10 6h4"></path><path d="M11 18h2"></path></svg>`;
    }

    const name = document.createElement("p");
    name.className = "deviceTitle";
    name.textContent = [disp.tipo, disp.marca, disp.modelo].filter(Boolean).join(" ");

    const meta = document.createElement("p");
    meta.className = "deviceMeta";
    [
      disp.numeroTelefono ? `Tel: ${disp.numeroTelefono}` : "",
      disp.imei ? `IMEI: ${disp.imei}` : "",
      disp.numeroSerie ? `Serie: ${disp.numeroSerie}` : ""
    ].filter(Boolean).forEach(text => {
      const line = document.createElement("span");
      line.textContent = text;
      meta.appendChild(line);
    });

    const badge = document.createElement("p");
    badge.className = "deviceBadge";
    if (isEnOtraOperacion) badge.classList.add("danger");
    else if (isAssignedInFlow) badge.classList.add("success");
    badge.textContent = isAssignedInFlow
      ? assignedInFlow
      : (isEnOtraOperacion ? "En otra operación" : "Disponible");

    const body = document.createElement("div");
    body.className = "deviceBody";
    body.appendChild(name);
    if (meta.textContent) body.appendChild(meta);
    body.appendChild(badge);

    card.appendChild(media);
    card.appendChild(body);

    card.addEventListener("click", () => {
      if (isEnOtraOperacion) return;

      const hasSelectedResource = !!state.dispositivoSelectedResource;

      if (hasSelectedResource) {
        if (asigActual) {
          if (destinoActualCoincide(asigActual)) {
            // Si ya está asignado al recurso seleccionado -> DESASIGNAR
            removerAsignacionDispositivo(disp.id);
            if (!state.dispositivosLiberadosLocalmente.includes(disp.id)) {
              state.dispositivosLiberadosLocalmente.push(disp.id);
            }
            state.dispositivoSelectedItems = state.dispositivoSelectedItems.filter(x => x !== disp.id);
          } else {
            // Si está asignado a otra persona -> REASIGNAR
            const idPersonal = getIdPersonalFromResource(state.dispositivoSelectedResource);
            if (idPersonal) {
              removerAsignacionDispositivo(disp.id);
              asignarDispositivo(disp.id, idPersonal);
              state.dispositivosLiberadosLocalmente = state.dispositivosLiberadosLocalmente.filter(id => id !== disp.id);
              state.dispositivoSelectedItems = [];
            }
          }
        } else {
          // Si está disponible -> ASIGNAR
          const idPersonal = getIdPersonalFromResource(state.dispositivoSelectedResource);
          if (idPersonal) {
            asignarDispositivo(disp.id, idPersonal);
            state.dispositivosLiberadosLocalmente = state.dispositivosLiberadosLocalmente.filter(id => id !== disp.id);
            state.dispositivoSelectedItems = [];
          }
        }
      } else {
        if (isSelected) {
          state.dispositivoSelectedItems = state.dispositivoSelectedItems.filter(x => x !== disp.id);
          if (asigActual) {
            removerAsignacionDispositivo(disp.id);
            if (!state.dispositivosLiberadosLocalmente.includes(disp.id)) {
              state.dispositivosLiberadosLocalmente.push(disp.id);
            }
          }
        } else {
          state.dispositivoSelectedItems.push(disp.id);
          if (asigActual) enfocarDestinoAsignado(asigActual);
        }
      }

      saveAsignacionActual();
      renderDispositivoAsignacion();
    });

    wrap.appendChild(card);
  });

  // Función para intentar asignación automática
  function tryAutoAssignment() {
    if (!state.dispositivoSelectedResource || state.dispositivoSelectedItems.length === 0) return false;

    const hasUnassigned = state.dispositivoSelectedItems.some(id => !destinoActualCoincide(getAsignacionDispositivo(id)));
    if (!hasUnassigned) return false;

    const idPersonal = getIdPersonalFromResource(state.dispositivoSelectedResource);
    if (!idPersonal) return false;

    state.dispositivoSelectedItems.forEach(idDispositivo => {
      try {
        removerAsignacionDispositivo(idDispositivo);
        asignarDispositivo(idDispositivo, idPersonal);
        state.dispositivosLiberadosLocalmente = state.dispositivosLiberadosLocalmente.filter(id => id !== idDispositivo);
      } catch (e) {
        logAlert(`Error asignando dispositivo: ${e.message}`);
      }
    });

    state.dispositivoSelectedItems = [];
    renderDispositivoAsignacion();
    return true;
  }

  // Intentar asignación automática
  if (tryAutoAssignment()) return;

  const footer = document.createElement("div");
  footer.className = "rightFooter";

  panel.appendChild(renderEquipoTabs());
  listBox.appendChild(wrap);
  panel.appendChild(listBox);
  panel.appendChild(footer);
  restoreScrollTop(wrap, state.dispositivosRightScrollTop || 0);

  btnAccion.onclick = async () => {
    state.categoria = null;
    state.pasoPersonal = "home";
    state.dispositivoSelectedItems = [];
    state.dispositivoSelectedResource = null;
    state.dispositivoSelectedCet = null;
    state.dispositivoSelectedGrupo = null;

    await finalizarAsignacionCompleta();
  };
}

export function renderDispositivoLeftPersonal() {
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

  if (!state.dispositivoSelectedCet || !state.cetSeleccionados.includes(state.dispositivoSelectedCet)) {
    state.dispositivoSelectedCet = state.cetSeleccionados[0];
  }

  const cet = state.dispositivoSelectedCet;
  const ginfo = state.gruposByCet[cet] || { names: [], map: {} };

  const cetRow = document.createElement("div");
  cetRow.className = "chipRow";
  cetRow.style.marginBottom = "12px";

  state.cetSeleccionados.forEach((c) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (state.dispositivoSelectedCet === c ? " active" : "");
    chip.textContent = state.flotillaByCet[c] || c;
    chip.addEventListener("click", () => {
      state.dispositivoSelectedCet = c;
      state.dispositivoSelectedResource = null;
      state.dispositivoSelectedGrupo = null;
      saveAsignacionActual();
      renderDispositivoAsignacion();
    });
    cetRow.appendChild(chip);
  });
  box.appendChild(cetRow);

  const headerBox = document.createElement("div");
  headerBox.style.padding = "0 0 10px";
  headerBox.style.borderBottom = "1px solid #d7e3ff";
  headerBox.style.marginBottom = "10px";

  const cetLbl = document.createElement("div");
  cetLbl.className = "lbl";
  cetLbl.style.marginBottom = "8px";
  cetLbl.textContent = "CET a cargo";
  headerBox.appendChild(cetLbl);

  const cetKey = `${cet} - CET: ${cet}`;
  const cetItem = document.createElement("div");
  cetItem.className = "item" + (state.dispositivoSelectedResource === cetKey ? " selected" : "");
  cetItem.style.cursor = "pointer";
  cetItem.textContent = `CET: ${getPersonDisplayName(cet)}`;
  cetItem.addEventListener("click", () => {
    if (state.dispositivoSelectedResource === cetKey) {
      removerAsignacionDeSeleccionActual(cetKey);
      state.dispositivoSelectedResource = null;
    } else {
      state.dispositivoSelectedResource = cetKey;
    }
    saveAsignacionActual();
    renderDispositivoAsignacion();
  });
  headerBox.appendChild(cetItem);

  const celulasParaCet = (state.asignacionCelulas[cet] || []).map(p => p.nombre ?? p);
  const cellsSinGrupo = celulasParaCet.filter(c => !getGrupoDeCelula(cet, c));
  const hasUnassigned = cellsSinGrupo.length > 0;
  const hasGroups = (ginfo.names || []).length > 0;

  if (hasGroups || hasUnassigned) {
    const gruposLbl = document.createElement("div");
    gruposLbl.className = "lbl";
    gruposLbl.style.margin = "12px 0 8px";
    gruposLbl.textContent = "Grupos";
    headerBox.appendChild(gruposLbl);

    const gruposRow = document.createElement("div");
    gruposRow.className = "groupsRow";

    ginfo.names.forEach((gName) => {
      const chip = document.createElement("button");
      chip.className = "chip" + (state.dispositivoSelectedGrupo === gName ? " active" : "");
      chip.textContent = gName;
      chip.addEventListener("click", () => {
        state.dispositivoSelectedGrupo = gName;
        state.dispositivoSelectedResource = null;
        saveAsignacionActual();
        renderDispositivoAsignacion();
      });
      gruposRow.appendChild(chip);
    });

    if (hasUnassigned) {
      const sinGrupoBtn = document.createElement("button");
      sinGrupoBtn.className = "chip" + (state.dispositivoSelectedGrupo === null ? " active" : "");
      sinGrupoBtn.textContent = "Sin grupo";
      sinGrupoBtn.addEventListener("click", () => {
        state.dispositivoSelectedGrupo = null;
        state.dispositivoSelectedResource = null;
        saveAsignacionActual();
        renderDispositivoAsignacion();
      });
      gruposRow.insertBefore(sinGrupoBtn, gruposRow.firstChild);
    }

    if (hasGroups && !hasUnassigned && state.dispositivoSelectedGrupo === null) {
      state.dispositivoSelectedGrupo = ginfo.names[0];
    }

    headerBox.appendChild(gruposRow);
  }

  box.appendChild(headerBox);

  const personasWrap = document.createElement("div");
  personasWrap.style.display = "flex";
  personasWrap.style.flexDirection = "column";
  personasWrap.style.gap = "10px";
  personasWrap.style.maxHeight = "340px";
  personasWrap.style.overflowY = "auto";
  personasWrap.addEventListener("scroll", () => {
    state.dispositivosLeftScrollTop = personasWrap.scrollTop;
  });

  const personas = state.dispositivoSelectedGrupo
    ? Array.from(ginfo.map[state.dispositivoSelectedGrupo] || [])
    : cellsSinGrupo;

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
      row.className = "item" + (state.dispositivoSelectedResource === key ? " selected" : "");
      row.style.cursor = "pointer";
      row.textContent = getPersonDisplayName(persona);
      row.addEventListener("click", () => {
        if (state.dispositivoSelectedResource === key) {
          removerAsignacionDeSeleccionActual(key);
          state.dispositivoSelectedResource = null;
        } else {
          state.dispositivoSelectedResource = key;
        }
        saveAsignacionActual();
        renderDispositivoAsignacion();
      });
      personasWrap.appendChild(row);
    });
  }

  box.appendChild(personasWrap);
  vehiculosLeftEl.appendChild(box);
  restoreScrollTop(personasWrap, state.dispositivosLeftScrollTop || 0);
}
