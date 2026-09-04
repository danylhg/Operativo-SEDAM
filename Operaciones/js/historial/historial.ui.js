import { dom } from "./historial.dom.js";

let lastScrolledEventMs = null;

export function renderTopbar(replay) {
  const operation = replay?.operacion || {};
  const user = JSON.parse(localStorage.getItem("user") || "null");

  if (dom.title) {
    dom.title.textContent = operation.nombre || operation.codigo || `Operacion ${operation.id_operacion || ""}`;
  }

  if (dom.statusBadge) {
    dom.statusBadge.textContent = dom.legacyPlaybackLayout
      ? "Historial y Replay"
      : operation.estado || "Historial";
  }

  if (dom.who) {
    dom.who.textContent = user?.nombre || user?.username || "";
  }
}

export function renderOperationInfo(replay) {
  const operation = replay?.operacion || {};
  const timeline = replay?.timeline || {};
  const events = timeline.eventos || [];
  const snapshots = replay?.snapshots || {};
  const assignment = replay?.asignacion || {};
  const personal = assignment.personal || replay?.personal || [];
  const vehiculos = assignment.vehiculos || replay?.vehiculos || [];
  const equipos = assignment.equipos || replay?.equipos || [];

  dom.infoContent.innerHTML = `
    <section class="infoSection">
      <h4>General</h4>
      <p><strong>Codigo:</strong> ${escapeHtml(operation.codigo || "-")}</p>
      <p><strong>Nombre:</strong> ${escapeHtml(operation.nombre || "Operacion")}</p>
      <p><strong>Descripcion:</strong> ${escapeHtml(operation.descripcion || "Sin descripcion disponible.")}</p>
      <p><strong>Prioridad:</strong> ${escapeHtml(operation.prioridad || "-")}</p>
      <p><strong>Estado:</strong> <span style="color:var(--accent)">${escapeHtml(operation.estado || "Historial")}</span></p>
      <p><strong>Inicio:</strong> ${escapeHtml(formatDateTime(timeline.inicio || operation.fecha_inicio))}</p>
      <p><strong>Cierre:</strong> ${escapeHtml(formatDateTime(timeline.fin || operation.fecha_fin))}</p>
      <p><strong>Eventos:</strong> ${escapeHtml(events.length)}</p>
    </section>
    <section class="infoSection">
      <h4>Personal asignado</h4>
      ${renderPersonalList(personal)}
    </section>
    <section class="infoSection">
      <h4>Vehiculos</h4>
      ${renderVehicleList(vehiculos)}
    </section>
    <section class="infoSection">
      <h4>Equipos</h4>
      ${renderEquipmentList(equipos)}
    </section>
    <section class="infoSection">
      <h4>Capas guardadas</h4>
      <p><strong>Puntos de interes:</strong> ${escapeHtml(countOf(snapshots.pois))}</p>
      <p><strong>Areas:</strong> ${escapeHtml(countOf(snapshots.areas))}</p>
      <p><strong>Estructuras:</strong> ${escapeHtml(countOf(snapshots.estructuras))}</p>
      <p><strong>Rutas tacticas:</strong> ${escapeHtml(countOf(snapshots.rutas_tacticas))}</p>
      <p><strong>Rutas navegacion:</strong> ${escapeHtml(countOf(snapshots.rutas_navegacion))}</p>
      <p><strong>Dibujos:</strong> ${escapeHtml(countOf(snapshots.dibujos))}</p>
    </section>
    <section class="infoSection">
      <h4>Grabaciones</h4>
      ${renderRecordingList(replay?.recordings || [], replay?.recordingsError)}
    </section>
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

export function renderTimelineTime(currentMs, endMs, events = [], startMs = currentMs) {
  if (dom.elapsedTime) {
    dom.elapsedTime.textContent = formatClockDuration(currentMs - startMs);
  }

  if (dom.durationTime) {
    dom.durationTime.textContent = formatClockDuration(endMs - startMs);
  }

  if (dom.legacyPlaybackLayout) {
    if (dom.currentTime) dom.currentTime.textContent = formatClockDuration(currentMs - startMs);
    if (dom.totalTime) dom.totalTime.textContent = formatClockDuration(endMs - startMs);
    if (dom.currentDate) dom.currentDate.textContent = formatDateTime(currentMs);
    return;
  }

  if (dom.currentTime) {
    dom.currentTime.textContent = formatTimeOnly(currentMs);
  }

  if (dom.totalTime) {
    dom.totalTime.textContent = formatTimeOnly(endMs);
  }

  const timeDateEl = document.getElementById("historyTimeDate");
  if (timeDateEl) {
    timeDateEl.textContent = formatDateOnly(currentMs);
  }

  if (dom.eventCounter) {
    const visibleEvents = events.filter((event) => Date.parse(event.occurred_at) <= currentMs).length;
    dom.eventCounter.textContent = `${visibleEvents}/${events.length} eventos`;
  }
}

export function renderPlaybackState(isPlaying) {
  if (dom.playPause) {
    dom.playPause.setAttribute("aria-label", isPlaying ? "Pausar" : "Reproducir");
    dom.playPause.innerHTML = isPlaying
      ? `<svg class="historyControlIcon historyPauseIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M8 6h3v12H8V6Z"></path>
          <path d="M13 6h3v12h-3V6Z"></path>
        </svg>`
      : `<svg class="historyControlIcon historyPlayIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M8 5v14l11-7L8 5Z"></path>
        </svg>`;
    return;
  }
  if (dom.playPause) {
    dom.playPause.textContent = isPlaying ? "\u23f8" : "\u25b6";
    return;
  }
  if (dom.playPause) {
    dom.playPause.textContent = isPlaying ? "⏸" : "▶";
  }
}

export function renderError(message) {
  if (dom.infoContent) {
    dom.infoContent.innerHTML = `<div class="historyEmpty">${escapeHtml(message)}</div>`;
  }

  if (dom.statusBadge) {
    dom.statusBadge.textContent = "Error";
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

function metaRow(label, value) {
  return `
    <div class="historyMetaItem">
      <span class="historyMetaLabel">${escapeHtml(label)}</span>
      <span class="historyMetaValue">${escapeHtml(value ?? "-")}</span>
    </div>
  `;
}

function countOf(value) {
  return Array.isArray(value) ? value.length : 0;
}

function renderPersonalList(items = []) {
  if (!items.length) {
    return '<div class="historyEmpty">Sin personal registrado para esta operacion.</div>';
  }

  return `
    <div class="memberList">
      ${items.map((person) => {
        const name = fullPersonName(person) || person.apodo || `Personal #${person.id_personal || ""}`;
        const role = person.rol_en_operacion || person.rol || "";
        const group = groupPath(person.grupo_padre_nombre, person.grupo_nombre);
        return `<span class="memberTag">${escapeHtml([formatRole(role), name, group].filter(Boolean).join(" | "))}</span>`;
      }).join("")}
    </div>
  `;
}

function renderVehicleList(items = []) {
  if (!items.length) {
    return '<div class="historyEmpty">Sin vehiculos registrados para esta operacion.</div>';
  }

  return `
    <div class="memberList">
      ${items.map((vehicle) => {
        const name = [vehicle.tipo, vehicle.codigo_interno, vehicle.alias].filter(Boolean).join(" - ")
          || `Vehiculo #${vehicle.id_vehiculo || ""}`;
        const assigned = vehiclePersonName(vehicle);
        const group = groupPath(vehicle.grupo_padre_nombre, vehicle.grupo_directo_nombre || vehicle.grupo_nombre);
        return `<span class="memberTag">${escapeHtml([name, assigned, group].filter(Boolean).join(" | "))}</span>`;
      }).join("")}
    </div>
  `;
}

function renderEquipmentList(items = []) {
  if (!items.length) {
    return '<div class="historyEmpty">Sin equipos registrados para esta operacion.</div>';
  }

  return `
    <div class="memberList">
      ${items.map((equipment) => {
        const name = equipment.nombre || equipment.tipo_equipo || `Equipo #${equipment.id_equipo || ""}`;
        const identifier = equipment.numero_serie || "Sin identificador";
        const destination = equipmentDestination(equipment);
        return `<span class="memberTag">${escapeHtml([name, identifier, equipment.categoria, destination].filter(Boolean).join(" | "))}</span>`;
      }).join("")}
    </div>
  `;
}

function fullPersonName(person) {
  return [person.puesto, person.nombre, person.apellido].filter(Boolean).join(" ").trim();
}

function vehiclePersonName(vehicle) {
  const name = [
    vehicle.personal_puesto,
    vehicle.personal_nombre || vehicle.asignado_a_nombre,
    vehicle.personal_apellido || vehicle.asignado_a_apellido
  ].filter(Boolean).join(" ").trim();

  return [formatRole(vehicle.personal_rol), name || vehicle.asignado_a_apodo].filter(Boolean).join(" ").trim();
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

function coordinatesText(lat, lon) {
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return "";
  return `${latNum.toFixed(5)}, ${lonNum.toFixed(5)}`;
}

function inlineMeta(label, value) {
  if (value == null || value === "") return "";
  return `<span><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</span>`;
}

function statusPill(value) {
  if (!value) return "";
  return `<span class="historyAssignmentStatus">${escapeHtml(value)}</span>`;
}

function renderRecordingList(recordings, error) {
  if (error) {
    return `<div class="historyEmpty">No se pudieron cargar las grabaciones: ${escapeHtml(error)}</div>`;
  }

  if (!recordings.length) {
    return '<div class="historyEmpty">Sin grabaciones guardadas.</div>';
  }

  return `
    <div class="memberList">
      ${recordings.map(recording => `
        <button class="btnSecondary historyRecordingDownload" type="button" data-recording-id="${escapeHtml(recording.id_recording)}">
          Stream #${escapeHtml(recording.id_stream)} - ${escapeHtml(recording.stream_label || recording.stream_kind || "Grabacion")} - Descargar
        </button>
      `).join("")}
    </div>
  `;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(value) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "--:--";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

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
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

  return `
    <div class="historyChatItem" data-channel-id="${channel.id}">
      <div class="historyChatItemIcon">
        ${iconSvg}
      </div>
      <div class="historyChatItemContent">
        <div class="historyChatItemName">${escapeHtml(channel.name)}</div>
        <div class="historyChatItemPreview">${escapeHtml(previewRecipient + previewText)}</div>
      </div>
    </div>
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

  // Sincronizar el chat al tiempo actual de reproducción
  import("./historial.state.js").then(({ replayState }) => {
    updateChatToTime(replayState.currentTimeMs);
  });
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
      groupedChats[channel.id] = {
        channel,
        events: []
      };
    }
  }

  for (const ev of allChatEvents) {
    const msg = ev.payload || {};
    
    // A. Agregar al canal del grupo (si corresponde)
    const groupChannel = getGroupChannel(msg);
    if (groupChannel) {
      ensureChannel(groupChannel);
      groupedChats[groupChannel.id].events.push(ev);
    }
    
    // B. Agregar al chat personal del remitente
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
        <div class="historyChatListSection">
          <div class="historyChatListSectionTitle">Grupos y Canales</div>
          ${groups.map(c => buildChatItemHtml(c)).join("")}
        </div>
      `;
    }
    
    if (directs.length > 0) {
      html += `
        <div class="historyChatListSection">
          <div class="historyChatListSectionTitle">Contactos</div>
          ${directs.map(c => buildChatItemHtml(c)).join("")}
        </div>
      `;
    }
    
    if (!groups.length && !directs.length) {
      html = '<div class="historyEmpty">Sin conversaciones en el historial.</div>';
    }
    
    chatListContainer.innerHTML = html;

    chatListContainer.querySelectorAll(".historyChatItem").forEach(el => {
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

export function renderEventLog(events) {
  if (!dom.eventLog) return;
  lastScrolledEventMs = null;

  const visibleEvents = [
    ...events.filter(ev => ev.tipo_evento !== "chat_mensaje" && !String(ev.tipo_evento || "").startsWith("tracking_")),
    ...trackingSummaries(events),
  ]
    .filter(ev => Number.isFinite(eventMs(ev)))
    .sort((left, right) => eventMs(left) - eventMs(right));

  if (!visibleEvents.length) {
    dom.eventLog.innerHTML = '<div class="historyEmpty">Sin eventos registrados.</div>';
    return;
  }

  dom.eventLog.innerHTML = visibleEvents.map(buildEventItem).join("");
}

function buildEventItem(ev) {
  const payload = ev.payload || {};
  const time = formatDateTime(ev.occurred_at);
  const ms = eventMs(ev);
  const name = payload.titulo || payload.contenido || payload.descripcion || payload.nota ||
    payload.nombre || payload.codigo || ev.entidad_tipo || ev.tipo_evento;
  const type = ev.entidad_tipo || ev.tipo_evento;
  const action = eventAction(ev.tipo_evento);

  return `
    <div class="eventItem eventPending" data-ms="${ms}">
      <div class="eventHeader">
        <span class="eventTime">${escapeHtml(time)}</span>
        <span class="eventAction ${action.className}">${escapeHtml(action.label)}</span>
      </div>
      <div class="eventBody">
        <span class="eventIcon" aria-hidden="true">${eventIcon(type)}</span>
        <div class="eventInfo">
          <div class="eventName">${escapeHtml(name)}</div>
          <div class="eventType">${escapeHtml(eventLabel(type))}</div>
        </div>
      </div>
    </div>
  `;
}

function trackingSummaries(events) {
  return ["tracking_personal", "tracking_vehiculo"]
    .map((tipo) => {
      const matches = events
        .filter(ev => ev.tipo_evento === tipo)
        .sort((left, right) => eventMs(left) - eventMs(right));

      if (!matches.length) return null;

      const label = tipo === "tracking_personal" ? "personal" : "vehiculos";
      return {
        tipo_evento: `${tipo}_resumen`,
        entidad_tipo: "tracking",
        occurred_at: matches[0].occurred_at,
        payload: {
          nombre: `${matches.length} posiciones de ${label}`,
        },
      };
    })
    .filter(Boolean);
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
  if (!dom.eventLog) return;

  let lastPlayed = null;
  for (const el of dom.eventLog.querySelectorAll("[data-ms]")) {
    const played = Number(el.dataset.ms) <= currentMs;
    el.classList.toggle("eventPlayed", played);
    el.classList.toggle("eventPending", !played);
    if (played) lastPlayed = el;
  }

  const playedMs = lastPlayed ? Number(lastPlayed.dataset.ms) : null;
  if (lastPlayed && playedMs !== lastScrolledEventMs) {
    lastScrolledEventMs = playedMs;
    lastPlayed.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
  const colors = [
    "#38bdf8", // Celeste
    "#a78bfa", // Violeta
    "#fb7185", // Rosa
    "#fb923c", // Naranja
    "#34d399", // Esmeralda
    "#22d3ee", // Cian
    "#f472b6"  // Fucsia
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

function buildBubble(ev) {
  const msg = ev.payload || {};
  const rawAutor = msg.autor_nombre || msg.nombre_usuario || msg.apodo_personal || msg.nombre_personal || "Tripulacion";
  const autor = escapeHtml(rawAutor);
  const hora = formatChatTime(ev.occurred_at);
  const texto = escapeHtml(msg.contenido || "");
  const ms = Date.parse(ev.occurred_at);
  const color = getAuthorColor(rawAutor);
  const recipient = msg.destino_label || destinationFallback(msg);

  return `
    <div class="msg" data-ms="${ms}" style="display:none">
      <div class="msgHeader">
        <span class="msgAuthor" style="color:${color} !important">${autor}</span>
        <span class="msgTime">${escapeHtml(hora)}</span>
      </div>
      ${recipient ? `<div class="msgRecipient">Para: ${escapeHtml(recipient)}</div>` : ""}
      <div class="msgText">${texto}</div>
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

function eventLabel(value) {
  return String(value || "evento")
    .replace(/_/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function eventAction(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("elimin")) {
    return { className: "deleted", label: "ELIMINACION" };
  }
  if (text.includes("cread")) {
    return { className: "created", label: "REGISTRO" };
  }
  return { className: "info", label: "EVENTO" };
}

function eventIcon(value) {
  const type = String(value || "").toLowerCase();
  if (type.includes("poi") || type.includes("punto")) return "P";
  if (type.includes("area") || type.includes("zona")) return "Z";
  if (type.includes("ruta")) return "R";
  if (type.includes("dibujo")) return "D";
  if (type.includes("tracking")) return "T";
  return "E";
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
