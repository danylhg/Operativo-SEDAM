// js/dashboard/dashboard.emergency.js

import { dashboardState } from "./dashboard.state.js";

const EMERGENCY_PULSE_COLOR_HEX = ["#FF1D25", "#FFD400", "#00E5FF"];

const emergencyPulseEntities = new Map();

function isUrgentMessage(msg) {
  return String(msg?.tipo_mensaje || "").toUpperCase() === "URGENTE";
}

function normalizeCoords(lat, lon) {
  const nLat = Number(lat);
  const nLon = Number(lon);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) return null;
  if (Math.abs(nLat) > 90 || Math.abs(nLon) > 180) return null;
  return { lat: nLat, lon: nLon };
}

function coordsFromEmergencyText(text) {
  const match = String(text || "").match(
    /UBICACI\S*N\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i
  );
  if (!match) return null;
  return normalizeCoords(match[1], match[2]);
}

function senderPersonalId(msg) {
  const raw = msg?.id_personal ?? msg?.idPersonal ?? msg?.personal_id;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? String(id) : "";
}

function coordsFromTrackingEntity(idPersonal) {
  const viewer = dashboardState.viewer;
  if (!viewer || !idPersonal) return null;

  const entity = dashboardState.trackingEntities?.get(`P:${idPersonal}`);
  const time = viewer.clock?.currentTime || Cesium.JulianDate.now();
  const position = entity?.position?.getValue?.(time) ?? entity?.position;
  if (!position) return null;

  try {
    const cartographic = Cesium.Cartographic.fromCartesian(position);
    return normalizeCoords(
      Cesium.Math.toDegrees(cartographic.latitude),
      Cesium.Math.toDegrees(cartographic.longitude)
    );
  } catch (_) {
    return null;
  }
}

function coordsFromTrackingHistory(idPersonal) {
  if (!idPersonal) return null;
  const history = dashboardState.trackingHistory?.get(`P:${idPersonal}`);
  return normalizeCoords(
    history?.lat ?? history?.latitud,
    history?.lng ?? history?.lon ?? history?.longitud
  );
}

function getEmergencyCoordsForChatMessage(msg) {
  const idPersonal = senderPersonalId(msg);
  return coordsFromEmergencyText(msg?.contenido) ||
    coordsFromTrackingEntity(idPersonal) ||
    coordsFromTrackingHistory(idPersonal);
}

function getEmergencyFocusCoordsForChatMessage(msg) {
  const idPersonal = senderPersonalId(msg);
  return coordsFromTrackingEntity(idPersonal) ||
    coordsFromTrackingHistory(idPersonal) ||
    coordsFromEmergencyText(msg?.contenido);
}

function removeEmergencyPulse(key) {
  const viewer = dashboardState.viewer;
  const entities = emergencyPulseEntities.get(key);
  if (!entities) return;

  entities.forEach((entity) => {
    if (viewer && entity) viewer.entities.remove(entity);
  });
  emergencyPulseEntities.delete(key);
}

function drawEmergencyPulse(key, coords, name) {
  const viewer = dashboardState.viewer;
  if (!viewer || !key || !coords) return;

  removeEmergencyPulse(key);

  const position = Cesium.Cartesian3.fromDegrees(coords.lon, coords.lat);
  const startedAt = Date.now();
  const durationMs = 4200;
  const pulseEntities = EMERGENCY_PULSE_COLOR_HEX.map((colorHex, index) => {
    const color = Cesium.Color.fromCssColorString(colorHex);
    const delayMs = index * 430;

    const progress = () => Math.max(
      0,
      Math.min(1, (Date.now() - startedAt - delayMs) / durationMs)
    );

    return viewer.entities.add({
      name: name || "Emergencia",
      position,
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => 35 + progress() * 360, false),
        semiMinorAxis: new Cesium.CallbackProperty(() => 35 + progress() * 360, false),
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(() => {
            const amount = progress();
            const alpha = amount <= 0 ? 0 : Math.max(0, 0.68 * (1 - amount));
            return color.withAlpha(alpha);
          }, false)
        ),
        outline: true,
        outlineColor: color.withAlpha(0.95),
        outlineWidth: 4,
        height: 0,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      },
      properties: {
        tacticalType: "emergency-pulse",
        transient: true,
        draggable: false
      }
    });
  });

  emergencyPulseEntities.set(key, pulseEntities);
  window.setTimeout(() => {
    removeEmergencyPulse(key);
  }, durationMs + (EMERGENCY_PULSE_COLOR_HEX.length * 430) + 300);
}

export function pulseEmergencyForChatMessage(msg) {
  if (!isUrgentMessage(msg)) return false;

  const idPersonal = senderPersonalId(msg);
  const coords = getEmergencyCoordsForChatMessage(msg);

  if (!coords) return false;

  const key = idPersonal
    ? `P:${idPersonal}`
    : `M:${msg?.id_mensaje || Date.now()}`;
  const author = String(msg?.autor_nombre || "").trim();
  drawEmergencyPulse(key, coords, author ? `Emergencia - ${author}` : "Emergencia");
  return true;
}

export function focusEmergencyForChatMessage(msg) {
  if (!isUrgentMessage(msg)) return false;

  const viewer = dashboardState.viewer;
  const coords = getEmergencyFocusCoordsForChatMessage(msg);
  if (!viewer || !coords) return false;

  const idPersonal = senderPersonalId(msg);
  const trackingKey = idPersonal ? `P:${idPersonal}` : "";
  const entity = trackingKey ? dashboardState.trackingEntities?.get(trackingKey) : null;
  if (entity) {
    dashboardState.selectedEntity = entity;
  }

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(coords.lon, coords.lat, 1800),
    orientation: {
      heading: viewer.camera.heading,
      pitch: viewer.camera.pitch,
      roll: viewer.camera.roll
    },
    duration: 0.55
  });

  const key = idPersonal
    ? `P:${idPersonal}`
    : `M:${msg?.id_mensaje || Date.now()}`;
  const author = String(msg?.autor_nombre || "").trim();
  drawEmergencyPulse(key, coords, author ? `Emergencia - ${author}` : "Emergencia");
  return true;
}
