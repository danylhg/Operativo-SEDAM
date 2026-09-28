import { dashboardState } from "./dashboard.state.js";

const banners = new Map();

function validCoords(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { lat: latitude, lon: longitude };
}

function alertKey(data = {}) {
  const personalId = Number(data.id_personal);
  if (Number.isInteger(personalId) && personalId > 0) return `personal-${personalId}`;
  const ptt = String(data.ptt_label || "PTT").trim().toLowerCase();
  return `ptt-${ptt.replace(/[^a-z0-9_-]+/g, "-") || "sin-nombre"}`;
}

function compactPersonName(value) {
  return String(value || "").toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((part) => !["CAP", "TTE", "SGTO", "CABO", "OFICIAL", "CORONEL", "TENIENTE"].includes(part))
    .join(" ");
}

function trackedEntityForAlert(data = {}) {
  const viewer = dashboardState.viewer;
  if (!viewer) return null;
  const direct = dashboardState.trackingEntities?.get(`P:${data?.id_personal}`);
  if (direct) return direct;

  const requestedName = compactPersonName(data?.sender_name);
  if (!requestedName) return null;
  const time = viewer.clock.currentTime;
  for (const [key, entity] of dashboardState.trackingEntities || []) {
    if (!key.startsWith("P:")) continue;
    const fullName = entity?.properties?.trackingFullLabel?.getValue?.(time) || entity?.name || "";
    const trackedName = compactPersonName(fullName);
    if (trackedName && (trackedName.includes(requestedName) || requestedName.includes(trackedName))) return entity;
  }
  return null;
}

function trackingCoords(data) {
  const viewer = dashboardState.viewer;
  const entity = trackedEntityForAlert(data);
  if (!viewer || !entity) return null;
  const position = entity.position?.getValue?.(viewer.clock?.currentTime) ?? entity.position;
  if (!position) return null;
  try {
    const point = Cesium.Cartographic.fromCartesian(position);
    return validCoords(Cesium.Math.toDegrees(point.latitude), Cesium.Math.toDegrees(point.longitude));
  } catch (_) {
    return null;
  }
}

function alertCoords(data) {
  return trackingCoords(data) ||
    validCoords(data?.lat ?? data?.latitud, data?.lon ?? data?.lng ?? data?.longitud);
}

function zoneIds(data) {
  const prefix = `ptt-web-zone-${alertKey(data)}`;
  return [`${prefix}-outer`, `${prefix}-middle`, `${prefix}-inner`];
}

function clearPttZones(data) {
  const viewer = dashboardState.viewer;
  if (!viewer) return;
  zoneIds(data).forEach((id) => viewer.entities.removeById(id));
}

function showPttZones(data) {
  const viewer = dashboardState.viewer;
  const coords = alertCoords(data);
  if (!viewer || !coords) return false;
  clearPttZones(data);

  const ids = zoneIds(data);
  const fallbackPosition = Cesium.Cartesian3.fromDegrees(coords.lon, coords.lat, 1);
  // La zona sigue al marcador del elemento mientras recibe nuevas posiciones.
  const position = new Cesium.CallbackProperty(() => {
    const tracked = trackedEntityForAlert(data);
    const trackedPosition = tracked?.position?.getValue?.(viewer.clock.currentTime) || tracked?.position;
    return trackedPosition || fallbackPosition;
  }, false);
  const startedAt = performance.now();
  const cycleMs = 1800;
  const zones = [
    { id: ids[0], radius: 110, phase: 0.00, fill: "#DC2626", alpha: 0.42, outline: "#EF4444" },
    { id: ids[1], radius: 78, phase: 0.33, fill: "#F59E0B", alpha: 0.48, outline: "#FBBF24" },
    { id: ids[2], radius: 48, phase: 0.66, fill: "#67E8F9", alpha: 0.58, outline: "#BAE6FD" }
  ];

  zones.forEach((zone) => {
    const baseColor = Cesium.Color.fromCssColorString(zone.fill);
    const wave = () => {
      const progress = ((performance.now() - startedAt) / cycleMs + zone.phase) % 1;
      return (Math.sin(progress * Math.PI * 2) + 1) / 2;
    };
    const radius = new Cesium.CallbackProperty(() => zone.radius * (0.82 + wave() * 0.20), false);
    viewer.entities.add({
      id: zone.id,
      name: "Zona de alerta PTT",
      position,
      ellipse: {
        semiMajorAxis: radius,
        semiMinorAxis: radius,
        material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(
          () => baseColor.withAlpha(zone.alpha * (0.58 + wave() * 0.42)), false
        )),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString(zone.outline),
        outlineWidth: 2,
        height: 1,
        classificationType: Cesium.ClassificationType.BOTH
      },
      label: zone.id === ids[2] ? {
        text: String(data?.sender_name || "ELEMENTO PTT").toUpperCase(),
        font: "700 13px system-ui, sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString("#1f2937"),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#0f172a").withAlpha(0.84),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
        pixelOffset: new Cesium.Cartesian2(0, -32),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      } : undefined,
      properties: { tacticalType: "ptt-emergency-zone", transient: true, draggable: false }
    });
  });
  viewer.scene.requestRender();
  return true;
}

function currentPersonalId() {
  let stored = {};
  let tokenPayload = {};
  try { stored = JSON.parse(localStorage.getItem("userData") || "{}"); } catch (_) { /* empty */ }
  try {
    const token = localStorage.getItem("token") || "";
    tokenPayload = JSON.parse(atob(token.split(".")[1] || ""));
  } catch (_) { /* empty */ }
  const table = String(tokenPayload.tabla || stored.tabla || "").toLowerCase();
  const value = tokenPayload.id_personal || stored.id_personal ||
    (table === "personal" ? tokenPayload.sub : null);
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function focusPttAlert(data) {
  const viewer = dashboardState.viewer;
  const coords = alertCoords(data);
  if (!viewer || !coords) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(coords.lon, coords.lat, 1200),
    duration: 0.6
  });
}

function makeBanner(key) {
  const node = document.createElement("aside");
  node.className = "emergencyTopBanner pttEmergencyBanner";
  node.setAttribute("aria-live", "assertive");
  node.innerHTML = `
    <button type="button" class="emergencyTopBannerClose pttAlertClose" aria-label="Cerrar alerta">&times;</button>
    <div class="emergencyTopBannerTitle">
      <svg class="pttAlertWarning" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path class="pttAlertWarningShape" d="M12 2.4 2.25 20.2c-.4.75.14 1.65 1 1.65h17.5c.86 0 1.4-.9 1-1.65L12 2.4Z"></path>
        <path class="pttAlertWarningMark" d="M12 8v6"></path>
        <circle class="pttAlertWarningMark" cx="12" cy="17.5" r="1"></circle>
      </svg>
      <strong class="pttAlertTitle"></strong>
      <span class="emergencyTopBannerTime pttAlertTime"></span>
    </div>
    <div class="emergencyTopBannerBody">
      <div class="emergencyTopBannerDetails"><span class="emergencyTopBannerStatus pttAlertPerson"></span></div>
      <button type="button" class="emergencyLocationButton pttAlertLocation">
        <svg class="emergencyLocationIcon" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          <path d="M12 21s7-6.05 7-12a7 7 0 1 0-14 0c0 5.95 7 12 7 12Z"></path>
          <circle cx="12" cy="9" r="2.35"></circle>
        </svg>
        <span>VER UBICACION</span>
      </button>
    </div>`;
  node.querySelector(".pttAlertClose")?.addEventListener("click", () => {
    node.remove();
    banners.delete(key);
  });
  (document.getElementById("emergencyAlertStack") || document.body).appendChild(node);
  banners.set(key, node);
  return node;
}

function showBanner(data) {
  const key = alertKey(data);
  const node = banners.get(key) || makeBanner(key);
  const name = String(data?.sender_name || "ELEMENTO PTT").trim().toUpperCase();
  const pttName = String(data?.ptt_label || "PTT").trim().toUpperCase();
  const coords = alertCoords(data);
  const moment = new Date(data?.timestamp || Date.now());
  const time = Number.isNaN(moment.getTime()) ? "" : moment.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  node.querySelector(".pttAlertTitle").textContent = `ALERTA DESDE ${pttName}`;
  node.querySelector(".pttAlertTime").textContent = time;
  node.querySelector(".pttAlertPerson").textContent = name;
  const locationButton = node.querySelector(".pttAlertLocation");
  locationButton.disabled = !coords;
  locationButton.style.display = coords ? "inline-flex" : "none";
  locationButton.onclick = () => focusPttAlert(data);
  node.style.display = "block";
  requestAnimationFrame(() => node.classList.add("visible"));
}

function hideBanner(data) {
  const key = alertKey(data);
  const node = banners.get(key);
  if (!node) return;
  node.classList.remove("visible");
  window.setTimeout(() => {
    node.remove();
    if (banners.get(key) === node) banners.delete(key);
  }, 260);
}

export function initPttAlerts(socket) {
  if (!socket) return;
  socket.off("ptt_alert_update");
  socket.on("ptt_alert_update", (data = {}) => {
    const senderId = Number(data.id_personal);
    const ownId = currentPersonalId();
    if (ownId && senderId === ownId) return;
    if (data.active === true) {
      showPttZones(data);
      showBanner(data);
    } else {
      clearPttZones(data);
      hideBanner(data);
    }
  });
}
