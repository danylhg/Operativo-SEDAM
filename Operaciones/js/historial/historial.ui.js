import { dom } from "./historial.dom.js";
import { replayState } from "./historial.state.js";
import { LAYERS, describeEvent, isRelevantEvent, isTargetPoi } from "./historial.meta.js";

// Instantes (ms, ordenados) de los eventos relevantes; permite contar los ya
// reproducidos con busqueda binaria en cada tick.
let relevantTimes = [];
// Elementos del feed (mismo orden que relevantTimes) y cuantos estan reproducidos.
let eventEls = [];
let playedCount = 0;

export function renderTopbar(replay) {
  const operation = replay?.operacion || {};
  const user = JSON.parse(localStorage.getItem("user") || "null");

  if (dom.title) {
    dom.title.textContent = operation.nombre || operation.codigo || `Operación ${operation.id_operacion || ""}`;
  }

  if (dom.code) {
    dom.code.textContent = operation.codigo || "";
  }

  if (dom.statusBadge) {
    const status = String(operation.estado || "Historial");
    dom.statusBadge.textContent = status;
    dom.statusBadge.dataset.status = status.toLowerCase();
  }

  if (dom.who) {
    dom.who.textContent = user?.nombre || user?.username || "";
  }
}

export function renderOperationInfo(replay) {
  const operation = replay?.operacion || {};
  const timeline = replay?.timeline || {};
  const snapshots = replay?.snapshots || {};
  const assignment = replay?.asignacion || {};
  const personal = assignment.personal || replay?.personal || [];
  const vehiculos = assignment.vehiculos || replay?.vehiculos || [];
  const equipos = assignment.equipos || replay?.equipos || [];

  // Respaldo para un backend anterior a la separacion waypoint / blanco.
  const legacyPois = snapshots.pois || [];
  const waypoints = snapshots.waypoints || legacyPois.filter(poi => !isTargetPoi(poi));
  const blancos = snapshots.blancos || legacyPois.filter(isTargetPoi);

  const stats = [
    ["personal", personal.length],
    ["vehiculos", vehiculos.length],
    ["waypoints", waypoints.length],
    ["blancos", blancos.length],
    ["geomsg", countOf(snapshots.geo_mensajes)],
    ["areas", countOf(snapshots.areas)],
    ["estructuras", countOf(snapshots.estructuras)],
    ["rutas", countOf(snapshots.rutas_tacticas) + countOf(snapshots.rutas_navegacion)],
    ["dibujos", countOf(snapshots.dibujos)],
  ];

  const startMs = Date.parse(timeline.inicio || operation.fecha_inicio);
  const endMs = Date.parse(timeline.fin || operation.fecha_fin);
  const duration = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? formatClockDuration(endMs - startMs)
    : "-";

  dom.infoContent.innerHTML = `
    <section class="hCard">
      <h4>General</h4>
      <p class="hDescription">${escapeHtml(operation.descripcion || "Sin descripción disponible.")}</p>
      <dl class="hMeta">
        ${metaItem("Código", operation.codigo || "-")}
        ${metaItem("Prioridad", operation.prioridad || "-")}
        ${metaItem("Inicio", formatDateTime(timeline.inicio || operation.fecha_inicio))}
        ${metaItem("Cierre", formatDateTime(timeline.fin || operation.fecha_fin))}
        ${metaItem("Duración", duration)}
        ${metaItem("Eventos", timeline.total_eventos ?? (timeline.eventos || []).length)}
      </dl>
    </section>

    <section class="hStats" aria-label="Resumen de elementos">
      ${stats.map(([key, value]) => statTile(key, value)).join("")}
    </section>

    ${accordion("Personal asignado", personal.length, renderPersonalList(personal), true)}
    ${accordion("Vehículos", vehiculos.length, renderVehicleList(vehiculos))}
    ${accordion("Equipos", equipos.length, renderEquipmentList(equipos))}
    ${accordion("Grabaciones", (replay?.recordings || []).length, renderRecordingList(replay?.recordings || [], replay?.recordingsError))}
  `;
}

function statTile(key, value) {
  const layer = LAYERS.find(item => item.key === key);
  return `
    <div class="hStat${value ? "" : " empty"}" style="--c:${layer?.color || "#94A3B8"}">
      <b>${escapeHtml(value)}</b>
      <span>${escapeHtml(layer?.label || key)}</span>
    </div>
  `;
}

function metaItem(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function accordion(title, count, body, open = false) {
  return `
    <details class="hAcc"${open ? " open" : ""}>
      <summary><span>${escapeHtml(title)}</span><em>${escapeHtml(count)}</em></summary>
      <div class="hAccBody">${body}</div>
    </details>
  `;
}

function formatTimeOnly(ms) {
  if (!ms && ms !== 0) return "--:--:--";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("es-MX", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatDateOnly(ms) {
  if (!ms && ms !== 0) return "--/--/----";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "--/--/----";
  return date.toLocaleDateString("es-MX", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  });
}

// Cantidad de elementos de una lista ordenada que cumplen valor <= limit.
function countUpTo(sortedValues, limit) {
  let low = 0;
  let high = sortedValues.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sortedValues[mid] <= limit) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function renderTimelineTime(currentMs, endMs, _events = [], startMs = currentMs) {
  if (dom.elapsedTime) dom.elapsedTime.textContent = formatClockDuration(currentMs - startMs);
  if (dom.durationTime) dom.durationTime.textContent = formatClockDuration(endMs - startMs);
  if (dom.currentTime) dom.currentTime.textContent = formatTimeOnly(currentMs);
  if (dom.totalTime) dom.totalTime.textContent = formatTimeOnly(endMs);
  if (dom.currentDate) dom.currentDate.textContent = formatDateOnly(currentMs);

  if (dom.eventCounter) {
    dom.eventCounter.textContent = `${countUpTo(relevantTimes, currentMs)}/${relevantTimes.length} eventos`;
  }
}

export function renderPlaybackState(isPlaying) {
  if (!dom.playPause) return;
  dom.playPause.setAttribute("aria-label", isPlaying ? "Pausar" : "Reproducir");
  dom.playPause.innerHTML = isPlaying
    ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 6h3v12H8V6Z"/><path d="M13 6h3v12h-3V6Z"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7L8 5Z"/></svg>`;
}

export function renderError(message) {
  if (dom.infoContent) {
    dom.infoContent.innerHTML = `<div class="hEmpty">${escapeHtml(message)}</div>`;
  }

  if (dom.statusBadge) {
    dom.statusBadge.textContent = "Error";
    dom.statusBadge.dataset.status = "error";
  }
}

export function formatDateTime(value) {
  if (!value && value !== 0) return "--:--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleString("es-MX", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatClockDuration(value) {
  const ms = Math.max(0, Number(value) || 0);
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds / 60) % 60)).padStart(2, "0");
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function countOf(value) {
  return Array.isArray(value) ? value.length : 0;
}

function renderPersonalList(items = []) {
  if (!items.length) {
    return '<div class="hEmpty">Sin personal registrado para esta operación.</div>';
  }

  return `
    <ul class="hMembers">
      ${items.map((person) => {
        const name = fullPersonName(person) || person.apodo || `Personal #${person.id_personal || ""}`;
        const role = person.rol_en_operacion || person.rol || "";
        const group = groupPath(person.grupo_padre_nombre, person.grupo_nombre);
        return memberRow(formatRole(role), name, group);
      }).join("")}
    </ul>
  `;
}

function renderVehicleList(items = []) {
  if (!items.length) {
    return '<div class="hEmpty">Sin vehículos registrados para esta operación.</div>';
  }

  return `
    <ul class="hMembers">
      ${items.map((vehicle) => {
        const name = [vehicle.tipo, vehicle.codigo_interno, vehicle.alias].filter(Boolean).join(" - ")
          || `Vehículo #${vehicle.id_vehiculo || ""}`;
        const assigned = vehiclePersonName(vehicle);
        const group = groupPath(vehicle.grupo_padre_nombre, vehicle.grupo_directo_nombre || vehicle.grupo_nombre);
        return memberRow("", name, [assigned, group].filter(Boolean).join(" | "));
      }).join("")}
    </ul>
  `;
}

function renderEquipmentList(items = []) {
  if (!items.length) {
    return '<div class="hEmpty">Sin equipos registrados para esta operación.</div>';
  }

  return `
    <ul class="hMembers">
      ${items.map((equipment) => {
        const name = equipment.nombre || equipment.tipo_equipo || `Equipo #${equipment.id_equipo || ""}`;
        const identifier = equipment.numero_serie || "Sin identificador";
        const destination = equipmentDestination(equipment);
        return memberRow("", name, [identifier, equipment.categoria, destination].filter(Boolean).join(" | "));
      }).join("")}
    </ul>
  `;
}

function memberRow(tag, name, detail) {
  return `
    <li>
      ${tag ? `<span class="hMemberTag">${escapeHtml(tag)}</span>` : ""}
      <span class="hMemberName">${escapeHtml(name)}</span>
      ${detail ? `<span class="hMemberDetail">${escapeHtml(detail)}</span>` : ""}
    </li>
  `;
}

function fullPersonName(person) {
  return [abbreviateRank(person.puesto), person.nombre, person.apellido].filter(Boolean).join(" ").trim();
}

function vehiclePersonName(vehicle) {
  const name = [
    abbreviateRank(vehicle.personal_puesto),
    vehicle.personal_nombre || vehicle.asignado_a_nombre,
    vehicle.personal_apellido || vehicle.asignado_a_apellido
  ].filter(Boolean).join(" ").trim();

  return [formatRole(vehicle.personal_rol), name || vehicle.asignado_a_apodo].filter(Boolean).join(" ").trim();
}

function abbreviateRank(value) {
  const rank = String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

  if (rank.includes("general de division")) return "Gral. Div.";
  if (rank.includes("general de brigada") || rank.includes("general brigadier")) return "Gral. Brig.";
  if (rank.includes("teniente coronel")) return "Tte. Cor.";
  if (rank.includes("capitan primero")) return "Cap. 1/o.";
  if (rank.includes("sargento primero")) return "Sgto. 1/o.";
  if (rank.includes("sargento segundo")) return "Sgto. 2/o.";
  if (rank.includes("subteniente")) return "Subtte.";
  if (rank.includes("teniente")) return "Tte.";
  if (rank.includes("coronel")) return "Cor.";
  if (rank.includes("capitan")) return "Cap.";
  if (rank.includes("mayor")) return "My.";
  if (rank.includes("cabo")) return "Cbo.";
  if (rank.includes("soldado") && rank.includes("marinero")) return "Sldo./Mro.";
  if (rank.includes("soldado")) return "Sold.";
  if (rank.includes("marinero")) return "Mar.";
  return String(value || "").trim();
}

function equipmentDestination(equipment) {
  if (equipment.tipo_destino === "VEHICULO") {
    return [equipment.asignado_a_vehiculo, equipment.vehiculo_alias].filter(Boolean).join(" - ");
  }

  if (equipment.tipo_destino === "GRUPO") {
    return groupPath(equipment.flotilla_asignada, equipment.grupo_asignado);
  }

  const personDestination = [formatRole(equipment.personal_rol), equipment.asignado_a_personal].filter(Boolean).join(" ").trim();
  return personDestination || groupPath(equipment.personal_flotilla_nombre, equipment.personal_grupo_nombre);
}

function groupPath(parent, child) {
  const parts = [parent, child]
    .map(value => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);

  return parts.join(" / ");
}

function formatRole(value) {
  const role = String(value || "").trim().toUpperCase();
  return role ? `(${role})` : "";
}

function renderRecordingList(recordings, error) {
  if (error) {
    return `<div class="hEmpty">No se pudieron cargar las grabaciones: ${escapeHtml(error)}</div>`;
  }

  if (!recordings.length) {
    return '<div class="hEmpty">Sin grabaciones guardadas.</div>';
  }

  return `
    <div class="hRecordings">
      ${recordings.map(recording => `
        <button class="hRecording historyRecordingDownload" type="button" data-recording-id="${escapeHtml(recording.id_recording)}">
          <span>Stream #${escapeHtml(recording.id_stream)} · ${escapeHtml(recording.stream_label || recording.stream_kind || "Grabación")}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg>
        </button>
      `).join("")}
    </div>
  `;
}

// ── Chats ─────────────────────────────────────────────────

let allChatEvents = [];
let groupedChats = {};
let activeChannelId = null;

function getGroupChannel(msg) {
  const destRol = String(msg.destinatario_rol || "GLOBAL").toUpperCase();
  const destTipo = String(msg.destino_tipo || "").toUpperCase();
  const destLabel = msg.destino_label || "";
  const destId = msg.destino_id || "";

  // Los destinos singulares son conversaciones directas, no canales de rol.
  if (["CELL", "CET", "CUT", "PERSONAL"].includes(destTipo)) return null;

  if (destTipo === "FLOTILLA") {
    return { id: `flotilla_${destId || destLabel}`, name: destLabel || `Flotilla ${destId}`, type: "group" };
  }
  if (destTipo === "GRUPO") {
    return { id: `grupo_${destId || destLabel}`, name: destLabel || `Grupo ${destId}`, type: "group" };
  }
  if (destRol === "GLOBAL" || destTipo === "GLOBAL" || destLabel.toLowerCase().includes("global")) {
    return { id: "global", name: "General", type: "group" };
  }
  if (destRol === "CELL,CET" || destRol === "CET,CELL" || destLabel.toLowerCase().includes("celula") || destLabel.toLowerCase().includes("mando")) {
    return { id: "cell_cet", name: "Células y Mando", type: "group" };
  }
  if (destTipo === "CETS" || (destRol === "CET" && !destTipo)) {
    return { id: "cets", name: "Canal CETs", type: "group" };
  }
  if (destTipo === "CUTS" || (destRol === "CUT" && !destTipo)) {
    return { id: "cuts", name: "Canal CUTs", type: "group" };
  }
  return null;
}

function getPersonalChannel(msg) {
  const rawAutor = msg.autor_nombre || msg.nombre_usuario || msg.apodo_personal || msg.nombre_personal || "Tripulacion";
  const destTipo = String(msg.destino_tipo || "").toUpperCase();
  const directTypes = new Set(["CELL", "CET", "CUT", "PERSONAL"]);
  const recipient = String(msg.destino_label || "").trim();

  if (msg.tipo_mensaje === "SISTEMA" || rawAutor === "Admin Principal" || rawAutor === "Sistema") {
    return null;
  }
  if (!directTypes.has(destTipo) || !recipient) return null;

  const participants = [rawAutor.trim(), recipient]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  const stableId = participants
    .map(name => name.toLocaleLowerCase("es-MX").replace(/[^a-z0-9áéíóúüñ]+/gi, "_"))
    .join("__");
  return {
    id: `direct_${stableId}`,
    name: participants.join(" con "),
    type: "direct"
  };
}

function buildChatItemHtml(chatData) {
  const { channel, events } = chatData;
  const lastEvent = events[events.length - 1] || {};
  const lastMsg = lastEvent.payload || {};
  const previewText = lastMsg.contenido || "";
  const previewRecipient = lastMsg.destino_label ? `Para ${lastMsg.destino_label}: ` : "";
  const iconSvg = channel.type === "group"
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

  return `
    <button class="hChatItem" type="button" data-channel-id="${escapeHtml(channel.id)}">
      <span class="hChatIcon">${iconSvg}</span>
      <span class="hChatItemText">
        <b>${escapeHtml(channel.name)}</b>
        <small>${escapeHtml(previewRecipient + previewText)}</small>
      </span>
      <em>${events.length}</em>
    </button>
  `;
}

function selectChatChannel(channelId) {
  activeChannelId = channelId;
  const chatData = groupedChats[channelId];
  if (!chatData) return;

  const titleEl = document.getElementById("historyChatActiveTitle");
  if (titleEl) titleEl.textContent = chatData.channel.name;

  if (dom.chatMessages) {
    dom.chatMessages.innerHTML = chatData.events.map(ev => buildBubble(ev)).join("");
  }

  document.getElementById("historyChatList")?.classList.add("hidden");
  document.getElementById("historyChatActive")?.classList.remove("hidden");

  updateChatToTime(replayState.currentTimeMs);
}

export function renderChatMessages(events) {
  if (!dom.chatMessages) return;

  allChatEvents = events
    .filter(ev => {
      if (ev.tipo_evento !== "chat_mensaje") return false;
      const contenido = ev.payload?.contenido || "";
      if (contenido.includes("automáticamente por trigger de BD.")) return false;
      return true;
    })
    .sort((left, right) => eventMs(left) - eventMs(right));

  groupedChats = {};

  function ensureChannel(channel) {
    if (!groupedChats[channel.id]) {
      groupedChats[channel.id] = { channel, events: [] };
    }
  }

  for (const ev of allChatEvents) {
    const msg = ev.payload || {};

    const groupChannel = getGroupChannel(msg);
    if (groupChannel) {
      ensureChannel(groupChannel);
      groupedChats[groupChannel.id].events.push(ev);
    }

    const personalChannel = getPersonalChannel(msg);
    if (personalChannel) {
      ensureChannel(personalChannel);
      groupedChats[personalChannel.id].events.push(ev);
    }
  }

  const chatListContainer = document.getElementById("historyChatList");
  if (chatListContainer) {
    const groups = Object.values(groupedChats).filter(c => c.channel.type === "group");
    const directs = Object.values(groupedChats).filter(c => c.channel.type === "direct");

    let html = "";

    if (groups.length > 0) {
      html += `
        <div class="hChatSection">
          <div class="hChatSectionTitle">Grupos y canales</div>
          ${groups.map(c => buildChatItemHtml(c)).join("")}
        </div>
      `;
    }

    if (directs.length > 0) {
      html += `
        <div class="hChatSection">
          <div class="hChatSectionTitle">Contactos</div>
          ${directs.map(c => buildChatItemHtml(c)).join("")}
        </div>
      `;
    }

    if (!groups.length && !directs.length) {
      html = '<div class="hEmpty">Sin conversaciones en el historial.</div>';
    }

    chatListContainer.innerHTML = html;

    chatListContainer.querySelectorAll(".hChatItem").forEach(el => {
      el.addEventListener("click", () => {
        selectChatChannel(el.dataset.channelId);
      });
    });
  }

  const backBtn = document.getElementById("historyChatBackBtn");
  if (backBtn && !backBtn.dataset.bound) {
    backBtn.dataset.bound = "true";
    backBtn.addEventListener("click", () => {
      activeChannelId = null;
      document.getElementById("historyChatActive")?.classList.add("hidden");
      document.getElementById("historyChatList")?.classList.remove("hidden");
    });
  }
}

// ── Actividad ─────────────────────────────────────────────

export function renderEventLog(events) {

  const visibleEvents = events
    .filter(isRelevantEvent)
    .filter(ev => Number.isFinite(eventMs(ev)))
    .sort((left, right) => eventMs(left) - eventMs(right));

  relevantTimes = visibleEvents.map(eventMs);
  if (dom.eventCounter) {
    dom.eventCounter.textContent = `${countUpTo(relevantTimes, replayState.currentTimeMs)}/${relevantTimes.length} eventos`;
  }

  if (!dom.eventLog) return;

  if (!visibleEvents.length) {
    dom.eventLog.innerHTML = '<div class="hEmpty">Sin eventos registrados.</div>';
    return;
  }

  dom.eventLog.innerHTML = visibleEvents.map(buildEventItem).join("");
  eventEls = [...dom.eventLog.querySelectorAll(".hEvent")];
  playedCount = 0;
}

function buildEventItem(ev) {
  const info = describeEvent(ev);
  const ms = eventMs(ev);
  const position = info.position
    ? ` data-lat="${info.position.lat}" data-lng="${info.position.lng}"`
    : "";

  return `
    <button class="hEvent hEventPending" type="button" data-ms="${ms}"${position} style="--c:${info.color}">
      <span class="hEventDot" aria-hidden="true"></span>
      <span class="hEventBody">
        <span class="hEventTop">
          <b>${escapeHtml(info.kind)}</b>
          <span class="hEventAction ${info.action.key}">${escapeHtml(info.action.label)}</span>
          <time>${escapeHtml(formatTimeOnly(ms))}</time>
        </span>
        <span class="hEventName">${escapeHtml(info.name)}</span>
        ${info.detail ? `<span class="hEventDetail">${escapeHtml(info.detail)}</span>` : ""}
      </span>
      ${info.position ? '<svg class="hEventLocate" viewBox="0 0 24 24" aria-label="Ir a la ubicación"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>' : ""}
    </button>
  `;
}

export function updateChatToTime(currentMs) {
  if (!dom.chatMessages || !activeChannelId) return;

  let lastVisible = null;
  for (const el of dom.chatMessages.querySelectorAll("[data-ms]")) {
    const visible = Number(el.dataset.ms) <= currentMs;
    el.style.display = visible ? "" : "none";
    if (visible) lastVisible = el;
  }

  if (lastVisible) {
    lastVisible.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

export function updateEventLogToTime(currentMs) {
  if (!eventEls.length) return;

  // Solo se tocan los elementos entre el conteo anterior y el nuevo, en vez de
  // recorrer todo el feed en cada tick.
  const count = countUpTo(relevantTimes, currentMs);
  if (count === playedCount) return;

  const from = Math.min(count, playedCount);
  const to = Math.max(count, playedCount);
  for (let i = from; i < to; i += 1) {
    const played = i < count;
    eventEls[i].classList.toggle("hEventPlayed", played);
    eventEls[i].classList.toggle("hEventPending", !played);
  }
  playedCount = count;

  // Solo sigue el ultimo evento mientras se reproduce; en pausa el usuario
  // puede desplazar la lista libremente.
  if (count > 0 && replayState.isPlaying) {
    eventEls[count - 1].scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function formatChatTime(value) {
  if (!value && value !== 0) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("es-MX", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getAuthorColor(name) {
  const colors = ["#38bdf8", "#a78bfa", "#fb7185", "#fb923c", "#34d399", "#22d3ee", "#f472b6"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function buildBubble(ev) {
  const msg = ev.payload || {};
  const rawAutor = msg.autor_nombre || msg.nombre_usuario || msg.apodo_personal || msg.nombre_personal || "Tripulacion";
  const hora = formatChatTime(ev.occurred_at);
  const ms = Date.parse(ev.occurred_at);
  const recipient = msg.destino_label || destinationFallback(msg);

  return `
    <div class="hMsg" data-ms="${ms}" style="display:none">
      <div class="hMsgHead">
        <span class="hMsgAuthor" style="color:${getAuthorColor(rawAutor)}">${escapeHtml(rawAutor)}</span>
        <span class="hMsgTime">${escapeHtml(hora)}</span>
      </div>
      ${recipient ? `<div class="hMsgTo">Para: ${escapeHtml(recipient)}</div>` : ""}
      <div class="hMsgText">${escapeHtml(msg.contenido || "")}</div>
    </div>
  `;
}

function destinationFallback(msg) {
  const type = String(msg.destino_tipo || "").toUpperCase();
  const role = String(msg.destinatario_rol || "").toUpperCase();
  if (type === "GLOBAL" || role === "GLOBAL") return "Canal general";
  if (type === "CETS") return "Todos los CETs";
  if (type === "CUTS") return "Todos los CUTs";
  if (type === "FLOTILLA") return "Flotilla";
  if (type === "GRUPO") return "Grupo";
  return role && role !== "GLOBAL" ? role : "";
}

function eventMs(event) {
  const ms = Date.parse(event?.occurred_at);
  return Number.isFinite(ms) ? ms : NaN;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[char]));
}
