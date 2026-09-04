import { panel, btnAccion, vehiculosLeftEl } from "../../core/dom.js";
import { state } from "../../core/state.js";
import { DEFAULT_GROUP_INFO, STORAGE_OPERACION_ACTUAL } from "../../core/constants.js";
import { readObjectStorage, writeStorage } from "../../core/storage.js";
import {
  clearPanel,
  showBack,
  showVehiculosLeftPanel,
  setHeader,
  setAccion,
  restoreScrollTop
} from "../../core/ui.js";
import { getGrupoDeCelula } from "../personal/personal.helpers.js";
import { saveAsignacionActual } from "../asignacion/asignacion.service.js";
import { asignarVehiculo, removerAsignacionVehiculo, getNombreVehiculoAsignado } from "./vehiculos.service.js";
import { renderEquipoAsignacion } from "../equipos/equipos.view.js";
import { guardarOperacionBaseDatos, collectOperacionActual } from "../operacion/operacion.service.js";

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
  const normalized = puesto.trim().toLowerCase();
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

function formatPersonLabel(key, prefix = "") {
  const displayName = getPersonDisplayName(key);
  return prefix ? `${prefix}: ${displayName}` : displayName;
}

function getSelectedVehicleId() {
  return state.vehiclesList.find(v => v.name === state.selectedVehicle)?.id || null;
}

function getKeysAsignadosAVehiculo(idVehiculo) {
  if (!idVehiculo) return [];

  const keys = [];
  state.asignacionVehiculos
    .filter(a => a.id_vehiculo === idVehiculo && a.id_personal)
    .forEach(asig => {
      const nombre = getNombrePersonalById(asig.id_personal);
      if (!nombre) return;

      if (state.cetSeleccionados.includes(nombre)) {
        keys.push(nombre);
        return;
      }

      for (const cet of state.cetSeleccionados) {
        const cells = state.asignacionCelulas[cet] || [];
        if (cells.includes(nombre)) {
          keys.push(`${cet}-${nombre}`);
          return;
        }
      }
    });

  return keys;
}

function removerAsignacionPorKey(key) {
  const separador = key.indexOf('-');
  const cet = separador === -1 ? key : key.slice(0, separador);
  const celula = separador === -1 ? null : key.slice(separador + 1);
  const nombre = celula || cet;
  const idPersonal = state.personalMap[nombre];
  if (!idPersonal) return false;

  const asignacion = state.asignacionVehiculos.find(a => a.id_personal === idPersonal);
  if (!asignacion) return false;

  removerAsignacionVehiculo(
    asignacion.id_vehiculo,
    asignacion.tipo_destino,
    idPersonal,
    asignacion.id_grupo_operacion ?? null
  );

  const quedanAsignacionesVeh = state.asignacionVehiculos.some(a => a.id_vehiculo === asignacion.id_vehiculo);
  if (!quedanAsignacionesVeh && !state.vehiculosLiberadosLocalmente.includes(asignacion.id_vehiculo)) {
    state.vehiculosLiberadosLocalmente.push(asignacion.id_vehiculo);
  }

  if (!quedanAsignacionesVeh) {
    const equiposLiberados = state.asignacionEquipos
      .filter(a => a.id_vehiculo === asignacion.id_vehiculo)
      .map(a => a.id_equipo);

    state.asignacionEquipos = state.asignacionEquipos.filter(a => a.id_vehiculo !== asignacion.id_vehiculo);
    equiposLiberados.forEach(idEquipo => {
      if (!state.equiposLiberadosLocalmente.includes(idEquipo)) {
        state.equiposLiberadosLocalmente.push(idEquipo);
      }
    });
  }

  return true;
}

function toggleSelectedKey(value, checked) {
  const set = new Set(state.selectedCells || []);
  if (checked) set.add(value);
  else set.delete(value);
  state.selectedCells = Array.from(set);
}

function mkCheckRow({ labelText, metaText = "", valueKey, disabled = false, checked = false, onChange }) {
  const label = document.createElement("label");
  label.className = "checkRow" + (disabled ? " disabled" : "");
  label.style.cursor = disabled ? "not-allowed" : "pointer";
  if (disabled) label.style.opacity = "0.65";

  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.value = valueKey;
  chk.checked = checked;
  chk.disabled = disabled;
  chk.addEventListener("change", (e) => onChange?.(e.target.checked));

  const textSpan = document.createElement("span");
  textSpan.className = "checkRowText";

  const main = document.createElement("span");
  main.className = "checkRowMain";
  main.textContent = labelText;
  textSpan.appendChild(main);

  if (metaText) {
    const meta = document.createElement("span");
    meta.className = "checkRowMeta";
    meta.textContent = metaText;
    textSpan.appendChild(meta);
  }

  label.appendChild(chk);
  label.appendChild(textSpan);
  return label;
}

function getCetOrderForVehiculos() {
  return state.cetSeleccionados
    .map((name, index) => ({
      name,
      index,
      order: Number.isFinite(state.flotillaOrderByCet?.[name])
        ? state.flotillaOrderByCet[name]
        : index + 1000
    }))
    .sort((a, b) => a.order - b.order || a.index - b.index);
}

export function renderVehiculos() {
  clearPanel();
  panel.classList.add("resourceWidePanel");
  panel.closest(".rightCard")?.classList.add("resourceWideMode");
  panel.closest(".cols")?.classList.add("resourceWideMode");
  panel.closest(".shell")?.classList.add("resourceWideMode");
  document.body.classList.add("resourceWideMode");
  showBack(true);

  showVehiculosLeftPanel("Asignación de personal al vehículo");
  vehiculosLeftEl.closest(".leftCard")?.classList.add("vehicleAssignLeftMode");

  const vehCount = {};
  state.asignacionVehiculos.forEach(asig => {
    const veh = state.vehiclesList.find(v => v.id === asig.id_vehiculo);
    if (veh) {
      vehCount[veh.name] = (vehCount[veh.name] || 0) + 1;
    }
  });

  const selectedVehicleId = getSelectedVehicleId();
  const keysAsignadosAlVehiculoSeleccionado = new Set(getKeysAsignadosAVehiculo(selectedVehicleId));
  const orderedCetsForVehiculos = getCetOrderForVehiculos();
  const activeOrderIndex = Math.max(
    0,
    orderedCetsForVehiculos.findIndex(item => item.index === state.cetActivoIndexVeh)
  );

  const cet = state.cetSeleccionados[state.cetActivoIndexVeh];

  if (!state.gruposByCet[cet]) {
    state.gruposByCet[cet] = structuredClone(DEFAULT_GROUP_INFO);
  }

  const ginfo = state.gruposByCet[cet];
  if (ginfo.vehActive === undefined) ginfo.vehActive = null;

  const hasGroups = (ginfo.names || []).length > 0;
  if (hasGroups) {
    // null ("Sin grupo") es válido aunque haya grupos — no forzar a un grupo
    if (ginfo.vehActive !== null && ginfo.vehActive !== undefined && !ginfo.names.includes(ginfo.vehActive)) {
      ginfo.vehActive = null;
    }
  } else {
    ginfo.vehActive = null;
  }

  if (!hasGroups) {
    ginfo.vehActive = null;
  } else if (ginfo.vehActive && !ginfo.names.includes(ginfo.vehActive)) {
    ginfo.vehActive = null;
  }

  const groupIndex = hasGroups
    ? (ginfo.vehActive === null ? -1 : Math.max(0, ginfo.names.indexOf(ginfo.vehActive)))
    : 0;
  const lastGroupIndex = hasGroups ? (ginfo.names.length - 1) : 0;

  setHeader("Asignación de Vehículos", "");
  const lastCet = activeOrderIndex === orderedCetsForVehiculos.length - 1;
  const isLastOverall = lastCet && (!hasGroups || groupIndex === lastGroupIndex);
  setAccion(isLastOverall ? "Finalizar" : "Siguiente", false);

  const cetButtons = document.createElement("div");
  cetButtons.className = "chipRow vehicleFlotillaRow";

  orderedCetsForVehiculos.forEach(({ name: n, index: i }) => {
    const flotillaName = state.flotillaByCet[n] || "Sin Flotilla";
    const btn = document.createElement("button");
    btn.className = "chip" + (i === state.cetActivoIndexVeh ? " active" : "");
    btn.textContent = flotillaName;
    btn.style.cursor = "pointer";
    btn.addEventListener("click", () => {
      state.cetActivoIndexVeh = i;
      saveAsignacionActual(); // BACKEND: saveAsignacionActual() se vuelve async con POST /ops/:id/personal, /grupos, /vehiculos, /equipos
      renderVehiculos();
    });
    cetButtons.appendChild(btn);
  });

  vehiculosLeftEl.appendChild(cetButtons);

  const headerBox = document.createElement("div");
  headerBox.className = "stickyTop vehicleAssignHeader";

  const flotillaLbl = document.createElement("div");
  flotillaLbl.className = "lbl";
  flotillaLbl.style.marginBottom = "8px";
  flotillaLbl.textContent = "CET a cargo";

  headerBox.appendChild(flotillaLbl);

  const cetKey = `${cet}`;
  const cetAssigned = getNombreVehiculoAsignado(cetKey);
  const cetAssignedToSelectedVehicle = keysAsignadosAlVehiculoSeleccionado.has(cetKey);
  const cetLocked = !!cetAssigned && !cetAssignedToSelectedVehicle;

  const cetCheckboxRow = mkCheckRow({
    labelText: cetLocked ? `${formatPersonLabel(cet, "CET")} (Asignado: ${cetAssigned})` : formatPersonLabel(cet, "CET"),
    valueKey: cetKey,
    disabled: cetLocked,
    checked: cetAssignedToSelectedVehicle || (state.selectedCells || []).includes(cetKey),
    onChange: (checked) => {
      if (!checked && cetAssignedToSelectedVehicle) {
        removerAsignacionPorKey(cetKey);
        toggleSelectedKey(cetKey, false);
        saveAsignacionActual();
        renderVehiculos();
        return;
      }
      toggleSelectedKey(cetKey, checked);
      renderVehiculos();
    }
  });

  headerBox.appendChild(cetCheckboxRow);

  if (hasGroups) {
    const grpLbl = document.createElement("div");
    grpLbl.className = "lbl";
    grpLbl.style.margin = "10px 0 6px";
    grpLbl.textContent = "Grupos";
    headerBox.appendChild(grpLbl);

    const grpRow = document.createElement("div");
    grpRow.className = "groupsRow";

    const sinGrupoBtn = document.createElement("button");
    sinGrupoBtn.className = "chip" + (ginfo.vehActive === null ? " active" : "");
    sinGrupoBtn.textContent = "Sin grupo";
    sinGrupoBtn.addEventListener("click", () => {
      ginfo.vehActive = null;
      saveAsignacionActual();
      renderVehiculos();
    });
    grpRow.appendChild(sinGrupoBtn);

    // Grupos existentes (a, b...)
    ginfo.names.forEach((gName) => {
      const chip = document.createElement("button");
      chip.className = "chip" + (ginfo.vehActive === gName ? " active" : "");
      chip.textContent = gName;
      chip.addEventListener("click", () => {
        ginfo.vehActive = gName;
        saveAsignacionActual();
        renderVehiculos();
      });
      grpRow.appendChild(chip);
    });

    headerBox.appendChild(grpRow);
  }

  vehiculosLeftEl.appendChild(headerBox);

  const cellulasList = document.createElement("div");
  cellulasList.className = "leftPeopleList";

  const cellsForCET = state.asignacionCelulas[cet] || [];

  let cellsToShow = [];
  if (ginfo.vehActive) {
    const set = ginfo.map[ginfo.vehActive] || new Set();
    const arr = Array.from(set);
    cellsToShow = arr.filter(c => cellsForCET.some(p => (p.nombre ?? p) === c));
  } else {
    // Modo Sin Grupo: mostrar solo los que no están en ningún subgrupo
    cellsToShow = cellsForCET.filter(c => !getGrupoDeCelula(cet, c));
  }

  const visibleKeys = cellsToShow.map(c => `${cet}-${c}`);
  const unlockedVisible = visibleKeys.filter(k => !getNombreVehiculoAsignado(k));

  if (visibleKeys.length > 0) {
    const allSelectedVisible =
      unlockedVisible.length > 0 &&
      unlockedVisible.every(k => (state.selectedCells || []).includes(k));

    const someSelectedVisible =
      unlockedVisible.some(k => (state.selectedCells || []).includes(k));

    const rowAll = mkCheckRow({
      labelText: "Seleccionar todo lo visible",
      valueKey: `${cet}::allVisible`,
      disabled: unlockedVisible.length === 0,
      checked: allSelectedVisible,
      onChange: (checked) => {
        const set = new Set(state.selectedCells || []);
        if (checked) unlockedVisible.forEach(k => set.add(k));
        else unlockedVisible.forEach(k => set.delete(k));
        state.selectedCells = Array.from(set);
        renderVehiculos();
      }
    });

    rowAll.querySelector("input").indeterminate = (!allSelectedVisible && someSelectedVisible);
    cellulasList.insertBefore(rowAll, cellulasList.firstChild);
  }

  cellsToShow.forEach(cell => {
    const key = `${cet}-${cell}`;
    const assignedVehicle = getNombreVehiculoAsignado(key);
    const assignedToSelectedVehicle = keysAsignadosAlVehiculoSeleccionado.has(key);
    const isLocked = !!assignedVehicle && !assignedToSelectedVehicle;

    // Obtener etiqueta de grupo
    const gName = getGrupoDeCelula(cet, cell);
    const gLabel = gName ? `Grupo ${gName}` : "Sin grupo";

    cellulasList.appendChild(
      mkCheckRow({
        labelText: isLocked 
          ? `${getPersonDisplayName(cell)} (Asignado: ${assignedVehicle})` 
          : getPersonDisplayName(cell),
        valueKey: key,
        disabled: isLocked,
        checked: assignedToSelectedVehicle || (state.selectedCells || []).includes(key),
        onChange: (checked) => {
          if (!checked && assignedToSelectedVehicle) {
            removerAsignacionPorKey(key);
            toggleSelectedKey(key, false);
            saveAsignacionActual();
            renderVehiculos();
            return;
          }
          toggleSelectedKey(key, checked);
          renderVehiculos();
        }
      })
    );
  });

  vehiculosLeftEl.appendChild(cellulasList);

  const vehiclesWrap = document.createElement("div");
  vehiclesWrap.className = "listBox vehicleListBox";

  const vehicleGrid = document.createElement("div");
  vehicleGrid.className = "vehicleGrid";
  vehicleGrid.addEventListener("scroll", () => {
    state.vehiculosGridScrollTop = vehicleGrid.scrollTop;
  });

  state.vehiclesList.forEach((vehicle) => {
    const card = document.createElement("div");
    card.className = "vehicleCard";
    card.style.cursor = "pointer";

    const used = vehCount[vehicle.name] || 0;
    const cap = Number(vehicle.capacity || 0);
    const isFull = cap > 0 && used >= cap;
    const isAssignedInCurrentOp = state.asignacionVehiculos.some(a => a.id_vehiculo === vehicle.id);
    const fueLiberadoLocalmente = state.vehiculosLiberadosLocalmente.includes(vehicle.id);
    const isEnOperacion = !isAssignedInCurrentOp && !fueLiberadoLocalmente && vehicle.status && vehicle.status !== "DISPONIBLE";
    const isDisabled = isEnOperacion;

    const isSelected = state.selectedVehicle === vehicle.name;
    if (isSelected) card.classList.add("selected");
    if (isDisabled) {
      card.classList.add("disabled");
      card.style.cursor = "not-allowed";
    }

    const img = document.createElement("img");
    img.src = vehicle.image || "";
    img.alt = vehicle.name;

    const nameP = document.createElement("p");
    nameP.textContent = vehicle.name;

    const capP = document.createElement("p");
    capP.className = "vehicleMeta";

    if (isEnOperacion) {
      capP.textContent = "En operación";
      capP.classList.add("danger");
    } else if (isAssignedInCurrentOp) {
      capP.textContent = `Asignado | Capacidad: ${used}/${cap || 0}`;
      capP.classList.add("success");
    } else {
      capP.textContent = `Capacidad: ${used}/${cap || 0}`;
    }

    card.appendChild(img);
    card.appendChild(nameP);
    card.appendChild(capP);

    card.addEventListener("click", () => {
      if (isDisabled) return;
      if (state.selectedVehicle === vehicle.name) {
        state.selectedVehicle = null;
      } else {
        state.selectedVehicle = vehicle.name;
      }
      renderVehiculos();
    });

    vehicleGrid.appendChild(card);
  });

  vehiclesWrap.appendChild(vehicleGrid);
  panel.appendChild(vehiclesWrap);
  restoreScrollTop(vehicleGrid, state.vehiculosGridScrollTop || 0);

  // Función para intentar asignación automática
  function tryAutoAssignment() {
    if (!state.selectedVehicle) return false;

    const selected = (state.selectedCells || []).filter(k => {
      if (k.includes("::")) return false;
      if (state.cetSeleccionados.includes(k)) return true;
      if (k.includes("-")) return true;
      return false;
    }).filter(k => !keysAsignadosAlVehiculoSeleccionado.has(k));

    if (selected.length === 0) return false;

    const vehObj = state.vehiclesList.find(v => v.name === state.selectedVehicle);
    if (!vehObj) return false;

    const used = state.asignacionVehiculos.filter(a => a.id_vehiculo === vehObj.id).length;
    const cap = Number(vehObj.capacity || 0);
    const remainingNow = cap - used;

    const locked = selected.filter(k => getNombreVehiculoAsignado(k));
    if (locked.length > 0) return false;

    if (selected.length > remainingNow) return false;

    // Asignar automáticamente
    selected.forEach((key) => {
      const parts = key.split('-');
      const cet = parts[0];
      const celula = parts[1] || null;

      if (celula) {
        const idPersonal = state.personalMap[celula];
        if (idPersonal) {
          asignarVehiculo(vehObj.id, 'personal', idPersonal);
          state.vehiculosLiberadosLocalmente = state.vehiculosLiberadosLocalmente.filter(id => id !== vehObj.id);
        }
      } else {
        const idCet = state.personalMap[cet];
        if (idCet) {
          asignarVehiculo(vehObj.id, 'personal', idCet);
          state.vehiculosLiberadosLocalmente = state.vehiculosLiberadosLocalmente.filter(id => id !== vehObj.id);
        }
      }
    });

    state.selectedVehicle = null;
    state.selectedCells = [];
    renderVehiculos();
    return true;
  }

  // Intentar asignación automática
  if (tryAutoAssignment()) return;

  btnAccion.onclick = async () => {
    if (hasGroups && groupIndex < lastGroupIndex) {
      ginfo.vehActive = ginfo.names[groupIndex + 1];
      saveAsignacionActual();
      renderVehiculos();
      return;
    }

    if (activeOrderIndex < orderedCetsForVehiculos.length - 1) {
      const next = orderedCetsForVehiculos[activeOrderIndex + 1];
      state.cetActivoIndexVeh = next.index;

      const nextCet = next.name;
      const ngi = state.gruposByCet[nextCet] || structuredClone(DEFAULT_GROUP_INFO);
      state.gruposByCet[nextCet] = ngi;

      const hasNextGroups = (ngi.names || []).length > 0;
      if (hasNextGroups) {
        if (!ngi.vehActive || !ngi.names.includes(ngi.vehActive)) {
          ngi.vehActive =
            (ngi.active && ngi.names.includes(ngi.active))
              ? ngi.active
              : ngi.names[0];
        }
      } else {
        ngi.vehActive = null;
      }

      saveAsignacionActual();
      renderVehiculos();
      return;
    }

    // --- BLOQUE FINALIZAR: AUTO-GUARDADO DE CABECERA ---
    // Si llegó hasta aquí, significa que ya pasó el último grupo y el último CET (isLastOverall es true)
    try {
        const opLoc = readObjectStorage(STORAGE_OPERACION_ACTUAL, {});
        const fromForm = collectOperacionActual();
        const opDB = await guardarOperacionBaseDatos(fromForm, { 
            id_operacion: opLoc.id || null, 
            estado_operacion: opLoc.estado || 'PLANIFICADA' 
        });
        
        if (opDB && opDB.id_operacion && !opLoc.id) {
           opLoc.id = opDB.id_operacion;
           if (opDB.estado) opLoc.estado = opDB.estado;
           writeStorage(STORAGE_OPERACION_ACTUAL, opLoc);
        }
    } catch (e) {
        console.error("Fallo auto-guardado de operación en BD desde Vehículos:", e);
    }

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
        (ginfo.names && ginfo.names.length > 0) ? ginfo.names[0] : null;
    } else {
      state.equipoSelectedGrupo = null;
    }

    saveAsignacionActual();
    renderEquipoAsignacion();
  };
}
