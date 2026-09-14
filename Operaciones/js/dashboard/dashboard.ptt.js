import { dashboardState } from "./dashboard.state.js";

let banner = null;
let activeAlert = null;
const zoneEntityIds = ["ptt-web-zone-outer", "ptt-web-zone-middle", "ptt-web-zone-inner"];

function validCoords(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { lat: latitude, lon: longitude };
}

function trackingCoords(idPersonal) {
  const viewer = dashboardState.viewer;
  const entity = dashboardState.trackingEntities?.get(`P:${idPersonal}`);
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
  return validCoords(data?.lat ?? data?.latitud, data?.lon ?? data?.lng ?? data?.longitud) ||
    trackingCoords(data?.id_personal);
}

function clearPttZones() {
  const viewer = dashboardState.viewer;
  if (!viewer) return;
  zoneEntityIds.forEach((id) => viewer.entities.removeById(id));
}

function showPttZones(data) {
  const viewer = dashboardState.viewer;
  const coords = alertCoords(data);
  if (!viewer || !coords) return false;
  clearPttZones();

  const tracked = dashboardState.trackingEntities?.get(`P:${data?.id_personal}`);
  const position = tracked?.position || Cesium.Cartesian3.fromDegrees(coords.lon, coords.lat, 1);
  const startedAt = performance.now();
  const cycleMs = 1800;
  const zones = [
    { id: zoneEntityIds[0], radius: 300, phase: 0.00, fill: "#DC2626", alpha: 0.42, outline: "#EF4444" },
    { id: zoneEntityIds[1], radius: 220, phase: 0.33, fill: "#F59E0B", alpha: 0.48, outline: "#FBBF24" },
    { id: zoneEntityIds[2], radius: 140, phase: 0.66, fill: "#67E8F9", alpha: 0.58, outline: "#BAE6FD" }
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
        outlineWidth: 3,
        height: 1,
        classificationType: Cesium.ClassificationType.BOTH
      },
      properties: { tacticalType: "ptt-emergency-zone", transient: true, draggable: false }
    });
  });
  viewer.scene.requestRender();
  return true;
}

function currentPersonalId() {
  let stored = {};
  let tokenPayload = {};
  try { stored = JSON.parse(localStorage.getItem("userData") || "{}"); } catch (_) { /* vacio */ }
  try {
    const token = localStorage.getItem("token") || "";
    tokenPayload = JSON.parse(atob(token.split(".")[1] || ""));
  } catch (_) { /* vacio */ }
  const table = String(tokenPayload.tabla || stored.tabla || "").toLowerCase();
  const value = tokenPayload.id_personal || stored.id_personal ||
    (table === "personal" ? tokenPayload.sub : null);
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function ensureBanner() {
  if (banner) return banner;
  banner = document.createElement("button");
  banner.type = "button";
  banner.id = "pttEmergencyBanner";
  banner.setAttribute("aria-live", "assertive");
  Object.assign(banner.style, {
    position: "fixed", top: "18px", left: "50%", transform: "translate(-50%, -130%)",
    zIndex: "100000", minWidth: "320px", maxWidth: "min(620px, calc(100vw - 32px))",
    padding: "13px 22px", border: "2px solid #fb7185", borderRadius: "14px",
    background: "linear-gradient(135deg, rgba(127,29,29,.98), rgba(190,18,60,.96))",
    color: "white", font: "700 14px/1.35 system-ui, sans-serif", letterSpacing: ".03em",
    textAlign: "center", cursor: "pointer", boxShadow: "0 10px 35px rgba(127,29,29,.55)",
    opacity: "0", transition: "transform .25s ease, opacity .25s ease"
  });
  banner.onclick = focusActivePttAlert;
  document.body.appendChild(banner);
  return banner;
}

function showBanner(data) {
  const node = ensureBanner();
  const name = String(data?.sender_name || "ELEMENTO PTT").trim().toUpperCase();
  const coords = alertCoords(data);
  node.textContent = `ALERTA DE EMERGENCIA PTT · ${name}${coords ? " · VER UBICACION" : ""}`;
  node.style.display = "block";
  requestAnimationFrame(() => {
    node.style.opacity = "1";
    node.style.transform = "translate(-50%, 0)";
  });
}

function hideBanner() {
  if (!banner) return;
  banner.style.opacity = "0";
  banner.style.transform = "translate(-50%, -130%)";
  window.setTimeout(() => {
    if (!activeAlert && banner) banner.style.display = "none";
  }, 260);
}

function focusActivePttAlert() {
  const viewer = dashboardState.viewer;
  const coords = alertCoords(activeAlert);
  if (!viewer || !coords) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(coords.lon, coords.lat, 1200),
    duration: 0.6
  });
}

export function initPttAlerts(socket) {
  if (!socket) return;
  socket.off("ptt_alert_update");
  socket.on("ptt_alert_update", (data = {}) => {
    const senderId = Number(data.id_personal);
    const ownId = currentPersonalId();
    if (ownId && senderId === ownId) return;
    if (data.active === true) {
      activeAlert = data;
      showPttZones(data);
      showBanner(data);
    } else {
      activeAlert = null;
      clearPttZones();
      hideBanner();
    }
  });
}
