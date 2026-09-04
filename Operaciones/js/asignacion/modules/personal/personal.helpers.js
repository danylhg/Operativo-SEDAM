import { state } from '../../core/state.js';

export function getGrupoDeCelula(cet, celula) {
  const ginfo = state.gruposByCet[cet];
  if (!ginfo || !ginfo.map) return "";

  for (const gName of Object.keys(ginfo.map)) {
    const set = ginfo.map[gName];
    if (set && set.has(celula)) return gName;
  }
  return "";
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

export function getPersonDisplayName(key) {
  const person = getPersonDetails(key);
  return [abbreviatePuesto(person.puesto), person.nombre, person.apellido].filter(Boolean).join(" ").trim() || key;
}

export function celulaRow({ name, selected = false, disabled = false, status = "Disponible", onToggle }) {
  const row = document.createElement("div");
  row.className = "item" + (selected ? " selected" : "") + (disabled ? " disabled" : "");

  const left = document.createElement("div");
  left.className = "personIdentity";

  const title = document.createElement("div");
  title.className = "itemName";
  title.textContent = getPersonDisplayName(name);
  left.appendChild(title);

  const right = document.createElement("div");
  right.className = "badgeRight";
  right.textContent = status;

  row.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) onToggle();
  });

  row.append(left, right);
  return row;
}
