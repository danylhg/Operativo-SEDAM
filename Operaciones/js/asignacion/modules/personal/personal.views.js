import { panel, btnAccion } from "../../core/dom.js";
import { state } from "../../core/state.js";
import {
  showOperacionInfo,
  setHeader,
  setAccion,
  showBack,
  clearPanel,
  getScrollTopInPanel,
  restoreScrollTop
} from "../../core/ui.js";
import { DEFAULT_GROUP_INFO, STORAGE_OPERACION_ACTUAL } from "../../core/constants.js";
import { readObjectStorage, writeStorage } from "../../core/storage.js";
import { celulaRow, getGrupoDeCelula } from "./personal.helpers.js";
import { saveAsignacionActual } from "../asignacion/asignacion.service.js";
import { abrirModalCrearGrupo } from "./grupos.modal.js";
import { renderVehiculos } from "../vehiculos/vehiculos.view.js";
import { guardarOperacionBaseDatos, collectOperacionActual, validarOperacionInfo, syncOperacionCompleta } from "../operacion/operacion.service.js";

function clearFlotillaValidation() {
  delete state.flotillaErrorByCet;
}

function setFlotillaValidation(cetNombre, message) {
  state.flotillaErrorByCet = { cet: cetNombre, message };
}

function getPersonDetails(key) {
  return state.personalDetails?.[key] || { apodo: key };
}

function getPersonDisplayName(key) {
  const person = getPersonDetails(key);
  return [person.puesto, person.nombre, person.apellido].filter(Boolean).join(" ").trim() || key;
}

function getPersonSearchText(key) {
  const person = getPersonDetails(key);
  return [
    key,
    person.apodo,
    person.puesto,
    person.nombre,
    person.apellido,
    person.rol,
    getPersonDisplayName(key)
  ].filter(Boolean).join(" ").toLowerCase();
}

function appendPersonIdentity(row, key) {
  const wrap = document.createElement("div");
  wrap.className = "personIdentity";

  const name = document.createElement("div");
  name.className = "itemName";
  name.textContent = getPersonDisplayName(key);
  wrap.appendChild(name);

  row.appendChild(wrap);
}

function limpiarAsignacionesDependientesDePersonal(nombrePersonal) {
  const idPersonal = state.personalMap[nombrePersonal];
  if (!idPersonal) return;

  const vehiculosLiberados = new Set();
  state.asignacionVehiculos
    .filter(a => a.id_personal === idPersonal)
    .forEach(a => {
      const quedan = state.asignacionVehiculos.some(other => other !== a && other.id_vehiculo === a.id_vehiculo);
      if (!quedan) vehiculosLiberados.add(a.id_vehiculo);
    });

  state.asignacionVehiculos = state.asignacionVehiculos.filter(a => a.id_personal !== idPersonal);
  vehiculosLiberados.forEach(idVehiculo => {
    if (!state.vehiculosLiberadosLocalmente.includes(idVehiculo)) {
      state.vehiculosLiberadosLocalmente.push(idVehiculo);
    }
  });

  const equiposLiberados = state.asignacionEquipos
    .filter(a => a.id_personal === idPersonal)
    .map(a => a.id_equipo);

  state.asignacionEquipos = state.asignacionEquipos.filter(a => a.id_personal !== idPersonal);
  equiposLiberados.forEach(idEquipo => {
    if (!state.equiposLiberadosLocalmente.includes(idEquipo)) {
      state.equiposLiberadosLocalmente.push(idEquipo);
    }
  });

  const dispositivosLiberados = state.asignacionDispositivos
    .filter(a => a.id_personal === idPersonal)
    .map(a => a.id_dispositivo);

  state.asignacionDispositivos = state.asignacionDispositivos.filter(a => a.id_personal !== idPersonal);
  dispositivosLiberados.forEach(idDispositivo => {
    if (!state.dispositivosLiberadosLocalmente.includes(idDispositivo)) {
      state.dispositivosLiberadosLocalmente.push(idDispositivo);
    }
  });
}

export function renderCUT() {
  showOperacionInfo();
  const prevScroll = getScrollTopInPanel();
  clearPanel();
  panel.classList.add("personasPanel");
  showBack(true);

  setHeader("Comandante de Unidad Táctica", "");
  setAccion("Siguiente", !state.cutSeleccionado);

  const listBox = document.createElement("div");
  listBox.className = "listBox personasListBox";

  const search = document.createElement("input");
  search.className = "inp searchCompact";
  search.placeholder = "Buscar CUT...";
  search.style.marginBottom = "10px";

  const data = state.cutList.slice();

  const rowsWrap = document.createElement("div");
  rowsWrap.className = "personasScroll";
  rowsWrap.style.display = "flex";
  rowsWrap.style.flexDirection = "column";
  rowsWrap.style.gap = "14px";

  function paint(filterText) {
    const ft = (filterText || "").toLowerCase().trim();
    rowsWrap.innerHTML = "";

    data
      .filter(n => !ft || getPersonSearchText(n).includes(ft))
      .forEach((name) => {
        const enOp = state.personalEnOperacion?.[name];
        const row = document.createElement("div");
        row.className = "item"
          + (state.cutSeleccionado === name ? " selected" : "")
          + (enOp ? " disabled" : "");
        row.style.cursor = enOp ? "not-allowed" : "pointer";

        const selectCut = () => {
          if (enOp) return;
          state.cutSeleccionado = name;
          state.cetSeleccionados = [];
          state.cetActivoIndex = 0;
          state.asignacionCelulas = {};
          saveAsignacionActual(); // BACKEND: saveAsignacionActual() se vuelve async con POST /ops/:id/personal, /grupos, /vehiculos, /equipos
          renderCUT();
        };

        row.addEventListener("click", selectCut);

        appendPersonIdentity(row, name);

        if (enOp) {
          const badge = document.createElement("div");
          badge.className = "badgeRight";
          badge.textContent = `En op: ${enOp}`;
          row.appendChild(badge);
        }

        rowsWrap.appendChild(row);
      });
  }

  search.addEventListener("input", () => paint(search.value));

  listBox.appendChild(search);
  listBox.appendChild(rowsWrap);
  panel.appendChild(listBox);

  paint("");
  restoreScrollTop(listBox, prevScroll);

  btnAccion.onclick = () => {
    if (!validarOperacionInfo()) return;
    if (!state.cutSeleccionado) return;
    saveAsignacionActual();
    state.pasoPersonal = "cet";
    renderCET();
  };
}

export function renderCET() {
  showOperacionInfo();
  const prevScroll = getScrollTopInPanel();
  clearPanel();
  panel.classList.add("personasPanel");
  showBack(true);

  setHeader("Comandante de Equipo de Trabajo", "");
  setAccion("Siguiente", state.cetSeleccionados.length === 0);

  const chips = document.createElement("div");
  chips.className = "chipRow";

  const cutChip = document.createElement("div");
  cutChip.className = "chip navChip";
  cutChip.textContent = `CUT: ${state.cutSeleccionado || "—"}`;
  cutChip.textContent = `CUT: ${state.cutSeleccionado ? getPersonDisplayName(state.cutSeleccionado) : "-"}`;
  cutChip.addEventListener("click", () => {
    state.pasoPersonal = "cut";
    saveAsignacionActual();
    renderCUT();
  });
  chips.appendChild(cutChip);

  state.cetSeleccionados.forEach((n) => {
    const c = document.createElement("div");
    c.className = "chip active";
    c.textContent = `CET: ${n}`;
    c.textContent = `CET: ${getPersonDisplayName(n)}`;
    chips.appendChild(c);
  });

  panel.appendChild(chips);

  const listBox = document.createElement("div");
  listBox.className = "listBox personasListBox";

  const search = document.createElement("input");
  search.className = "inp searchCompact";
  search.placeholder = "Buscar CET...";
  search.style.marginBottom = "10px";

  const data = state.cetList.slice();

  const rowsWrap = document.createElement("div");
  rowsWrap.className = "personasScroll";
  rowsWrap.style.display = "flex";
  rowsWrap.style.flexDirection = "column";
  rowsWrap.style.gap = "14px";

  function paint(filterText) {
    const ft = (filterText || "").toLowerCase().trim();
    rowsWrap.innerHTML = "";

    data
      .filter(n => !ft || getPersonSearchText(n).includes(ft))
      .forEach((name) => {
        const isSel = state.cetSeleccionados.includes(name);
        const enOp = state.personalEnOperacion?.[name];

        const row = document.createElement("div");
        row.className = "item"
          + (isSel ? " selected" : "")
          + (enOp ? " disabled" : "");
        row.style.cursor = enOp ? "not-allowed" : "pointer";

        const toggleCet = () => {
          if (enOp) return;
          if (isSel) {
            limpiarAsignacionesDependientesDePersonal(name);
            (state.asignacionCelulas[name] || []).forEach(cel => limpiarAsignacionesDependientesDePersonal(cel));
            state.cetSeleccionados = state.cetSeleccionados.filter(n => n !== name);
            delete state.asignacionCelulas[name];
            delete state.flotillaByCet[name];
            delete state.searchByCet[name];
            delete state.gruposByCet[name];
          } else {
            state.cetSeleccionados.push(name);

            if (!state.flotillaByCet[name]) state.flotillaByCet[name] = "";
            if (!state.searchByCet[name]) state.searchByCet[name] = "";
            if (!state.gruposByCet[name]) {
              state.gruposByCet[name] = { names: [], active: null, map: {}, idx: 0, vehActive: null };
            } else {
              if (state.gruposByCet[name].idx === undefined) state.gruposByCet[name].idx = 0;
              if (state.gruposByCet[name].vehActive === undefined) state.gruposByCet[name].vehActive = null;
            }
          }
          saveAsignacionActual(); // BACKEND: saveAsignacionActual() se vuelve async con POST /ops/:id/personal, /grupos, /vehiculos, /equipos
          renderCET();
        };

        row.addEventListener("click", toggleCet);

        appendPersonIdentity(row, name);

        if (enOp) {
          const badge = document.createElement("div");
          badge.className = "badgeRight";
          badge.textContent = `En op: ${enOp}`;
          row.appendChild(badge);
        }

        rowsWrap.appendChild(row);
      });
  }

  search.addEventListener("input", () => paint(search.value));

  listBox.appendChild(search);
  listBox.appendChild(rowsWrap);
  panel.appendChild(listBox);

  paint("");
  restoreScrollTop(listBox, prevScroll);

  btnAccion.onclick = () => {
    if (!validarOperacionInfo()) return;
    if (state.cetSeleccionados.length === 0) return;

    state.cetSeleccionados.forEach(n => {
      if (!state.asignacionCelulas[n]) state.asignacionCelulas[n] = [];
      if (state.flotillaByCet[n] === undefined) state.flotillaByCet[n] = "";
      if (state.searchByCet[n] === undefined) state.searchByCet[n] = "";
      if (!state.gruposByCet[n]) state.gruposByCet[n] = { names: [], active: null, map: {}, idx: 0, vehActive: null };
      if (state.gruposByCet[n].idx === undefined) state.gruposByCet[n].idx = 0;
      if (state.gruposByCet[n].vehActive === undefined) state.gruposByCet[n].vehActive = null;
    });

    saveAsignacionActual();

    state.pasoPersonal = "celulas";
    state.cetActivoIndex = 0;

    const firstCet = state.cetSeleccionados[0];
    const gi = state.gruposByCet[firstCet];
    if (gi && (gi.names || []).length > 0) {
      gi.idx = Math.max(0, Math.min(gi.idx || 0, gi.names.length - 1));
      gi.active = gi.names[gi.idx];
      if (!gi.vehActive) gi.vehActive = gi.active;
    }

    renderCelulas();
  };
}

export function pintarChipsGrupos(cet, container) {
  container.innerHTML = "";

  const info = state.gruposByCet[cet] || { names: [], active: null, map: {}, idx: 0, vehActive: null };
  if (info.idx === undefined) info.idx = 0;
  if (info.vehActive === undefined) info.vehActive = null;

  const hasGroups = (info.names || []).length > 0;
  if (hasGroups) {
    info.idx = Math.max(0, Math.min(info.idx, info.names.length - 1));
    // Solo corregir info.active si apunta a un grupo que ya no existe
    // null ("Sin grupo") es un estado válido aunque haya grupos
    if (info.active && !info.names.includes(info.active)) {
      info.active = null;
    }
    if (!info.vehActive) info.vehActive = info.active;
  } else {
    info.active = null;
    info.idx = 0;
    info.vehActive = null;
  }

  state.gruposByCet[cet] = info;

  // Botones de grupos (a, b, ...)
  info.names.forEach((gName, index) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (info.active === gName ? " active" : "");
    chip.textContent = gName;

    chip.addEventListener("click", () => {
      info.idx = index;
      info.active = gName;
      saveAsignacionActual();
      renderCelulas();
    });

    container.appendChild(chip);
  });

  // BOTÓN EXTRA: "Sin grupo" (Mando Directo)
  if (hasGroups) {
    const sinGrupoBtn = document.createElement("button");
    sinGrupoBtn.className = "chip" + (info.active === null ? " active" : "");
    sinGrupoBtn.textContent = "Sin grupo";
    
    sinGrupoBtn.addEventListener("click", () => {
      info.active = null; // Modo Mando Directo
      saveAsignacionActual();
      renderCelulas();
    });
    container.appendChild(sinGrupoBtn);
  }
}

export function renderCelulas() {
  showOperacionInfo();
  const prevScroll = getScrollTopInPanel();
  clearPanel();
  panel.classList.add("personasPanel");
  showBack(true);

  const cetActivo = state.cetSeleccionados[state.cetActivoIndex];
  const asignadas = state.asignacionCelulas[cetActivo] || [];

  if (!state.gruposByCet[cetActivo]) {
    state.gruposByCet[cetActivo] = { names: [], active: null, map: {}, idx: 0, vehActive: null };
  }

  const info = state.gruposByCet[cetActivo];
  if (info.idx === undefined) info.idx = 0;
  if (info.vehActive === undefined) info.vehActive = null;

  const hasGroups = (info.names || []).length > 0;
  if (hasGroups) {
    info.idx = Math.max(0, Math.min(info.idx, info.names.length - 1));
    // null ("Sin grupo") es válido aunque haya grupos — no forzar a un grupo
    if (info.active && !info.names.includes(info.active)) {
      info.active = null;
    }
    if (!info.vehActive) info.vehActive = info.active;
  } else {
    info.active = null;
    info.idx = 0;
    info.vehActive = null;
  }

  setHeader("Célula", "");

  const lastCet = state.cetActivoIndex === state.cetSeleccionados.length - 1;
  const lastGroup = !hasGroups ? true : (info.idx === info.names.length - 1);
  setAccion((lastCet && lastGroup) ? "Finalizar" : "Siguiente", false);

  const chips = document.createElement("div");
  chips.className = "chipRow";

  const cutChip = document.createElement("div");
  cutChip.className = "chip navChip";
  cutChip.textContent = `CUT: ${state.cutSeleccionado || "—"}`;
  cutChip.textContent = `CUT: ${state.cutSeleccionado ? getPersonDisplayName(state.cutSeleccionado) : "-"}`;
  cutChip.addEventListener("click", () => {
    state.pasoPersonal = "cut";
    saveAsignacionActual();
    renderCUT();
  });
  chips.appendChild(cutChip);

  state.cetSeleccionados.forEach((n, i) => {
    const c = document.createElement("div");
    c.className = "chip" + (i === state.cetActivoIndex ? " active" : "");
    c.textContent = `CET: ${n}`;
    c.textContent = `CET: ${getPersonDisplayName(n)}`;
    c.addEventListener("click", () => {
      state.cetActivoIndex = i;

      const gi = state.gruposByCet[n];
      if (gi) {
        if (gi.idx === undefined) gi.idx = 0;
        if (gi.vehActive === undefined) gi.vehActive = null;

        if ((gi.names || []).length > 0) {
          gi.idx = Math.max(0, Math.min(gi.idx, gi.names.length - 1));
          gi.active = gi.names[gi.idx];
          if (!gi.vehActive) gi.vehActive = gi.active;
        } else {
          gi.idx = 0;
          gi.active = null;
          gi.vehActive = null;
        }
      }

      saveAsignacionActual();
      renderCelulas();
    });
    chips.appendChild(c);
  });

  panel.appendChild(chips);

  const listBox = document.createElement("div");
  listBox.className = "listBox personasListBox";

  const sticky = document.createElement("div");
  sticky.className = "stickyTop";

  const flotillaRow = document.createElement("div");
  flotillaRow.className = "flotillaRow";

  const flotWrap = document.createElement("div");
  flotWrap.style.flex = "1";
  flotWrap.style.position = "relative";

  const flotLbl = document.createElement("div");
  flotLbl.className = "lbl";
  flotLbl.style.marginBottom = "6px";
  flotLbl.textContent = "Nombre de la flotilla";

  const flotInp = document.createElement("input");
  flotInp.className = "inp";
  flotInp.value = state.flotillaByCet[cetActivo] || "";
  flotInp.placeholder = "Nombre de la flotilla (obligatorio)";

  const flotError = document.createElement("div");
  flotError.style.cssText = "color:#dc2626;font-size:12px;position:absolute;bottom:-18px;left:0;display:none;white-space:nowrap;";
  flotError.textContent = "El nombre de la flotilla es obligatorio.";

  if (state.flotillaErrorByCet?.cet === cetActivo && state.flotillaErrorByCet?.message) {
    flotInp.style.borderColor = "#dc2626";
    flotError.textContent = state.flotillaErrorByCet.message;
    flotError.style.display = "block";
  }

  flotInp.addEventListener("input", () => {
    const hadOrder = Number.isFinite(state.flotillaOrderByCet?.[cetActivo]);
    state.flotillaByCet[cetActivo] = flotInp.value;
    if (flotInp.value.trim() && !hadOrder) {
      state.flotillaOrderByCet = state.flotillaOrderByCet || {};
      const nextOrder = Math.max(-1, ...Object.values(state.flotillaOrderByCet).filter(Number.isFinite)) + 1;
      state.flotillaOrderByCet[cetActivo] = nextOrder;
    }
    if (state.flotillaErrorByCet?.cet === cetActivo) clearFlotillaValidation();
    if (flotInp.value.trim()) {
      flotInp.style.borderColor = "";
      flotError.style.display = "none";
    }
    saveAsignacionActual(); // BACKEND: saveAsignacionActual() se vuelve async con POST /ops/:id/personal, /grupos, /vehiculos, /equipos
  });

  flotWrap.appendChild(flotLbl);
  flotWrap.appendChild(flotInp);
  flotWrap.appendChild(flotError);

  const btnCrearGrupo = document.createElement("button");
  btnCrearGrupo.className = "btnSoft";
  btnCrearGrupo.textContent = "Crear grupo";
  btnCrearGrupo.addEventListener("click", () => abrirModalCrearGrupo(cetActivo));

  const searchInp = document.createElement("input");
  searchInp.className = "inp searchCompact";
  searchInp.placeholder = "Buscar personal...";
  searchInp.value = state.searchByCet[cetActivo] || "";

  flotillaRow.appendChild(flotWrap);
  flotillaRow.appendChild(btnCrearGrupo);
  flotillaRow.appendChild(searchInp);

  const groupsRow = document.createElement("div");
  groupsRow.className = "groupsRow";
  pintarChipsGrupos(cetActivo, groupsRow);

  sticky.appendChild(flotillaRow);
  sticky.appendChild(groupsRow);

  listBox.appendChild(sticky);

  const rowsWrap = document.createElement("div");
  rowsWrap.className = "personasScroll";
  rowsWrap.style.display = "flex";
  rowsWrap.style.flexDirection = "column";
  rowsWrap.style.gap = "14px";

  const yaUsadas = new Set();
  state.cetSeleccionados.forEach((cet, i) => {
    if (i === state.cetActivoIndex) return;
    (state.asignacionCelulas[cet] || []).forEach(x => yaUsadas.add(x));
  });

  function paintCells() {
    const term = (state.searchByCet[cetActivo] || "").toLowerCase().trim();
    rowsWrap.innerHTML = "";

    state.celulasList
      .filter(cel => !term || getPersonSearchText(cel).includes(term))
      .forEach((cel) => {
        const enEste = asignadas.includes(cel);
        const bloqueada = yaUsadas.has(cel);
        const enOp = state.personalEnOperacion?.[cel];
        const disabled = bloqueada || !!enOp;

        const row = celulaRow({
          name: cel,
          selected: enEste,
          disabled,
          status: (() => {
            if (enOp) return `En op: ${enOp}`;
            if (bloqueada) return "Asignado";
            if (!enEste) return "Disponible";
            const gName = getGrupoDeCelula(cetActivo, cel);
            return gName ? `Grupo ${gName}` : "Sin grupo";
          })(),
          onToggle: () => {
            if (disabled) return;

            const grupoInfo = state.gruposByCet[cetActivo];
            const grupoActivo = grupoInfo?.active || null;
            const grupoActualDePersona = getGrupoDeCelula(cetActivo, cel) || null;

            if (enEste) {
              // Si ya está en el CET, evaluamos si movemos de grupo o desasignamos
              if (grupoActivo === grupoActualDePersona) {
                // Si el modo actual coincide con donde está: DESASIGNAR
                state.asignacionCelulas[cetActivo] = asignadas.filter(x => x !== cel);
                Object.keys(grupoInfo.map).forEach(g => grupoInfo.map[g]?.delete(cel));
                limpiarAsignacionesDependientesDePersonal(cel);
              } else {
                // Si el modo es distinto: MOVER (Primero quitamos de todos los grupos)
                Object.keys(grupoInfo.map).forEach(g => grupoInfo.map[g]?.delete(cel));
                // Y si el modo nuevo es un grupo real, lo metemos ahí
                if (grupoActivo) {
                  if (!grupoInfo.map[grupoActivo]) grupoInfo.map[grupoActivo] = new Set();
                  grupoInfo.map[grupoActivo].add(cel);
                }
              }
            } else {
              // SI NO ESTABA EN EL CET: ASIGNAR (Normal)
              state.asignacionCelulas[cetActivo] = [...asignadas, cel];
              if (grupoActivo) {
                if (!grupoInfo.map[grupoActivo]) grupoInfo.map[grupoActivo] = new Set();
                grupoInfo.map[grupoActivo].add(cel);
              }
            }

            saveAsignacionActual(); // BACKEND: saveAsignacionActual() se vuelve async con POST /ops/:id/personal, /grupos, /vehiculos, /equipos
            renderCelulas();
          }
        });

        rowsWrap.appendChild(row);
      });
  }

  searchInp.addEventListener("input", () => {
    state.searchByCet[cetActivo] = searchInp.value;
    saveAsignacionActual(); // BACKEND: saveAsignacionActual() se vuelve async con POST /ops/:id/personal, /grupos, /vehiculos, /equipos
    paintCells();
  });

  listBox.appendChild(rowsWrap);
  panel.appendChild(listBox);

  paintCells();
  restoreScrollTop(listBox, prevScroll);

  btnAccion.onclick = async () => {
    if (!validarOperacionInfo()) return;

    // Validación estricta: Busca el primer CET que tenga su flotilla vacía
    const cetFaltanteIndex = state.cetSeleccionados.findIndex(n => !state.flotillaByCet[n] || !state.flotillaByCet[n].trim());

    const flotillasNormalizadas = state.cetSeleccionados
      .map(n => ({
        cet: n,
        flotilla: String(state.flotillaByCet[n] || "").trim()
      }))
      .filter(item => item.flotilla)
      .map(item => ({
        ...item,
        flotillaKey: item.flotilla.toLowerCase()
      }));

    const duplicateFlotilla = flotillasNormalizadas.find((item, index, arr) =>
      arr.findIndex(other => other.flotillaKey === item.flotillaKey) !== index
    );
    
    // Si hay un CET sin flotilla "Y" el usuario trata de irse o ese CET es el actual, bloqueamos
    if (cetFaltanteIndex !== -1) {
      // Si el faltante no es el activo, lo forzamos a navegar allá para avisarle
      if (cetFaltanteIndex !== state.cetActivoIndex) {
        state.cetActivoIndex = cetFaltanteIndex;
        setFlotillaValidation(state.cetSeleccionados[cetFaltanteIndex], "El nombre de la flotilla es obligatorio.");
        saveAsignacionActual();
        renderCelulas();
        return;
      }
      
      // Si el faltante es el actual, le mostramos el recuadro rojo clásico
      flotInp.style.borderColor = "#dc2626";
      flotError.style.display = "block";
      flotInp.focus();
      return;
    }

    if (duplicateFlotilla) {
      const duplicateCetIndex = state.cetSeleccionados.findIndex(n =>
        String(state.flotillaByCet[n] || "").trim().toLowerCase() === duplicateFlotilla.flotillaKey
      );

      if (duplicateCetIndex !== -1) {
        state.cetActivoIndex = duplicateCetIndex;
        setFlotillaValidation(state.cetSeleccionados[duplicateCetIndex], "No puede haber dos flotillas con el mismo nombre.");
        renderCelulas();
        return;
      }

      setFlotillaValidation(cetActivo, "No puede haber dos flotillas con el mismo nombre.");
      flotInp.style.borderColor = "#dc2626";
      flotError.textContent = "No puede haber dos flotillas con el mismo nombre.";
      flotError.style.display = "block";
      flotInp.focus();
      return;
    }

    clearFlotillaValidation();
    flotError.textContent = "El nombre de la flotilla es obligatorio.";
    flotError.style.display = "none";
    flotInp.style.borderColor = "";

    const gi = state.gruposByCet[cetActivo] || { names: [], active: null, map: {}, idx: 0, vehActive: null };
    const has = (gi.names || []).length > 0;

    // Detectamos si es el último paso "FINALIZAR" del panel de células
    const lastCet = (state.cetActivoIndex === state.cetSeleccionados.length - 1);
    const isFinalizar = (has && gi.idx >= gi.names.length - 1 && lastCet) || (!has && lastCet);

    if (isFinalizar) {
      try {
        const opLoc = readObjectStorage(STORAGE_OPERACION_ACTUAL, {});
        const fromForm = collectOperacionActual();
        // Dispara POST (si no hay ID) o PUT (si hay ID) silenciosamente
        const opDB = await guardarOperacionBaseDatos(fromForm, { 
            id_operacion: opLoc.id || null, 
            estado_operacion: opLoc.estado || 'PLANIFICADA' 
        });
        
        // Si fue una creación (POST) y nos regresó el ID, lo guardamos para futuros PUT
        if (opDB && opDB.id_operacion && !opLoc.id) {
           opLoc.id = opDB.id_operacion;
           if (opDB.estado) opLoc.estado = opDB.estado;
           writeStorage(STORAGE_OPERACION_ACTUAL, opLoc);
        }

        const finalOpId = opDB?.id_operacion || opLoc.id || null;
        if (finalOpId) {
          await syncOperacionCompleta(finalOpId);
        }
      } catch (e) {
        console.error("Fallo auto-guardado de operación en BD:", e);
      }
    }

    if (has) {
      if (gi.idx < gi.names.length - 1) {
        gi.idx += 1;
        gi.active = gi.names[gi.idx];
        if (!gi.vehActive) gi.vehActive = gi.active;
        saveAsignacionActual();
        renderCelulas();
        return;
      }

      if (state.cetActivoIndex < state.cetSeleccionados.length - 1) {
        state.cetActivoIndex += 1;
        const nextCet = state.cetSeleccionados[state.cetActivoIndex];
        const ngi = state.gruposByCet[nextCet];
        if (ngi) {
          if (ngi.idx === undefined) ngi.idx = 0;
          if (ngi.vehActive === undefined) ngi.vehActive = null;
          if ((ngi.names || []).length > 0) {
            ngi.idx = Math.max(0, Math.min(ngi.idx, ngi.names.length - 1));
            ngi.active = ngi.names[ngi.idx];
            if (!ngi.vehActive) ngi.vehActive = ngi.active;
          } else {
            ngi.idx = 0;
            ngi.active = null;
            ngi.vehActive = null;
          }
        }
        saveAsignacionActual();
        renderCelulas();
        return;
      }

      state.cetActivoIndexVeh = 0;
      state.selectedVehicle = null;
      state.selectedCells = [];
      state.pasoPersonal = "vehiculos";
      saveAsignacionActual();
      renderVehiculos();
      return;
    }

    if (state.cetActivoIndex < state.cetSeleccionados.length - 1) {
      state.cetActivoIndex += 1;
      saveAsignacionActual();
      renderCelulas();
    } else {
      state.cetActivoIndexVeh = 0;
      state.selectedVehicle = null;
      state.selectedCells = [];
      state.pasoPersonal = "vehiculos";
      saveAsignacionActual();
      renderVehiculos();
    }
  };
}
