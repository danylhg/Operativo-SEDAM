// js/dashboard/dashboard.tracking.js

import { dashboardState } from "./dashboard.state.js";
import { processTrackingUpdate, shouldShowPersonEntity } from "./dashboard.tracking.clustering.js";
import {
  ASIGNACION_ACTUAL_KEY,
  getCurrentOperation,
  getJsonStorage
} from "./dashboard.storage.js";
import {
  activatePersonalLocation,
  activateTrackingLocation,
  refreshPersonnelInfoPopup,
  updateFollowedPersonalLocation,
  updateFollowedTrackingLocation
} from "./dashboard.ui.js?v=20260923-draggable-person-popup";

const API_BASE = () => localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
const token = () => localStorage.getItem("token");
const opId = () => localStorage.getItem("active_operation_id");

// ── Iconos / colores ─────────────────────────────────────────
const TRACKING_COLOR_HEX = {
  personal: "#00BFFF",
  vehiculo: "#FFD700",
  equipo: "#B4FF39",
  dispositivo: "#FF8A3D"
};
const TRACKING_SYMBOL_SIZE = 42;
const TRACKING_SYMBOL_RENDER_SIZE = 160;
const TRACKING_ACTIVE_STALE_MS = 30000;
const TRACKING_HEADING_START_M = 7;
const TRACKING_HEADING_LENGTH_M = 32;
const TRACKING_LABEL_MAX_CHARS = 18;
const TRACKING_DRONE_LABEL_MAX_CHARS = 14;
const trackingSymbolImageCache = new Map();

function trackingColor(type) {
  return Cesium.Color.fromCssColorString(TRACKING_COLOR_HEX[type] || TRACKING_COLOR_HEX.personal);
}

function getTrackingScaleByDistance() {
  return new Cesium.NearFarScalar(1e3, 1.5, 2e6, 0.1);
}

function getSymbolScaleByDistance() {
  return new Cesium.NearFarScalar(1e3, 1.0, 2e6, 0.28);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function textIncludes(text, ...needles) {
  return needles.some(needle => text.includes(needle));
}

function buildMilSidc(identity = "F", dimension = "G", icon = "U-----") {
  const safeIcon = String(icon || "U-----").padEnd(6, "-").slice(0, 6);
  return `S${identity}${dimension}P${safeIcon}-----`;
}

function getFallbackMilSidc(tacticalType = "personal") {
  if (tacticalType === "vehiculo") return buildMilSidc("F", "G", "EV----");
  if (tacticalType === "equipo") return buildMilSidc("F", "G", "E-----");
  if (tacticalType === "dispositivo") return buildMilSidc("F", "G", "UCS---");
  return buildMilSidc("F", "G", "UCI---");
}

function resolveTrackingMilSymbol(tacticalType, item = {}) {
  const providedSidc = item.sidc || item.codigo_sidc || item.mil_sidc;
  if (providedSidc) return String(providedSidc);

  const text = normalizeText([
    tacticalType,
    item.rol_en_operacion,
    item.rol,
    item.tipo,
    item.tipo_equipo,
    item.tipo_tactico,
    item.categoria,
    item.nombre,
    item.marca,
    item.modelo,
    item.sistema_operativo,
    item.codigo_interno,
    item.alias
  ].filter(Boolean).join(" "));

  if (tacticalType === "vehiculo") {
    if (textIncludes(text, "AMBULANC", "MEDIC")) return buildMilSidc("F", "G", "UCM---");
    if (textIncludes(text, "BLIND", "TANQUE", "ARMORED")) return buildMilSidc("F", "G", "UCD---");
    if (textIncludes(text, "PATRULL", "POLIC", "SEGUR")) return buildMilSidc("F", "G", "UCF---");
    return buildMilSidc("F", "G", "EV----");
  }

  if (tacticalType === "equipo") {
    if (textIncludes(text, "DRON", "DRONE", "UAV", "MATRICE")) return buildMilSidc("F", "A", "MFQ---");
    if (textIncludes(text, "RADIO", "COMUNIC", "SENAL", "SIGNAL")) return buildMilSidc("F", "G", "UCS---");
    if (textIncludes(text, "ARMA", "RIFLE", "PISTOLA", "FUSIL")) return buildMilSidc("F", "G", "EW----");
    if (textIncludes(text, "CAMARA", "SENSOR", "TACTICO")) return buildMilSidc("F", "G", "EX----");
    return buildMilSidc("F", "G", "E-----");
  }

  if (tacticalType === "dispositivo") {
    if (textIncludes(text, "TELEFONO", "CELULAR", "TABLET", "RADIO", "COMUNIC")) {
      return buildMilSidc("F", "G", "UCS---");
    }
    if (textIncludes(text, "CAMARA", "SENSOR")) return buildMilSidc("F", "G", "EX----");
    return buildMilSidc("F", "G", "E-----");
  }

  if (tacticalType === "personal") {
    if (textIncludes(text, "CUT", "CET")) return buildMilSidc("F", "G", "UCI---");
    if (textIncludes(text, "CELL", "CELULA")) return buildMilSidc("F", "G", "UCI---");
    if (textIncludes(text, "PATRULL", "POLIC", "SEGUR")) return buildMilSidc("F", "G", "UCF---");
    return getFallbackMilSidc("personal");
  }

  return getFallbackMilSidc(tacticalType);
}

function renderMilSymbol(sidc) {
  if (!sidc || typeof ms === "undefined" || typeof ms.Symbol !== "function") return null;
  if (trackingSymbolImageCache.has(sidc)) return trackingSymbolImageCache.get(sidc);

  try {
    const symbol = new ms.Symbol(sidc, {
      size: TRACKING_SYMBOL_RENDER_SIZE,
      colorMode: "Light"
    });

    if (typeof symbol.isValid === "function" && symbol.isValid() === false) {
      trackingSymbolImageCache.set(sidc, null);
      return null;
    }

    if (typeof symbol.asSVG === "function" && />\s*\?\s*</.test(symbol.asSVG())) {
      trackingSymbolImageCache.set(sidc, null);
      return null;
    }

    const image = symbol.asCanvas();
    trackingSymbolImageCache.set(sidc, image);
    return image;
  } catch (err) {
    console.warn("[TRACKING] No se pudo generar simbolo MIL:", sidc, err);
    trackingSymbolImageCache.set(sidc, null);
    return null;
  }
}

function makeTrackingBillboard(image) {
  return new Cesium.BillboardGraphics({
    image,
    width: TRACKING_SYMBOL_SIZE,
    height: TRACKING_SYMBOL_SIZE,
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    scaleByDistance: getSymbolScaleByDistance()
  });
}

function getTrackingMarker(meta) {
  const tacticalType = meta.tacticalType || "personal";
  const sidc = resolveTrackingMilSymbol(tacticalType, meta.liveData || {});
  const fallbackSidc = getFallbackMilSidc(tacticalType);
  let image = renderMilSymbol(sidc);
  let renderedSidc = sidc;

  if (!image && sidc !== fallbackSidc) {
    image = renderMilSymbol(fallbackSidc);
    if (image) renderedSidc = fallbackSidc;
  }

  return {
    sidc: renderedSidc,
    billboard: image ? makeTrackingBillboard(image) : undefined,
    point: undefined,
    labelOffset: new Cesium.Cartesian2(0, 17)
  };
}

function makePersonalLabel(item) {
  const fullName = [item.nombre, item.apellido].filter(Boolean).join(" ").trim();
  return fullName || item.apodo || item.nombre || item.apellido || `P-${item.id_personal}`;
}

function makeVehiculoLabel(item) {
  const codigo = item.codigo_interno || "";
  const alias = item.alias || "";
  if (codigo && alias) return `${codigo} - ${alias}`;
  return codigo || alias || `V-${item.id_vehiculo}`;
}

function makeEquipoLabel(item) {
  const serie = item.numero_serie || "";
  const nombre = item.nombre || item.tipo_equipo || "";
  if (serie && nombre) return `${serie} - ${nombre}`;
  return nombre || serie || `E-${item.id_equipo}`;
}

function compactTrackingLabel(value, maxChars = TRACKING_LABEL_MAX_CHARS) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 3)).trim()}...`;
}

function stripTrackingIdentityPrefix(value) {
  return String(value || "")
    .replace(/^[A-Z0-9_-]{8,}\s*-\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeTrackingMapLabel(key, label, meta = {}) {
  const kind = meta.tacticalType || (String(key || "").startsWith("E:") ? "equipo" : "");
  if (kind !== "equipo") return compactTrackingLabel(label);

  const item = meta.liveData || {};
  const text = normalizeText([
    item.categoria,
    item.tipo_equipo,
    item.tipo,
    item.nombre,
    label
  ].filter(Boolean).join(" "));

  const preferred = stripTrackingIdentityPrefix(item.nombre || item.tipo_equipo || label);
  if (textIncludes(text, "DRON", "DRONE", "UAV", "MATRICE")) {
    const droneLabel = preferred.replace(/\bDJI\b\s*/i, "").trim() || preferred || "Dron";
    return compactTrackingLabel(droneLabel, TRACKING_DRONE_LABEL_MAX_CHARS);
  }

  return compactTrackingLabel(preferred || label);
}

function makeDispositivoLabel(item) {
  const modelo = [item.marca, item.modelo].filter(Boolean).join(" ").trim();
  const tipo = item.tipo || "Dispositivo";
  const serie = item.numero_serie || item.imei || item.numero_telefono || "";
  if (modelo && serie) return `${tipo} ${modelo} - ${serie}`;
  return modelo || serie || `${tipo}-${item.id_dispositivo}`;
}

function normalizeCoords(lat, lng) {
  if (lat === undefined || lat === null || String(lat).trim() === "") return null;
  if (lng === undefined || lng === null || String(lng).trim() === "") return null;
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return null;
  if (Math.abs(nLat) > 90 || Math.abs(nLng) > 180) return null;
  if (nLat === 0 && nLng === 0) return null;
  return { lat: nLat, lng: nLng };
}

function parseTrackingTimestamp(value) {
  if (value == null || String(value).trim() === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function trackingTimestamp(item = {}) {
  return firstTrackingValue(
    item.timestamp,
    item.updated_at,
    item.fecha_actualizacion,
    item.ultima_actualizacion,
    item.last_update,
    item.lastUpdated
  );
}

function isFreshTrackingItem(item = {}) {
  const timestamp = parseTrackingTimestamp(trackingTimestamp(item));
  if (!timestamp) return false;
  return Date.now() - timestamp <= TRACKING_ACTIVE_STALE_MS;
}

function getCoords(item) {
  const lat = item?.latitud ?? item?.lat;
  const lng = item?.longitud ?? item?.lng ?? item?.lon;
  if (lat == null || lng == null) return null;
  return normalizeCoords(lat, lng);
}

function assignedPersonalId(item) {
  const value = item?.id_personal ?? item?.personal_id ?? item?.id_personal_asignado;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function firstTrackingValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function normalizeHeadingDegrees(value) {
  const raw = firstTrackingValue(value);
  if (raw == null) return null;
  const degrees = Number(String(raw).replace(/[^\d.+-]/g, "").trim());
  if (!Number.isFinite(degrees)) return null;
  return ((degrees % 360) + 360) % 360;
}

function trackingHeadingDegrees(meta = {}) {
  const liveData = meta.liveData || {};
  return normalizeHeadingDegrees(firstTrackingValue(
    liveData.rumbo_grados,
    liveData.rumboGrados,
    liveData.headingDegrees,
    liveData.heading,
    liveData.bearing,
    liveData.curso,
    liveData.rumbo,
    meta.rumbo_grados,
    meta.rumboGrados,
    meta.headingDegrees,
    meta.heading,
    meta.bearing,
    meta.curso,
    meta.rumbo
  ));
}

function headingEndPosition(lat, lng, headingDegrees, meters = TRACKING_HEADING_LENGTH_M) {
  const origin = Cesium.Cartesian3.fromDegrees(lng, lat);
  const radians = Cesium.Math.toRadians(headingDegrees);
  const localStart = new Cesium.Cartesian3(
    Math.sin(radians) * TRACKING_HEADING_START_M,
    Math.cos(radians) * TRACKING_HEADING_START_M,
    0
  );
  const localEnd = new Cesium.Cartesian3(
    Math.sin(radians) * meters,
    Math.cos(radians) * meters,
    0
  );
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  const start = Cesium.Matrix4.multiplyByPoint(enu, localStart, new Cesium.Cartesian3());
  const end = Cesium.Matrix4.multiplyByPoint(enu, localEnd, new Cesium.Cartesian3());
  return { start, end };
}

function trackingDirectionArrowImage(headingDegrees) {
  // Mismo gráfico de rumbo utilizado por los Blancos tácticos.
  const radians = Cesium.Math.toRadians(headingDegrees);
  const pointsUpward = true;
  const startX = 40 + Math.sin(radians) * 19;
  const startY = 40 - Math.cos(radians) * 19;
  const elbowX = 40;
  const elbowY = 40;
  const length = 39;
  const tipX = elbowX + Math.sin(radians) * length;
  const tipY = elbowY - Math.cos(radians) * length;
  const headLength = 9;
  const leftX = tipX - Math.sin(radians - Math.PI / 6) * headLength;
  const leftY = tipY + Math.cos(radians - Math.PI / 6) * headLength;
  const rightX = tipX - Math.sin(radians + Math.PI / 6) * headLength;
  const rightY = tipY + Math.cos(radians + Math.PI / 6) * headLength;
  const n = (value) => Number(value).toFixed(1);
  const connector = pointsUpward
    ? `M${startX} ${startY}L${n(tipX)} ${n(tipY)}`
    : `M${startX} ${startY}V${elbowY}L${n(tipX)} ${n(tipY)}`;
  const arrowPath = `${connector}M${n(tipX)} ${n(tipY)}L${n(leftX)} ${n(leftY)}M${n(tipX)} ${n(tipY)}L${n(rightX)} ${n(rightY)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><path d="${arrowPath}" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="${arrowPath}" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return {
    image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    pointsUpward
  };
}

function northAlignedAxis(position) {
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(position);
  const north = Cesium.Matrix4.multiplyByPointAsVector(
    enu,
    new Cesium.Cartesian3(0, 1, 0),
    new Cesium.Cartesian3()
  );
  return Cesium.Cartesian3.normalize(north, north);
}

function upsertTrackingHeadingLine(key, lat, lng, color, meta = {}) {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  const heading = trackingHeadingDegrees(meta);
  if (heading === null) {
    removeTrackingHeadingLine(key);
    return;
  }

  const existing = dashboardState.trackingHeadingEntities.get(key);
  const usesBlancoArrow = /^P:|^V:/.test(String(key));
  // Personal y vehículos muestran la misma flecha SVG que los Blancos.
  if (usesBlancoArrow) {
    const arrowGraphic = trackingDirectionArrowImage(heading);
    const verticalOrigin = Cesium.VerticalOrigin.CENTER;
    const pixelOffset = new Cesium.Cartesian2(0, -21);
    const alignedAxis = new Cesium.CallbackProperty(() => {
      const target = dashboardState.trackingEntities.get(key);
      const position = target?.position
        ? (target.position.getValue ? target.position.getValue(viewer.clock.currentTime) : target.position)
        : Cesium.Cartesian3.fromDegrees(lng, lat);
      return northAlignedAxis(position);
    }, false);

    if (existing) {
      existing.name = `Rumbo ${Math.round(heading)}°`;
      existing.billboard.image = arrowGraphic.image;
      existing.billboard.verticalOrigin = verticalOrigin;
      existing.billboard.pixelOffset = pixelOffset;
      existing.billboard.alignedAxis = alignedAxis;
      existing.properties.headingDegrees = heading;
      return;
    }

    const arrow = viewer.entities.add({
      name: `Rumbo ${Math.round(heading)}°`,
      position: new Cesium.CallbackProperty(() => {
        const target = dashboardState.trackingEntities.get(key);
        if (target?.position) {
          return target.position.getValue
            ? target.position.getValue(viewer.clock.currentTime)
            : target.position;
        }
        return Cesium.Cartesian3.fromDegrees(lng, lat);
      }, false),
      billboard: {
        image: arrowGraphic.image,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin,
        pixelOffset,
        // La flecha conserva el rumbo geográfico aunque se rote el mapa.
        alignedAxis,
        width: 80,
        height: 80,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      },
      properties: {
        trackingKey: key,
        tacticalType: "tracking-heading",
        headingLine: true,
        headingDegrees: heading,
        draggable: false
      }
    });
    dashboardState.trackingHeadingEntities.set(key, arrow);
    return;
  }

  const coords = headingEndPosition(lat, lng, heading);
  if (existing) {
    existing.polyline.positions = [coords.start, coords.end];
    existing.polyline.material = color.withAlpha(0.92);
    existing.properties.headingDegrees = heading;
    return;
  }

  const entity = viewer.entities.add({
    name: `Rumbo ${Math.round(heading)}°`,
    polyline: {
      positions: [coords.start, coords.end],
      width: 3,
      material: color.withAlpha(0.92),
      clampToGround: true
    },
    properties: {
      trackingKey: key,
      tacticalType: "tracking-heading",
      headingLine: true,
      headingDegrees: heading,
      draggable: false
    }
  });
  dashboardState.trackingHeadingEntities.set(key, entity);
}

function removeTrackingHeadingLine(key) {
  const entity = dashboardState.trackingHeadingEntities.get(key);
  if (!entity) return;
  const viewer = dashboardState.viewer;
  if (viewer) viewer.entities.remove(entity);
  dashboardState.trackingHeadingEntities.delete(key);
}

function normalizeDeviceIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function deviceIdentityValues(item = {}) {
  return [
    item.numero_serie,
    item.numeroSerie,
    item.serial_dispositivo,
    item.serial,
    item.imei,
    item.identificador_app,
    item.identificadorApp
  ]
    .map(normalizeDeviceIdentity)
    .filter(Boolean);
}

function getDeviceId(item = {}) {
  return firstTrackingValue(
    item.id_dispositivo,
    item.id,
    item.dispositivo_id,
    item.idDispositivo,
    item.device_id
  );
}

function getAssignedDevices() {
  const op = getCurrentOperation() || {};
  const asignacion = getJsonStorage(ASIGNACION_ACTUAL_KEY, {}) || {};
  return [
    ...(Array.isArray(asignacion.dispositivos) ? asignacion.dispositivos : []),
    ...(Array.isArray(op.dispositivos) ? op.dispositivos : [])
  ];
}

function findConfirmedDevice(item = {}) {
  const incomingIdentity = deviceIdentityValues(item);
  if (!incomingIdentity.length) return null;

  const incomingId = String(getDeviceId(item) ?? "").trim();
  const assigned = getAssignedDevices();
  if (!assigned.length) return item;
  const sameId = incomingId
    ? assigned.filter((candidate) => String(getDeviceId(candidate) ?? "").trim() === incomingId)
    : [];
  const candidates = sameId.length ? sameId : assigned;

  return candidates.find((candidate) => {
    const candidateIdentity = deviceIdentityValues(candidate);
    return candidateIdentity.length &&
      incomingIdentity.some((value) => candidateIdentity.includes(value));
  }) || null;
}

function upsertPersonalTracking(item) {
  const coords = getCoords(item);
  if (!coords || item?.id_personal == null) return;

  upsertTrackingEntity(`P:${item.id_personal}`, coords.lat, coords.lng, makePersonalLabel(item), trackingColor("personal"), {
    tacticalType: "personal",
    trackingRole: item.rol_en_operacion || item.rol || "",
    liveData: item
  });
  activatePersonalLocation(item.id_personal, coords.lat, coords.lng);
  updateFollowedPersonalLocation(item.id_personal, coords.lat, coords.lng);
  refreshPersonnelInfoPopup(item.id_personal, item);
}

function upsertVehiculoTracking(item) {
  const coords = getCoords(item);
  if (!coords || item?.id_vehiculo == null) return;

  upsertTrackingEntity(`V:${item.id_vehiculo}`, coords.lat, coords.lng, makeVehiculoLabel(item), trackingColor("vehiculo"), {
    tacticalType: "vehiculo",
    trackingRole: item.tipo || "",
    liveData: item
  });
  activateTrackingLocation("V", item.id_vehiculo, coords.lat, coords.lng);
  updateFollowedTrackingLocation(`V:${item.id_vehiculo}`, coords.lat, coords.lng);
}

function upsertEquipoTracking(item, options = {}) {
  const coords = getCoords(item);
  if (!coords || item?.id_equipo == null) return;
  if (options.requireFreshTimestamp && !isFreshTrackingItem(item)) {
    removeTrackingEntity(`E:${item.id_equipo}`);
    return;
  }

  upsertTrackingEntity(`E:${item.id_equipo}`, coords.lat, coords.lng, makeEquipoLabel(item), trackingColor("equipo"), {
    tacticalType: "equipo",
    trackingRole: item.categoria || item.tipo_equipo || "",
    liveData: item
  });
  activateTrackingLocation("E", item.id_equipo, coords.lat, coords.lng);
  updateFollowedTrackingLocation(`E:${item.id_equipo}`, coords.lat, coords.lng);
}

function upsertDispositivoTracking(item) {
  const coords = getCoords(item);
  if (!coords || item?.id_dispositivo == null) return;
  const key = `D:${item.id_dispositivo}`;
  const confirmedDevice = findConfirmedDevice(item);
  if (!confirmedDevice) {
    dashboardState.trackingDeviceLatest.delete(key);
    dashboardState.requestedDeviceTrackingKeys.delete(key);
    removeTrackingEntity(key);
    return;
  }

  const liveData = { ...confirmedDevice, ...item };
  dashboardState.trackingDeviceLatest.set(key, liveData);
  activateTrackingLocation("D", item.id_dispositivo, coords.lat, coords.lng);

  if (!isDeviceTrackingDisplayRequested(key)) {
    removeTrackingEntity(key);
    return;
  }

  upsertTrackingEntity(key, coords.lat, coords.lng, makeDispositivoLabel(liveData), trackingColor("dispositivo"), {
    tacticalType: "dispositivo",
    trackingRole: item.tipo || "",
    liveData
  });
  updateFollowedTrackingLocation(key, coords.lat, coords.lng);
}

function isDeviceTrackingDisplayRequested(key) {
  return dashboardState.requestedDeviceTrackingKeys.has(String(key || "")) ||
    String(dashboardState.followedTrackingKey || "") === String(key || "");
}

function clearRequestedDeviceTracking(keepKey = null) {
  const keep = keepKey ? String(keepKey) : null;
  [...dashboardState.requestedDeviceTrackingKeys].forEach((key) => {
    if (keep && key === keep) return;
    dashboardState.requestedDeviceTrackingKeys.delete(key);
    removeTrackingEntity(key);
  });
}

function requestDeviceTrackingDisplay(detail = {}) {
  const key = String(detail.key || "");
  if (!key.startsWith("D:")) {
    clearRequestedDeviceTracking();
    return;
  }

  clearRequestedDeviceTracking(key);
  dashboardState.requestedDeviceTrackingKeys.add(key);

  const id = key.slice(2);
  const cached = dashboardState.trackingDeviceLatest.get(key) || {
    id_dispositivo: id,
    latitud: detail.lat,
    longitud: detail.lon,
    nombre: detail.label
  };
  const coords = getCoords(cached) || normalizeCoords(detail.lat, detail.lon);
  if (!coords) return;

  const liveData = { ...cached, id_dispositivo: cached.id_dispositivo ?? id };
  dashboardState.trackingDeviceLatest.set(key, liveData);
  upsertTrackingEntity(key, coords.lat, coords.lng, makeDispositivoLabel(liveData), trackingColor("dispositivo"), {
    tacticalType: "dispositivo",
    trackingRole: liveData.tipo || "",
    liveData
  });
}

document.addEventListener("dashboard:tracking-follow-requested", (event) => {
  requestDeviceTrackingDisplay(event.detail || {});
});

// ── Crear o mover una entidad de tracking ────────────────────
function upsertTrackingEntity(key, lat, lng, label, color, meta = {}) {
  const coords = normalizeCoords(lat, lng);
  if (!coords) return;

  processTrackingUpdate(key, coords.lat, coords.lng, meta.liveData ? { liveData: meta.liveData } : {});

  const viewer = dashboardState.viewer;
  if (!viewer) return;

  const position = Cesium.Cartesian3.fromDegrees(coords.lng, coords.lat);
  const marker = getTrackingMarker(meta);
  const mapLabel = makeTrackingMapLabel(key, label, meta);

  if (dashboardState.trackingEntities.has(key)) {
    // Mover y refrescar estilo/etiqueta si ya existe
    const ent = dashboardState.trackingEntities.get(key);
    ent.position = position;
    ent.name = label;
    if (ent.label) {
      ent.label.text = mapLabel;
      ent.label.backgroundColor = color.withAlpha(0.7);
      ent.label.pixelOffset = marker.labelOffset;
      ent.label.show = (dashboardState.selectedEntity === ent);
    }
    ent.billboard = marker.billboard;
    ent.point = marker.point;
    if (ent.properties) {
      ent.properties.trackingRole = meta.trackingRole || ent.properties.trackingRole;
      ent.properties.tacticalType = meta.tacticalType || ent.properties.tacticalType;
      ent.properties.trackingSidc = marker.sidc || ent.properties.trackingSidc;
      ent.properties.trackingFullLabel = label;
      ent.properties.trackingMapLabel = mapLabel;
    }
    upsertTrackingHeadingLine(key, coords.lat, coords.lng, color, meta);
    return;
  }

  // Crear nueva entidad
  const ent = viewer.entities.add({
    name: label,
    position,
    billboard: marker.billboard,
    point: marker.point,
    label: {
      text: mapLabel,
      font: "11px sans-serif",
      pixelOffset: marker.labelOffset,
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      showBackground: true,
      backgroundColor: color.withAlpha(0.6),
      backgroundPadding: new Cesium.Cartesian2(4, 2),
      scaleByDistance: getTrackingScaleByDistance(),
      show: false
    },
    properties: {
      trackingKey: key,
      tacticalType: meta.tacticalType || (key.startsWith("V:") ? "vehiculo" : "personal"),
      trackingRole: meta.trackingRole || "",
      trackingSidc: marker.sidc || "",
      trackingFullLabel: label,
      trackingMapLabel: mapLabel,
      draggable: false
    }
  });

  dashboardState.trackingEntities.set(key, ent);
  upsertTrackingHeadingLine(key, coords.lat, coords.lng, color, meta);

  if (key.startsWith("P:")) {
    const shouldShow = shouldShowPersonEntity(key);
    if (ent.show !== shouldShow) {
      ent.show = shouldShow;
    }
    const headingEntity = dashboardState.trackingHeadingEntities.get(key);
    if (headingEntity && headingEntity.show !== shouldShow) {
      headingEntity.show = shouldShow;
    }
  }
}

function removeTrackingEntity(key) {
  const ent = dashboardState.trackingEntities.get(key);
  removeTrackingHeadingLine(key);
  if (!ent) return;
  const viewer = dashboardState.viewer;
  if (viewer) viewer.entities.remove(ent);
  dashboardState.trackingEntities.delete(key);
}

// ── Carga desde datos de mapa ya obtenidos (sin fetch extra) ─
export function loadTrackingFromMapaData(mapaData) {
  const activePersonal = new Set(
    (mapaData.personal || []).map(p => String(p.id_personal)).filter(Boolean)
  );
  Array.from(dashboardState.trackingEntities.keys()).forEach(key => {
    if (key.startsWith("P:") && !activePersonal.has(key.slice(2))) removeTrackingEntity(key);
  });
  (mapaData.personal || []).forEach(p => {
    upsertPersonalTracking(p);
  });
  (mapaData.vehiculos || []).forEach(v => {
    upsertVehiculoTracking(v);
  });
  (mapaData.equipos || []).forEach(e => {
    upsertEquipoTracking(e);
  });
  (mapaData.dispositivos || []).forEach(d => {
    upsertDispositivoTracking(d);
  });
}

// ── Carga inicial desde /ops/:id/mapa (fallback) ─────────────
export async function loadTrackingFromBackend() {
  const id = opId();
  if (!id || !token()) return;

  try {
    const res = await fetch(`${API_BASE()}/ops/${id}/mapa`, {
      headers: { "Authorization": `Bearer ${token()}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok) return;

    // Personal con posición conocida
    (data.personal || []).forEach(upsertPersonalTracking);

    // Vehículos con posición conocida
    (data.vehiculos || []).forEach(upsertVehiculoTracking);

    (data.equipos || []).forEach(e => {
      upsertEquipoTracking(e);
    });

    (data.dispositivos || []).forEach(d => {
      upsertDispositivoTracking(d);
    });

  } catch (err) {
    console.error("[TRACKING] Error cargando posiciones iniciales:", err);
  }
}

async function fetchTrackingList(path) {
  const id = opId();
  if (!id || !token()) return [];

  try {
    const res = await fetch(`${API_BASE()}/ops/${id}${path}`, {
      headers: { "Authorization": `Bearer ${token()}` },
      cache: "no-store"
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch (err) {
    console.warn("[TRACKING] No se pudo refrescar tracking:", err.message);
    return [];
  }
}

// `/mapa` ya filtra `personal` por presencia de socket activa. Usarlo como
// fuente de verdad evita volver a pintar ubicaciones hist\u00f3ricas de personas
// que se desconectaron de la operaci\u00f3n.
async function fetchConnectedPersonalTracking() {
  const id = opId();
  if (!id || !token()) return [];

  try {
    const res = await fetch(`${API_BASE()}/ops/${id}/mapa`, {
      headers: { "Authorization": `Bearer ${token()}` },
      cache: "no-store"
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.ok && Array.isArray(data.personal) ? data.personal : [];
  } catch (err) {
    console.warn("[TRACKING] No se pudo refrescar personal conectado:", err.message);
    return [];
  }
}

export async function refreshTrackingPositions() {
  const [personal, vehiculos, equipos, dispositivos] = await Promise.all([
    fetchConnectedPersonalTracking(),
    fetchTrackingList("/tracking/vehiculos"),
    fetchTrackingList("/tracking/equipos"),
    fetchTrackingList("/tracking/dispositivos")
  ]);

  if (personal.length || vehiculos.length || equipos.length || dispositivos.length) {
    console.log(
      `[TRACKING] refresh personal=${personal.length} vehiculos=${vehiculos.length} ` +
      `equipos=${equipos.length} dispositivos=${dispositivos.length}`
    );
  }

  const connectedPersonalKeys = new Set(
    personal.map(item => `P:${item.id_personal}`).filter(key => key !== "P:undefined" && key !== "P:null")
  );
  [...dashboardState.trackingEntities.keys()]
    .filter(key => key.startsWith("P:") && !connectedPersonalKeys.has(key))
    .forEach(removeTrackingEntity);
  personal.forEach(upsertPersonalTracking);
  vehiculos.forEach(upsertVehiculoTracking);
  equipos.forEach(upsertEquipoTracking);
  dispositivos.forEach(upsertDispositivoTracking);
}

export function startTrackingPolling(intervalMs = 5000) {
  refreshTrackingPositions();
  return window.setInterval(refreshTrackingPositions, intervalMs);
}

// ── Socket en tiempo real ────────────────────────────────────
export function initTrackingSocket(socket) {
  socket.on("personal_desconectado", (data) => {
    const id = Number(data?.id_personal);
    if (Number.isFinite(id) && id > 0) removeTrackingEntity(`P:${id}`);
  });

  socket.on("tracking_personal", (data) => {
    upsertPersonalTracking(data);
  });

  socket.on("signos_vitales_personal", (data) => {
    if (!data?.id_personal) return;
    refreshPersonnelInfoPopup(data.id_personal, data);
  });

  socket.on("tracking_vehiculo", (data) => {
    upsertVehiculoTracking(data);
  });

  socket.on("tracking_equipo", (data) => {
    upsertEquipoTracking(data);
  });

  socket.on("tracking_dispositivo", (data) => {
    upsertDispositivoTracking(data);
  });
}
