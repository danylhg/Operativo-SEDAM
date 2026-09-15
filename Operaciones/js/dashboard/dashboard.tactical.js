// js/dashboard/dashboard.tactical.js

import { dashboardState } from "./dashboard.state.js";
import { dom } from "./dashboard.dom.js";
import { setRouteInfo, updateSelectionInfo } from "./dashboard.ui.js";
import { getCurrentOperation } from "./dashboard.storage.js";
import { clearPlanningArea, finishPlanningAreaByPoints } from "./dashboard.area.js";
import { cartesianToLatLng, saveTacticalData } from "./dashboard.persistence.js";
import { startPencilMode, stopPencilMode, startEraserMode, stopEraserMode, stopAllDrawingModes, pushUndoAction, clearAllDrawings, ensureMapMovementEnabled } from "./dashboard.drawing.js";

function getTacticalScaleByDistance() {
  return new Cesium.NearFarScalar(1e3, 1.0, 2e6, 0.04);
}

// Escala los íconos/etiquetas proporcionalmente a la distancia de la cámara:
// cerca (1 km) → escala normal; lejos (2 000 km) → escala mínima visible.
const COLOR_HEX_MAP = {
  red: '#FF4500',
  blue: '#00BFFF',
  black: '#222222',
  yellow: '#FFD700',
  green: '#00FF88',
  orange: '#FF8C00',
  white: '#FFFFFF'
};

export function getCesiumColor(name, alpha = 1) {
  const map = {
    red: Cesium.Color.RED,
    blue: Cesium.Color.CYAN,
    black: Cesium.Color.BLACK,
    yellow: Cesium.Color.YELLOW,
    green: Cesium.Color.LIME,
    orange: Cesium.Color.ORANGE,
    white: Cesium.Color.WHITE
  };

  const base = map[name] || Cesium.Color.WHITE;
  return base.withAlpha(alpha);
}

// IDs de POIs que acabo de enviar yo (evita redibujar lo que ya dibujé localmente)
const _mySentPoiIds = new Set();
const _mySentRouteIds = new Set();
let gridSaveTimer = null;
let lastLocalGridSaveAt = 0;

function getAreaCreatorPayload() {
  const userData = JSON.parse(localStorage.getItem("userData") || "{}");
  const tabla = userData.tabla || "usuario";
  const idKey = tabla === "personal" ? "id_personal" : "id_usuario";
  const idVal = tabla === "personal" ? userData.id_personal : userData.id_usuario;

  return {
    tipo_creador: tabla === "personal" ? "PERSONAL" : "USUARIO",
    [idKey]: idVal
  };
}

function creatorProperties(source = {}) {
  return {
    tipo_creador: source.tipo_creador ?? source.created_by_tipo ?? null,
    id_usuario: source.id_usuario ?? null,
    id_personal: source.id_personal ?? null,
    creador_nombre: source.creador_nombre || source.personal_nombre || source.usuario_nombre || ""
  };
}

function circleToPolygonCoordinates(lat, lng, radiusMeters, segments = 48) {
  const earthRadius = 6378137;
  const latRad = Cesium.Math.toRadians(lat);
  const lonRad = Cesium.Math.toRadians(lng);
  const angularDistance = radiusMeters / earthRadius;
  const coords = [];

  for (let i = 0; i <= segments; i += 1) {
    const bearing = (2 * Math.PI * i) / segments;
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const sinAd = Math.sin(angularDistance);
    const cosAd = Math.cos(angularDistance);

    const pointLat = Math.asin(
      sinLat * cosAd + cosLat * sinAd * Math.cos(bearing)
    );
    const pointLon = lonRad + Math.atan2(
      Math.sin(bearing) * sinAd * cosLat,
      cosAd - sinLat * Math.sin(pointLat)
    );

    coords.push([
      Cesium.Math.toDegrees(pointLon),
      Cesium.Math.toDegrees(pointLat)
    ]);
  }

  return [coords];
}

function pointsToPolygonCoordinates(points) {
  if (!Array.isArray(points) || points.length < 3) return null;

  const ring = points.map(point => [point.lng, point.lat]);
  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];

  if (firstLng !== lastLng || firstLat !== lastLat) {
    ring.push([firstLng, firstLat]);
  }

  return [ring];
}

function pointsToLineString(points) {
  if (!Array.isArray(points) || points.length < 2) return null;

  const coordinates = points
    .map(point => [Number(point.lng), Number(point.lat)])
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));

  if (coordinates.length < 2) return null;
  return { type: "LineString", coordinates };
}

function getPolygonLabelPosition(points) {
  if (!Array.isArray(points) || points.length === 0) return null;

  const totals = points.reduce(
    (acc, point) => ({
      lat: acc.lat + Number(point.lat || 0),
      lng: acc.lng + Number(point.lng || 0)
    }),
    { lat: 0, lng: 0 }
  );

  return {
    lat: totals.lat / points.length,
    lng: totals.lng / points.length
  };
}

function getOperationZonePoints(zona) {
  const ring = zona?.geometria?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) return null;

  const points = ring
    .map(([lng, lat]) => ({ lng: Number(lng), lat: Number(lat) }))
    .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));

  if (points.length < 4) return null;

  const first = points[0];
  const last = points[points.length - 1];
  if (first.lat === last.lat && first.lng === last.lng) {
    points.pop();
  }

  return points.length >= 3 ? points : null;
}

function clearOperationZoneEntities() {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  clearGrid({ persist: false });

  // Remove the main zone border
  if (dashboardState.operationZoneBorder) {
    viewer.entities.remove(dashboardState.operationZoneBorder);
  }

  // Remove all radar / wind-rose sub-entities tied to this zone
  const toRemove = [];
  viewer.entities.values.forEach(ent => {
    const tt = ent.properties?.tacticalType?.getValue?.() ?? ent.properties?.tacticalType;
    if (tt === "operation-zone-part") toRemove.push(ent);
  });
  toRemove.forEach(ent => viewer.entities.remove(ent));

  if (dashboardState.selectedEntity === dashboardState.operationZoneBorder) {
    dashboardState.selectedEntity = null;
    updateSelectionInfo(null);
  }

  dashboardState.operationZoneBorder = null;
  dashboardState.currentOperationZone = null;
}

function focusViewerOnOperationZone(zona) {
  const viewer = dashboardState.viewer;
  if (!viewer || !zona) return;

  const lat = Number(zona.centroide_lat);
  const lng = Number(zona.centroide_lon);
  const zoom = Math.max(Number(zona.zoom_inicial || 1800) || 1800, 1800);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lng, lat, zoom)
  });
}

function buildOperationZoneEntity(zona) {
  const viewer = dashboardState.viewer;
  if (!viewer || !zona?.id_zona) return null;

  const points = getOperationZonePoints(zona);
  if (!points) return null;
  updateZoneCoordinatesSummary(points);

  clearOperationZoneEntities();

  const closedPoints = [...points, points[0]];
  const color = Cesium.Color.fromCssColorString(zona.color || "#3b82f6");
  const entity = viewer.entities.add({
    id: `zona_${zona.id_zona}`,
    name: zona.nombre || "Zona de operación",
    polyline: {
      positions: toCartesianArray(closedPoints),
      width: Number(zona.geometria?.meta?.outline_width || 3),
      material: new Cesium.PolylineDashMaterialProperty({
        color,
        dashLength: 16
      }),
      clampToGround: true
    },
    properties: {
      tacticalType: "operation-zone",
      id_zona: zona.id_zona,
      draggable: false
    }
  });

  dashboardState.operationZoneBorder = entity;
  dashboardState.currentOperationZone = zona;

  renderIntegratedWindRose(zona, closedPoints);

  return entity;
}

function calculateCentroid(points) {
  if (!points || points.length === 0) return null;
  let sumLat = 0, sumLng = 0;
  points.forEach(p => {
    sumLat += Number(p.lat);
    sumLng += Number(p.lng);
  });
  return { lat: sumLat / points.length, lng: sumLng / points.length };
}

function getHullRadius(center, points) {
  if (!center || !points) return 5000;
  const centerCart = Cesium.Cartesian3.fromDegrees(center.lng, center.lat);
  let maxDist = 1000;
  points.forEach(p => {
    const pCart = Cesium.Cartesian3.fromDegrees(p.lng, p.lat);
    const d = Cesium.Cartesian3.distance(centerCart, pCart);
    if (d > maxDist) maxDist = d;
  });
  return maxDist;
}

export function renderIntegratedWindRose(zona, points) {
  const viewer = dashboardState.viewer;
  if (!viewer || !Array.isArray(points) || points.length < 3) return;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  points.forEach((point) => {
    const lat = Number(point.lat);
    const lng = Number(point.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  });

  if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) return;

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  const zoneProps = { tacticalType: "operation-zone-part", id_zona: zona.id_zona };

  [
    { text: "N", lat: maxLat, lng: centerLng, offset: new Cesium.Cartesian2(0, -16) },
    { text: "S", lat: minLat, lng: centerLng, offset: new Cesium.Cartesian2(0, 16) },
    { text: "E", lat: centerLat, lng: maxLng, offset: new Cesium.Cartesian2(18, 0) },
    { text: "W", lat: centerLat, lng: minLng, offset: new Cesium.Cartesian2(-18, 0) }
  ].forEach((label) => {
    viewer.entities.add({
      name: "Rosa de viento zona",
      position: Cesium.Cartesian3.fromDegrees(label.lng, label.lat),
      label: {
        text: label.text,
        font: "bold 24px monospace",
        fillColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.92)"),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.82),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: label.offset,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      },
      properties: zoneProps
    });
  });
}

/**
 * Generates a canvas with a stereographic-projection radar overlay.
 * Inspired by Observable's star map (d3.geoStereographic).
 */
function generateRadarCanvas(size, _unused, colorHex, radiusMeters) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.47; // Maximize circle within canvas
  const totalRings = 8;

  // Line/label colors: black-based, stronger for visibility
  const lineStrong = "rgba(0,0,0,0.75)";
  const lineMedium = "rgba(0,0,0,0.45)";
  const lineLight  = "rgba(0,0,0,0.20)";
  const labelDark  = "rgba(0,0,0,0.90)";
  const labelMid   = "rgba(0,0,0,0.60)";

  // ── 1. Outer border ring (REMOVED) ──

  // ── 2. Principal axes (divide into 4 quadrants) ──
  for (let deg = 0; deg < 360; deg += 90) {
    const rad = (deg - 90) * (Math.PI / 180);
    ctx.strokeStyle = lineStrong;
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + maxR * 1.02 * Math.cos(rad), cy + maxR * 1.02 * Math.sin(rad));
    ctx.stroke();
  }

  // ── 3. Bearing labels (N, E, S, W) ──
  const cardinalLabels = [
    { deg: 0,   sub: "N"  },
    { deg: 90,  sub: "E"  },
    { deg: 180, sub: "S" },
    { deg: 270, sub: "W" }
  ];

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  cardinalLabels.forEach(({ deg, sub }) => {
    const rad = (deg - 90) * (Math.PI / 180);
    const subR = maxR * 1.15; // Closer now that there are no degrees
    ctx.font = "bold 32px monospace";
    ctx.fillStyle = labelDark;
    ctx.fillText(sub, cx + subR * Math.cos(rad), cy + subR * Math.sin(rad));
  });

  // ── 4. Center crosshair ──
  const cross = maxR * 0.06;
  ctx.strokeStyle = lineStrong;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - cross, cy); ctx.lineTo(cx + cross, cy);
  ctx.moveTo(cx, cy - cross); ctx.lineTo(cx, cy + cross);
  ctx.stroke();

  // ── 8. Center dot ──
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

// ── Render standalone RADAR POI entities ──
function renderRadarEntities(poi) {
  const viewer = dashboardState.viewer;
  if (!viewer || !poi) return;

  const lat = Number(poi.latitud ?? poi.lat);
  const lng = Number(poi.longitud ?? poi.lon ?? poi.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const entityId = poi.id_poi ? `poi_${poi.id_poi}` : undefined;
  if (entityId && viewer.entities.getById(entityId)) return;

  const color = Cesium.Color.fromCssColorString(poi.color || "#00BFFF");
  const position = Cesium.Cartesian3.fromDegrees(lng, lat);
  const displayLabel = String(poi.nombre || "").trim();

  const ent = viewer.entities.add({
    id: entityId,
    name: poi.nombre || "Radar",
    position,
    point: {
      pixelSize: 12,
      color: color.withAlpha(0.8),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    },
    label: displayLabel && displayLabel !== "Radar" ? {
      text: displayLabel,
      font: "12px sans-serif",
      pixelOffset: new Cesium.Cartesian2(0, -18),
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    } : undefined,
    properties: {
      tacticalType: "radar-part",
      draggable: true,
      id_poi: poi.id_poi ?? null
    }
  });

  if (ent) addTacticalEntity(ent);
}

// ── Delete all local entities belonging to a given POI id ──
function deleteLocalPoiEntities(idPoi) {
  const viewer = dashboardState.viewer;
  if (!viewer || !idPoi) return;

  // Remove by standard POI id
  const mainEntity = viewer.entities.getById(`poi_${idPoi}`);
  if (mainEntity) viewer.entities.remove(mainEntity);

  // Also scan for any entities referencing this id_poi
  const toRemove = [];
  viewer.entities.values.forEach(ent => {
    const entIdPoi = ent.properties?.id_poi?.getValue?.() ?? ent.properties?.id_poi;
    if (entIdPoi && Number(entIdPoi) === Number(idPoi)) {
      toRemove.push(ent);
    }
  });
  toRemove.forEach(ent => viewer.entities.remove(ent));

  dashboardState.tacticalEntities = dashboardState.tacticalEntities.filter(ent => {
    const entIdPoi = ent.properties?.id_poi?.getValue?.() ?? ent.properties?.id_poi;
    return !entIdPoi || Number(entIdPoi) !== Number(idPoi);
  });
}

function buildMilUniqueName(baseName) {
  const normalizedBase = String(baseName || "Simbolo MIL").trim() || "Simbolo MIL";
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
    String(now.getMilliseconds()).padStart(3, "0")
  ].join("");
  return `${normalizedBase} ${stamp}`;
}

function getPoiDisplayLabel(poi) {
  const rawLabel = String(poi.nombre || poi.name || "PDI");
  const tipoPoi = String(poi.tipo_poi || poi.tipoPoi || "").toUpperCase();
  if (tipoPoi === "MIL") {
    const label = rawLabel.replace(/\s\d{17}$/, "").trim();
    return label === "Simbolo MIL" ? "" : label;
  }
  return ["PDI", "Punto de interés"].includes(rawLabel.trim()) ? "" : rawLabel.trim();
}

function resolvePoiImage(iconSrc) {
  if (!iconSrc) return null;
  if (/^(https?:)?\/\//i.test(iconSrc) || iconSrc.startsWith("data:")) return iconSrc;
  const apiBase = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  return `${apiBase.replace(/\/$/, "")}/${iconSrc.replace(/^\.?\//, "")}`;
}

function getMilSymbolInstance(sidc, size = 200) {
  if (!sidc || typeof ms === "undefined" || typeof ms.Symbol !== "function") return null;

  try {
    return new ms.Symbol(sidc, {
      size,
      colorMode: "Light"
    });
  } catch (err) {
    console.warn("[MIL] SIDC invalido para milsymbol:", sidc, err);
    return null;
  }
}

export function renderMilSymbolImage(sidc, size = 200) {
  const symbol = getMilSymbolInstance(sidc, size);
  return symbol ? symbol.asCanvas() : null;
}

function getMilBillboardSize() {
  return 42;
}

function normalizeNumericInput(value, fallback = null) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function normalizeHeading(value) {
  const heading = normalizeNumericInput(value);
  if (heading === null) return null;
  return ((heading % 360) + 360) % 360;
}

function destinationFromHeading(lat, lng, headingDegrees, distanceMeters) {
  const earthRadius = 6378137;
  const angularDistance = distanceMeters / earthRadius;
  const bearing = Cesium.Math.toRadians(headingDegrees);
  const lat1 = Cesium.Math.toRadians(lat);
  const lng1 = Cesium.Math.toRadians(lng);
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinDistance = Math.sin(angularDistance);
  const cosDistance = Math.cos(angularDistance);
  const lat2 = Math.asin(sinLat1 * cosDistance + cosLat1 * sinDistance * Math.cos(bearing));
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * sinDistance * cosLat1,
    cosDistance - sinLat1 * Math.sin(lat2)
  );
  return {
    lat: Cesium.Math.toDegrees(lat2),
    lng: Cesium.Math.toDegrees(((lng2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
  };
}

function createMovingPosition(lat, lng, speedKmh, headingDegrees) {
  const speed = normalizeNumericInput(speedKmh, 0);
  const heading = normalizeHeading(headingDegrees);
  const viewer = dashboardState.viewer;
  if (!viewer || speed <= 0 || heading === null) return Cesium.Cartesian3.fromDegrees(lng, lat);

  const startTime = Cesium.JulianDate.clone(viewer.clock.currentTime);
  return new Cesium.CallbackProperty((time) => {
    const elapsedSeconds = Math.max(0, Cesium.JulianDate.secondsDifference(time, startTime));
    const distanceMeters = speed * 1000 / 3600 * elapsedSeconds;
    const destination = destinationFromHeading(lat, lng, heading, distanceMeters);
    return Cesium.Cartesian3.fromDegrees(destination.lng, destination.lat);
  }, false);
}

function getMilMovementData() {
  return {
    velocidad_kmh: Math.max(0, normalizeNumericInput(dom.milSpeed?.value, 0)),
    rumbo_grados: normalizeHeading(dom.milHeading?.value) ?? 0
  };
}

const MIL_SYMBOL_CATALOG = [
  { dimension: "G", group: "Tierra - Unidades", code: "U-----", label: "Unidad genérica" },
  { dimension: "G", group: "Tierra - Unidades", code: "UCI---", label: "Infantería" },
  { dimension: "G", group: "Tierra - Unidades", code: "UCD---", label: "Blindada / Tanques" },
  { dimension: "G", group: "Tierra - Unidades", code: "UCA---", label: "Artillería" },
  { dimension: "G", group: "Tierra - Unidades", code: "UCF---", label: "Defensa aérea" },
  { dimension: "G", group: "Tierra - Unidades", code: "UCR---", label: "Reconocimiento / Exploración" },
  { dimension: "G", group: "Tierra - Unidades", code: "UCJ---", label: "Ingenieros" },
  { dimension: "G", group: "Tierra - Unidades", code: "UCO---", label: "Aviación" },
  { dimension: "G", group: "Tierra - Apoyo", code: "UCS---", label: "Comunicaciones / Señales" },
  { dimension: "G", group: "Tierra - Apoyo", code: "UCM---", label: "Médica" },
  { dimension: "G", group: "Tierra - Apoyo", code: "UCL---", label: "Logística / Abastecimiento" },
  { dimension: "G", group: "Tierra - Apoyo", code: "UCP---", label: "Policía / Seguridad" },
  { dimension: "G", group: "Tierra - Apoyo", code: "UCK---", label: "CBRN / Química" },
  { dimension: "G", group: "Instalaciones", code: "IB----", label: "Base / Cuartel" },
  { dimension: "G", group: "Instalaciones", code: "IP----", label: "Punto de control" },
  { dimension: "G", group: "Instalaciones", code: "IR----", label: "Radar" },
  { dimension: "A", group: "Aire", code: "MF----", label: "Aeronave militar" },
  { dimension: "A", group: "Aire", code: "MFF---", label: "Ala fija" },
  { dimension: "A", group: "Aire", code: "MFR---", label: "Ala rotatoria" },
  { dimension: "A", group: "Aire", code: "MFQ---", label: "UAV / Drone" },
  { dimension: "A", group: "Aire", code: "MFB---", label: "Bombardero" },
  { dimension: "A", group: "Aire", code: "MFI---", label: "Caza" },
  { dimension: "S", group: "Mar superficie", code: "C-----", label: "Combatiente" },
  { dimension: "S", group: "Mar superficie", code: "CL----", label: "Buque de línea" },
  { dimension: "S", group: "Mar superficie", code: "CLCV--", label: "Portaaviones" },
  { dimension: "S", group: "Mar superficie", code: "CLDD--", label: "Destructor" },
  { dimension: "S", group: "Mar superficie", code: "CLFF--", label: "Fragata / Corbeta" },
  { dimension: "U", group: "Subsuperficie", code: "S-----", label: "Submarino" },
  { dimension: "U", group: "Subsuperficie", code: "SC----", label: "Submarino convencional" },
  { dimension: "U", group: "Subsuperficie", code: "SU----", label: "UUV / Vehículo submarino no tripulado" },
  { dimension: "U", group: "Subsuperficie", code: "W-----", label: "Arma submarina" },
  { dimension: "G", group: "Tierra - Equipo", code: "E-----", label: "Equipo genérico" },
  { dimension: "G", group: "Tierra - Equipo", code: "EW----", label: "Arma" },
  { dimension: "G", group: "Tierra - Equipo", code: "EV----", label: "Vehículo" },
  { dimension: "G", group: "Tierra - Equipo", code: "EX----", label: "Equipo especial" }
];

const milSidcValidityCache = new Map();

function buildMilSidcFromParts(identity, dimension, icon) {
  const safeIdentity = identity || "F";
  const safeDimension = dimension || "G";
  const safeIcon = String(icon || "UCI---").padEnd(6, "-").slice(0, 6);

  return `S${safeIdentity}${safeDimension}P${safeIcon}-----`;
}

function isMilSidcRenderable(sidc) {
  if (milSidcValidityCache.has(sidc)) {
    return milSidcValidityCache.get(sidc);
  }

  const symbol = getMilSymbolInstance(sidc, 64);
  let isRenderable = !!symbol;

  if (isRenderable && typeof symbol.isValid === "function") {
    isRenderable = symbol.isValid() !== false;
  }

  if (isRenderable && typeof symbol.getMetadata === "function") {
    const metadata = (() => {
      try {
        return symbol.getMetadata() || {};
      } catch {
        return {};
      }
    })();

    if (metadata.valid === false || metadata.validIcon === false || metadata.validSIDC === false) {
      isRenderable = false;
    }
  }

  if (isRenderable && typeof symbol.asSVG === "function") {
    const svg = (() => {
      try {
        return symbol.asSVG();
      } catch {
        return "";
      }
    })();

    if (typeof svg === "string" && />\s*\?\s*</.test(svg)) {
      isRenderable = false;
    }
  }

  milSidcValidityCache.set(sidc, isRenderable);
  return isRenderable;
}

function getMilOptionsForCurrentDimension() {
  const identity = dom.milIdentity?.value || "F";
  const dimension = dom.milDimension?.value || "G";

  return MIL_SYMBOL_CATALOG
    .filter(item => item.dimension === dimension)
    .filter(item => isMilSidcRenderable(buildMilSidcFromParts(identity, item.dimension, item.code)));
}

function populateMilIconOptions() {
  if (!dom.milIcon) return;

  const previousValue = dom.milIcon.value;
  const validOptions = getMilOptionsForCurrentDimension();
  dom.milIcon.innerHTML = "";

  if (!validOptions.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Sin símbolos válidos para esta dimensión";
    option.disabled = true;
    option.selected = true;
    dom.milIcon.appendChild(option);
    return;
  }

  const byGroup = new Map();
  validOptions.forEach((item) => {
    if (!byGroup.has(item.group)) byGroup.set(item.group, []);
    byGroup.get(item.group).push(item);
  });

  byGroup.forEach((items, groupName) => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = groupName;

    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.code;
      option.textContent = item.label;
      option.dataset.dimension = item.dimension;
      optgroup.appendChild(option);
    });

    dom.milIcon.appendChild(optgroup);
  });

  const stillExists = validOptions.some(item => item.code === previousValue);
  dom.milIcon.value = stillExists ? previousValue : validOptions[0].code;
}

function buildMilSidc() {
  const identity = dom.milIdentity?.value || "F";
  const selectedOption = dom.milIcon?.selectedOptions?.[0];
  const dimension = selectedOption?.dataset.dimension || dom.milDimension?.value || "G";
  const icon = dom.milIcon?.value || "";

  if (!icon) return "";

  return buildMilSidcFromParts(identity, dimension, icon);
}

function buildPoiEntity(poi, tacticalType = "poi") {
  const viewer = dashboardState.viewer;
  if (!viewer) return null;

  const lat = Number(poi.latitud ?? poi.lat);
  const lng = Number(poi.longitud ?? poi.lon ?? poi.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const sidc = poi.sidc || (poi.icono_src?.startsWith("S") ? poi.icono_src : null);
  let iconSrc = resolvePoiImage(poi.icono_src || poi.iconSrc || poi.image);

  // Si hay SIDC, generamos el icono dinámicamente con milsymbol
  if (sidc) {
    iconSrc = renderMilSymbolImage(sidc, 200) || iconSrc;
  }

  const tipo_poi_raw = (poi.tipo_poi || poi.tipoPoi || "").toUpperCase();
  const isMil = tipo_poi_raw === "MIL" || !!sidc;

  // Si es tipo RADAR, no lo dibujamos como un POI simple, ya que renderRadarEntities se encarga
  if (tipo_poi_raw === "RADAR") return null;

  const hexColor = poi.color || "#FFD700";
  const cesiumColor = Cesium.Color.fromCssColorString(hexColor);
  const label = getPoiDisplayLabel(poi);
  const entityId = poi.id_poi ? `poi_${poi.id_poi}` : undefined;
  const speedKmh = normalizeNumericInput(poi.velocidad_kmh ?? poi.velocidad ?? poi.speed, 0);
  const headingDegrees = normalizeHeading(poi.rumbo_grados ?? poi.rumbo ?? poi.headingDegrees ?? poi.heading);

  if (entityId && viewer.entities.getById(entityId)) {
    return null;
  }

  return viewer.entities.add({
    id: entityId,
    name: label,
    position: Cesium.Cartesian3.fromDegrees(lng, lat),
    billboard: iconSrc ? {
      image: iconSrc,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      width: isMil ? getMilBillboardSize() : undefined,
      height: isMil ? getMilBillboardSize() : undefined,
      scale: isMil ? 1 : Number(poi.scale || 1.0)
    } : undefined,
    point: !iconSrc ? {
      pixelSize: 10,
      color: cesiumColor,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    } : undefined,
    label: label ? {
      text: label,
      font: "14px sans-serif",
      pixelOffset: iconSrc ? new Cesium.Cartesian2(0, 15) : new Cesium.Cartesian2(0, -20),
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      showBackground: !iconSrc,
      backgroundColor: !iconSrc ? cesiumColor.withAlpha(0.7) : undefined,
      backgroundPadding: !iconSrc ? new Cesium.Cartesian2(6, 4) : undefined
    } : undefined,
    properties: {
      tacticalType: isMil ? "mil-dropped" : tacticalType,
      draggable: true,
      id_poi: poi.id_poi ?? null,
      sidc: sidc,
      velocidad_kmh: speedKmh,
      rumbo_grados: headingDegrees,
      ...creatorProperties(poi)
    }
  });
}

async function savePoiToBackend(lat, lng, nombre, tipoPoi, colorName, iconoSrc = null, sidc = null, movement = {}) {
  try {
    const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
    const token = localStorage.getItem("token");
    const opId = localStorage.getItem("active_operation_id");
    if (!token || !opId) return;

    const userData = JSON.parse(localStorage.getItem("userData") || "{}");
    const tabla = userData.tabla || "usuario";
    const idKey = tabla === "personal" ? "id_personal" : "id_usuario";
    const idVal = tabla === "personal" ? userData.id_personal : userData.id_usuario;

    const body = {
      nombre,
      tipo_poi: tipoPoi,
      latitud: lat,
      longitud: lng,
      color: COLOR_HEX_MAP[colorName] || '#FFD700',
      icono_src: iconoSrc,
      sidc: sidc,
      velocidad_kmh: movement.velocidad_kmh ?? null,
      rumbo_grados: movement.rumbo_grados ?? null,
      tipo_creador: tabla === "personal" ? "PERSONAL" : "USUARIO",
      [idKey]: idVal
    };

    const res = await fetch(`${API_BASE}/ops/${opId}/pois`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      const mensaje = data?.mensaje || "No se pudo guardar el punto de interés.";
      if (dom.tbHint) dom.tbHint.textContent = mensaje;
      return null;
    }
    if (data?.ok && data?.poi?.id_poi) {
      _mySentPoiIds.add(data.poi.id_poi);
      setTimeout(() => _mySentPoiIds.delete(data.poi.id_poi), 5000);
      return data.poi;
    }
    return null;
  } catch (err) {
    console.warn("[POI] Backend no disponible:", err.message);
    return null;
  }
}

async function saveStructureToBackend(lat, lng, nombre, tipoEstructura) {
  try {
    const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
    const token = localStorage.getItem("token");
    const opId = localStorage.getItem("active_operation_id");
    if (!token || !opId) return null;

    const body = {
      nombre,
      tipo_estructura: tipoEstructura,
      latitud: lat,
      longitud: lng,
      ...getAreaCreatorPayload()
    };

    const res = await fetch(`${API_BASE}/ops/${opId}/edificios`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      const mensaje = data?.mensaje || "No se pudo guardar la estructura.";
      if (dom.tbHint) dom.tbHint.textContent = mensaje;
      return null;
    }

    return data.edificio || null;
  } catch (err) {
    console.warn("[ESTRUCTURA] Backend no disponible:", err.message);
    return null;
  }
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? value : null;
}

function normalizeAreaGeometry(area) {
  return parseJsonObject(area?.geometria ?? area?.geometry);
}

function normalizeAreaMeta(area, geometry) {
  return parseJsonObject(geometry?.meta)
    || parseJsonObject(geometry?.metadata)
    || parseJsonObject(geometry?.properties)
    || parseJsonObject(area?.meta)
    || parseJsonObject(area?.metadata)
    || {};
}

function getCircleCenter(area, meta) {
  const center = Array.isArray(meta.center) ? meta.center : null;
  if (center && center.length >= 2) {
    return {
      lng: Number(center[0]),
      lat: Number(center[1])
    };
  }

  return {
    lng: Number(area?.center_lon ?? area?.centroide_lon ?? area?.longitud ?? area?.lon ?? area?.lng),
    lat: Number(area?.center_lat ?? area?.centroide_lat ?? area?.latitud ?? area?.lat)
  };
}

function makeCircleAreaData(idArea, lat, lng, radius, nombre, colorName) {
  return {
    id_area: idArea,
    nombre: nombre || "Círculo de cobertura",
    color: COLOR_HEX_MAP[colorName] || "#FF4500",
    geometria: {
      type: "Polygon",
      coordinates: circleToPolygonCoordinates(lat, lng, radius),
      meta: {
        shape: "circle",
        center: [lng, lat],
        radius_m: radius,
        opacity: getOpacity(),
        outline_width: getLineWidth()
      }
    }
  };
}

function getAreaDisplayLabel(area, shape) {
  const label = String(area?.nombre || "").trim();
  const automaticNames = shape === "circle"
    ? ["Círculo de cobertura", "Circulo de cobertura", "Círculo táctico"]
    : ["Polígono / Zona", "Poligono / Zona", "Polígono táctico"];
  return automaticNames.includes(label) ? "" : label;
}

function removeTacticalEntity(entity) {
  const viewer = dashboardState.viewer;
  if (!viewer || !entity) return;
  viewer.entities.remove(entity);
  dashboardState.tacticalEntities = (dashboardState.tacticalEntities || [])
    .filter(ent => ent !== entity);
}

function buildAreaEntity(area) {
  const viewer = dashboardState.viewer;
  if (!viewer) return null;

  const geometry = normalizeAreaGeometry(area);
  const meta = normalizeAreaMeta(area, geometry);
  if (geometry?.type !== "Polygon") return null;

  const opacity = Number(meta.opacity ?? 0.35);
  const lineWidth = Number(meta.outline_width ?? 3);

  const colorHex = area.color || "#FF4500";
  const outline = Cesium.Color.fromCssColorString(colorHex);
  const entityId = area.id_area ? `area_${area.id_area}` : undefined;

  if (entityId && viewer.entities.getById(entityId)) return null;

  if (String(meta?.shape || "").toLowerCase() === "circle") {
    const center = getCircleCenter(area, meta);
    const radius = Number(meta.radius_m ?? area?.radius_m ?? area?.radio_m);

    if (!Number.isFinite(radius) || radius <= 0) {
      return null;
    }

    const { lng, lat } = center;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const displayLabel = getAreaDisplayLabel(area, "circle");
    return viewer.entities.add({
      id: entityId,
      name: area.nombre || "Círculo de cobertura",
      position: Cesium.Cartesian3.fromDegrees(lng, lat),
      ellipse: {
        semiMajorAxis: radius,
        semiMinorAxis: radius,
        material: outline.withAlpha(opacity),
        outline: true,
        outlineColor: outline,
        outlineWidth: lineWidth,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      },
      label: displayLabel ? {
        text: displayLabel,
        font: "14px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      } : undefined,
      properties: {
        tacticalType: "circle",
        draggable: true,
        id_area: area.id_area ?? null,
        ...creatorProperties(area)
      }
    });
  }

  if (String(meta?.shape || "polygon").toLowerCase() !== "polygon") return null;

  const coordinates = Array.isArray(geometry?.coordinates?.[0]) ? geometry.coordinates[0] : null;
  if (!coordinates || coordinates.length < 4) return null;

  const ringPoints = coordinates
    .map(coord => ({
      lng: Number(coord?.[0]),
      lat: Number(coord?.[1])
    }))
    .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    .slice(0, -1);

  if (ringPoints.length < 3) return null;

  const labelPosition = getPolygonLabelPosition(ringPoints);
  const displayLabel = getAreaDisplayLabel(area, "polygon");

  return viewer.entities.add({
    id: entityId,
    name: area.nombre || "Polígono / Zona",
    position: labelPosition
      ? Cesium.Cartesian3.fromDegrees(labelPosition.lng, labelPosition.lat)
      : undefined,
    polygon: {
      hierarchy: toCartesianArray(ringPoints),
      material: outline.withAlpha(opacity),
      outline: true,
      outlineColor: outline,
      outlineWidth: lineWidth,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      perPositionHeight: false
    },
    label: displayLabel && labelPosition ? {
      text: displayLabel,
      font: "14px sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    } : undefined,
    properties: {
      tacticalType: "polygon",
      draggable: false,
      id_area: area.id_area ?? null,
      ...creatorProperties(area)
    }
  });

  return viewer.entities.add({
    id: entityId,
    name: area.nombre || "Círculo de cobertura",
    position: Cesium.Cartesian3.fromDegrees(lng, lat),
    ellipse: {
      semiMajorAxis: radius,
      semiMinorAxis: radius,
      material: fill,
      outline: true,
      outlineColor: outline,
      outlineWidth: lineWidth,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    },
    label: area.nombre ? {
      text: area.nombre,
      font: "14px sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    } : undefined,
    properties: {
      tacticalType: "circle",
      draggable: true,
      id_area: area.id_area ?? null,
      ...creatorProperties(area)
    }
  });
}

function buildStructureEntity(estructura) {
  const viewer = dashboardState.viewer;
  if (!viewer) return null;

  const lat = Number(estructura.latitud ?? estructura.lat);
  const lng = Number(estructura.longitud ?? estructura.lon ?? estructura.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const type = String(estructura.tipo_estructura || "").toUpperCase();
  const isLabel = type === "ETIQUETA";
  const entityId = estructura.id_marca ? `estructura_${estructura.id_marca}` : undefined;

  if (entityId && viewer.entities.getById(entityId)) {
    return null;
  }

  const name = String(estructura.nombre || (isLabel ? "Etiqueta" : "Edificio"));
  const displayLabel = ["Etiqueta", "Edificio"].includes(name.trim()) ? "" : name.trim();

  return viewer.entities.add({
    id: entityId,
    name,
    position: Cesium.Cartesian3.fromDegrees(lng, lat),
    billboard: !isLabel ? {
      image: "img/estructuras/casa.png",
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      scale: 0.08,
      scaleByDistance: getTacticalScaleByDistance()
    } : undefined,
    label: displayLabel ? {
      text: displayLabel,
      font: "12px sans-serif",
      pixelOffset: isLabel ? new Cesium.Cartesian2(0, -18) : new Cesium.Cartesian2(0, 8),
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      scaleByDistance: getTacticalScaleByDistance(),
      showBackground: isLabel,
      backgroundColor: isLabel ? Cesium.Color.BLACK.withAlpha(0.7) : undefined,
      backgroundPadding: isLabel ? new Cesium.Cartesian2(6, 4) : undefined
    } : undefined,
    properties: {
      tacticalType: isLabel ? "label" : "building",
      draggable: true,
      id_marca: estructura.id_marca ?? null,
      tipo_estructura: type || null,
      ...creatorProperties(estructura)
    }
  });
}

function buildRouteEntity(ruta) {
  const viewer = dashboardState.viewer;
  if (!viewer) return null;

  let geometry = ruta?.geometria;
  if (typeof geometry === "string") {
    try { geometry = JSON.parse(geometry); } catch { return null; }
  }
  if (geometry?.type !== "LineString" || !Array.isArray(geometry.coordinates)) return null;

  const points = geometry.coordinates
    .map(coord => ({
      lng: Number(coord?.[0]),
      lat: Number(coord?.[1])
    }))
    .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (points.length < 2) return null;

  const entityId = ruta.id_ruta ? `ruta_operacion_${ruta.id_ruta}` : undefined;
  if (entityId && viewer.entities.getById(entityId)) return null;

  const color = Cesium.Color.fromCssColorString(ruta.color || "#1E90FF");

  return viewer.entities.add({
    id: entityId,
    name: ruta.nombre || "Linea tactica",
    polyline: {
      positions: toCartesianArray(points),
      width: Number(ruta.grosor || ruta.width || getLineWidth()),
      material: color,
      clampToGround: true
    },
    properties: {
      tacticalType: "polyline",
      draggable: false,
      id_ruta: ruta.id_ruta ?? null,
      ...creatorProperties(ruta)
    }
  });
}

async function saveCircleAreaToBackend(lat, lng, radius, nombre, colorName) {
  try {
    const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
    const token = localStorage.getItem("token");
    const opId = localStorage.getItem("active_operation_id");
    if (!token || !opId) return null;

    const body = {
      nombre: nombre || "Círculo de cobertura",
      descripcion: "Circulo de cobertura",
      color: COLOR_HEX_MAP[colorName] || "#FF4500",
      geometria: {
        type: "Polygon",
        coordinates: circleToPolygonCoordinates(lat, lng, radius),
        meta: {
          shape: "circle",
          center: [lng, lat],
          radius_m: radius,
          opacity: getOpacity(),
          outline_width: getLineWidth()
        }
      },
      ...getAreaCreatorPayload()
    };

    const res = await fetch(`${API_BASE}/ops/${opId}/areas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      const mensaje = data?.mensaje || "No se pudo guardar el círculo de cobertura.";
      if (dom.tbHint) dom.tbHint.textContent = mensaje;
      alert(mensaje);
      return null;
    }

    return data.area || null;
  } catch (err) {
    console.error("Error guardando área en backend:", err);
    if (dom.tbHint) {
      dom.tbHint.textContent = "Error de conexión al guardar el círculo de cobertura.";
    }
    alert("Error de conexión al guardar el círculo de cobertura.");
    return null;
  }
}

async function savePolygonAreaToBackend(points, nombre, colorName) {
  const coordinates = pointsToPolygonCoordinates(points);
  if (!coordinates) return null;

  try {
    const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
    const token = localStorage.getItem("token");
    const opId = localStorage.getItem("active_operation_id");
    if (!token || !opId) return null;

    const body = {
      nombre: nombre || "Polígono / Zona",
      descripcion: "Poligono o zona",
      color: COLOR_HEX_MAP[colorName] || "#FFD700",
      geometria: {
        type: "Polygon",
        coordinates,
        meta: {
          shape: "polygon",
          opacity: getOpacity(),
          outline_width: getLineWidth()
        }
      },
      ...getAreaCreatorPayload()
    };

    const res = await fetch(`${API_BASE}/ops/${opId}/areas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      const mensaje = data?.mensaje || "No se pudo guardar el polígono.";
      if (dom.tbHint) dom.tbHint.textContent = mensaje;
      alert(mensaje);
      return null;
    }

    return data.area || null;
  } catch (err) {
    console.error("Error guardando área poligonal en backend:", err);
    if (dom.tbHint) {
      dom.tbHint.textContent = "Error de conexión al guardar el polígono.";
    }
    alert("Error de conexión al guardar el polígono.");
    return null;
  }
}

async function saveTacticalRouteToBackend(points, nombre, colorName) {
  const geometria = pointsToLineString(points);
  if (!geometria) return null;

  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");
  if (!token || !opId) return null;

  try {
    const res = await fetch(`${API_BASE}/ops/${opId}/rutas`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        nombre: nombre || "Linea tactica",
        descripcion: "Linea tactica dibujada en dashboard",
        geometria,
        color: COLOR_HEX_MAP[colorName] || "#1E90FF",
        ...getAreaCreatorPayload()
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      const mensaje = data?.mensaje || "No se pudo guardar la linea tactica.";
      if (dom.tbHint) dom.tbHint.textContent = mensaje;
      alert(mensaje);
      return null;
    }

    if (data.ruta?.id_ruta) {
      _mySentRouteIds.add(data.ruta.id_ruta);
      setTimeout(() => _mySentRouteIds.delete(data.ruta.id_ruta), 5000);
    }

    return data.ruta || null;
  } catch (err) {
    console.error("[RUTA] Error guardando linea tactica:", err);
    if (dom.tbHint) dom.tbHint.textContent = "Error de conexion al guardar la linea tactica.";
    return null;
  }
}

async function saveOperationZoneToBackend(points, nombre, colorName) {
  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");
  if (!token || !opId) return null;

  const coordinates = pointsToPolygonCoordinates(points);
  if (!coordinates) {
    if (dom.tbHint) dom.tbHint.textContent = "La zona requiere al menos 3 puntos.";
    return null;
  }

  try {
    const res = await fetch(`${API_BASE}/ops/${opId}/zona`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        nombre: nombre || "Zona de operación",
        geometria: {
          type: "Polygon",
          coordinates,
          meta: {
            outline_width: getLineWidth()
          }
        },
        color: COLOR_HEX_MAP[colorName] || COLOR_HEX_MAP.blue
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const mensaje = data?.mensaje || "No se pudo guardar la zona.";
      if (dom.tbHint) dom.tbHint.textContent = mensaje;
      return null;
    }

    return data.zona || null;
  } catch (err) {
    console.warn("[ZONA] Error guardando zona de operación:", err);
    if (dom.tbHint) dom.tbHint.textContent = "Sin conexión — zona creada localmente.";
    return null;
  }
}

async function deleteOperationZoneFromBackend() {
  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");
  if (!token || !opId) return false;

  try {
    const res = await fetch(`${API_BASE}/ops/${opId}/zona`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const mensaje = data?.mensaje || "No se pudo eliminar la zona de operación.";
      if (dom.tbHint) dom.tbHint.textContent = mensaje;
      alert(mensaje);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[ZONA] Error eliminando zona de operación:", err);
    if (dom.tbHint) dom.tbHint.textContent = "Error de conexión al eliminar la zona de operación.";
    alert("Error de conexión al eliminar la zona de operación.");
    return false;
  }
}

export function getLineWidth() {
  if (dashboardState.toolMode === "perimeter" && dom.zoneWidthRange) {
    return Number(dom.zoneWidthRange.value || 3);
  }
  return Number(dom.widthRange?.value || 3);
}

export function getOpacity() {
  return Number(dom.opacityRange?.value || 0.35);
}

export function getRadius() {
  return Number(dom.radiusInput?.value || 5000);
}

export function getCurrentLabel() {
  return (dom.symLabel?.value || "").trim();
}

export function getCurrentColorName() {
  if (dashboardState.toolMode === "perimeter" && dom.zoneColorSelect) {
    return dom.zoneColorSelect.value || "blue";
  }
  return dom.colorSelect?.value || "red";
}

function getCurrentDrawingColor(alpha = 1) {
  return getCesiumColor(getCurrentColorName(), alpha);
}

function refreshDrawingVertexColors() {
  const color = getCurrentDrawingColor(1);
  dashboardState.drawingVertexEntities.forEach((entity) => {
    if (entity?.point) {
      entity.point.color = color;
    }
  });
}

function updateTacticalControlReadouts() {
  if (dom.opacityValue && dom.opacityRange) {
    const opacity = Number(dom.opacityRange.value || 0);
    dom.opacityValue.textContent = `${Math.round(opacity * 100)}%`;
  }

  if (dom.widthValue && dom.widthRange) {
    dom.widthValue.textContent = `${Number(dom.widthRange.value || 0)} px`;
  }
}

export function toCartesianArray(points) {
  return points.map(p => Cesium.Cartesian3.fromDegrees(p.lng, p.lat));
}

export function addTacticalEntity(entity) {
  dashboardState.tacticalEntities.push(entity);
  saveTacticalData();

  // Register in global undo/redo stack
  if (entity?.id) {
    pushUndoAction({
      type: "add",
      entityId: entity.id,
      entityRef: entity,
      source: "tactical"
    });
  }

  return entity;
}

export function resetDrawingState() {
  dashboardState.placingMode = false;
  dashboardState.drawingPoints = [];

  const viewer = dashboardState.viewer;
  if (viewer) {
    dashboardState.drawingVertexEntities.forEach(ent => viewer.entities.remove(ent));

    if (dashboardState.tacticalPreviewLine) {
      viewer.entities.remove(dashboardState.tacticalPreviewLine);
    }

    if (dashboardState.tacticalPreviewFill) {
      viewer.entities.remove(dashboardState.tacticalPreviewFill);
    }
  }

  dashboardState.drawingVertexEntities = [];
  dashboardState.tacticalPreviewLine = null;
  dashboardState.tacticalPreviewFill = null;
}

function clearCurrentSelectionAndTool(message = "Selección cancelada.") {
  stopAllDrawingModes();
  ensureMapMovementEnabled();
  resetDrawingState();

  dashboardState.selectedEntity = null;
  dashboardState.toolMode = "none";
  dashboardState.placingMode = false;
  dashboardState.pickMode = null;
  dashboardState.selectedRemoteRouteId = null;

  if (dom.toolSelect) dom.toolSelect.value = "none";
  if (dom.entityPopup) dom.entityPopup.style.display = "none";
  if (dom.vehicleQuickMenu) dom.vehicleQuickMenu.style.display = "none";
  if (dom.tbHint) dom.tbHint.textContent = message;

  updateSelectionInfo(null);
  setTacticalUI();
}

function finishActiveTool(message = "Herramienta finalizada.") {
  stopAllDrawingModes();
  ensureMapMovementEnabled();
  resetDrawingState();

  dashboardState.toolMode = "none";
  dashboardState.placingMode = false;
  dashboardState.pickMode = null;

  if (dom.toolSelect) dom.toolSelect.value = "none";
  if (dom.tbHint) dom.tbHint.textContent = message;

  setTacticalUI();
}

export function updateTacticalPreview(currentLat, currentLng) {
  const viewer = dashboardState.viewer;
  if (!viewer || dashboardState.drawingPoints.length === 0 || !dashboardState.placingMode) return;

  const validModes = ["polygon", "polyline", "perimeter"];
  if (!validModes.includes(dashboardState.toolMode)) return;

  const previewPoints = [
    ...dashboardState.drawingPoints,
    { lat: currentLat, lng: currentLng }
  ];

  if (dashboardState.toolMode === "polygon" || dashboardState.toolMode === "perimeter") {
    previewPoints.push(dashboardState.drawingPoints[0]);
  }

  if (dashboardState.tacticalPreviewLine) {
    viewer.entities.remove(dashboardState.tacticalPreviewLine);
  }

  if (dashboardState.tacticalPreviewFill) {
    viewer.entities.remove(dashboardState.tacticalPreviewFill);
  }

  const dashColor = getCurrentDrawingColor(1);

  dashboardState.tacticalPreviewLine = viewer.entities.add({
    polyline: {
      positions: toCartesianArray(previewPoints),
      width: getLineWidth(),
      material: new Cesium.PolylineDashMaterialProperty({
        color: dashColor,
        dashLength: 12
      }),
      clampToGround: true
    }
  });

  if (dashboardState.toolMode === "polygon" && dashboardState.drawingPoints.length >= 2) {
    const polyPoints = [
      ...dashboardState.drawingPoints,
      { lat: currentLat, lng: currentLng }
    ];

    dashboardState.tacticalPreviewFill = viewer.entities.add({
      polygon: {
        hierarchy: toCartesianArray(polyPoints),
        material: Cesium.Color.WHITE.withAlpha(0.15),
        perPositionHeight: false
      }
    });
  } else {
    dashboardState.tacticalPreviewFill = null;
  }
}

function syncTacticalToolAvailability(currentOperation = getCurrentOperation()) {
  const phase = String(currentOperation?.phase || currentOperation?.estado || "").toLowerCase();
  const isPlanningOperation = phase === "planificada";
  const isActiveOperation = phase === "activa";
  const canEditTactical = isPlanningOperation || isActiveOperation;
  const canEditOperationZone = isPlanningOperation;
  const panelTitle = document.getElementById("tacticalPanelTitle") || document.querySelector("#tacticalPanel .panelTitle");
  const toolGroupTitle = document.getElementById("tacticalToolGroupTitle") || document.querySelector("#tacticalPanel .groupTitle");
  const perimeterOption = dom.toolSelect?.querySelector('option[value="perimeter"]');

  if (panelTitle) panelTitle.textContent = "Objetos";
  if (toolGroupTitle) toolGroupTitle.textContent = "Selección de tipo de objeto";

  if (perimeterOption) {
    perimeterOption.hidden = !canEditOperationZone;
    perimeterOption.disabled = !canEditOperationZone;
  }

  if (!canEditOperationZone && dashboardState.toolMode === "perimeter") {
    dashboardState.toolMode = "none";
    if (dom.toolSelect) dom.toolSelect.value = "none";
    resetDrawingState();
  }

  return { canEditTactical, canEditOperationZone };
}

export function setTacticalUI() {
  const currentOperation = getCurrentOperation();
  const { canEditTactical, canEditOperationZone } = syncTacticalToolAvailability(currentOperation);
  const phase = String(currentOperation?.phase || currentOperation?.estado || "").toLowerCase();
  const showOperationZone = phase === "planificada" || phase === "activa";
  const isToolActive = dashboardState.toolMode !== "none";
  const isMil = dashboardState.toolMode === "mil";
  const isPoi = dashboardState.toolMode === "poi";
  const isPencil = dashboardState.toolMode === "pencil";
  const isEraser = dashboardState.drawingMode === "eraser";
  const isDrawingTool = isPencil;
  const isBuilding = dashboardState.toolMode === "building";
  const isLabel = dashboardState.toolMode === "label";
  const isGrid = dashboardState.toolMode === "grid";
  const isCircle = dashboardState.toolMode === "circle";
  const needsLabel = ["mil", "poi", "label", "circle", "polygon", "polyline", "perimeter"].includes(dashboardState.toolMode);
  const needsRadius = dashboardState.toolMode === "circle";
  const isMultiPoint = ["polygon", "polyline", "perimeter"].includes(dashboardState.toolMode);
  const showsFinishShapeAction = ["polygon", "polyline", "perimeter"].includes(dashboardState.toolMode) || dashboardState.areaDrawing;
  const showCancelButton = !isGrid && !isMil && !isDrawingTool && !["poi", "circle", "label", "building"].includes(dashboardState.toolMode);
  const showLabelInput = !isGrid && needsLabel && !isMil && !isDrawingTool;
  const showColorInput = !isBuilding && !isGrid && !isMil && !isEraser && dashboardState.toolMode !== "none";
  const showOpacityInput = !isBuilding && !isLabel && isToolActive && !isGrid && !isMil && !isPoi && !isDrawingTool && dashboardState.toolMode !== "perimeter";
  const showWidthInput = !isBuilding && !isLabel && !isGrid && !isMil && !isPoi && !isEraser && dashboardState.toolMode !== "none";

  if (dom.tacticalPanel) {
    dom.tacticalPanel.classList.toggle("has-active-tool", isToolActive);
    dom.tacticalPanel.classList.toggle("is-circle-tool", isCircle);
  }

  const milTitle = document.getElementById("milSymbolTitle");
  if (milTitle) milTitle.style.display = isMil ? "block" : "none";

  if (dom.milSymbolGenerator) dom.milSymbolGenerator.style.display = isMil ? "block" : "none";

  const buildingPreview = document.getElementById("buildingPreview");
  if (buildingPreview) buildingPreview.style.display = isBuilding ? "block" : "none";
  if (dom.gridSubmenu) dom.gridSubmenu.style.display = isGrid ? "block" : "none";

  if (dom.pencilSubmenu) dom.pencilSubmenu.style.display = isPencil ? "block" : "none";
  if (isPencil) {
    if (dom.btnSelectPencil) {
      dom.btnSelectPencil.style.background = isEraser ? "rgba(255,255,255,0.1)" : "#00ffa6";
      dom.btnSelectPencil.style.color = isEraser ? "#fff" : "#001b1b";
    }
    if (dom.btnSelectEraser) {
      dom.btnSelectEraser.style.background = isEraser ? "#00ffa6" : "rgba(255,255,255,0.1)";
      dom.btnSelectEraser.style.color = isEraser ? "#001b1b" : "#fff";
    }
  }

  if (dom.symLabelContainer) dom.symLabelContainer.style.display = showLabelInput ? "block" : "none";
  if (dom.colorContainer) dom.colorContainer.style.display = showColorInput ? "block" : "none";
  if (dom.opacityContainer) dom.opacityContainer.style.display = showOpacityInput ? "block" : "none";
  if (dom.widthContainer) dom.widthContainer.style.display = showWidthInput ? "block" : "none";
  updateTacticalControlReadouts();
  if (dom.tacticalActionButtons) {
    dom.tacticalActionButtons.style.display =
      isToolActive || dashboardState.areaDrawing ? "grid" : "none";
    dom.tacticalActionButtons.classList.toggle("hasFinishAction", showsFinishShapeAction);
  }
  if (dom.cancelPlace) dom.cancelPlace.style.display = showCancelButton ? "" : "none";
  if (dom.clearTactical) {
    dom.clearTactical.style.display = canEditTactical ? "" : "none";
    dom.clearTactical.disabled = !canEditTactical;
    dom.clearTactical.title = canEditTactical
      ? "Limpiar objetos tacticos"
      : "No se puede limpiar una operacion finalizada";
  }

  if (dom.symLabel) dom.symLabel.disabled = !showLabelInput;
  if (dom.radiusInput) dom.radiusInput.disabled = !needsRadius;
  if (dom.radiusContainer) {
    dom.radiusContainer.style.display = needsRadius ? "block" : "none";
  }

  if (isMil) {
    populateMilIconOptions();
    updateMilSymbolPreview();
  }

  const finishActionLabels = {
    polygon: "Terminar polígono",
    polyline: "Terminar ruta",
    perimeter: "Terminar perímetro"
  };

  if (dom.finishShape) {
    const minPoints = dashboardState.toolMode === "polygon" ? 3 : 2;
    const canFinishShape = dashboardState.areaDrawing || (isMultiPoint && dashboardState.placingMode && dashboardState.drawingPoints.length >= minPoints);
    dom.finishShape.style.display = showsFinishShapeAction ? "" : "none";
    dom.finishShape.textContent = dashboardState.areaDrawing
      ? "Terminar área"
      : (finishActionLabels[dashboardState.toolMode] || "Terminar figura");
    dom.finishShape.disabled = !canFinishShape;
  }

  const isDrawingZone = dashboardState.toolMode === "perimeter" && dashboardState.placingMode;
  if (dom.operationZoneControls) dom.operationZoneControls.style.display = showOperationZone ? "" : "none";
  if (dom.zoneEditActions) dom.zoneEditActions.style.display = canEditOperationZone ? "" : "none";
  if (dom.zoneCoordinatesEditControls) dom.zoneCoordinatesEditControls.style.display = canEditOperationZone ? "" : "none";
  if (dom.zoneStyleControls) dom.zoneStyleControls.style.display = canEditOperationZone ? "grid" : "none";
  if (dom.zoneActionBtns) dom.zoneActionBtns.style.display = isDrawingZone ? "block" : "none";
  if (dom.finishZoneBtn) dom.finishZoneBtn.style.display = isDrawingZone ? "block" : "none";
  if (dom.markZoneBtn) {
    const isModeZone = dashboardState.toolMode === "perimeter";
    dom.markZoneBtn.disabled = !canEditOperationZone;
    dom.markZoneBtn.style.background = isModeZone ? "var(--dash-accent-light)" : "";
    dom.markZoneBtn.style.color = isModeZone ? "#001b1b" : "";
    dom.markZoneBtn.textContent = isDrawingZone ? "Marcando..." : "Marcar zona";
    dom.markZoneBtn.title = canEditOperationZone
      ? "Delimitar zona de operacion"
      : "La zona queda bloqueada cuando la operacion esta activa";
  }
  if (dom.clearZoneBtn) {
    dom.clearZoneBtn.disabled = !canEditOperationZone || !dashboardState.currentOperationZone;
    dom.clearZoneBtn.title = canEditOperationZone
      ? "Limpiar zona de operacion"
      : "La zona queda bloqueada cuando la operacion esta activa";
  }
  if (dom.zoneCoordinatesInput) dom.zoneCoordinatesInput.disabled = !canEditOperationZone;
  if (dom.applyZoneCoordinatesBtn) dom.applyZoneCoordinatesBtn.disabled = !canEditOperationZone;
  if (dom.zoneColorSelect) dom.zoneColorSelect.disabled = !canEditOperationZone;
  if (dom.zoneWidthRange) dom.zoneWidthRange.disabled = !canEditOperationZone;

  // Manage cursor for draw modes
  const mapEl = document.getElementById("map");
  if (mapEl) {
    mapEl.classList.remove("pencil-cursor", "eraser-cursor");
    if (isPencil) mapEl.classList.add("pencil-cursor");
    if (isEraser) mapEl.classList.add("eraser-cursor");
  }
}

export async function createPoi(lat, lng, iconPath = null) {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  const label = getCurrentLabel();
  const color = getCesiumColor(getCurrentColorName(), 1);

  if (dashboardState.toolMode === "poi") {
    const storedName = label || "Punto de interés";
    let savedPoi = await savePoiToBackend(lat, lng, storedName, "PDI", getCurrentColorName());
    if (!savedPoi) {
      // Fallback local
      savedPoi = {
        id_poi: `local_${Date.now()}`,
        nombre: storedName,
        tipo_poi: "PDI",
        latitud: lat,
        longitud: lng,
        color: COLOR_HEX_MAP[getCurrentColorName()] || "#FFD700"
      };
    }

    const ent = buildPoiEntity(savedPoi, "poi");
    if (ent) {
      addTacticalEntity(ent);
      if (dom.tbHint) dom.tbHint.textContent = "Punto de interés colocado.";
    }
    return;
  }

  if (dashboardState.toolMode === "building") {
    const storedName = label || "Edificio";
    let savedStructure = await saveStructureToBackend(lat, lng, storedName, "EDIFICIO");
    if (!savedStructure) {
      savedStructure = {
        id_marca: `local_${Date.now()}`,
        nombre: storedName,
        tipo_estructura: "EDIFICIO",
        latitud: lat,
        longitud: lng
      };
    }

    const ent = buildStructureEntity(savedStructure);
    if (ent) {
      addTacticalEntity(ent);
      if (dom.tbHint) dom.tbHint.textContent = "Edificio colocado.";
    }
    return;
  }

  const ent = viewer.entities.add({
    name: label,
    position: Cesium.Cartesian3.fromDegrees(lng, lat),
    billboard: iconPath ? {
      image: iconPath,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      scale: 0.08,
      scaleByDistance: getTacticalScaleByDistance()
    } : undefined,
    point: !iconPath ? {
      pixelSize: 10,
      color,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      scaleByDistance: getTacticalScaleByDistance()
    } : undefined,
    label: label ? {
      text: label,
      font: "14px sans-serif",
      pixelOffset: iconPath ? new Cesium.Cartesian2(0, 15) : new Cesium.Cartesian2(0, -20),
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      scaleByDistance: getTacticalScaleByDistance()
    } : undefined,
    properties: {
      tacticalType: dashboardState.toolMode,
      draggable: true
    }
  });

  addTacticalEntity(ent);
  if (dom.tbHint) dom.tbHint.textContent = "Objeto colocado.";
}

export async function createMilSymbol(lat, lng, nombre, iconPath, scale = 0.08, sidc = null) {
  const uniqueName = buildMilUniqueName(nombre);
  const movement = getMilMovementData();
  let savedPoi = await savePoiToBackend(lat, lng, uniqueName, "MIL", "red", iconPath, sidc, movement);
  if (!savedPoi) {
    savedPoi = {
      id_poi: `local_${Date.now()}`,
      nombre: uniqueName,
      tipo_poi: "MIL",
      latitud: lat,
      longitud: lng,
      color: "#FF4500",
      icono_src: iconPath,
      sidc: sidc,
      ...movement
    };
  }

  const ent = buildPoiEntity({ ...savedPoi, sidc: sidc || savedPoi.sidc, scale }, "poi");
  if (ent) {
    addTacticalEntity(ent);
    if (dom.tbHint) dom.tbHint.textContent = "Símbolo MIL colocado.";
  }
}

function getCurrentMilPlacement() {
  const sidc = buildMilSidc();
  if (!sidc || !isMilSidcRenderable(sidc)) return null;

  return {
    sidc,
    title: dom.milIcon?.selectedOptions?.[0]?.textContent
      || dom.milPreviewContainer?.dataset.title
      || "Simbolo MIL"
  };
}

export async function createLabel(lat, lng) {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  const label = getCurrentLabel();
  const storedName = label || "Etiqueta";
  let savedStructure = await saveStructureToBackend(lat, lng, storedName, "ETIQUETA");
  if (!savedStructure) {
    savedStructure = {
      id_marca: `local_${Date.now()}`,
      nombre: storedName,
      tipo_estructura: "ETIQUETA",
      latitud: lat,
      longitud: lng
    };
  }

  const ent = buildStructureEntity(savedStructure);
  if (ent) addTacticalEntity(ent);
  if (dom.tbHint) dom.tbHint.textContent = "Etiqueta colocada.";
}

export async function createCircle(lat, lng) {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  const label = getCurrentLabel();
  const colorName = getCurrentColorName();
  const radius = getRadius();
  const localArea = makeCircleAreaData(`local_${Date.now()}`, lat, lng, radius, label, colorName);
  const localEntity = buildAreaEntity(localArea);
  if (localEntity) dashboardState.tacticalEntities.push(localEntity);
  if (dom.tbHint) dom.tbHint.textContent = "Círculo de cobertura colocado.";

  const savedArea = await saveCircleAreaToBackend(lat, lng, radius, label, colorName);
  if (!savedArea) {
    if (localEntity?.id) {
      saveTacticalData();
      pushUndoAction({
        type: "add",
        entityId: localEntity.id,
        entityRef: localEntity,
        source: "tactical"
      });
    }
    return;
  }
  
  if (localEntity) removeTacticalEntity(localEntity);

  const existing = viewer.entities.getById(`area_${savedArea.id_area}`);
  if (existing) return;

  /*
    // Fallback local
    const fallbackId = `local_${Date.now()}`;
    savedArea = {
        id_area: fallbackId,
        nombre: label || "Círculo de cobertura",
        color: COLOR_HEX_MAP[colorName] || "#FF4500",
        geometria: {
            type: "Polygon",
            coordinates: circleToPolygonCoordinates(lat, lng, radius),
            meta: {
              shape: "circle",
              center: [lng, lat],
              radius_m: radius,
              opacity: getOpacity(),
              outline_width: getLineWidth()
            }
        }
    };
  }

  */

  const entFromBackend = buildAreaEntity(savedArea);
  if (!entFromBackend) return;

  addTacticalEntity(entFromBackend);
  if (dom.tbHint) dom.tbHint.textContent = "Círculo de cobertura colocado.";
}

export async function finishPolygon() {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  if (dashboardState.drawingPoints.length < 3) {
    if (dom.tbHint) dom.tbHint.textContent = "El polígono requiere al menos 3 puntos.";
    return;
  }

  const label = getCurrentLabel();
  const colorName = getCurrentColorName();
  let savedArea = await savePolygonAreaToBackend(dashboardState.drawingPoints, label, colorName);
  
  if (!savedArea) {
      // Fallback local
      const coordinates = pointsToPolygonCoordinates(dashboardState.drawingPoints);
      if (coordinates) {
          savedArea = {
              id_area: `local_${Date.now()}`,
              nombre: label || "Polígono / Zona",
              color: COLOR_HEX_MAP[colorName] || "#FFD700",
              geometria: {
                type: "Polygon",
                coordinates,
                meta: {
                  shape: "polygon",
                  opacity: getOpacity(),
                  outline_width: getLineWidth()
                }
              }
          };
      }
  }

  if (savedArea) {
      const entFromBackend = buildAreaEntity(savedArea);
      if (entFromBackend) addTacticalEntity(entFromBackend);
  }

  resetDrawingState();
  if (dom.tbHint) dom.tbHint.textContent = "Polígono / zona colocado.";
  setTacticalUI();
  finishActiveTool("Poligono / zona colocado.");
}

export async function finishPolyline() {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  if (dashboardState.drawingPoints.length < 2) {
    if (dom.tbHint) dom.tbHint.textContent = "La línea requiere al menos 2 puntos.";
    return;
  }

  const positions = toCartesianArray(dashboardState.drawingPoints);
  const color = getCesiumColor(getCurrentColorName(), 1);
  const label = getCurrentLabel();
  const colorName = getCurrentColorName();
  let savedRoute = await saveTacticalRouteToBackend(dashboardState.drawingPoints, label, colorName);

  if (savedRoute) {
    const entFromBackend = buildRouteEntity(savedRoute);
    if (entFromBackend) addTacticalEntity(entFromBackend);
  } else {
    savedRoute = { id_ruta: `local_${Date.now()}` };
  }

  if (String(savedRoute.id_ruta).startsWith("local_")) {
    const ent = viewer.entities.add({
    name: label || "Línea táctica",
    polyline: {
      positions,
      width: getLineWidth(),
      material: color,
      clampToGround: true
    },
    properties: {
      tacticalType: "polyline",
      draggable: false,
      id_ruta: savedRoute.id_ruta
    }
  });

    addTacticalEntity(ent);
  }

  if (label) {
    const last = dashboardState.drawingPoints[dashboardState.drawingPoints.length - 1];
    const labelEnt = viewer.entities.add({
      name: label,
      position: Cesium.Cartesian3.fromDegrees(last.lng, last.lat),
      label: {
        text: label,
        font: "14px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        scaleByDistance: getTacticalScaleByDistance()
      },
      properties: {
        tacticalType: "label",
        draggable: true
      }
    });
    addTacticalEntity(labelEnt);
  }

  resetDrawingState();
  if (dom.tbHint) dom.tbHint.textContent = "Línea táctica completada.";
  setTacticalUI();
  finishActiveTool("Linea tactica completada.");
}

export function finishPerimeter() {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  if (dashboardState.drawingPoints.length < 3) {
    if (dom.tbHint) dom.tbHint.textContent = "El perímetro requiere al menos 3 puntos.";
    return;
  }

  const closed = [...dashboardState.drawingPoints, dashboardState.drawingPoints[0]];
  const positions = toCartesianArray(closed);
  const color = getCesiumColor(getCurrentColorName(), 1);
  const label = getCurrentLabel();

  const ent = viewer.entities.add({
    name: label || "Perímetro punteado",
    polyline: {
      positions,
      width: getLineWidth(),
      material: new Cesium.PolylineDashMaterialProperty({
        color,
        dashLength: 16
      }),
      clampToGround: true
    },
    properties: {
      tacticalType: "perimeter",
      draggable: false
    }
  });

  addTacticalEntity(ent);

  if (label) {
    const first = dashboardState.drawingPoints[0];
    const labelEnt = viewer.entities.add({
      name: label,
      position: Cesium.Cartesian3.fromDegrees(first.lng, first.lat),
      label: {
        text: label,
        font: "14px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        scaleByDistance: getTacticalScaleByDistance()
      },
      properties: {
        tacticalType: "label",
        draggable: true
      }
    });
    addTacticalEntity(labelEnt);
  }

  resetDrawingState();
  if (dom.tbHint) dom.tbHint.textContent = "Perímetro completado.";
  setTacticalUI();
  finishActiveTool("Perimetro completado.");
}

async function finishOperationZonePerimeter() {
  const currentOperation = getCurrentOperation();
  const phase = String(currentOperation?.phase || currentOperation?.estado || "").toLowerCase();
  if (phase !== "planificada") {
    if (dom.tbHint) dom.tbHint.textContent = "La zona queda bloqueada cuando la operacion esta activa.";
    resetDrawingState();
    setTacticalUI();
    return;
  }

  if (dashboardState.drawingPoints.length < 3) {
    if (dom.tbHint) dom.tbHint.textContent = "La zona de operacion requiere al menos 3 puntos.";
    return;
  }

  const label = getCurrentLabel();
  const colorName = getCurrentColorName();
  let zona = await saveOperationZoneToBackend(
    dashboardState.drawingPoints,
    label || "Zona de operacion",
    colorName
  );

  // Fallback local: si el backend falla, construimos la zona localmente
  if (!zona) {
    const coordinates = pointsToPolygonCoordinates(dashboardState.drawingPoints);
    if (!coordinates) return;

    const center = calculateCentroid(dashboardState.drawingPoints);
    zona = {
      id_zona: `local_${Date.now()}`,
      nombre: label || "Zona de operacion",
      color: COLOR_HEX_MAP[colorName] || COLOR_HEX_MAP.blue,
      geometria: {
        type: "Polygon",
        coordinates,
        meta: {
          outline_width: getLineWidth()
        }
      },
      centroide_lat: center?.lat,
      centroide_lon: center?.lng,
      zoom_inicial: 1000
    };

    console.warn("[ZONA] Backend no disponible, zona creada localmente.");
  }

  buildOperationZoneEntity(zona);
  updateZoneCoordinatesSummary(dashboardState.drawingPoints);
  focusViewerOnOperationZone(zona);
  resetDrawingState();
  if (dom.tbHint) dom.tbHint.textContent = "Zona de operacion actualizada.";
  setTacticalUI();
  finishActiveTool("Zona de operacion actualizada.");
}

function parseZoneCoordinatesInput(value) {
  const parts = String(value || "").split(/[;\n]+/).map((part) => part.trim()).filter(Boolean);
  const points = parts.map((part) => {
    const values = part.split(/[\s,]+/).map(Number);
    if (values.length !== 2 || !Number.isFinite(values[0]) || !Number.isFinite(values[1])) return null;
    const [lat, lng] = values;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  });
  return points.length >= 3 && points.every(Boolean) ? points : null;
}

function updateZoneCoordinatesSummary(points = []) {
  if (!dom.zoneCoordinatesSummary) return;
  const normalized = points.map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) }));
  dom.zoneCoordinatesSummary.textContent = normalized.length
    ? `Coordenadas guardadas (${normalized.length} puntos):\n${normalized.map((p, i) => `${i + 1}. ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`).join("\n")}`
    : "Sin coordenadas guardadas.";
  if (dom.zoneCoordinatesInput && normalized.length) {
    dom.zoneCoordinatesInput.value = normalized.map((p) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`).join("; ");
  }
}

export function handleTacticalPlacement(lat, lng) {
  const viewer = dashboardState.viewer;
  if (!viewer) return false;

  if (!dashboardState.placingMode || dashboardState.toolMode === "none") return false;

  if (dashboardState.toolMode === "mil") {
    const mil = getCurrentMilPlacement();
    if (!mil) {
      if (dom.tbHint) dom.tbHint.textContent = "Selecciona un simbolo MIL valido.";
      return true;
    }

    createMilSymbol(lat, lng, getCurrentLabel(), null, 1, mil.sidc)
      .finally(() => finishActiveTool(`${mil.title} colocado.`));
    return true;
  }

  if (dashboardState.toolMode === "grid") {
    generateGrid();
    finishActiveTool("Cuadricula generada.");
    return true;
  }

  if (dashboardState.toolMode === "poi") {
    createPoi(lat, lng).finally(() => finishActiveTool("Punto de interes colocado."));
    return true;
  }

  if (dashboardState.toolMode === "building") {
    createPoi(lat, lng, "img/estructuras/casa.png").finally(() => finishActiveTool("Estructura colocada."));
    return true;
  }

  if (dashboardState.toolMode === "label") {
    createLabel(lat, lng).finally(() => finishActiveTool("Etiqueta colocada."));
    return true;
  }

  if (dashboardState.toolMode === "circle") {
    createCircle(lat, lng).finally(() => finishActiveTool("Circulo de cobertura colocado."));
    return true;
  }

  if (["polygon", "polyline", "perimeter"].includes(dashboardState.toolMode)) {
    dashboardState.drawingPoints.push({ lat, lng });
    const pointColor = getCurrentDrawingColor(1);

    const ent = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat),
      point: {
        pixelSize: 8,
        color: pointColor,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      }
    });

    dashboardState.drawingVertexEntities.push(ent);

    if (dom.tbHint) {
      if (dashboardState.toolMode === "perimeter") {
        dom.tbHint.textContent = `Punto ${dashboardState.drawingPoints.length}/4 agregado para la zona de operación.`;
      } else {
        dom.tbHint.textContent = `Punto agregado (${dashboardState.drawingPoints.length}). Continúa marcando y luego usa "Terminar figura".`;
      }
    }

    if (dashboardState.toolMode === "perimeter" && dashboardState.drawingPoints.length === 4) {
      if (dom.tbHint) {
        dom.tbHint.textContent = "Cargando 4 puntos... Generando zona de operación automáticamente.";
      }
      void finishOperationZonePerimeter();
    }

    setTacticalUI();
    return true;
  }

  return false;
}

export function isDraggableEntity(entity) {
  if (!entity) return false;
  const draggable = entity.properties?.draggable?.getValue?.() ?? entity.properties?.draggable;
  return Boolean(draggable && entity.position);
}

function getEntityCurrentLatLng(entity) {
  const position = entity?.position?.getValue?.(Cesium.JulianDate.now()) ?? entity?.position;
  if (!position) return null;
  return cartesianToLatLng(position);
}

function applyPoiUpdateToEntity(entity, poi) {
  const lat = Number(poi.latitud ?? poi.lat);
  const lng = Number(poi.longitud ?? poi.lon ?? poi.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const speedKmh = normalizeNumericInput(poi.velocidad_kmh ?? poi.velocidad ?? poi.speed,
    entity.properties?.velocidad_kmh?.getValue?.() ?? entity.properties?.velocidad_kmh ?? 0);
  const headingDegrees = normalizeHeading(poi.rumbo_grados ?? poi.rumbo ?? poi.headingDegrees ?? poi.heading)
    ?? normalizeHeading(entity.properties?.rumbo_grados?.getValue?.() ?? entity.properties?.rumbo_grados);
  entity.position = createMovingPosition(lat, lng, speedKmh, headingDegrees);
}

function applyStructureUpdateToEntity(entity, estructura) {
  const lat = Number(estructura.latitud ?? estructura.lat);
  const lng = Number(estructura.longitud ?? estructura.lon ?? estructura.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  entity.position = Cesium.Cartesian3.fromDegrees(lng, lat);
}

function applyAreaUpdateToEntity(entity, area) {
  const geometry = normalizeAreaGeometry(area);
  const meta = normalizeAreaMeta(area, geometry);
  if (String(meta?.shape || "").toLowerCase() !== "circle") return;

  const center = getCircleCenter(area, meta);
  const radius = Number(meta.radius_m ?? area?.radius_m ?? area?.radio_m);
  if (!Number.isFinite(radius) || radius <= 0) return;

  const { lng, lat } = center;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  entity.position = Cesium.Cartesian3.fromDegrees(lng, lat);
}

export async function persistDraggedEntity(entity) {
  const tacticalType =
    entity?.properties?.tacticalType?.getValue?.() ||
    entity?.properties?.tacticalType ||
    "";

  const coords = getEntityCurrentLatLng(entity);
  if (!coords) return false;

  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");
  if (!token || !opId) return false;

  let path = null;
  let body = { latitud: coords.lat, longitud: coords.lng };

  const idPoi = entity.properties?.id_poi?.getValue?.() ?? entity.properties?.id_poi;
  const idArea = entity.properties?.id_area?.getValue?.() ?? entity.properties?.id_area;
  const idMarca = entity.properties?.id_marca?.getValue?.() ?? entity.properties?.id_marca;

  if (idPoi && ["poi", "mil-dropped"].includes(String(tacticalType))) {
    path = `/ops/${opId}/pois/${idPoi}`;
  } else if (idArea && String(tacticalType) === "circle") {
    path = `/ops/${opId}/areas/${idArea}`;
  } else if (idMarca && ["building", "label"].includes(String(tacticalType))) {
    path = `/ops/${opId}/edificios/${idMarca}`;
  } else {
    saveTacticalData();
    return true;
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      const mensaje = data?.mensaje || "No se pudo actualizar el objeto táctico.";
      if (dom.tbHint) dom.tbHint.textContent = mensaje;
      alert(mensaje);
      return false;
    }

    if (data?.poi) applyPoiUpdateToEntity(entity, data.poi);
    if (data?.area) applyAreaUpdateToEntity(entity, data.area);
    if (data?.edificio) applyStructureUpdateToEntity(entity, data.edificio);

    saveTacticalData();
    if (dom.tbHint) dom.tbHint.textContent = "Objeto táctico actualizado.";
    return true;
  } catch (err) {
    console.error("[TACTICAL] Error actualizando objeto arrastrado:", err);
    if (dom.tbHint) dom.tbHint.textContent = "Error de conexión al actualizar el objeto táctico.";
    alert("Error de conexión al actualizar el objeto táctico.");
    return false;
  }
}

async function deletePoiFromBackend(idPoi) {
  if (String(idPoi).startsWith("local_")) return true; // nunca llegó al backend
  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");
  if (!token || !opId || !idPoi) return false;

  try {
    const res = await fetch(`${API_BASE}/ops/${opId}/pois/${idPoi}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const mensaje = data?.mensaje || "No se pudo eliminar el punto de interés.";
      if (dom.tbHint) dom.tbHint.textContent = mensaje;
      alert(mensaje);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[POI] Error eliminando punto de interés:", err);
    if (dom.tbHint) dom.tbHint.textContent = "Error de conexión al eliminar el punto de interés.";
    alert("Error de conexión al eliminar el punto de interés.");
    return false;
  }
}

async function deleteAreaFromBackend(idArea) {
  if (String(idArea).startsWith("local_")) return true; // nunca llegó al backend
  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");
  if (!token || !opId || !idArea) return false;

  try {
    const res = await fetch(`${API_BASE}/ops/${opId}/areas/${idArea}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const mensaje = data?.mensaje || "No se pudo eliminar el círculo de cobertura.";
      if (dom.tbHint) dom.tbHint.textContent = mensaje;
      alert(mensaje);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[AREA] Error eliminando círculo de cobertura:", err);
    if (dom.tbHint) dom.tbHint.textContent = "Error de conexión al eliminar el círculo de cobertura.";
    alert("Error de conexión al eliminar el círculo de cobertura.");
    return false;
  }
}

async function deleteStructureFromBackend(idMarca) {
  if (String(idMarca).startsWith("local_")) return true; // nunca llegó al backend
  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");
  if (!token || !opId || !idMarca) return false;

  try {
    const res = await fetch(`${API_BASE}/ops/${opId}/edificios/${idMarca}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const mensaje = data?.mensaje || "No se pudo eliminar la estructura.";
      if (dom.tbHint) dom.tbHint.textContent = mensaje;
      alert(mensaje);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[ESTRUCTURA] Error eliminando estructura:", err);
    if (dom.tbHint) dom.tbHint.textContent = "Error de conexion al eliminar la estructura.";
    alert("Error de conexion al eliminar la estructura.");
    return false;
  }
}

async function deleteRouteFromBackend(idRuta) {
  if (String(idRuta).startsWith("local_")) return true;
  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");
  if (!token || !opId || !idRuta) return false;

  try {
    const res = await fetch(`${API_BASE}/ops/${opId}/rutas/${idRuta}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const mensaje = data?.mensaje || "No se pudo eliminar la ruta tactica.";
      if (dom.tbHint) dom.tbHint.textContent = mensaje;
      alert(mensaje);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[RUTA] Error eliminando ruta tactica:", err);
    if (dom.tbHint) dom.tbHint.textContent = "Error de conexion al eliminar la ruta tactica.";
    return false;
  }
}

async function deleteCurrentOperationZoneFromBackend(idZona) {
  if (idZona && String(idZona).startsWith("local_")) return true; // nunca llegó al backend
  return deleteOperationZoneFromBackend();
}

function removeTacticalEntityLocally(entity) {
  const viewer = dashboardState.viewer;
  if (viewer && entity) {
    viewer.entities.remove(entity);
  }

  dashboardState.tacticalEntities = dashboardState.tacticalEntities.filter(
    ent => ent !== entity
  );
}

function clearTacticalStorageSnapshot() {
  const opId = getCurrentOperation()?.id || localStorage.getItem("active_operation_id");
  if (!opId) return;
  localStorage.removeItem(`tactical_data_${opId}`);
}

async function clearTacticalPersistedData() {
  const entities = [...dashboardState.tacticalEntities];
  const deletedPois = new Set();
  const deletedAreas = new Set();
  const deletedStructures = new Set();
  const failures = [];

  for (const entity of entities) {
    const tacticalType =
      entity.properties?.tacticalType?.getValue?.() ||
      entity.properties?.tacticalType ||
      "";
    const idPoi = entity.properties?.id_poi?.getValue?.() ?? entity.properties?.id_poi;
    const idArea = entity.properties?.id_area?.getValue?.() ?? entity.properties?.id_area;
    const idMarca = entity.properties?.id_marca?.getValue?.() ?? entity.properties?.id_marca;
    const idZona = entity.properties?.id_zona?.getValue?.() ?? entity.properties?.id_zona;
    const idRuta = entity.properties?.id_ruta?.getValue?.() ?? entity.properties?.id_ruta;

    // La zona de operacion/perimetro persistido no se toca desde este boton.
    if (idZona || ["operation-zone", "perimeter"].includes(String(tacticalType))) {
      continue;
    }

    if (idPoi && ["poi", "mil-dropped"].includes(String(tacticalType))) {
      if (!deletedPois.has(Number(idPoi))) {
        const deleted = await deletePoiFromBackend(idPoi);
        if (!deleted) {
          failures.push(`POI ${idPoi}`);
          continue;
        }
        deletedPois.add(Number(idPoi));
      }
      removeTacticalEntityLocally(entity);
      continue;
    }

    if (idArea && ["circle", "polygon"].includes(String(tacticalType))) {
      if (!deletedAreas.has(Number(idArea))) {
        const deleted = await deleteAreaFromBackend(idArea);
        if (!deleted) {
          failures.push(`Area ${idArea}`);
          continue;
        }
        deletedAreas.add(Number(idArea));
      }
      removeTacticalEntityLocally(entity);
      continue;
    }

    if (idMarca && ["building", "label"].includes(String(tacticalType))) {
      if (!deletedStructures.has(Number(idMarca))) {
        const deleted = await deleteStructureFromBackend(idMarca);
        if (!deleted) {
          failures.push(`Estructura ${idMarca}`);
          continue;
        }
        deletedStructures.add(Number(idMarca));
      }
      removeTacticalEntityLocally(entity);
      continue;
    }

    if (idRuta && String(tacticalType) === "polyline") {
      const deleted = await deleteRouteFromBackend(idRuta);
      if (!deleted) {
        failures.push(`Ruta ${idRuta}`);
        continue;
      }
      removeTacticalEntityLocally(entity);
      continue;
    }

    // Todo lo no persistido en backend se limpia localmente.
    removeTacticalEntityLocally(entity);
  }

  if (
    dashboardState.selectedEntity &&
    !dashboardState.tacticalEntities.includes(dashboardState.selectedEntity)
  ) {
    dashboardState.selectedEntity = null;
  }

  const gridDeleted = await deleteGridFromBackend();
  if (!gridDeleted) failures.push("Cuadricula");
  clearGrid({ persist: false });
  clearPlanningArea();
  clearTacticalStorageSnapshot();

  const drawingFailures = await clearAllDrawings();
  failures.push(...drawingFailures);

  return {
    ok: failures.length === 0,
    failures
  };
}

export async function deleteSelectedEntity() {
  const viewer = dashboardState.viewer;
  if (!dashboardState.selectedEntity || !viewer) return;

  const selected = dashboardState.selectedEntity;
  const tacticalType =
    selected.properties?.tacticalType?.getValue?.() ||
    selected.properties?.tacticalType ||
    "";

  if (String(tacticalType) === "grid-part") {
    dashboardState.selectedEntity = null;
    updateSelectionInfo(null);
    if (dom.entityPopup) dom.entityPopup.style.display = "none";
    return;
  }

  const idPoi = selected.properties?.id_poi?.getValue?.() ?? selected.properties?.id_poi;
  const idArea = selected.properties?.id_area?.getValue?.() ?? selected.properties?.id_area;
  const idMarca = selected.properties?.id_marca?.getValue?.() ?? selected.properties?.id_marca;
  const idZona = selected.properties?.id_zona?.getValue?.() ?? selected.properties?.id_zona;
  const idRuta = selected.properties?.id_ruta?.getValue?.() ?? selected.properties?.id_ruta;

  if (idPoi && ["poi", "mil-dropped", "radar-part"].includes(String(tacticalType))) {
    const deleted = await deletePoiFromBackend(idPoi);
    if (!deleted) return;
    deleteLocalPoiEntities(idPoi);
    dashboardState.selectedEntity = null;
    if (dom.entityPopup) dom.entityPopup.style.display = "none";
    return;
  }

  if (idArea && ["circle", "polygon"].includes(String(tacticalType))) {
    const deleted = await deleteAreaFromBackend(idArea);
    if (!deleted) return;
  }

  if (idMarca && ["building", "label"].includes(String(tacticalType))) {
    const deleted = await deleteStructureFromBackend(idMarca);
    if (!deleted) return;
  }

  if (idRuta && String(tacticalType) === "polyline") {
    const deleted = await deleteRouteFromBackend(idRuta);
    if (!deleted) return;
  }

  if (idZona && String(tacticalType) === "operation-zone") {
    const currentOperation = getCurrentOperation();
    const phase = String(currentOperation?.phase || currentOperation?.estado || "").toLowerCase();
    if (phase !== "planificada") {
      alert("La zona no se puede eliminar cuando la operacion esta activa.");
      return;
    }
    const deleted = await deleteCurrentOperationZoneFromBackend(idZona);
    if (!deleted) return;
    clearOperationZoneEntities();
  }

  if (
    selected === dashboardState.planningAreaFill ||
    selected === dashboardState.planningAreaBorder ||
    selected === dashboardState.planningAreaLabel
  ) {
    clearPlanningArea();
  } else if (selected === dashboardState.operationZoneBorder) {
    clearOperationZoneEntities();
  } else {
    viewer.entities.remove(selected);
    dashboardState.tacticalEntities = dashboardState.tacticalEntities.filter(
      ent => ent !== selected
    );
  }

  dashboardState.selectedEntity = null;
  updateSelectionInfo(dashboardState.selectedEntity);

  saveTacticalData();

  if (dom.entityPopup) {
    dom.entityPopup.style.display = "none";
  }
}

export async function restoreTacticalLayersFromMapaData(mapaData) {
  const viewer = dashboardState.viewer;
  if (!viewer || !mapaData) return;

  const zona = mapaData.zona_operacion || mapaData.zona || null;
  if (zona) {
    buildOperationZoneEntity(zona);
  }

  const capas = mapaData.capas || [];
  capas.forEach(element => {
    try {
      const type = String(element.tipo_capa || "").toUpperCase();
      if (type === "POI") {
        const poi = {
          id_poi: element.id_elemento,
          nombre: element.nombre,
          tipo_poi: element.subtipo,
          latitud: element.latitud,
          longitud: element.longitud,
          color: element.color,
          icono_src: element.icono_src,
          sidc: element.sidc,
          tipo_creador: element.tipo_creador,
          id_usuario: element.id_usuario,
          id_personal: element.id_personal,
          creador_nombre: element.creador_nombre
        };
        if (String(element.subtipo || "").toUpperCase() === "RADAR") {
          renderRadarEntities(poi);
        } else {
          const ent = buildPoiEntity(poi, "poi");
          if (ent) addTacticalEntity(ent);
        }
      } else if (type === "AREA") {
        const ent = buildAreaEntity({
          id_area: element.id_elemento,
          nombre: element.nombre,
          color: element.color,
          geometria: element.geometria,
          tipo_creador: element.tipo_creador,
          id_usuario: element.id_usuario,
          id_personal: element.id_personal,
          creador_nombre: element.creador_nombre
        });
        if (ent) addTacticalEntity(ent);
      } else if (type === "RUTA") {
        const ent = buildRouteEntity({
          id_ruta: element.id_elemento,
          nombre: element.nombre,
          color: element.color,
          geometria: element.geometria,
          tipo_creador: element.tipo_creador,
          id_usuario: element.id_usuario,
          id_personal: element.id_personal,
          creador_nombre: element.creador_nombre
        });
        if (ent) addTacticalEntity(ent);
      } else if (type === "EDIFICIO") {
        const ent = buildStructureEntity({
          id_marca: element.id_elemento,
          nombre: element.nombre,
          tipo_estructura: element.subtipo,
          latitud: element.latitud,
          longitud: element.longitud,
          tipo_creador: element.tipo_creador,
          id_usuario: element.id_usuario,
          id_personal: element.id_personal,
          creador_nombre: element.creador_nombre
        });
        if (ent) addTacticalEntity(ent);
      }
    } catch (err) {
      console.error("[MAPA] Error al restaurar elemento tactico:", element, err);
    }
  });
}

export async function loadPoisFromBackend() {
  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");
  const viewer = dashboardState.viewer;
  if (!token || !opId || !viewer) return;

  try {
    const res = await fetch(`${API_BASE}/ops/${opId}/pois`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const pois = data.items || [];

    pois.forEach(poi => {
      if (!poi?.id_poi) return;
      if (poi.tipo_poi === "RADAR") {
        renderRadarEntities(poi);
      } else {
        const ent = buildPoiEntity(poi, "poi");
        if (ent) addTacticalEntity(ent);
      }
    });
  } catch (err) {
    console.error("[POI] Error cargando POIs desde backend:", err);
  }
}

export async function loadAreasFromBackend() {
  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");
  const viewer = dashboardState.viewer;
  if (!token || !opId || !viewer) return;

  try {
    const res = await fetch(`${API_BASE}/ops/${opId}/areas`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const areas = data.items || [];

    areas.forEach(area => {
      if (!area?.id_area) return;
      const ent = buildAreaEntity(area);
      if (ent) addTacticalEntity(ent);
    });
  } catch (err) {
    console.error("[AREA] Error cargando areas desde backend:", err);
  }
}

export async function loadStructuresFromBackend() {
  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");
  const viewer = dashboardState.viewer;
  if (!token || !opId || !viewer) return;

  try {
    const res = await fetch(`${API_BASE}/ops/${opId}/edificios`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const items = data.items || [];

    items.forEach(estructura => {
      if (!estructura?.id_marca) return;
      const ent = buildStructureEntity(estructura);
      if (ent) addTacticalEntity(ent);
    });
  } catch (err) {
    console.error("[ESTRUCTURA] Error cargando estructuras desde backend:", err);
  }
}

export async function loadRoutesFromBackend() {
  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");
  const viewer = dashboardState.viewer;
  if (!token || !opId || !viewer) return;

  try {
    const res = await fetch(`${API_BASE}/ops/${opId}/rutas`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const items = data.items || [];

    items.forEach(ruta => {
      if (!ruta?.id_ruta) return;
      const ent = buildRouteEntity(ruta);
      if (ent) addTacticalEntity(ent);
    });
  } catch (err) {
    console.error("[RUTA] Error cargando rutas tacticas desde backend:", err);
  }
}

export async function loadOperationZoneFromBackend() {
  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");
  const viewer = dashboardState.viewer;
  if (!token || !opId || !viewer) return null;

  try {
    const res = await fetch(`${API_BASE}/ops/${opId}/zona`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 404) {
      clearOperationZoneEntities();
      setTacticalUI();
      return null;
    }

    if (!res.ok) return null;
    const data = await res.json();
    const zona = data.zona || null;
    if (!zona) {
      clearOperationZoneEntities();
      setTacticalUI();
      return null;
    }

    buildOperationZoneEntity(zona);
    setTacticalUI();
    return zona;
  } catch (err) {
    console.error("[ZONA] Error cargando zona de operacion:", err);
    return null;
  }
}

function renderGeoMsgEntity(geoMsg) {
  const viewer = dashboardState.viewer;
  const id = Number(geoMsg?.id_geo_msg ?? geoMsg?.id);
  const lat = Number(geoMsg?.lat ?? geoMsg?.latitud);
  const lng = Number(geoMsg?.lon ?? geoMsg?.lng ?? geoMsg?.longitud);
  if (!viewer || !Number.isInteger(id) || id <= 0 || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const entityId = `geomsg_${id}`;
  const existing = viewer.entities.getById(entityId);
  if (existing) viewer.entities.remove(existing);

  const author = String(geoMsg.author || "Usuario").trim() || "Usuario";
  const text = String(geoMsg.text || "").trim();
  const entity = viewer.entities.add({
    id: entityId,
    name: author,
    position: Cesium.Cartesian3.fromDegrees(lng, lat),
    point: {
      pixelSize: 11,
      color: Cesium.Color.fromCssColorString("#2dd4bf"),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    },
    label: {
      text: text || "GEO-MSG",
      font: "12px sans-serif",
      pixelOffset: new Cesium.Cartesian2(0, -20),
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    },
    properties: { tacticalType: "geomsg", id_geo_msg: id, author, text }
  });
  addTacticalEntity(entity);
}

function removeGeoMsgEntity(idGeoMsg) {
  const viewer = dashboardState.viewer;
  if (!viewer || !idGeoMsg) return;
  const entity = viewer.entities.getById(`geomsg_${idGeoMsg}`);
  if (entity) viewer.entities.remove(entity);
  dashboardState.tacticalEntities = dashboardState.tacticalEntities.filter(ent => String(ent.id || "") !== `geomsg_${idGeoMsg}`);
}

export function initPoiSocket(socket) {
  socket.on("geo_msg_created", (geoMsg) => renderGeoMsgEntity(geoMsg));
  socket.on("geo_msg_deleted", ({ id_geo_msg, id }) => removeGeoMsgEntity(id_geo_msg || id));

  socket.on("poi_creado", ({ poi }) => {
    if (!poi?.id_poi) return;
    // Saltar si soy yo quien lo creó (ya lo dibujé localmente)
    if (_mySentPoiIds.has(poi.id_poi)) return;

    const viewer = dashboardState.viewer;
    if (!viewer) return;

    if (poi.tipo_poi === "RADAR") {
      renderRadarEntities(poi);
    } else {
      const ent = buildPoiEntity(poi, "poi");
      if (ent) addTacticalEntity(ent);
    }
  });

  socket.on("poi_actualizado", ({ poi }) => {
    if (!poi?.id_poi) return;

    const viewer = dashboardState.viewer;
    if (!viewer) return;

    const entity = viewer.entities.getById(`poi_${poi.id_poi}`);
    if (entity) {
      applyPoiUpdateToEntity(entity, poi);
      saveTacticalData();
      return;
    }

    const ent = buildPoiEntity(poi, "poi");
    if (ent) addTacticalEntity(ent);
  });

  socket.on("poi_eliminado", ({ id_poi }) => {
    if (!id_poi) return;

    const viewer = dashboardState.viewer;
    if (!viewer) return;

    const entity = viewer.entities.getById(`poi_${id_poi}`);
    if (entity) viewer.entities.remove(entity);

    dashboardState.tacticalEntities = dashboardState.tacticalEntities.filter(ent => {
      const entIdPoi = ent.properties?.id_poi?.getValue?.() ?? ent.properties?.id_poi;
      return Number(entIdPoi) !== Number(id_poi);
    });
  });

  socket.on("area_creada", ({ area }) => {
    if (!area?.id_area) return;

    const viewer = dashboardState.viewer;
    if (!viewer) return;

    const ent = buildAreaEntity(area);
    if (ent) addTacticalEntity(ent);
  });

  socket.on("area_actualizada", ({ area }) => {
    if (!area?.id_area) return;

    const viewer = dashboardState.viewer;
    if (!viewer) return;

    const entity = viewer.entities.getById(`area_${area.id_area}`);
    if (entity) {
      applyAreaUpdateToEntity(entity, area);
      saveTacticalData();
      return;
    }

    const ent = buildAreaEntity(area);
    if (ent) addTacticalEntity(ent);
  });

  socket.on("area_eliminada", ({ id_area }) => {
    if (!id_area) return;

    const viewer = dashboardState.viewer;
    if (!viewer) return;

    const entity = viewer.entities.getById(`area_${id_area}`);
    if (entity) viewer.entities.remove(entity);

    dashboardState.tacticalEntities = dashboardState.tacticalEntities.filter(ent => {
      const entIdArea = ent.properties?.id_area?.getValue?.() ?? ent.properties?.id_area;
      return Number(entIdArea) !== Number(id_area);
    });
  });

  socket.on("estructura_creada", ({ estructura }) => {
    if (!estructura?.id_marca) return;

    const viewer = dashboardState.viewer;
    if (!viewer) return;

    const ent = buildStructureEntity(estructura);
    if (ent) addTacticalEntity(ent);
  });

  socket.on("estructura_actualizada", ({ estructura }) => {
    if (!estructura?.id_marca) return;

    const viewer = dashboardState.viewer;
    if (!viewer) return;

    const entity = viewer.entities.getById(`estructura_${estructura.id_marca}`);
    if (entity) {
      applyStructureUpdateToEntity(entity, estructura);
      saveTacticalData();
      return;
    }

    const ent = buildStructureEntity(estructura);
    if (ent) addTacticalEntity(ent);
  });

  socket.on("estructura_eliminada", ({ id_marca }) => {
    if (!id_marca) return;

    const viewer = dashboardState.viewer;
    if (!viewer) return;

    const entity = viewer.entities.getById(`estructura_${id_marca}`);
    if (entity) viewer.entities.remove(entity);

    dashboardState.tacticalEntities = dashboardState.tacticalEntities.filter(ent => {
      const entIdMarca = ent.properties?.id_marca?.getValue?.() ?? ent.properties?.id_marca;
      return Number(entIdMarca) !== Number(id_marca);
    });
  });

  socket.on("ruta_operacion_creada", ({ ruta }) => {
    if (!ruta?.id_ruta) return;
    if (_mySentRouteIds.has(ruta.id_ruta)) return;

    const viewer = dashboardState.viewer;
    if (!viewer) return;

    const ent = buildRouteEntity(ruta);
    if (ent) addTacticalEntity(ent);
  });

  socket.on("ruta_operacion_eliminada", ({ id_ruta }) => {
    if (!id_ruta) return;

    const viewer = dashboardState.viewer;
    if (!viewer) return;

    const entity = viewer.entities.getById(`ruta_operacion_${id_ruta}`);
    if (entity) viewer.entities.remove(entity);

    dashboardState.tacticalEntities = dashboardState.tacticalEntities.filter(ent => {
      const entIdRuta = ent.properties?.id_ruta?.getValue?.() ?? ent.properties?.id_ruta;
      return Number(entIdRuta) !== Number(id_ruta);
    });
  });

  socket.on("cuadricula_actualizada", ({ grid }) => {
    if (Date.now() - lastLocalGridSaveAt < 1500) return;
    void restoreGridFromBackend(grid);
  });

  socket.on("cuadricula_eliminada", () => {
    clearGrid({ persist: false });
  });
}

function getGridNamesFromInputs() {
  if (!dom.gridNamesContainer) return [];
  return Array.from(dom.gridNamesContainer.querySelectorAll("input"))
    .map(input => input.value || "");
}

async function saveGridToBackend() {
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");
  if (!token || !opId || !dom.gridSizeSelect) return null;

  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const payload = {
    size: dom.gridSizeSelect.value || "3x3",
    names: getGridNamesFromInputs()
  };

  try {
    lastLocalGridSaveAt = Date.now();
    const res = await fetch(`${API_BASE}/ops/${opId}/grid`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.mensaje || "No se pudo guardar la cuadricula.");
    }

    return data.grid || data.cuadricula || null;
  } catch (err) {
    console.error("[GRID] Error guardando cuadricula:", err);
    setRouteInfo("No se pudo guardar la cuadricula en el servidor.");
    return null;
  }
}

function scheduleSaveGridToBackend() {
  if (gridSaveTimer) window.clearTimeout(gridSaveTimer);
  gridSaveTimer = window.setTimeout(() => {
    gridSaveTimer = null;
    void saveGridToBackend();
  }, 500);
}

async function deleteGridFromBackend() {
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");
  if (!token || !opId) return true;

  const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;

  try {
    const res = await fetch(`${API_BASE}/ops/${opId}/grid`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 404) return true;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.mensaje || "No se pudo eliminar la cuadricula.");
    }

    return true;
  } catch (err) {
    console.error("[GRID] Error eliminando cuadricula:", err);
    setRouteInfo("No se pudo eliminar la cuadricula del servidor.");
    return false;
  }
}

export function clearGrid({ persist = false } = {}) {
  const viewer = dashboardState.viewer;
  const gridEntities = dashboardState.gridEntities || [];

  if (gridSaveTimer) {
    window.clearTimeout(gridSaveTimer);
    gridSaveTimer = null;
  }

  if (viewer) {
    gridEntities.forEach((ent) => {
      if (ent) viewer.entities.remove(ent);
    });
  }

  if (dashboardState.selectedEntity && gridEntities.includes(dashboardState.selectedEntity)) {
    dashboardState.selectedEntity = null;
    updateSelectionInfo(null);
    if (dom.entityPopup) dom.entityPopup.style.display = "none";
  }

  dashboardState.gridEntities = [];
  dashboardState.gridQuadrants = [];

  if (dom.gridNamesContainer) dom.gridNamesContainer.innerHTML = "";
  if (dom.gridNamesWrapper) dom.gridNamesWrapper.style.display = "none";
  if (dom.clearGridBtn) dom.clearGridBtn.style.display = "none";

  if (persist) void deleteGridFromBackend();
}

export function generateGrid({ persist = true, names = null } = {}) {
  const viewer = dashboardState.viewer;
  const zona = dashboardState.currentOperationZone;

  if (!viewer || !zona) {
    setRouteInfo("Delimita una zona de operacion antes de generar la cuadricula.");
    alert("No hay una zona de operacion activa. Usa Marcar zona primero.");
    return;
  }

  const points = getOperationZonePoints(zona);
  if (!points || points.length < 3) {
    setRouteInfo("La zona de operacion no tiene geometria suficiente para generar cuadricula.");
    return;
  }

  clearGrid({ persist: false });

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  points.forEach((point) => {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  });

  const sizeStr = dom.gridSizeSelect?.value || "3x3";
  const [rows, cols] = sizeStr.split("x").map(Number);
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows < 1 || cols < 1) return;

  const quad = points.length === 4 ? points : null;
  const gridPoint = (rowT, colT) => {
    if (!quad) {
      return { lat: minLat + rowT * (maxLat - minLat), lng: minLng + colT * (maxLng - minLng) };
    }
    const top = {
      lat: quad[0].lat + (quad[1].lat - quad[0].lat) * colT,
      lng: quad[0].lng + (quad[1].lng - quad[0].lng) * colT
    };
    const bottom = {
      lat: quad[3].lat + (quad[2].lat - quad[3].lat) * colT,
      lng: quad[3].lng + (quad[2].lng - quad[3].lng) * colT
    };
    return {
      lat: top.lat + (bottom.lat - top.lat) * rowT,
      lng: top.lng + (bottom.lng - top.lng) * rowT
    };
  };

  const latStep = (maxLat - minLat) / rows;
  const lngStep = (maxLng - minLng) / cols;
  if (!Number.isFinite(latStep) || !Number.isFinite(lngStep) || latStep <= 0 || lngStep <= 0) return;

  const colors = [
    Cesium.Color.fromCssColorString("#FFA000"),
    Cesium.Color.fromCssColorString("#1E88E5"),
    Cesium.Color.fromCssColorString("#E53935"),
    Cesium.Color.fromCssColorString("#00897B"),
    Cesium.Color.fromCssColorString("#8E24AA"),
    Cesium.Color.fromCssColorString("#FB8C00"),
    Cesium.Color.fromCssColorString("#D81B60"),
    Cesium.Color.fromCssColorString("#039BE5"),
    Cesium.Color.fromCssColorString("#43A047"),
    Cesium.Color.fromCssColorString("#FDD835")
  ];

  const phonetic = [
    "ALFA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT", "GOLF", "HOTEL",
    "INDIA", "JULIETT", "KILO", "LIMA", "MIKE", "NOVEMBER", "OSCAR", "PAPA",
    "QUEBEC", "ROMEO", "SIERRA", "TANGO", "UNIFORM", "VICTOR", "WHISKEY", "X-RAY",
    "YANKEE", "ZULU"
  ];

  let colorIdx = 0;

  for (let col = 1; col < cols; col += 1) {
    const top = gridPoint(0, col / cols);
    const bottom = gridPoint(1, col / cols);
    const color = colors[colorIdx % colors.length];
    colorIdx += 1;
    const line = viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray([top.lng, top.lat, bottom.lng, bottom.lat]),
        width: 3,
        material: new Cesium.PolylineDashMaterialProperty({
          color: color.withAlpha(0.7),
          dashLength: 16
        }),
        clampToGround: true
      },
      properties: { tacticalType: "grid-part" }
    });
    dashboardState.gridEntities.push(line);
  }

  for (let row = 1; row < rows; row += 1) {
    const left = gridPoint(row / rows, 0);
    const right = gridPoint(row / rows, 1);
    const color = colors[colorIdx % colors.length];
    colorIdx += 1;
    const line = viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray([left.lng, left.lat, right.lng, right.lat]),
        width: 3,
        material: new Cesium.PolylineDashMaterialProperty({
          color: color.withAlpha(0.7),
          dashLength: 16
        }),
        clampToGround: true
      },
      properties: { tacticalType: "grid-part" }
    });
    dashboardState.gridEntities.push(line);
  }

  if (dom.gridNamesContainer) dom.gridNamesContainer.innerHTML = "";

  let count = 0;
  for (let row = 0; row < rows; row += 1) {
    const rowTop = row / rows;
    const rowBottom = (row + 1) / rows;

    for (let col = 0; col < cols; col += 1) {
      const topLeft = gridPoint(rowTop, col / cols);
      const topRight = gridPoint(rowTop, (col + 1) / cols);
      const bottomRight = gridPoint(rowBottom, (col + 1) / cols);
      const bottomLeft = gridPoint(rowBottom, col / cols);
      const color = colors[count % colors.length];
      const baseName = phonetic[count % phonetic.length] || `Q${count + 1}`;
      const cycle = Math.floor(count / phonetic.length);
      const defaultName = cycle > 0 ? `${baseName}-${cycle + 1}` : baseName;

      const polygon = viewer.entities.add({
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray([
            bottomLeft.lng, bottomLeft.lat,
            bottomRight.lng, bottomRight.lat,
            topRight.lng, topRight.lat,
            topLeft.lng, topLeft.lat
          ]),
          material: color.withAlpha(0.08),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        },
        properties: { tacticalType: "grid-part", quadrantId: count }
      });
      dashboardState.gridEntities.push(polygon);

      const labelAnchor = Cesium.Cartesian3.fromDegrees(topLeft.lng, topLeft.lat);
      const labelCenterPoint = gridPoint(
        (rowTop + rowBottom) / 2,
        (col + 0.5) / cols
      );
      const labelCenter = Cesium.Cartesian3.fromDegrees(labelCenterPoint.lng, labelCenterPoint.lat);
      const label = viewer.entities.add({
        position: labelAnchor,
        label: {
          text: ` ${defaultName} `,
          font: "bold 13px monospace",
          fillColor: Cesium.Color.WHITE,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
          showBackground: true,
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          pixelOffset: new Cesium.Cartesian2(5, 5),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        properties: { tacticalType: "grid-part", quadrantId: count }
      });
      dashboardState.gridEntities.push(label);
      dashboardState.gridQuadrants.push({
        id: count,
        labelEnt: label,
        defaultName,
        labelAnchor,
        labelCenter
      });

      if (dom.gridNamesContainer) {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";

        const nameLabel = document.createElement("label");
        nameLabel.className = "fieldLabel";
        nameLabel.style.fontSize = "10px";
        nameLabel.textContent = `Cuadrante ${defaultName}`;

        const input = document.createElement("input");
        input.type = "text";
        input.className = "opsInput";
        const savedName = Array.isArray(names) ? names[count] : "";
        input.value = savedName || defaultName;
        input.style.padding = "4px";
        input.addEventListener("input", (event) => {
          const value = event.target.value || defaultName;
          label.label.text = ` ${value} `;
          scheduleSaveGridToBackend();
        });
        if (savedName) label.label.text = ` ${savedName} `;

        wrapper.appendChild(nameLabel);
        wrapper.appendChild(input);
        dom.gridNamesContainer.appendChild(wrapper);
      }

      count += 1;
    }
  }

  if (dom.gridNamesWrapper) dom.gridNamesWrapper.style.display = "block";
  if (dom.clearGridBtn) dom.clearGridBtn.style.display = "block";

  bindGridLabelAutoAlignment(viewer);
  if (persist) void saveGridToBackend();
}

function bindGridLabelAutoAlignment(viewer) {
  if (!viewer?.scene || viewer.__gridLabelAutoAlignmentBound) return;
  viewer.__gridLabelAutoAlignmentBound = true;

  const anchorWindow = new Cesium.Cartesian2();
  const centerWindow = new Cesium.Cartesian2();

  viewer.scene.preRender.addEventListener(() => {
    dashboardState.gridQuadrants.forEach((quadrant) => {
      const label = quadrant?.labelEnt?.label;
      if (!label || !quadrant.labelAnchor || !quadrant.labelCenter) return;

      const anchor = Cesium.SceneTransforms.worldToWindowCoordinates(
        viewer.scene,
        quadrant.labelAnchor,
        anchorWindow
      );
      const center = Cesium.SceneTransforms.worldToWindowCoordinates(
        viewer.scene,
        quadrant.labelCenter,
        centerWindow
      );
      if (!anchor || !center) return;

      const growsRight = center.x >= anchor.x;
      const growsDown = center.y >= anchor.y;
      label.horizontalOrigin = growsRight
        ? Cesium.HorizontalOrigin.LEFT
        : Cesium.HorizontalOrigin.RIGHT;
      label.verticalOrigin = growsDown
        ? Cesium.VerticalOrigin.TOP
        : Cesium.VerticalOrigin.BOTTOM;
      label.pixelOffset = new Cesium.Cartesian2(
        growsRight ? 5 : -5,
        growsDown ? 5 : -5
      );
    });
  });
}

export async function restoreGridFromBackend(initialGrid = null) {
  const opId = localStorage.getItem("active_operation_id");
  if (!opId || !dashboardState.currentOperationZone) return null;

  let grid = initialGrid;

  if (!grid) {
    const token = localStorage.getItem("token");
    if (!token) return null;

    const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;

    try {
      const res = await fetch(`${API_BASE}/ops/${opId}/grid`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.status === 404) return null;

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.mensaje || "No se pudo cargar la cuadricula.");
      }

      grid = data.grid || data.cuadricula || null;
    } catch (err) {
      console.error("[GRID] Error cargando cuadricula:", err);
      return null;
    }
  }

  if (!grid?.size) return null;

  if (dom.gridSizeSelect) {
    dom.gridSizeSelect.value = grid.size;
  }

  const names = Array.isArray(grid.names)
    ? grid.names
    : Array.isArray(grid.nombres)
      ? grid.nombres
      : [];

  generateGrid({ persist: false, names });
  return grid;
}

export function bindTacticalEvents() {
  if (dom.toolSelect) {
    dom.toolSelect.addEventListener("change", (e) => {
      const newMode = e.target.value;

      // Stop any active drawing mode when switching tools.
      stopAllDrawingModes();

      dashboardState.toolMode = newMode;
      resetDrawingState();

      if (newMode === "none") {
        clearCurrentSelectionAndTool();
        return;
      }

      if (newMode === "pencil") {
        startPencilMode();
      }

      if (newMode === "poi") {
        dashboardState.placingMode = true;
        if (dom.tbHint) dom.tbHint.textContent = "Haz clic en el mapa para colocar el punto de interes.";
      }

      if (newMode === "mil") {
        dashboardState.placingMode = true;
        populateMilIconOptions();
        updateMilSymbolPreview();
        if (dom.tbHint) dom.tbHint.textContent = "Haz clic en el mapa para colocar el simbolo MIL.";
      }

      if (newMode === "circle") {
        dashboardState.placingMode = true;
        if (dom.tbHint) dom.tbHint.textContent = "Haz clic en el mapa para colocar el circulo de cobertura.";
      }

      if (newMode === "label") {
        dashboardState.placingMode = true;
        if (dom.tbHint) dom.tbHint.textContent = "Haz clic en el mapa para colocar la etiqueta.";
      }

      if (newMode === "building") {
        dashboardState.placingMode = true;
        if (dom.tbHint) dom.tbHint.textContent = "Haz clic en el mapa para colocar la estructura.";
      }

      if (newMode === "grid") {
        dashboardState.placingMode = true;
        if (dom.tbHint) dom.tbHint.textContent = "Haz clic en el mapa para generar la cuadricula.";
      }

      if (newMode === "polygon") {
        dashboardState.placingMode = true;
        if (dom.tbHint) dom.tbHint.textContent = "Marca puntos en el mapa y usa Terminar figura al finalizar.";
      }

      if (newMode === "polyline") {
        dashboardState.placingMode = true;
        if (dom.tbHint) dom.tbHint.textContent = "Marca la ruta en el mapa y usa Terminar figura al finalizar.";
      }

      setTacticalUI();
    });
  }

  if (dom.generateGridBtn) {
    dom.generateGridBtn.addEventListener("click", generateGrid);
  }

  if (dom.clearGridBtn) {
    dom.clearGridBtn.addEventListener("click", () => clearGrid({ persist: true }));
  }

  if (dom.btnSelectPencil) {
    dom.btnSelectPencil.addEventListener("click", () => {
      if (dashboardState.drawingMode === "pencil") {
        stopAllDrawingModes();
        dashboardState.toolMode = "none";
        if (dom.toolSelect) dom.toolSelect.value = "none";
      } else {
        stopAllDrawingModes();
        dashboardState.toolMode = "pencil";
        if (dom.toolSelect) dom.toolSelect.value = "pencil";
        startPencilMode();
      }

      setTacticalUI();
    });
  }

  if (dom.btnSelectEraser) {
    dom.btnSelectEraser.addEventListener("click", () => {
      if (dashboardState.drawingMode === "eraser") {
        stopAllDrawingModes();
        dashboardState.toolMode = "none";
        if (dom.toolSelect) dom.toolSelect.value = "none";
      } else {
        stopAllDrawingModes();
        dashboardState.toolMode = "pencil";
        if (dom.toolSelect) dom.toolSelect.value = "pencil";
        startEraserMode();
      }

      setTacticalUI();
    });
  }

  if (dom.cancelPlace) {
    dom.cancelPlace.addEventListener("click", () => {
      finishActiveTool("Accion cancelada.");
    });
  }

  if (dom.clearTactical) {
    dom.clearTactical.addEventListener("click", async () => {
      const viewer = dashboardState.viewer;
      if (!viewer) return;

      const result = await clearTacticalPersistedData();
      dashboardState.selectedEntity = null;

      updateSelectionInfo(dashboardState.selectedEntity);
      resetDrawingState();

      if (dom.entityPopup) {
        dom.entityPopup.style.display = "none";
      }

      const message = result.ok
        ? "Elementos tacticos y dibujos limpiados. La zona de operacion se conservo."
        : `Se limpiaron elementos tacticos, pero fallaron algunos borrados: ${result.failures.join(", ")}.`;
      finishActiveTool(message);
    });
  }

  if (dom.deleteSelectedBtn) {
    dom.deleteSelectedBtn.addEventListener("click", deleteSelectedEntity);
  }

  if (dom.entityPopupDelete) {
    dom.entityPopupDelete.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSelectedEntity();
    });
  }

  if (dom.clearSelectionBtn) {
    dom.clearSelectionBtn.addEventListener("click", () => {
      clearCurrentSelectionAndTool();
    });
  }

  if (dom.finishShape) {
    dom.finishShape.addEventListener("click", () => {
      if (dashboardState.areaDrawing) {
        finishPlanningAreaByPoints();
        return;
      }

      if (dashboardState.toolMode === "polygon") {
        finishPolygon();
        return;
      }

      if (dashboardState.toolMode === "polyline") {
        finishPolyline();
        return;
      }

      if (dashboardState.toolMode === "perimeter") {
        finishOperationZonePerimeter();
      }
    });
  }

  if (dom.markZoneBtn) {
    dom.markZoneBtn.addEventListener("click", () => {
      const currentOperation = getCurrentOperation();
      const phase = String(currentOperation?.phase || currentOperation?.estado || "").toLowerCase();
      if (phase !== "planificada") {
        alert("La zona solo se puede editar mientras la operacion esta planificada.");
        setTacticalUI();
        return;
      }

      if (dashboardState.toolMode === "perimeter") {
        stopAllDrawingModes();
        dashboardState.toolMode = "none";
        if (dom.toolSelect) dom.toolSelect.value = "none";
        resetDrawingState();
      } else {
        stopAllDrawingModes();
        dashboardState.toolMode = "perimeter";
        if (dom.toolSelect) dom.toolSelect.value = "perimeter";
        resetDrawingState();
        dashboardState.placingMode = true;
        setRouteInfo("Haz clic en el mapa para delimitar la zona de operacion.");
      }

      setTacticalUI();
    });
  }

  if (dom.applyZoneCoordinatesBtn) {
    dom.applyZoneCoordinatesBtn.addEventListener("click", () => {
      const points = parseZoneCoordinatesInput(dom.zoneCoordinatesInput?.value);
      if (!points) {
        alert("Escribe al menos 3 pares en formato latitud, longitud separados por punto y coma.");
        return;
      }
      const currentOperation = getCurrentOperation();
      const phase = String(currentOperation?.phase || currentOperation?.estado || "").toLowerCase();
      if (phase !== "planificada") {
        alert("La zona solo se puede editar mientras la operacion esta planificada.");
        return;
      }
      dashboardState.drawingPoints = points;
      updateZoneCoordinatesSummary(points);
      void finishOperationZonePerimeter();
    });
  }

  if (dom.clearZoneBtn) {
    dom.clearZoneBtn.addEventListener("click", async () => {
      const currentOperation = getCurrentOperation();
      const phase = String(currentOperation?.phase || currentOperation?.estado || "").toLowerCase();
      if (phase !== "planificada") {
        alert("La zona no se puede eliminar cuando la operacion esta activa.");
        setTacticalUI();
        return;
      }
      if (!dashboardState.currentOperationZone) return;
      const idZona = dashboardState.currentOperationZone.id_zona;
      const deleted = await deleteCurrentOperationZoneFromBackend(idZona);
      if (!deleted) return;

      clearOperationZoneEntities();
      setRouteInfo("Zona de operacion eliminada.");
      setTacticalUI();
    });
  }

  if (dom.finishZoneBtn) {
    dom.finishZoneBtn.addEventListener("click", () => {
      if (dashboardState.toolMode === "perimeter") {
        finishOperationZonePerimeter();
      }
    });
  }

  [dom.opacityRange, dom.widthRange]
    .filter(Boolean)
    .forEach((control) => {
      control.addEventListener("input", updateTacticalControlReadouts);
      control.addEventListener("change", updateTacticalControlReadouts);
    });

  [dom.zoneColorSelect, dom.zoneWidthRange]
    .filter(Boolean)
    .forEach((control) => {
      control.addEventListener("input", () => {
        refreshDrawingVertexColors();
      });
      control.addEventListener("change", () => {
        refreshDrawingVertexColors();
      });
    });
  updateTacticalControlReadouts();

  populateMilIconOptions();

  if (dom.milIdentity) {
    dom.milIdentity.addEventListener("change", () => {
      populateMilIconOptions();
      updateMilSymbolPreview();
    });
  }
  if (dom.milDimension) {
    dom.milDimension.addEventListener("change", () => {
      populateMilIconOptions();
      updateMilSymbolPreview();
    });
  }
  if (dom.milIcon) dom.milIcon.addEventListener("change", updateMilSymbolPreview);

  if (dom.milPreviewContainer) {
    dom.milPreviewContainer.addEventListener("dragstart", (e) => {
      const container = e.target.closest("#milPreviewContainer");
      if (!container) return;
      const sidc = container.dataset.sidc;
      const title = container.dataset.title;
      if (!sidc) return;

      e.dataTransfer.setData("application/sidc", sidc);
      e.dataTransfer.setData("application/title", title);
      e.dataTransfer.effectAllowed = "copy";
    });
  }

  if (dom.buildingPreviewDrag) {
    dom.buildingPreviewDrag.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("application/building", "true");
      e.dataTransfer.setData("application/title", "Edificio");
      e.dataTransfer.effectAllowed = "copy";
    });
  }
}

/* ── Generador MILSymbol ───────────────────────────── */

export function updateMilSymbolPreview() {
  if (!dom.milPreviewContainer) return;
  const sidc = buildMilSidc();

  if (!sidc) {
    dom.milPreviewContainer.innerHTML = '<span style="font-size:11px;color:#a0c4ff;font-weight:700;text-align:center;">Sin símbolo válido</span>';
    delete dom.milPreviewContainer.dataset.sidc;
    delete dom.milPreviewContainer.dataset.title;
    return;
  }

  const canvas = renderMilSymbolImage(sidc, 130);
  if (!canvas || !isMilSidcRenderable(sidc)) {
    dom.milPreviewContainer.innerHTML = '<span style="font-size:11px;color:#a0c4ff;font-weight:700;text-align:center;">SIDC no soportado</span>';
    delete dom.milPreviewContainer.dataset.sidc;
    delete dom.milPreviewContainer.dataset.title;
    return;
  }

  dom.milPreviewContainer.innerHTML = "";
  dom.milPreviewContainer.appendChild(canvas);
  dom.milPreviewContainer.dataset.sidc = sidc;
  dom.milPreviewContainer.dataset.title = dom.milIcon?.selectedOptions?.[0]?.text || "Símbolo MIL";
}
