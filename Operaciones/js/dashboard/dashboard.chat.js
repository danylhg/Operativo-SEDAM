// js/dashboard/dashboard.chat.js

import { dom } from "./dashboard.dom.js?v=20260728-web-alert-sound-4";
import { escapeHtml } from "./dashboard.storage.js";
import { formatTime } from "./dashboard.ui.js?v=20260923-draggable-person-popup";
import { getVehicleOccupants } from "./dashboard.tracking.clustering.js";
import {
  clearEmergencyForChatMessage,
  focusEmergencyForChatMessage,
  getEmergencyCoordsForChatMessage,
  pulseEmergencyForChatMessage
} from "./dashboard.emergency.js";

const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;

let _opId      = null;
let _socket    = null;
let _activeTab = "global";
let _channelType = "global";
let _channelTarget = "";
let _allMsgs   = [];             // todos los mensajes en memoria
let _chatDirectory = {
  cuts: [],
  cets: [],
  cells: [],
  flotillas: [],
  grupos: [],
  vehiculos: [],
  personalById: new Map()
};
let _mediaRecorder = null;
let _audioChunks = [];
let _isRecordingAudio = false;
let _emergencyTopBannerBound = false;
const _activeEmergencyAlerts = new Map();
let _alertAudioContext = null;
const _unreadByChannel = new Map();

const ATTACHMENT_PREFIX = "CHAT_ATTACHMENT:";
const GROUP_MEMBER_CHANNELS = new Set(["global", "cets", "flotilla", "grupo", "vehiculo"]);
const CHAT_AUDIO_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"></path>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
    <path d="M12 19v3"></path>
  </svg>
`;
const CHAT_STOP_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M8 8h8v8H8Z"></path>
  </svg>
`;

function getAlertAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!_alertAudioContext) _alertAudioContext = new AudioContextClass();
  return _alertAudioContext;
}

function armWebAlertAudio() {
  const unlock = () => {
    const context = getAlertAudioContext();
    if (!context) return;
    const activate = () => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.01);
    };
    if (context.state === "suspended") context.resume().then(activate).catch(() => {});
    else activate();
  };
  window.addEventListener("pointerdown", unlock, { once: true, passive: true });
  window.addEventListener("keydown", unlock, { once: true });
}

function playAlertTone(context) {
  const startedAt = context.currentTime + 0.02;
  [
    { offset: 0, frequency: 880 },
    { offset: 0.22, frequency: 660 },
    { offset: 0.44, frequency: 880 }
  ].forEach(({ offset, frequency }) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = startedAt + offset;
    const end = start + 0.16;

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.32, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end);
  });
}

function playWebAlertSound(msg) {
  if (!isEmergencyMessage(msg)) return;

  const context = getAlertAudioContext();
  if (!context) return;

  if (context.state === "suspended") {
    context.resume().then(() => playAlertTone(context)).catch(() => {});
  } else {
    playAlertTone(context);
  }
}

function setChatAudioButtonState(recording = false) {
  if (!dom.chatAudioBtn) return;
  dom.chatAudioBtn.innerHTML = recording ? CHAT_STOP_ICON : CHAT_AUDIO_ICON;
  dom.chatAudioBtn.title = recording ? "Detener grabación" : "Grabar audio";
  dom.chatAudioBtn.setAttribute("aria-label", recording ? "Detener grabación" : "Grabar audio");
}

// ── JWT helper ──────────────────────────────────────────────
function getMyInfo() {
  const token = localStorage.getItem("token");
  if (!token) return {};
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return { sub: payload.sub, tabla: payload.tabla };
  } catch { return {}; }
}

function isMine(msg) {
  const { sub, tabla } = getMyInfo();
  if (!sub) return false;
  if (tabla === "usuario")   return String(msg.id_usuario)  === String(sub);
  if (tabla === "personal")  return String(msg.id_personal) === String(sub);
  return false;
}

function messageChannelType(msg) {
  const destinoTipo = String(msg?.destino_tipo || "").toUpperCase();
  if (destinoTipo === "CETS") return "cets";
  if (destinoTipo === "CET" || destinoTipo === "CUT") return "cet_specific";
  if (destinoTipo === "CELL") return "cell_specific";
  if (destinoTipo === "FLOTILLA") return "flotilla";
  if (destinoTipo === "GRUPO") return "grupo";
  if (destinoTipo === "VEHICULO" || destinoTipo === "CELL_LIST") return "vehiculo";
  return "global";
}

function renderUnreadBadges() {
  let total = 0;
  document.querySelectorAll("[data-chat-channel]").forEach((button) => {
    const type = button.dataset.chatChannel || "global";
    const count = Number(_unreadByChannel.get(type) || 0);
    total += count;
    let badge = button.querySelector(".chatUnreadBadge");
    if (!badge && count > 0) {
      badge = document.createElement("span");
      badge.className = "chatUnreadBadge";
      badge.setAttribute("aria-label", "mensajes nuevos");
      button.appendChild(badge);
    }
    if (badge) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.hidden = count === 0;
    }
  });

  if (dom.toggleChatPanel) {
    let badge = dom.toggleChatPanel.querySelector(".chatToolUnreadBadge");
    if (!badge && total > 0) {
      badge = document.createElement("span");
      badge.className = "chatToolUnreadBadge";
      badge.setAttribute("aria-label", "mensajes nuevos");
      dom.toggleChatPanel.appendChild(badge);
    }
    if (badge) {
      badge.textContent = total > 99 ? "99+" : String(total);
      badge.hidden = total === 0;
    }
  }
}

function registerUnreadMessage(msg) {
  if (isMine(msg) || shouldHideChatMessage(msg)) return;
  const chatIsOpen = Boolean(dom.chatPanel?.classList.contains("open"));
  if (chatIsOpen && isVisibleInTab(msg)) return;
  const type = messageChannelType(msg);
  _unreadByChannel.set(type, Number(_unreadByChannel.get(type) || 0) + 1);
  renderUnreadBadges();
}

export function markActiveChatRead() {
  _unreadByChannel.delete(_channelType);
  renderUnreadBadges();
}

function comparable(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function sameValue(a, b) {
  const left = comparable(a);
  const right = comparable(b);
  return !!left && !!right && left === right;
}

function flotillaAliasesForTarget(flotillaId = _channelTarget) {
  const aliases = new Set();
  const add = (value) => {
    const text = String(value || "").trim();
    if (text) aliases.add(text);
  };

  const selected = _chatDirectory.flotillas.find((flotilla) =>
    sameValue(flotilla.id, flotillaId) || sameValue(flotilla.label, flotillaId)
  );

  add(flotillaId);
  add(selected?.id);
  add(selected?.label);

  _chatDirectory.personalById.forEach((person) => {
    const flotilla = getFlotillaForPerson(person);
    const belongsToSelected =
      sameValue(flotilla?.id, flotillaId) ||
      sameValue(flotilla?.label, flotillaId) ||
      sameValue(flotilla?.id, selected?.id) ||
      sameValue(flotilla?.label, selected?.label);

    if (belongsToSelected) {
      add(flotilla?.id);
      add(flotilla?.label);
      add(person?.grupo_padre_nombre);
      add(person?.grupo_padre_apodo);
      add(person?.grupo_nombre);
      add(person?.grupo_apodo);
      add(person?.cet_flotilla);
    }
  });

  return [...aliases];
}

function flotillaMessageMatchesTarget(msg, flotillaId = _channelTarget) {
  const tipo = String(msg.destino_tipo || "").toUpperCase();
  if (tipo !== "FLOTILLA") return false;

  const aliases = flotillaAliasesForTarget(flotillaId);
  return aliases.some((alias) =>
    sameValue(msg.destino_id, alias) || sameValue(msg.destino_label, alias)
  );
}

function cellBelongsToFlotilla(cellId, flotillaId) {
  const person = _chatDirectory.personalById.get(String(cellId));
  if (!person) return false;
  const flotilla = getFlotillaForPerson(person);
  return flotillaAliasesForTarget(flotillaId).some((alias) =>
    sameValue(flotilla?.id, alias) || sameValue(flotilla?.label, alias)
  );
}

function personBelongsToFlotilla(personId, flotillaId) {
  const person = _chatDirectory.personalById.get(String(personId));
  if (!person) return false;
  const flotilla = getFlotillaForPerson(person);
  return flotillaAliasesForTarget(flotillaId).some((alias) =>
    sameValue(flotilla?.id, alias) || sameValue(flotilla?.label, alias)
  );
}

// ── Visibilidad según tab activo ────────────────────────────
// Tab CET  → solo mensajes de ADMIN, CUT y CET
// Tab Global → todos
function isVisibleInTab(msg) {
  const destinatario = (msg.destinatario_rol || "GLOBAL").toUpperCase();
  const destinoTipo = String(msg.destino_tipo || "").toUpperCase();
  const destinoId = String(msg.destino_id || "");

  if (_channelType === "global") return destinatario === "GLOBAL" && !destinoTipo;
  if (_channelType === "cets") {
    return destinatario === "CET" && (!destinoTipo || destinoTipo === "CETS");
  }
  if (_channelType === "cuts") {
    return destinoTipo === "CUTS" || (destinatario === "CUT" && !destinoTipo);
  }
  if (_channelType === "cet_specific") {
    return (destinoTipo === "CET" && destinoId === String(_channelTarget))
      || (destinoTipo === "CELL" && String(msg.id_personal || "") === String(_channelTarget))
      || (destinoTipo === "CUT" && String(msg.id_personal || "") === String(_channelTarget));
  }
  if (_channelType === "cell_specific") {
    return (destinoTipo === "CELL" && destinoId === String(_channelTarget))
      || (destinoTipo === "CET" && String(msg.id_personal || "") === String(_channelTarget));
  }
  if (_channelType === "flotilla") {
    return flotillaMessageMatchesTarget(msg);
  }
  if (_channelType === "grupo") {
    return destinoTipo === "GRUPO" && grupoAliasesForTarget().some((alias) =>
      sameValue(destinoId, alias) || sameValue(msg.destino_label, alias)
    );
  }
  if (_channelType === "vehiculo") {
    return (destinoTipo === "VEHICULO" && sameValue(destinoId, _channelTarget))
      || cellListMatchesVehicle(msg);
  }
  if (_activeTab === "global") return destinatario === "GLOBAL";
  return destinatario === "CET" || destinatario === "CUT";
}

function splitDestinationIds(value) {
  return String(value || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function cellListMatchesVehicle(msg) {
  const destinoTipo = String(msg?.destino_tipo || "").toUpperCase();
  if (destinoTipo !== "CELL_LIST") return false;
  if (sameValue(msg.destino_label, getTargetLabel())) return true;

  const vehicleRecipientIds = new Set(getVehicleRecipientIds().map((id) => String(id)));
  if (!vehicleRecipientIds.size) return false;
  return splitDestinationIds(msg.destino_id).some((id) => vehicleRecipientIds.has(String(id)));
}

function normalizeRole(person) {
  return String(person?.rol_en_operacion || person?.rol || "").toUpperCase();
}

function fullName(person) {
  return person?.apodo ||
    person?.apodo_personal ||
    [person?.nombre, person?.apellido].filter(Boolean).join(" ").trim() ||
    `Personal ${person?.id_personal || ""}`.trim();
}

function abbreviateAlertRank(value) {
  const rank = String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!rank) return "";
  if (rank.includes("capitan de navio")) return "Cap. Nav.";
  if (rank.includes("capitan de fragata")) return "Cap. Frag.";
  if (rank.includes("capitan de corbeta")) return "Cap. Corb.";
  if (rank.includes("capitan primero") || rank.includes("capitan 1/o")) return "Cap. 1/o";
  if (rank.includes("capitan segundo") || rank.includes("capitan 2/o")) return "Cap. 2/o";
  if (rank.includes("teniente de navio")) return "Tte. Nav.";
  if (rank.includes("teniente de fragata")) return "Tte. Frag.";
  if (rank.includes("teniente de corbeta")) return "Tte. Corb.";
  if (rank.includes("primer teniente") || rank.includes("1er teniente")) return "1er. Tte.";
  if (rank.includes("segundo teniente") || rank.includes("2do teniente")) return "2do. Tte.";
  if (rank.includes("subteniente")) return "Subtte.";
  if (rank.includes("teniente") || rank === "tte" || rank === "tte.") return "Tte.";
  if (rank.includes("capitan") || rank === "cap" || rank === "cap.") return "Cap.";
  if (rank.includes("sargento primero")) return "Sgto. 1/o";
  if (rank.includes("sargento segundo")) return "Sgto. 2/o";
  if (rank.includes("sargento")) return "Sgto.";
  if (rank.includes("cabo")) return "Cbo.";
  if (rank.includes("soldado")) return "Sld.";
  if (rank.includes("marinero")) return "Mro.";
  if (rank.includes("general de division")) return "Gral. Div.";
  if (rank.includes("general de brigada")) return "Gral. Brig.";
  if (rank.includes("general")) return "Gral.";
  if (rank.includes("coronel")) return "Cnel.";
  if (rank.includes("mayor")) return "My.";
  return "";
}

function emergencyAuthorLabel(msg) {
  const person = _chatDirectory.personalById.get(String(msg?.id_personal ?? ""));
  const incoming = String(msg?.autor_nombre || "PERSONAL OPERATIVO").trim();
  const incomingParts = incoming.split(/\s*[-·|]\s*/).filter(Boolean);
  const incomingRank = abbreviateAlertRank(incomingParts[incomingParts.length - 1]);
  const name = person
    ? [person.nombre, person.apellido].filter(Boolean).join(" ").trim() || person.apodo || incoming
    : (incomingRank ? incomingParts.slice(0, -1).join(" ").trim() : incoming);
  const rank = abbreviateAlertRank(person?.puesto) || incomingRank;
  return [rank, name].filter(Boolean).join(" ") || "PERSONAL OPERATIVO";
}

function isRootGroupName(name) {
  return String(name || "").trim().toLowerCase() === "mando operativo";
}

function getFlotillaForPerson(person) {
  const cetFlotilla = person?.cet_flotilla || "";
  const parentName = person?.grupo_padre_nombre || person?.grupo_padre_apodo || "";
  const groupName = person?.grupo_nombre || person?.grupo_apodo || "";

  if (cetFlotilla) {
    return {
      id: String(person?.grupo_padre_id || cetFlotilla),
      label: cetFlotilla
    };
  }

  if (parentName && !isRootGroupName(parentName)) {
    return {
      id: String(person?.grupo_padre_id || parentName),
      label: parentName
    };
  }

  if (groupName) {
    return {
      id: String(person?.id_grupo_operacion || groupName),
      label: groupName
    };
  }

  return null;
}

function getGrupoForPerson(person) {
  const parentName = person?.grupo_padre_nombre || person?.grupo_padre_apodo || "";
  const groupName = person?.grupo_nombre || person?.grupo_apodo || "";
  if (!groupName || !parentName || isRootGroupName(parentName)) return null;

  return {
    id: String(person?.id_grupo_operacion || groupName),
    label: groupName,
    flotilla: parentName
  };
}

function uniqueById(items, keyFn = (item) => item?.id) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(keyFn(item) || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildChatDirectory(mapaData = {}) {
  const personal = Array.isArray(mapaData.personal) ? mapaData.personal : [];
  const vehiculosRaw = Array.isArray(mapaData.vehiculos) ? mapaData.vehiculos : [];
  const { sub, tabla } = getMyInfo();
  const currentPersonalId = tabla === "personal" ? String(sub || "") : "";

  const personalById = new Map();
  personal.forEach((p) => {
    if (p.id_personal != null) personalById.set(String(p.id_personal), p);
  });

  const cuts = personal
    .filter((p) => normalizeRole(p) === "CUT")
    .map((p) => ({ id: String(p.id_personal), label: fullName(p) }));

  const cets = personal
    .filter((p) => normalizeRole(p) === "CET" && String(p.id_personal) !== currentPersonalId)
    .map((p) => ({ id: String(p.id_personal), label: fullName(p) }));

  const cells = personal
    .filter((p) => normalizeRole(p) !== "CET" && String(p.id_personal) !== currentPersonalId)
    .map((p) => ({ id: String(p.id_personal), label: fullName(p) }));

  const flotillas = uniqueById(
    personal
      .map(getFlotillaForPerson)
      .filter(Boolean),
    (item) => item.label
  );

  const grupos = uniqueById(
    personal
      .map(getGrupoForPerson)
      .filter(Boolean)
  ).map((g) => ({
    ...g,
    label: g.flotilla ? `${g.label} (${g.flotilla})` : g.label
  }));

  const vehiculoMap = new Map();
  vehiculosRaw.forEach((v) => {
    const id = v.id_vehiculo ?? v.id ?? v.codigo_interno ?? v.alias;
    if (id == null) return;
    const key = String(id);
    if (!vehiculoMap.has(key)) {
      const name = v.alias ||
        v.codigo_interno ||
        v.tipo ||
        `Vehiculo ${id}`;
      vehiculoMap.set(key, { id: key, label: name, personIds: new Set() });
    }
    if (v.id_personal != null) {
      vehiculoMap.get(key).personIds.add(String(v.id_personal));
    }
  });

  const vehiculos = Array.from(vehiculoMap.values()).map((v) => ({
    ...v,
    personIds: Array.from(v.personIds)
  }));

  _chatDirectory = { cuts, cets, cells, flotillas, grupos, vehiculos, personalById };
}

async function loadChatDirectory() {
  if (!_opId) return;
  try {
    const token = localStorage.getItem("token");
    const res = await fetch(`${API_BASE}/ops/${_opId}/mapa`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok) return;
    buildChatDirectory(data);
    updateTargetSelect();
    renderMessages();
  } catch (err) {
    console.error("[CHAT] Error cargando directorio:", err);
  }
}

function getTargetsForType(type = _channelType) {
  if (type === "cet_specific") return _chatDirectory.cets;
  if (type === "cell_specific") return _chatDirectory.cells;
  if (type === "flotilla") return _chatDirectory.flotillas;
  if (type === "grupo") return _chatDirectory.grupos;
  if (type === "vehiculo") return _chatDirectory.vehiculos;
  return [];
}

function isGroupMemberChannel(type = _channelType) {
  return GROUP_MEMBER_CHANNELS.has(type);
}

function getSpecificChannelForPerson(person) {
  if (!person?.id_personal) return "";
  const role = normalizeRole(person);
  if (role === "CET") return "cet_specific";
  return "cell_specific";
}

function openDirectPersonChat(personId, person = null, fallback = {}) {
  const id = String(personId || "").trim();
  if (!id) return;

  const role = normalizeRole(person) || String(fallback.role || "").toUpperCase();
  const channel = role === "CET" ? "cet_specific" : "cell_specific";
  const targets = channel === "cet_specific" ? _chatDirectory.cets : _chatDirectory.cells;
  const label = fullName(person) || String(fallback.label || `Personal ${id}`);

  if (!targets.some((target) => String(target.id) === id)) {
    targets.push({ id, label });
  }
  if (!_chatDirectory.personalById.has(id)) {
    _chatDirectory.personalById.set(id, {
      id_personal: id,
      apodo: label,
      rol: role || "CELL"
    });
  }

  setChannel(channel, id);
  openChatPanels();
  window.setTimeout(() => dom.chatInput?.focus(), 0);
}

function getChatPeople() {
  return Array.from(_chatDirectory.personalById.values())
    .filter((person) => person?.id_personal != null && getSpecificChannelForPerson(person))
    .sort((a, b) => fullName(a).localeCompare(fullName(b), "es", { sensitivity: "base" }));
}

function grupoAliasesForTarget(grupoId = _channelTarget) {
  const aliases = new Set();
  const add = (value) => {
    const text = String(value || "").trim();
    if (text) aliases.add(text);
  };

  const selected = _chatDirectory.grupos.find((grupo) =>
    sameValue(grupo.id, grupoId) || sameValue(grupo.label, grupoId)
  );

  add(grupoId);
  add(selected?.id);
  add(selected?.label);
  add(String(selected?.label || "").replace(/\s*\([^)]*\)\s*$/, ""));

  return [...aliases];
}

function personBelongsToGrupo(person, grupoId = _channelTarget) {
  const grupo = getGrupoForPerson(person);
  if (!grupo) return false;

  const labelWithFlotilla = grupo.flotilla ? `${grupo.label} (${grupo.flotilla})` : grupo.label;
  return grupoAliasesForTarget(grupoId).some((alias) =>
    sameValue(grupo.id, alias) ||
    sameValue(grupo.label, alias) ||
    sameValue(labelWithFlotilla, alias)
  );
}

function getVehicleTarget(vehicleId = _channelTarget) {
  return _chatDirectory.vehiculos.find((vehicle) =>
    sameValue(vehicle.id, vehicleId) || sameValue(vehicle.label, vehicleId)
  );
}

function getGroupChatMembers() {
  const people = getChatPeople();

  if (_channelType === "global") return people;
  if (_channelType === "cuts") return people.filter((person) => normalizeRole(person) === "CUT");
  if (_channelType === "cets") return people.filter((person) => normalizeRole(person) === "CET");
  if (_channelType === "flotilla") {
    return people.filter((person) => personBelongsToFlotilla(person.id_personal, _channelTarget));
  }
  if (_channelType === "grupo") {
    return people.filter((person) => personBelongsToGrupo(person, _channelTarget));
  }
  if (_channelType === "vehiculo") {
    const vehicle = getVehicleTarget();
    const memberIds = new Set([
      ...(vehicle?.personIds || []),
      ...getVehicleOccupants(`V:${_channelTarget}`).map((key) => String(key).replace(/^P:/, "").trim())
    ].filter(Boolean));
    return people.filter((person) => memberIds.has(String(person.id_personal)));
  }

  return [];
}

function getGroupMemberContext(person) {
  if (_channelType === "vehiculo") return getTargetLabel();
  const grupo = getGrupoForPerson(person);
  const flotilla = getFlotillaForPerson(person);
  if (_channelType === "flotilla") return grupo?.label || flotilla?.label || "";
  if (_channelType === "grupo") return flotilla?.label || "";
  return flotilla?.label || grupo?.label || "";
}

function setGroupMembersPanelOpen(open) {
  const canShow = isGroupMemberChannel();
  const shouldOpen = Boolean(open && canShow);
  dom.chatGroupMembersPanel?.classList.toggle("open", shouldOpen);
  if (dom.chatGroupMembersToggle) {
    dom.chatGroupMembersToggle.textContent = shouldOpen ? "<" : ">";
    dom.chatGroupMembersToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
  }
}

function renderGroupMembersPanel() {
  const canShow = isGroupMemberChannel();
  if (dom.chatGroupMembersToggle) {
    dom.chatGroupMembersToggle.hidden = !canShow;
  }

  if (!canShow) {
    setGroupMembersPanelOpen(false);
    return;
  }

  const members = getGroupChatMembers();
  if (dom.chatGroupMembersCount) {
    dom.chatGroupMembersCount.textContent = String(members.length);
  }

  if (!dom.chatGroupMembersList) return;
  if (!members.length) {
    dom.chatGroupMembersList.innerHTML = `<div class="chatGroupMembersEmpty">Sin integrantes</div>`;
    return;
  }

  dom.chatGroupMembersList.innerHTML = members.map((person) => {
    const id = String(person.id_personal);
    const role = normalizeRole(person) || "PERSONAL";
    const context = getGroupMemberContext(person);
    const meta = [role, context].filter(Boolean).join(" - ");
    return `
      <button class="chatGroupMemberItem" type="button" data-chat-member-id="${escapeHtml(id)}">
        <span>${escapeHtml(fullName(person))}</span>
        <small>${escapeHtml(meta)}</small>
      </button>
    `;
  }).join("");
}

function channelLabel(type = _channelType) {
  const labels = {
    global: "Todos",
    cets: "Todos los CET",
    cet_specific: "CET",
    cell_specific: "CELL",
    flotilla: "Flotilla",
    grupo: "Grupo",
    vehiculo: "Ocupantes de vehículo"
  };
  return labels[type] || "Todos";
}

function channelSubtitle(type = _channelType) {
  const labels = {
    global: "Operación completa",
    cets: "Mandos CET",
    cet_specific: "Personal específico",
    cell_specific: "Personal específico",
    flotilla: "CET e integrantes",
    grupo: "Integrantes del grupo",
    vehiculo: "Ocupantes detectados"
  };
  return labels[type] || "Operación completa";
}

function channelAvatar(type = _channelType) {
  const labels = {
    global: "T",
    cets: "C",
    cet_specific: "C",
    cell_specific: "P",
    flotilla: "F",
    grupo: "G",
    vehiculo: "V"
  };
  return labels[type] || "T";
}

function syncAudienceUi() {
  document.querySelectorAll("[data-chat-channel]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.chatChannel === _channelType);
  });

  const targets = getTargetsForType();
  const needsTarget = targets.length > 0;
  if (dom.chatTargetBox) dom.chatTargetBox.classList.toggle("hidden", !needsTarget);
  if (dom.chatTargetEmpty) dom.chatTargetEmpty.classList.toggle("hidden", needsTarget);

  if (dom.chatTargetPicker) {
    dom.chatTargetPicker.innerHTML = "";
    targets.forEach((target) => {
      const opt = document.createElement("option");
      opt.value = target.id;
      opt.textContent = target.label;
      dom.chatTargetPicker.appendChild(opt);
    });
    if (_channelTarget) dom.chatTargetPicker.value = _channelTarget;
  }

  const targetLabel = getTargetLabel();
  const title = targetLabel || channelLabel();
  if (dom.chatAudienceSummary) dom.chatAudienceSummary.textContent = title;
  if (dom.chatConversationTitle) dom.chatConversationTitle.textContent = title;
  if (dom.chatConversationSubtitle) {
    dom.chatConversationSubtitle.textContent = targetLabel ? channelLabel() : channelSubtitle();
  }
  if (dom.chatConversationAvatar) dom.chatConversationAvatar.textContent = channelAvatar();
  renderGroupMembersPanel();
}

function updateTargetSelect(preferredValue = "") {
  if (!dom.chatChannelTarget) {
    syncAudienceUi();
    return;
  }

  const targets = getTargetsForType();
  dom.chatChannelTarget.innerHTML = "";

  if (!targets.length) {
    dom.chatChannelTarget.style.display = "none";
    _channelTarget = "";
    syncAudienceUi();
    return;
  }

  targets.forEach((target) => {
    const opt = document.createElement("option");
    opt.value = target.id;
    opt.textContent = target.label;
    dom.chatChannelTarget.appendChild(opt);
  });

  dom.chatChannelTarget.style.display = "block";
  const value = preferredValue && targets.some((t) => t.id === String(preferredValue))
    ? String(preferredValue)
    : targets[0].id;
  dom.chatChannelTarget.value = value;
  _channelTarget = value;
  syncAudienceUi();
}

function setChannel(type, target = "") {
  _channelType = type === "cuts" ? "global" : (type || "global");
  _activeTab = _channelType === "global" ? "global" : "cet";
  if (dom.chatChannelType) dom.chatChannelType.value = _channelType;
  updateTargetSelect(target);
  syncAudienceUi();
  renderMessages();
  markActiveChatRead();
}

function getDestinatarioRol() {
  if (_channelType === "global") return "GLOBAL";
  if (_channelType === "cuts") return "CUT";
  if (_channelType === "cets" || _channelType === "cet_specific") return "CET";
  if (_channelType === "cell_specific") return "CELL";
  if (_channelType === "flotilla" || _channelType === "grupo" || _channelType === "vehiculo") return "CELL,CET";
  return "GLOBAL";
}

function getTargetLabel() {
  const targets = getTargetsForType();
  const found = targets.find((target) => target.id === String(_channelTarget));
  return found?.label || "";
}

function getDestinoTipo() {
  if (_channelType === "cets") return "CETS";
  if (_channelType === "cuts") return "CUTS";
  if (_channelType === "cet_specific") return "CET";
  if (_channelType === "cell_specific") return "CELL";
  if (_channelType === "flotilla") return "FLOTILLA";
  if (_channelType === "grupo") return "GRUPO";
  if (_channelType === "vehiculo") return "VEHICULO";
  return "";
}

function getVehicleRecipientIds() {
  const vehicle = getVehicleTarget();
  return Array.from(new Set([
    ...(vehicle?.personIds || []),
    ...getVehicleOccupants(`V:${_channelTarget}`)
      .map((key) => String(key).replace(/^P:/, "").trim())
  ].filter(Boolean)));
}

function getDestinoPayload() {
  const destinoTipo = getDestinoTipo();
  if (!destinoTipo) return {};

  if (_channelType === "vehiculo") {
    const recipientIds = getVehicleRecipientIds();
    if (!recipientIds.length) {
      alert("No hay personal detectado o asignado a ese vehiculo.");
      return null;
    }

    return {
      destino_tipo: "CELL_LIST",
      destino_id: recipientIds.join(","),
      destino_label: getTargetLabel()
    };
  }

  const label = destinoTipo === "CETS"
    ? "Todos los CETs"
    : destinoTipo === "CUTS"
      ? "Admin"
      : getTargetLabel();

  const id = destinoTipo === "CETS" || destinoTipo === "CUTS" ? "ALL" : _channelTarget;

  return {
    destino_tipo: destinoTipo,
    destino_id: id,
    destino_label: label
  };
}

function setAttachStatus(text = "") {
  if (!dom.chatAttachStatus) return;
  dom.chatAttachStatus.textContent = text;
  dom.chatAttachStatus.style.display = text ? "block" : "none";
}

function openChatPanels() {
  dom.chatAudiencePanel?.classList.add("open");
  dom.chatPanel?.classList.add("open");
  dom.toggleChatPanel?.classList.add("active");
  scrollChatToLatest();
}

function attachmentToContent(payload) {
  return `${ATTACHMENT_PREFIX}${JSON.stringify(payload)}`;
}

function parseAttachmentContent(content = "") {
  if (!String(content).startsWith(ATTACHMENT_PREFIX)) return null;
  try {
    return JSON.parse(String(content).slice(ATTACHMENT_PREFIX.length));
  } catch {
    return null;
  }
}

function normalizeAttachmentUrl(url = "") {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^data:/i.test(raw)) return raw;

  try {
    const parsed = new URL(raw, API_BASE);
    if (parsed.pathname.startsWith("/api/storage/")) {
      const base = new URL(API_BASE);
      return `${base.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.href;
  } catch {
    return /^https?:\/\//i.test(raw)
      ? raw
      : `${API_BASE}${raw.startsWith("/") ? "" : "/"}${raw}`;
  }
}

const VOICE_WAVE_HEIGHTS = [8, 14, 20, 11, 17, 24, 13, 19, 10, 22, 16, 26, 12, 18, 23, 9, 15, 21, 12, 25, 17, 10, 20, 14];

function buildVoicePlayerMarkup(source = "") {
  const safeSource = escapeHtml(source);
  const bars = VOICE_WAVE_HEIGHTS
    .map((height) => `<span class="chatVoiceBar" style="height:${height}px"></span>`)
    .join("");
  return `
    <div class="chatVoicePlayer">
      <button class="chatVoiceToggle" type="button" aria-label="Reproducir mensaje de voz"></button>
      <div class="chatVoiceTimeline">
        <div class="chatVoiceWave" aria-hidden="true">${bars}</div>
        <input class="chatVoiceSeek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Posici\u00f3n del audio">
        <span class="chatVoiceDuration">0:00</span>
      </div>
      <audio class="chatVoiceAudio" preload="metadata" src="${safeSource}"></audio>
    </div>
  `;
}

function formatVoiceTime(seconds) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function setupVoicePlayers(root = document) {
  root.querySelectorAll?.(".chatVoicePlayer").forEach((player) => {
    if (player.dataset.voiceBound === "1") return;
    player.dataset.voiceBound = "1";
    const audio = player.querySelector(".chatVoiceAudio");
    const toggle = player.querySelector(".chatVoiceToggle");
    const seek = player.querySelector(".chatVoiceSeek");
    const duration = player.querySelector(".chatVoiceDuration");
    const bars = [...player.querySelectorAll(".chatVoiceBar")];
    if (!audio || !toggle || !seek || !duration) return;

    const sync = () => {
      const total = Number.isFinite(audio.duration) ? audio.duration : 0;
      const progress = total > 0 ? Math.min(1, audio.currentTime / total) : 0;
      seek.value = String(progress * 100);
      duration.textContent = formatVoiceTime(audio.paused ? total : audio.currentTime);
      bars.forEach((bar, index) => bar.classList.toggle("played", index / bars.length <= progress));
    };

    toggle.addEventListener("click", () => {
      if (audio.paused) {
        document.querySelectorAll(".chatVoiceAudio").forEach((other) => {
          if (other !== audio) other.pause();
        });
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    });
    seek.addEventListener("input", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = (Number(seek.value) / 100) * audio.duration;
        sync();
      }
    });
    audio.addEventListener("loadedmetadata", sync);
    audio.addEventListener("durationchange", sync);
    audio.addEventListener("timeupdate", sync);
    audio.addEventListener("play", () => {
      player.classList.add("playing");
      toggle.setAttribute("aria-label", "Pausar mensaje de voz");
    });
    audio.addEventListener("pause", () => {
      player.classList.remove("playing");
      toggle.setAttribute("aria-label", "Reproducir mensaje de voz");
      sync();
    });
    audio.addEventListener("ended", () => {
      audio.currentTime = 0;
      sync();
    });
    sync();
  });
}

function renderMessageContent(msg) {
  const content = msg.contenido || "";
  const attachmentKind = String(msg.attachment_kind || "").trim().toUpperCase();
  if (attachmentKind === "AUDIO" && /^mensaje de voz$/i.test(String(content).trim())) return "";
  const attachment = parseAttachmentContent(content);
  if (!attachment) return `<div class="chatBubbleText">${escapeHtml(content)}</div>`;

  const caption = attachment.caption
    ? `<div class="chatBubbleText">${escapeHtml(attachment.caption)}</div>`
    : "";

  if (attachment.kind === "image") {
    return `
      <div class="chatAttachment">
        <img class="chatAttachmentImage" src="${escapeHtml(attachment.dataUrl || "")}" alt="${escapeHtml(attachment.name || "Imagen del chat")}">
        ${caption}
      </div>
    `;
  }

  if (attachment.kind === "audio") {
    return `
      <div class="chatAttachment">
        ${buildVoicePlayerMarkup(attachment.dataUrl || "")}
        ${caption}
      </div>
    `;
  }

  return `<div class="chatBubbleText">${escapeHtml(content)}</div>`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl) {
  const text = String(dataUrl || "");
  const comma = text.indexOf(",");
  const meta = text.slice(0, comma);
  const payload = text.slice(comma + 1);
  if (!meta.startsWith("data:") || comma === -1) {
    throw new Error("Adjunto invalido");
  }

  const mime = meta.match(/^data:([^;,]+)/i)?.[1] || "application/octet-stream";
  const isBase64 = /;base64/i.test(meta);
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

function apiAttachmentKind(kind = "") {
  const raw = String(kind || "").trim().toLowerCase();
  const normalized = String(kind || "").trim().toUpperCase();
  if (["IMAGE", "VIDEO", "AUDIO", "FILE"].includes(normalized)) return normalized;
  if (normalized === "VOICE") return "AUDIO";
  if (raw === "image") return "IMAGE";
  if (raw === "audio") return "AUDIO";
  if (raw === "video") return "VIDEO";
  return "FILE";
}

function defaultAttachmentName(kind = "", mime = "") {
  const upper = apiAttachmentKind(kind);
  const lowerMime = String(mime || "").toLowerCase();
  if (upper === "IMAGE") return lowerMime.includes("png") ? "imagen.png" : "imagen.jpg";
  if (upper === "AUDIO") return lowerMime.includes("mp4") ? "audio.m4a" : "audio.webm";
  if (upper === "VIDEO") return lowerMime.includes("webm") ? "video.webm" : "video.mp4";
  return "adjunto.bin";
}

function attachmentSourceToBlob(source) {
  if (source instanceof Blob) return source;
  if (typeof source === "string") return dataUrlToBlob(source);
  throw new Error("Adjunto invalido");
}

async function imageFileToDataUrl(file) {
  const originalDataUrl = await fileToDataUrl(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxSide = 1280;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.78));
    };
    img.onerror = () => resolve(originalDataUrl);
    img.src = originalDataUrl;
  });
}

function formatDestino(msg) {
  const tipo = String(msg.destino_tipo || "").toUpperCase();
  const label = String(msg.destino_label || "").trim();
  if (!label) return "";

  if (tipo === "CETS") return "para todos los CETs";
  if (tipo === "CET") return `para CET: ${label}`;
  if (tipo === "CUTS") return "para admin";
  if (tipo === "CUT") return `para admin: ${label}`;
  if (tipo === "CELL") return `para CELL: ${label}`;
  if (tipo === "FLOTILLA") return `para flotilla: ${label}`;
  if (tipo === "GRUPO") return `para grupo: ${label}`;
  if (tipo === "VEHICULO") return `para vehiculo: ${label}`;
  if (tipo === "CELL_LIST") return `para ocupantes de vehiculo: ${label}`;
  return `para ${label}`;
}

function shouldHideChatMessage(msg) {
  const tipo = String(msg?.tipo_mensaje || "").toUpperCase();
  const contenido = String(msg?.contenido || "").toLowerCase();
  // Los GEO-MSG pertenecen exclusivamente al mapa. Ocultamos también los
  // que pudieron haberse guardado en el historial antes de este ajuste.
  if (contenido.startsWith("[geo-msg]")) return true;
  if (tipo !== "SISTEMA") return false;
  return (
    contenido.includes("trigger de bd") ||
    contenido.includes("operacion activada autom") ||
    contenido.includes("operación activada autom")
  );
}

function isEmergencyMessage(msg) {
  const type = String(msg?.tipo_mensaje || msg?.tipo || "").trim().toUpperCase();
  const markedAsAlert = msg?.es_alerta === true ||
    msg?.alerta === true ||
    msg?.alert === true ||
    ["URGENTE", "ALERTA", "ALERT"].includes(type);
  return markedAsAlert && !shouldHideChatMessage(msg);
}

function layoutEmergencyTopBanners() {
  // El contenedor flex se encarga de ordenar la pila verticalmente.
}

function expandEmergencyTopBanner(card) {
  _activeEmergencyAlerts.forEach(({ card: otherCard }) => {
    otherCard.classList.toggle("compact", otherCard !== card);
  });
  requestAnimationFrame(layoutEmergencyTopBanners);
}

function alertField(content, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(content || "").match(new RegExp(`^${escapedLabel}\\s*:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() || "";
}

function alertVitalNumber(value) {
  const match = String(value || "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function criticalVitalAlerts({ heartRate, oxygen, respiration, temperature, bloodPressure }) {
  const alerts = [];
  const heart = alertVitalNumber(heartRate);
  const spo2 = alertVitalNumber(oxygen);
  const breaths = alertVitalNumber(respiration);
  const temp = alertVitalNumber(temperature);
  const systolic = alertVitalNumber(bloodPressure);

  // Señales de triaje visual: avisan para verificación inmediata; no sustituyen
  // una valoración clínica ni diagnostican a la persona.
  if (heart !== null) {
    if (heart <= 0) alerts.push(`SIN PULSO DETECTADO (FC ${heartRate})`);
    else if (heart < 40 || heart > 180) alerts.push(`FC CRÍTICA: ${heartRate}`);
  }
  if (spo2 !== null && spo2 <= 85) alerts.push(`OXÍGENO CRÍTICO: ${oxygen}`);
  if (breaths !== null) {
    if (breaths <= 0) alerts.push(`SIN RESPIRACIÓN DETECTADA (${respiration})`);
    else if (breaths < 8 || breaths > 35) alerts.push(`RESPIRACIÓN CRÍTICA: ${respiration}`);
  }
  if (temp !== null && (temp < 32 || temp >= 41)) alerts.push(`TEMPERATURA CRÍTICA: ${temperature}`);
  if (systolic !== null && systolic < 70) alerts.push(`PRESIÓN CRÍTICA: ${bloodPressure}`);
  return alerts;
}

function showEmergencyTopBanner(msg) {
  if (!dom.emergencyTopBanner) return;
  // Algunos eventos de socket llegan antes de que la BD asigne un id (0/null).
  // No usamos ese valor como llave, pues dos PTT simultáneos se reemplazaban.
  const numericMessageId = Number(msg?.id_mensaje ?? msg?.id);
  const key = Number.isFinite(numericMessageId) && numericMessageId > 0
    ? `M:${numericMessageId}`
    : `E:${msg?.autor_nombre || msg?.id_personal || "personal"}:${msg?.fecha_envio || Date.now()}:${String(msg?.contenido || "").slice(0, 80)}`;
  let card = _activeEmergencyAlerts.get(key)?.card;
  if (!card) {
    const baseCard = dom.emergencyTopBanner;
    card = _activeEmergencyAlerts.size === 0 && baseCard.hidden
      ? baseCard
      : baseCard.cloneNode(true);
    if (card !== baseCard) document.getElementById("emergencyAlertStack")?.append(card);
    _activeEmergencyAlerts.set(key, { msg, card });
    card.querySelector("#closeEmergencyTopBanner")?.addEventListener("click", () => {
      const alert = _activeEmergencyAlerts.get(key);
      if (!alert) return;
      clearEmergencyForChatMessage(alert.msg);
      _activeEmergencyAlerts.delete(key);
      if (card === baseCard) {
        card.classList.remove("visible");
        card.hidden = true;
      } else {
        card.remove();
      }
      layoutEmergencyTopBanners();
    });
    card.querySelector("#viewEmergencyLocationBtn")?.addEventListener("click", () => {
      const alert = _activeEmergencyAlerts.get(key)?.msg;
      if (alert) focusEmergencyForChatMessage(alert);
    });
    card.querySelector(".emergencyTopBannerTitle")?.addEventListener("click", () => {
      expandEmergencyTopBanner(card);
    });
  }
  const coords = getEmergencyCoordsForChatMessage(msg);
  const author = emergencyAuthorLabel(msg).toUpperCase();
  const timestamp = formatTime(msg?.fecha_envio);
  const content = String(msg?.contenido || "");
  const isLifeLine = /LINEA\s+DE\s+VIDA/i.test(content);
  // La identidad del emisor se normaliza con su grado, igual que el resto de alertas.
  const reportedUser = author;
  const heartRate = alertField(content, "FRECUENCIA CARDIACA") ||
    alertField(content, "PULSO") || alertField(content, "PULSO ACTUAL");
  const oxygen = alertField(content, "OXIGENO EN SANGRE");
  const respiration = alertField(content, "FRECUENCIA RESPIRATORIA");
  const temperature = alertField(content, "TEMPERATURA CORPORAL");
  const bloodPressure = alertField(content, "PRESION ARTERIAL");
  const criticalAlerts = criticalVitalAlerts({
    heartRate, oxygen, respiration, temperature, bloodPressure
  });
  const allVitalsSummary = [
    ["FC", heartRate || "no disponible"],
    ["SpO2", oxygen || "no disponible"],
    ["Resp.", respiration || "no disponible"],
    ["Temp.", temperature || "no disponible"],
    ["PA", bloodPressure || "no disponible"]
  ];

  const find = (selector) => card.querySelector(selector);
  const name = find("#emergencyTopBannerName");
  if (name) {
    name.textContent = isLifeLine
      ? `LINEA DE VIDA - ${reportedUser.toUpperCase()}`
      : `ALERTA DE ${author}`;
  }
  const time = find("#emergencyTopBannerTime");
  if (time) time.textContent = timestamp;
  const vitals = find("#emergencyTopBannerVitals");
  if (vitals) {
    vitals.replaceChildren();
    if (isLifeLine) {
      allVitalsSummary.forEach(([label, value]) => {
        const metric = document.createElement("span");
        metric.className = "emergencyVitalMetric";
        const metricLabel = document.createElement("small");
        metricLabel.textContent = label;
        const metricValue = document.createElement("strong");
        metricValue.textContent = value;
        metric.append(metricLabel, metricValue);
        vitals.append(metric);
      });
    } else {
      const status = document.createElement("strong");
      status.textContent = "EMERGENCIA OPERATIVA";
      vitals.append(status);
    }
  }
  const status = find("#emergencyTopBannerStatus");
  if (status) {
    status.hidden = !isLifeLine || !criticalAlerts.length;
    status.textContent = criticalAlerts.length
      ? `⚠ ${criticalAlerts.join(" · ")} — VERIFICAR DE INMEDIATO`
      : "";
  }
  card.classList.toggle("critical-vitals", criticalAlerts.length > 0);
  const coordsLabel = find("#emergencyTopBannerCoords");
  if (coordsLabel) {
    // La ubicación se abre con el botón; no repetimos coordenadas técnicas en
    // la alerta para que pueda leerse de un vistazo.
    coordsLabel.hidden = true;
  }
  const locationButton = find("#viewEmergencyLocationBtn");
  if (locationButton) locationButton.disabled = !coords;

  card.hidden = false;
  expandEmergencyTopBanner(card);
  requestAnimationFrame(() => {
    card.classList.add("visible");
    layoutEmergencyTopBanners();
  });
}

function bindEmergencyTopBanner() {
  // Los controles se enlazan al crear cada tarjeta, para que múltiples
  // emergencias simultáneas tengan acciones independientes.
}

function buildBubble(msg) {
  if (shouldHideChatMessage(msg)) return "";
  const mine  = isMine(msg);
  const autor = escapeHtml(isEmergencyMessage(msg) ? emergencyAuthorLabel(msg) : (msg.autor_nombre || "Sistema"));
  const hora  = escapeHtml(formatTime(msg.fecha_envio));
  const tipo  = (msg.tipo_mensaje || "NORMAL").toUpperCase();
  const rol   = (msg.autor_rol   || "").toLowerCase();    // admin | cut | cet | cell
  const destinoText = formatDestino(msg);
  const destino = destinoText
    ? `${escapeHtml(destinoText)} - ${hora}`
    : hora;

  const typeExtra = tipo === "URGENTE" ? " urgente" : tipo === "SISTEMA" ? " sistema" : "";
  const rolClass  = rol ? ` rol-${rol}` : "";

  const isPersonal = _channelType === "cet_specific" || _channelType === "cell_specific";
  const header = tipo !== "SISTEMA"
    ? (isPersonal
        ? `<div class="chatBubbleHeader" style="justify-content: flex-end;"><span>${hora}</span></div>`
        : `<div class="chatBubbleHeader"><span>${autor}</span><span>${hora}</span></div>`)
    : `<div class="chatBubbleTime">${hora}</div>`;
  const attachment = buildAttachmentMarkup(msg);

  return `
    <div class="chatBubble${mine ? " mine" : ""}${typeExtra}${rolClass}" data-id="${msg.id_mensaje ?? ""}">
      ${header}
      ${renderMessageContent(msg)}
      ${attachment}
    </div>
  `;
}

function buildAttachmentMarkup(msg) {
  const url = msg.attachment_url;
  if (!url) return "";

  const absolute = normalizeAttachmentUrl(url);
  const kind = String(msg.attachment_kind || "").toUpperCase();
  const name = escapeHtml(msg.attachment_name || "Adjunto");
  const safeUrl = escapeHtml(absolute);

  if (kind === "IMAGE") {
    return `<a class="chatAttachment" href="${safeUrl}" target="_blank" rel="noopener"><img src="${safeUrl}" alt="${name}"></a>`;
  }

  if (kind === "VIDEO") {
    return `<video class="chatAttachmentMedia" src="${safeUrl}" controls playsinline></video>`;
  }

  if (kind === "AUDIO") {
    return buildVoicePlayerMarkup(absolute);
  }

  return `<a class="chatAttachmentFile" href="${safeUrl}" target="_blank" rel="noopener">${name}</a>`;
}

// ── Re-renderiza todos los mensajes visibles ────────────────
function renderMessages() {
  if (!dom.chatMessages) return;
  dom.chatMessages.innerHTML = "";
  _allMsgs.filter(msg =>
    !shouldHideChatMessage(msg) && !isEmergencyMessage(msg) && isVisibleInTab(msg)
  ).forEach(msg => {
    dom.chatMessages.insertAdjacentHTML("beforeend", buildBubble(msg));
  });
  setupVoicePlayers(dom.chatMessages);
  dom.chatMessages.querySelectorAll("img").forEach((image) => {
    if (!image.complete) image.addEventListener("load", scrollChatToLatest, { once: true });
  });
  scrollChatToLatest();
}

export function scrollChatToLatest() {
  if (!dom.chatMessages) return;

  const scroll = () => {
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  };

  scroll();
  window.requestAnimationFrame(() => {
    scroll();
    window.requestAnimationFrame(scroll);
  });
}

// ── Agrega un mensaje (guard de duplicados) ─────────────────
function appendMessage(msg) {
  if (!dom.chatMessages) return false;

  // Dedup por id_mensaje
  if (msg.id_mensaje && _allMsgs.some(m => m.id_mensaje === msg.id_mensaje)) return false;
  _allMsgs.push(msg);

  if (shouldHideChatMessage(msg)) return true;
  // Las alertas se reciben por el mismo canal en tiempo real, pero se muestran
  // exclusivamente en el aviso superior, no dentro de la conversación.
  if (isEmergencyMessage(msg)) {
    // También se conserva la alerta enviada por la cuenta actual; todas las
    // emergencias activas deben permanecer visibles en la central.
    showEmergencyTopBanner(msg);
    return true;
  }
  if (!isVisibleInTab(msg)) return true;

  const atBottom =
    dom.chatMessages.scrollHeight - dom.chatMessages.scrollTop <=
    dom.chatMessages.clientHeight + 60;

  dom.chatMessages.insertAdjacentHTML("beforeend", buildBubble(msg));
  setupVoicePlayers(dom.chatMessages);

  if (atBottom) dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  return true;
}

// ── Carga historial desde backend ──────────────────────────
async function loadMessages() {
  if (!_opId) return;
  try {
    const token = localStorage.getItem("token");
    const res   = await fetch(`${API_BASE}/ops/${_opId}/chat/messages`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.items)) return;

    _allMsgs = [];
    data.items.forEach(msg => _allMsgs.push(msg));
    renderMessages();
  } catch (err) {
    console.error("[CHAT] Error cargando mensajes:", err);
  }
}

// ── Envía un mensaje (POST → socket lo devuelve) ────────────
async function sendChatContent(content, { clearText = false, restoreText = "" } = {}) {
  if (!_opId) return;
  const text = String(content || "").trim();
  if (!text) return;

  const destinoPayload = getDestinoPayload();
  if (destinoPayload === null) {
    if (restoreText && dom.chatInput) dom.chatInput.value = restoreText;
    return;
  }

  if (clearText && dom.chatInput) dom.chatInput.value = "";
  if (dom.sendChatBtn) dom.sendChatBtn.disabled = true;

  try {
    const token = localStorage.getItem("token");
    const res   = await fetch(`${API_BASE}/ops/${_opId}/chat/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contenido: text,
        tipo_mensaje: "NORMAL",
        destinatario_rol: getDestinatarioRol(),
        ...destinoPayload
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      console.error("[CHAT] Error al enviar:", res.status, data);
      if (restoreText && dom.chatInput) dom.chatInput.value = restoreText;
      alert(data?.mensaje || "No se pudo enviar el mensaje.");
      return;
    }

    const savedMessage = data?.item || data?.mensaje;
    if (savedMessage) appendMessage(savedMessage);
  } catch (err) {
    console.error("[CHAT] Error enviando mensaje:", err);
    if (restoreText && dom.chatInput) dom.chatInput.value = restoreText;
    alert("No se pudo enviar el mensaje.");
  } finally {
    if (dom.sendChatBtn) dom.sendChatBtn.disabled = false;
    dom.chatInput?.focus();
  }
}

async function sendMessage() {
  const text = dom.chatInput?.value.trim();
  await sendChatContent(text, { clearText: true, restoreText: text });
}

async function sendAttachment(kind, source, name = "") {
  const caption = dom.chatInput?.value.trim() || "";
  if (!_opId) return;

  const destinoPayload = getDestinoPayload();
  if (destinoPayload === null) return;

  const blob = attachmentSourceToBlob(source);
  const attachmentKind = apiAttachmentKind(kind);
  const fileName = name || defaultAttachmentName(attachmentKind, blob.type);
  const params = new URLSearchParams({
    tipo_mensaje: "NORMAL",
    destinatario_rol: getDestinatarioRol()
  });

  if (caption) params.set("contenido", caption);
  Object.entries(destinoPayload).forEach(([key, value]) => {
    if (value != null && String(value).trim()) params.set(key, String(value));
  });

  if (dom.chatInput) dom.chatInput.value = "";
  if (dom.sendChatBtn) dom.sendChatBtn.disabled = true;

  try {
    const token = localStorage.getItem("token");
    const res = await fetch(`${API_BASE}/ops/${_opId}/chat/attachments?${params.toString()}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": blob.type || "application/octet-stream",
        "X-File-Name": fileName,
        "X-Attachment-Kind": attachmentKind
      },
      body: blob
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      console.error("[CHAT] Error al enviar adjunto:", res.status, data);
      if (dom.chatInput) dom.chatInput.value = caption;
      alert(data?.mensaje || "No se pudo enviar el adjunto.");
      return;
    }

    const savedMessage = data?.item || data?.mensaje;
    if (savedMessage) appendMessage(savedMessage);
  } catch (err) {
    console.error("[CHAT] Error enviando adjunto:", err);
    if (dom.chatInput) dom.chatInput.value = caption;
    alert("No se pudo enviar el adjunto.");
  } finally {
    if (dom.sendChatBtn) dom.sendChatBtn.disabled = false;
    dom.chatInput?.focus();
  }
}

async function sendVideoFromInput(input) {
  const file = input?.files?.[0];
  if (!file) return;

  try {
    setAttachStatus("Enviando video...");
    await sendAttachment("video", file, file.name || "video.mp4");
  } catch (err) {
    console.error("[CHAT] Error enviando video:", err);
    alert("No se pudo enviar el video.");
  } finally {
    if (input) input.value = "";
    setAttachStatus("");
  }
}

async function sendImageFromInput(input) {
  const file = input?.files?.[0];
  if (!file) return;
  try {
    setAttachStatus("Preparando imagen...");
    const dataUrl = await imageFileToDataUrl(file);
    await sendAttachment("image", dataUrl, file.name || "imagen.jpg");
  } catch (err) {
    console.error("[CHAT] Error enviando imagen:", err);
    alert("No se pudo enviar la imagen.");
  } finally {
    if (input) input.value = "";
    setAttachStatus("");
  }
}

async function sendAttachmentFromInput(input) {
  const file = input?.files?.[0];
  if (!file) return;

  const type = String(file.type || "").toLowerCase();
  if (type.startsWith("image/")) {
    await sendImageFromInput(input);
    return;
  }
  if (type.startsWith("video/")) {
    await sendVideoFromInput(input);
    return;
  }

  input.value = "";
  alert("Selecciona una foto o un video.");
}

async function toggleAudioRecording() {
  if (_isRecordingAudio && _mediaRecorder) {
    _mediaRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    alert("Este navegador no permite grabar audio desde aqui.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _audioChunks = [];
    _mediaRecorder = new MediaRecorder(stream);
    _mediaRecorder.ondataavailable = (event) => {
      if (event.data?.size) _audioChunks.push(event.data);
    };
    _mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      _isRecordingAudio = false;
      dom.chatAudioBtn?.classList.remove("recording");
      setChatAudioButtonState(false);
      setAttachStatus("Enviando audio...");
      const blob = new Blob(_audioChunks, { type: _mediaRecorder.mimeType || "audio/webm" });
      await sendAttachment("audio", blob, "audio.webm");
      setAttachStatus("");
    };
    _mediaRecorder.start();
    _isRecordingAudio = true;
    dom.chatAudioBtn?.classList.add("recording");
    setChatAudioButtonState(true);
    setAttachStatus("Grabando audio...");
  } catch (err) {
    console.error("[CHAT] Error grabando audio:", err);
    alert("No se pudo acceder al microfono.");
    setAttachStatus("");
  }
}

// ── Público: inicializa chat con socket ─────────────────────
export function initChat(opId, socket) {
  _opId   = opId;
  _socket = socket;
  bindEmergencyTopBanner();
  armWebAlertAudio();

  socket.on("chat_message", (msg) => {
    if (!isMine(msg)) {
      playWebAlertSound(msg);
      registerUnreadMessage(msg);
    }
    if (appendMessage(msg) && !isMine(msg)) {
      pulseEmergencyForChatMessage(msg);
    }
  });

  loadChatDirectory();
  loadMessages();
}

// ── Público: enlaza eventos de UI ───────────────────────────
export function bindChatEvents() {
  if (dom.chatChannelType) {
    dom.chatChannelType.addEventListener("change", () => {
      setChannel(dom.chatChannelType.value || "global");
    });
  }

  document.querySelectorAll("[data-chat-channel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setChannel(btn.dataset.chatChannel || "global");
    });
  });

  if (dom.chatAudienceToggle) {
    dom.chatAudienceToggle.addEventListener("click", () => {
      dom.chatAudienceBody?.classList.toggle("collapsed");
      const collapsed = dom.chatAudienceBody?.classList.contains("collapsed");
      dom.chatAudienceToggle.textContent = collapsed ? "⌄" : "⌃";
      dom.chatAudienceToggle.setAttribute(
        "aria-label",
        collapsed ? "Expandir destinatarios" : "Minimizar destinatarios"
      );
    });
  }

  if (dom.chatGroupMembersToggle) {
    dom.chatGroupMembersToggle.addEventListener("click", () => {
      const isOpen = dom.chatGroupMembersPanel?.classList.contains("open");
      setGroupMembersPanelOpen(!isOpen);
      renderGroupMembersPanel();
    });
  }

  if (dom.chatGroupMembersList) {
    dom.chatGroupMembersList.addEventListener("click", (event) => {
      const item = event.target.closest("[data-chat-member-id]");
      if (!item) return;
      const id = String(item.dataset.chatMemberId || "").trim();
      const person = _chatDirectory.personalById.get(id);
      const channel = getSpecificChannelForPerson(person);
      if (!channel) return;
      setChannel(channel, id);
      setGroupMembersPanelOpen(false);
      openChatPanels();
      dom.chatInput?.focus();
    });
  }

  if (dom.chatChannelTarget) {
    dom.chatChannelTarget.addEventListener("change", () => {
      _channelTarget = dom.chatChannelTarget.value || "";
      if (dom.chatTargetPicker) dom.chatTargetPicker.value = _channelTarget;
      syncAudienceUi();
      renderMessages();
    });
  }

  if (dom.chatTargetPicker) {
    dom.chatTargetPicker.addEventListener("change", () => {
      _channelTarget = dom.chatTargetPicker.value || "";
      if (dom.chatChannelTarget) dom.chatChannelTarget.value = _channelTarget;
      syncAudienceUi();
      renderMessages();
    });
  }

  document.addEventListener("openEntityChat", (event) => {
    const detail = event.detail || {};
    const trackingKey = String(detail.trackingKey || "");
    const id = trackingKey.split(":")[1] || "";
    const person = trackingKey.startsWith("P:") ? _chatDirectory.personalById.get(String(id)) : null;

    if (detail.target === "person") {
      openDirectPersonChat(id, person, {
        role: detail.role,
        label: detail.entityName
      });
      return;
    } else if (detail.target === "cet") {
      setChannel("cet_specific", id);
    } else if (detail.target === "flotilla") {
      const flotilla = getFlotillaForPerson(person);
      setChannel("flotilla", flotilla?.id || "");
    } else if (detail.target === "grupo") {
      const grupo = getGrupoForPerson(person);
      setChannel("grupo", grupo?.id || "");
    } else if (detail.target === "vehiculo") {
      setChannel("vehiculo", id);
    }

    openChatPanels();
    dom.chatInput?.focus();
  });

  document.addEventListener("openVehicleChat", (event) => {
    const detail = event.detail || {};
    const vehicleName = detail.vehicleName || detail.entityName || "";
    const vehicle = _chatDirectory.vehiculos.find((v) =>
      sameValue(v.id, detail.id_vehiculo) ||
      sameValue(v.label, vehicleName)
    );

    if (vehicle) setChannel("vehiculo", vehicle.id);
    openChatPanels();
    dom.chatInput?.focus();
  });

  if (dom.sendChatBtn) {
    dom.sendChatBtn.addEventListener("click", sendMessage);
  }

  if (dom.chatAttachmentBtn) {
    dom.chatAttachmentBtn.addEventListener("click", () => dom.chatAttachmentInput?.click());
  }

  if (dom.chatAudioBtn) {
    dom.chatAudioBtn.addEventListener("click", toggleAudioRecording);
  }

  if (dom.chatAttachmentInput) {
    dom.chatAttachmentInput.addEventListener("change", () => sendAttachmentFromInput(dom.chatAttachmentInput));
  }

  if (dom.chatInput) {
    dom.chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  if (dom.chatTabCet) {
    dom.chatTabCet.addEventListener("click", () => {
      setChannel("cets");
      dom.chatTabCet.classList.add("active");
      dom.chatTabCells?.classList.remove("active");
    });
  }

  if (dom.chatTabCells) {
    dom.chatTabCells.addEventListener("click", () => {
      setChannel("global");
      dom.chatTabCells.classList.add("active");
      dom.chatTabCet?.classList.remove("active");
    });
  }
}
