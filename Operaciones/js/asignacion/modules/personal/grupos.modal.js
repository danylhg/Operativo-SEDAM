import { state } from "../../core/state.js";
import { saveAsignacionActual } from "../asignacion/asignacion.service.js";
import { renderCelulas } from "./personal.views.js";

const logAlert = (message) => {
  if (message) alert(message);
};

export function abrirModalCrearGrupo(cetActivo) {
  const info = state.gruposByCet[cetActivo] || {
    names: [],
    active: null,
    map: {},
    idx: 0,
    vehActive: null
  };

  const overlay = document.createElement("div");
  overlay.className = "groupModalOverlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const modal = document.createElement("div");
  modal.className = "groupModalCard";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "groupModalTitle");

  const title = document.createElement("div");
  title.id = "groupModalTitle";
  title.className = "groupModalTitle";
  title.textContent = "Crear grupos";

  const row1 = document.createElement("div");
  row1.className = "groupModalCountRow";

  const lbl = document.createElement("label");
  lbl.className = "groupModalLabel";
  lbl.textContent = "Cuantos";

  const inpNum = document.createElement("input");
  inpNum.type = "number";
  inpNum.min = "1";
  inpNum.id = "groupModalCount";
  inpNum.className = "inp groupModalCountInput";
  inpNum.value = info.names.length || "";
  lbl.setAttribute("for", inpNum.id);

  row1.append(lbl, inpNum);

  const formWrap = document.createElement("div");
  formWrap.className = "groupModalFields";

  const btnRow = document.createElement("div");
  btnRow.className = "groupModalActions";

  const btnCancel = document.createElement("button");
  btnCancel.className = "btnGhost";
  btnCancel.textContent = "Cancelar";
  btnCancel.addEventListener("click", () => overlay.remove());

  const btnCreate = document.createElement("button");
  btnCreate.className = "btnPrimary";
  btnCreate.textContent = "Guardar grupos";

  let nameInputs = [];
  let draftNames = [...info.names];

  function syncDraftNamesFromInputs() {
    nameInputs.forEach((input, index) => {
      draftNames[index] = input.value;
    });
  }

  function buildFields() {
    syncDraftNamesFromInputs();
    formWrap.innerHTML = "";
    nameInputs = [];

    const n = Number(inpNum.value || 0);
    if (!n || n < 1) return;

    for (let i = 0; i < n; i++) {
      const line = document.createElement("div");
      line.className = "groupModalFieldRow";

      const l = document.createElement("label");
      l.className = "groupModalLabel";
      l.textContent = `Nombre grupo ${i + 1}`;

      const inp = document.createElement("input");
      inp.className = "inp";
      inp.id = `groupModalName${i}`;
      l.setAttribute("for", inp.id);
      inp.value = draftNames[i] || "";
      inp.addEventListener("input", () => {
        draftNames[i] = inp.value;
      });
      nameInputs.push(inp);

      line.append(l, inp);
      formWrap.appendChild(line);
    }
  }

  inpNum.addEventListener("input", buildFields);
  if (info.names.length > 0) buildFields();

  btnCreate.addEventListener("click", () => {
    const names = nameInputs.map(i => i.value.trim()).filter(Boolean);
    const nExpected = Number(inpNum.value || 0);

    if (!nExpected || nExpected < 1) {
      logAlert("Pon un número válido en 'Cuantos'.");
      return;
    }

    if (names.length !== nExpected) {
      logAlert("Completa todos los nombres de grupo.");
      return;
    }

    const normalizedNewNames = names.map(name => name.toLowerCase());
    const hasDuplicateInModal = normalizedNewNames.some((name, index) => normalizedNewNames.indexOf(name) !== index);
    if (hasDuplicateInModal) {
      logAlert("No puede haber más de un grupo con el mismo nombre.");
      return;
    }

    const reservedNames = new Set(["mando operativo", "sin grupo"]);
    if (normalizedNewNames.some(name => reservedNames.has(name))) {
      logAlert("Ese nombre está reservado.");
      return;
    }

    const flotillaNames = Object.values(state.flotillaByCet || {})
      .map(name => String(name || "").trim().toLowerCase())
      .filter(Boolean);

    if (normalizedNewNames.some(name => flotillaNames.includes(name))) {
      logAlert("Un grupo no puede llamarse igual que una flotilla.");
      return;
    }

    const oldNames = info.names;
    const oldMap = info.map;
    const newMap = {};

    names.forEach((name, i) => {
      const originalName = oldNames[i];
      if (originalName) {
        newMap[name] = oldMap[originalName] || new Set();
      } else {
        newMap[name] = new Set();
      }
    });

    if (info.active) {
      const activeIdx = oldNames.indexOf(info.active);
      if (activeIdx !== -1 && activeIdx < names.length) {
        info.active = names[activeIdx];
      } else {
        info.active = names.length > 0 ? names[0] : null;
      }
    } else if (names.length > 0) {
      info.active = names[0];
    }

    if (info.vehActive) {
      const vActiveIdx = oldNames.indexOf(info.vehActive);
      if (vActiveIdx !== -1 && vActiveIdx < names.length) {
        info.vehActive = names[vActiveIdx];
      } else {
        info.vehActive = info.active;
      }
    } else {
      info.vehActive = info.active;
    }

    info.names = names;
    info.map = newMap;
    info.idx = Math.max(0, info.names.indexOf(info.active));

    state.gruposByCet[cetActivo] = info;
    saveAsignacionActual();
    overlay.remove();
    renderCelulas();
  });

  btnRow.append(btnCancel, btnCreate);
  modal.append(title, row1, formWrap, btnRow);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  if (!inpNum.value) inpNum.focus();
}
