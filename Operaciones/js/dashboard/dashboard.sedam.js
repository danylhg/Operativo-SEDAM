import { dashboardState } from "./dashboard.state.js";

// Red SEDAM: la API reenvía lo que llega del servidor SEDAM Móvil (unidades OWNPOS,
// blancos TRACKPOS, waypoints WAYPOINTPOS, mensajes y pánico) por "sedam_bridge_event".

const DEFAULT_SIDC = "SFGPU----------";
const SYMBOL_SIZE = 26;
const SESSION_OUT_GRACE_MS = 10_000;
const MAX_GEO_MESSAGES = 50;
const MAX_LIST_MESSAGES = 200;
const OWN_POI_REFRESH_MS = 2_000;
const WAYPOINT_COLORS = { F: "#F7FAFF", H: "#FF3347", N: "#00F53D", U: "#FFF000" };

const units = new Map();      // id → evento "unit" más reciente
const entities = new Map();   // id → entidad Cesium
const aliases = new Map();
const panics = new Set();
const goneTimers = new Map();
const geoEntities = [];
const messages = [];
const symbolCache = new Map();

let panel = null;
let activeTab = "unidades";
let linkStatus = null; // estado de la API con SEDAM: { remote: { target, connected, error }, bridgeClients, ... }
let unreadMessages = 0;
let bridgeSocket = null;

const isTarget = (id) => id.startsWith("T");
const isWaypoint = (id) => id.startsWith("W");

function displayName(id) {
  const unit = units.get(id);
  return aliases.get(id) || unit?.name || id;
}

// Igual que el selector de objetos: waypoints monocromo por identidad, el resto en tema MIL Light.
function symbolImage(sidc, course) {
  if (typeof ms === "undefined" || typeof ms.Symbol !== "function") return null;
  const heading = Number.isFinite(course) ? Math.round(course / 5) * 5 % 360 : null;
  const key = `${sidc}|${heading ?? ""}`;
  if (symbolCache.has(key)) return symbolCache.get(key);

  const options = sidc.charAt(0) === "G"
    ? { size: SYMBOL_SIZE, monoColor: WAYPOINT_COLORS[sidc.charAt(1)] || "#FFF000", fill: false }
    : { size: SYMBOL_SIZE, colorMode: "Light", fill: true };
  if (heading !== null) options.direction = heading;

  let image = null;
  try {
    const symbol = new ms.Symbol(sidc, options);
    image = symbol.isValid?.() === false ? null : symbol.asCanvas();
  } catch (err) {
    console.warn("[SEDAM] Símbolo inválido:", sidc, err);
  }
  if (!image && sidc !== DEFAULT_SIDC) image = symbolImage(DEFAULT_SIDC, course);
  symbolCache.set(key, image);
  return image;
}

function labelStyle(id) {
  const panic = panics.has(id);
  return {
    text: panic ? `⚠ ${displayName(id)}` : displayName(id),
    background: panic
      ? Cesium.Color.fromCssColorString("#b91c1c").withAlpha(0.9)
      : isTarget(id)
        ? Cesium.Color.fromCssColorString("#7f1d1d").withAlpha(0.75)
        : Cesium.Color.fromCssColorString("#1f2937").withAlpha(0.8),
  };
}

function upsertEntity(unit) {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  // El rumbo solo se dibuja si la unidad se mueve (los puestos fijos reportan 0.1).
  const moving = Number.isFinite(unit.speed) && unit.speed > 0.5;
  const sidc = unit.sidc && unit.sidc.length >= 10 ? unit.sidc : DEFAULT_SIDC;
  const image = symbolImage(sidc, moving && !isWaypoint(unit.id) ? unit.course : null);
  const position = Cesium.Cartesian3.fromDegrees(unit.lon, unit.lat);
  const label = labelStyle(unit.id);

  let entity = entities.get(unit.id);
  if (!entity) {
    entity = viewer.entities.add({
      id: `sedam:${unit.id}`,
      position,
      billboard: {
        image: image || undefined,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: label.text,
        font: "bold 11px sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#fde68a"),
        showBackground: true,
        backgroundColor: label.background,
        backgroundPadding: new Cesium.Cartesian2(6, 3),
        pixelOffset: new Cesium.Cartesian2(0, -(SYMBOL_SIZE + 6)),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6_000_000),
      },
    });
    entities.set(unit.id, entity);
  } else {
    entity.position = position;
    if (image) entity.billboard.image = image;
    entity.label.text = label.text;
    entity.label.backgroundColor = label.background;
    entity.billboard.color = Cesium.Color.WHITE;
  }
}

function removeUnit(id) {
  clearTimeout(goneTimers.get(id));
  goneTimers.delete(id);
  units.delete(id);
  const entity = entities.get(id);
  if (entity) dashboardState.viewer?.entities.remove(entity);
  entities.delete(id);
}

// SESSION_OUT: la unidad se atenúa y se quita si no vuelve a reportar en el margen.
function markGone(id) {
  const entity = entities.get(id);
  if (entity) entity.billboard.color = Cesium.Color.WHITE.withAlpha(0.4);
  clearTimeout(goneTimers.get(id));
  goneTimers.set(id, setTimeout(() => {
    removeUnit(id);
    renderPanel();
  }, SESSION_OUT_GRACE_MS));
}

function refreshLabels(id) {
  const unit = units.get(id);
  if (unit) upsertEntity(unit);
}

function addGeoMessage(msg) {
  const viewer = dashboardState.viewer;
  if (!viewer) return;
  const entity = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(msg.lon, msg.lat),
    point: {
      pixelSize: 9,
      color: Cesium.Color.fromCssColorString("#38bdf8"),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: `💬 ${displayName(msg.from)}: ${msg.text}`,
      font: "12px sans-serif",
      fillColor: Cesium.Color.WHITE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("#0c4a6e").withAlpha(0.85),
      backgroundPadding: new Cesium.Cartesian2(6, 3),
      pixelOffset: new Cesium.Cartesian2(0, -18),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  geoEntities.push(entity);
  if (geoEntities.length > MAX_GEO_MESSAGES) viewer.entities.remove(geoEntities.shift());
}

function pushMessage(msg, { countUnread = true } = {}) {
  messages.push(msg);
  if (messages.length > MAX_LIST_MESSAGES) messages.shift();
  if (msg.type === "geochat") addGeoMessage(msg);
  if (countUnread && activeTab !== "mensajes") unreadMessages += 1;
}

function handleEvent(event) {
  if (!event?.type) return;
  switch (event.type) {
    case "unit":
      if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) return;
      clearTimeout(goneTimers.get(event.id));
      goneTimers.delete(event.id);
      units.set(event.id, { ...units.get(event.id), ...event });
      upsertEntity(units.get(event.id));
      break;
    case "alias":
      aliases.set(event.id, event.alias);
      if (units.has(event.id)) refreshLabels(event.id);
      break;
    case "panic":
      if (event.active) panics.add(event.id);
      else panics.delete(event.id);
      if (units.has(event.id)) refreshLabels(event.id);
      break;
    case "message":
    case "geochat":
      pushMessage(event);
      break;
    case "gone":
      if (event.grace) markGone(event.id);
      else removeUnit(event.id);
      break;
    default:
      return;
  }
  schedulePanelRender();
}

function handleStatus(status) {
  linkStatus = status || null;
  schedulePanelRender();
}

// Texto para el operador cuando no llegan unidades: dice qué conexión falla.
function describeLink() {
  if (!linkStatus) return { ok: false, text: "La API no tiene configurada la red SEDAM." };
  const { remote, socket } = linkStatus;
  const parts = [];
  if (socket) {
    parts.push(socket.online
      ? `En línea con SEDAM Móvil ${socket.target} (serie ${socket.serial})`
      : `Sin conexión con SEDAM Móvil ${socket.target}${socket.error ? `: ${socket.error}` : ""}`);
  }
  if (remote) {
    parts.push(remote.connected
      ? `Conectado a SEDAM ${remote.target}`
      : `Sin conexión con SEDAM ${remote.target}${remote.error ? `: ${remote.error}` : ""}`);
  }
  if (linkStatus.listenPort) {
    parts.push(linkStatus.bridgeClients > 0
      ? `Bridge conectado al puerto ${linkStatus.listenPort}`
      : `Ningún Bridge conectado al puerto ${linkStatus.listenPort}`);
  }
  const ok = Boolean(socket?.online) || Boolean(remote?.connected) || linkStatus.bridgeClients > 0;
  return { ok, text: parts.join(" · ") };
}

function handleSnapshot(snapshot = {}) {
  if (snapshot.status) linkStatus = snapshot.status;
  Object.entries(snapshot.aliases || {}).forEach(([id, alias]) => aliases.set(id, alias));
  (snapshot.panics || []).forEach((id) => panics.add(id));
  (snapshot.units || []).forEach((unit) => handleEvent({ ...unit, type: "unit" }));
  // Al reconectar no se repiten los mensajes que ya se tienen.
  if (!messages.length) (snapshot.messages || []).forEach((msg) => pushMessage(msg, { countUnread: false }));
  renderPanel();
}

// ── Panel ────────────────────────────────────────────────────

let renderQueued = false;
function schedulePanelRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderPanel();
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function flyTo(lat, lon) {
  dashboardState.viewer?.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, 25_000),
    duration: 1.2,
  });
}

function formatTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "";
}

function buildPanel() {
  panel = el("section", "sedamPanel collapsed");
  panel.setAttribute("aria-label", "SEDAM");

  const header = el("button", "sedamPanelHeader");
  header.type = "button";
  header.append(el("span", "sedamPanelDot"), el("span", "sedamPanelTitle", "SEDAM"), el("span", "sedamPanelCount", "0"));
  header.onclick = () => panel.classList.toggle("collapsed");

  const tabs = el("div", "sedamPanelTabs");
  [["unidades", "Unidades"], ["blancos", "Blancos / WP"], ["mensajes", "Mensajes"]].forEach(([key, text]) => {
    const tab = el("button", "sedamPanelTab", text);
    tab.type = "button";
    tab.dataset.tab = key;
    tab.onclick = () => {
      activeTab = key;
      if (key === "mensajes") unreadMessages = 0;
      renderPanel();
    };
    tabs.appendChild(tab);
  });

  panel.append(header, tabs, el("div", "sedamPanelBody"));
  document.body.appendChild(panel);
}

function unitRow(unit) {
  const row = el("button", `sedamRow${panics.has(unit.id) ? " panic" : ""}`);
  row.type = "button";
  row.onclick = () => flyTo(unit.lat, unit.lon);
  const sidc = unit.sidc && unit.sidc.length >= 10 ? unit.sidc : DEFAULT_SIDC;
  const icon = symbolImage(sidc, null);
  const iconBox = el("span", "sedamRowIcon");
  if (icon) iconBox.appendChild(Object.assign(document.createElement("img"), { src: icon.toDataURL(), alt: "" }));
  const info = el("span", "sedamRowInfo");
  info.append(
    el("strong", null, displayName(unit.id)),
    el("small", null, `${unit.lat.toFixed(5)} / ${unit.lon.toFixed(5)}${Number.isFinite(unit.speed) ? ` · ${unit.speed.toFixed(1)} km/h` : ""}`),
  );
  row.append(iconBox, info);
  if (isTarget(unit.id) || isWaypoint(unit.id)) {
    const owner = unit.id.slice(1).split("-")[0];
    info.appendChild(el("small", null, `De: ${displayName(owner)}`));
    // Lo borra solo de este sistema (los demás lo siguen viendo) y ya no regresa aunque lo reenvíen.
    const remove = el("span", "sedamRowDelete", "✕");
    remove.setAttribute("role", "button");
    remove.title = "Borrar de mi mapa";
    remove.onclick = (event) => {
      event.stopPropagation();
      if (!confirm(`¿Borrar "${displayName(unit.id)}" de tu mapa? Ya no volverá a aparecer.`)) return;
      bridgeSocket?.emit("sedam_bridge_hide", { id: unit.id });
      removeUnit(unit.id);
      renderPanel();
    };
    row.appendChild(remove);
  }
  return row;
}

// Waypoints y blancos propios del dashboard (entidades "poi_<id>"), públicos o privados.
function ownPoiObjects() {
  const viewer = dashboardState.viewer;
  if (!viewer) return [];
  const time = viewer.clock.currentTime;
  return viewer.entities.values
    .filter((entity) => String(entity.id).startsWith("poi_") && entity.show !== false)
    .map((entity) => {
      const position = entity.position?.getValue?.(time);
      if (!position) return null;
      const carto = Cesium.Cartographic.fromCartesian(position);
      const prop = (name) => entity.properties?.[name]?.getValue?.(time) ?? entity.properties?.[name];
      const image = entity.billboard?.image?.getValue?.(time);
      return {
        entity,
        name: entity.name || "Sin nombre",
        sidc: String(prop("sidc") || ""),
        isPublic: String(prop("visibilidad") || "PRIVADO").toUpperCase() === "PUBLICO",
        speed: Number(prop("velocidad_kmh")),
        image: typeof image === "string" ? image : image?.toDataURL?.() || null,
        lat: Cesium.Math.toDegrees(carto.latitude),
        lon: Cesium.Math.toDegrees(carto.longitude),
      };
    })
    .filter(Boolean);
}

function ownPoiRow(poi) {
  const row = el("button", "sedamRow");
  row.type = "button";
  row.onclick = () => flyTo(poi.lat, poi.lon);
  const iconBox = el("span", "sedamRowIcon");
  const src = poi.image || (poi.sidc.length >= 10 ? symbolImage(poi.sidc, null)?.toDataURL() : null);
  if (src) iconBox.appendChild(Object.assign(document.createElement("img"), { src, alt: "" }));
  const info = el("span", "sedamRowInfo");
  info.append(
    el("strong", null, poi.name),
    el("small", null, `${poi.lat.toFixed(5)} / ${poi.lon.toFixed(5)}${poi.speed > 0 ? ` · ${poi.speed.toFixed(1)} km/h` : ""}`),
    el("small", null, poi.isPublic ? "Mío · Público (se ve en SEDAM)" : "Mío · Privado"),
  );
  row.append(iconBox, info);
  return row;
}

function messageRow(msg) {
  const row = el(msg.type === "geochat" ? "button" : "div", "sedamMsg");
  const to = msg.type === "geochat" ? "GEO-MSG" : msg.to === "ALL" ? "General" : `Para ${displayName(msg.to)}`;
  const head = el("div", "sedamMsgHead");
  head.append(el("strong", null, displayName(msg.from)), el("span", null, `${to} · ${formatTime(msg.ts)}`));
  row.append(head, el("div", "sedamMsgText", msg.text));
  if (msg.type === "geochat") {
    row.type = "button";
    row.onclick = () => flyTo(msg.lat, msg.lon);
  }
  return row;
}

function renderPanel() {
  if (!panel) return;
  const all = [...units.values()];
  const own = all.filter((u) => !isTarget(u.id) && !isWaypoint(u.id));
  const objects = all.filter((u) => isTarget(u.id) || isWaypoint(u.id));
  const ownPois = ownPoiObjects();

  const link = describeLink();
  panel.querySelector(".sedamPanelCount").textContent = String(own.length);
  panel.querySelector(".sedamPanelHeader").title = link.text;
  panel.classList.toggle("offline", !link.ok);
  panel.classList.toggle("hasPanic", panics.size > 0);
  panel.querySelectorAll(".sedamPanelTab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === activeTab);
    const label = { unidades: `Unidades (${own.length})`, blancos: `Blancos / WP (${objects.length + ownPois.length})`, mensajes: "Mensajes" }[tab.dataset.tab];
    tab.textContent = label;
    if (tab.dataset.tab === "mensajes" && unreadMessages > 0) tab.appendChild(el("span", "sedamBadge", String(unreadMessages)));
  });

  const body = panel.querySelector(".sedamPanelBody");
  const byName = (a, b) => displayName(a.id).localeCompare(displayName(b.id));
  let rows;
  if (activeTab === "unidades") rows = own.sort(byName).map(unitRow);
  else if (activeTab === "blancos") {
    rows = [
      ...ownPois.sort((a, b) => a.name.localeCompare(b.name)).map(ownPoiRow),
      ...objects.sort(byName).map(unitRow),
    ];
  }
  else rows = [...messages].reverse().map(messageRow);

  body.replaceChildren(...rows);
}

export function initSedamLayer(socket) {
  if (!socket) return;
  bridgeSocket = socket;
  buildPanel();
  renderPanel();
  // Los puntos propios cambian sin eventos de SEDAM (se crean, publican o se mueven): se refresca la lista.
  setInterval(() => {
    if (activeTab === "blancos" && !panel.classList.contains("collapsed")) renderPanel();
  }, OWN_POI_REFRESH_MS);

  socket.on("sedam_bridge_snapshot", handleSnapshot);
  socket.on("sedam_bridge_event", handleEvent);
  socket.on("sedam_bridge_status", handleStatus);
  // Se pide el estado completo al conectar y en cada reconexión.
  socket.on("connect", () => socket.emit("sedam_bridge_subscribe"));
  if (socket.connected) socket.emit("sedam_bridge_subscribe");
}
