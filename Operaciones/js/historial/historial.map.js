import { dom } from "./historial.dom.js";
import { configureGoogleLikeCamera } from "../map.camera.js?v=20260723-map-data-safe-zoom";
import { replayState } from "./historial.state.js";
import { isTargetPoi } from "./historial.meta.js";

const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
const SCALE_BY_DIST = new Cesium.NearFarScalar(1e3, 1.0, 2e6, 0.04);
const TRACKING_SYMBOL_SIZE = 42;
const TRACKING_SYMBOL_RENDER_SIZE = 160;
const TRACKING_SYMBOL_SCALE_BY_DIST = new Cesium.NearFarScalar(1e3, 1.0, 2e6, 0.28);
const TRACKING_LABEL_SCALE_BY_DIST = new Cesium.NearFarScalar(1e3, 1.5, 2e6, 0.1);
const DEFAULT_CAMERA_HEIGHT = 2500000;
const DEFAULT_ZONE_CAMERA_HEIGHT = 1000;
const MIN_CAMERA_DISTANCE = 500;
const MAX_CAMERA_DISTANCE = 5000000;
const USER_CAMERA_GRACE_MS = 700;
const TARGET_HEADING_ARROW_M = 140;
const GEO_MSG_LABEL_MAX = 48;
const EARTH_RADIUS_M = 6371008.8;

// Entidades con control de tiempo: { entity, showAt, hideAt (ms epoch) }
const mapRegistry = [];
const visibleLayerTypes = new Set(["personal", "vehiculos", "equipos", "dispositivos", "waypoints", "blancos", "geomsg", "areas", "estructuras", "rutas", "dibujos", "grid"]);
// Elementos logicos por capa (un registro puede tener varias entidades Cesium).
const layerCounts = {};
// Instante hasta el cual un cambio de camara se considera intencional.
let cameraGraceUntil = 0;
// Entidades que cambian con el tiempo (trayectos, blancos en movimiento). Se
// actualizan de forma imperativa solo cuando su estado cambia, en vez de usar
// CallbackProperty, que Cesium reevalua en cada render.
const dynamicUpdaters = [];
// Las etiquetas solo se dibujan con la camara cerca; lejos, solo el simbolo.
const LABEL_DISPLAY = new Cesium.DistanceDisplayCondition(0, 7000);
const LABEL_LAYERS = new Set(["waypoints", "blancos", "personal", "vehiculos", "equipos", "dispositivos", "estructuras"]);
const MAX_PATH_VERTICES = 1500;
// Las lineas dinamicas van ligeramente elevadas: sin anclaje al suelo, a altura 0 el globo las tapa.
const LINE_LIFT_M = 15;

function countLayer(type, amount = 1) {
  layerCounts[type] = (layerCounts[type] || 0) + amount;
}

export function getLayerCounts() {
  return { ...layerCounts };
}

// ── Init ──────────────────────────────────────────────────

export function initHistoryMap(initialZone = null) {
  if (!dom.map || !window.Cesium || replayState.viewer) return;

  Cesium.Ion.defaultAccessToken = localStorage.getItem("CESIUM_TOKEN") || "";

  replayState.viewer = new Cesium.Viewer(dom.map, {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    sceneModePicker: false,
    geocoder: false,
    infoBox: false,
    selectionIndicator: false,
    homeButton: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    imageryProvider: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
  });

  const viewer = replayState.viewer;
  viewer.clock.shouldAnimate = false;
  viewer.trackedEntity = undefined;
  viewer.imageryLayers.removeAll();
  addHybridLayer(viewer);
  enableHistoryCameraControls(viewer);
  window.addEventListener("resize", resizeHistoryMap);

  const initialTarget = getZoneCameraTarget(initialZone);
  viewer.camera.cancelFlight?.();
  viewer.scene?.tweens?.removeAll?.();
  viewer.camera.setView({
    destination: initialTarget
      ? Cesium.Cartesian3.fromDegrees(initialTarget.lng, initialTarget.lat, initialTarget.height)
      : Cesium.Cartesian3.fromDegrees(-99.1332, 19.4326, DEFAULT_CAMERA_HEIGHT),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
  });
  viewer.trackedEntity = undefined;
  viewer.selectedEntity = undefined;
  viewer.camera.cancelFlight?.();
  viewer.scene?.tweens?.removeAll?.();
  logInitialCameraTarget(initialTarget);
  enableHistoryCameraControls(viewer);
  bindUserOnlyCameraGuard(viewer);
  resizeHistoryMap();
}

// ── Build all entities from replay data ──────────────────

export function buildMapEntities(replay) {
  const viewer = replayState.viewer;
  if (!viewer || !window.Cesium) return;

  mapRegistry.length = 0;
  dynamicUpdaters.length = 0;
  for (const key of Object.keys(layerCounts)) delete layerCounts[key];
  viewer.entities.removeAll();

  const snapshots = replay?.snapshots || {};
  const operationZone = getReplayOperationZone(replay);
  const events = replay?.timeline?.eventos || [];

  // Timestamps de eliminación por "tipo:id"
  const DELETION_EVENTS = new Set([
    "poi_eliminado", "area_eliminada", "estructura_eliminada",
    "ruta_tactica_eliminada", "ruta_navegacion_eliminada", "dibujo_eliminado",
    "geo_msg_eliminado"
  ]);
  const deletionMs = new Map();
  for (const ev of events) {
    if (!DELETION_EVENTS.has(ev.tipo_evento)) continue;
    const ms = Date.parse(ev.occurred_at);
    if (isFinite(ms)) deletionMs.set(`${ev.entidad_tipo}:${ev.entidad_id}`, ms);
  }

  // Zona de operación (siempre visible, sin time-gate)
  if (operationZone) {
    buildZonaEntity(operationZone, viewer);
  }

  const grid = replay?.grid || replay?.cuadricula_operacion || snapshots.cuadriculas?.[0] || null;
  if (grid && operationZone) {
    const showAt = Date.parse(grid.fecha_creacion || grid.fecha_actualizacion) || replayState.startMs || 0;
    const hideAt = grid.activo === false && grid.fecha_actualizacion
      ? (Date.parse(grid.fecha_actualizacion) || Infinity)
      : Infinity;
    for (const entity of buildGridEntities(grid, operationZone, viewer)) {
      mapRegistry.push({ entity, showAt, hideAt, type: "grid" });
    }
    countLayer("grid");
  }

  // Waypoints y blancos (ambos viven en puntos_interes). Si el backend es
  // anterior a la separacion, se clasifican aqui con la misma regla.
  const legacyPois = snapshots.pois || [];
  const waypoints = snapshots.waypoints || legacyPois.filter(poi => !isTargetPoi(poi));
  const blancos = snapshots.blancos || legacyPois.filter(isTargetPoi);

  for (const poi of waypoints) {
    const showAt = Date.parse(poi.fecha_creacion) || 0;
    const hideAt = deletionMs.get(`poi:${poi.id_poi}`) ?? Infinity;
    const entity = buildWaypointEntity(poi, viewer);
    if (!entity) continue;
    mapRegistry.push({ entity, showAt, hideAt, type: "waypoints" });
    countLayer("waypoints");
  }

  for (const blanco of blancos) {
    const showAt = Date.parse(blanco.fecha_creacion) || 0;
    const hideAt = deletionMs.get(`poi:${blanco.id_poi}`) ?? Infinity;
    const entities = buildTargetEntities(blanco, viewer, showAt, hideAt);
    if (!entities.length) continue;
    for (const entity of entities) mapRegistry.push({ entity, showAt, hideAt, type: "blancos" });
    countLayer("blancos");
  }

  // GEO-MSG
  for (const geoMsg of (snapshots.geo_mensajes || [])) {
    const showAt = Date.parse(geoMsg.fecha_creacion) || 0;
    const hideAt = geoMsg.fecha_eliminacion
      ? (Date.parse(geoMsg.fecha_eliminacion) || Infinity)
      : (deletionMs.get(`geo_msg:${geoMsg.id_geo_msg}`) ?? Infinity);
    const entity = buildGeoMsgEntity(geoMsg, viewer);
    if (!entity) continue;
    mapRegistry.push({ entity, showAt, hideAt, type: "geomsg" });
    countLayer("geomsg");
  }

  // Áreas
  for (const area of (snapshots.areas || [])) {
    const showAt = Date.parse(area.fecha_creacion) || 0;
    const hideAt = deletionMs.get(`area:${area.id_area}`) ?? Infinity;
    const entity = buildAreaEntity(area, viewer);
    if (entity) { mapRegistry.push({ entity, showAt, hideAt, type: "areas" }); countLayer("areas"); }
  }

  // Estructuras / edificios
  for (const est of (snapshots.estructuras || [])) {
    const showAt = Date.parse(est.fecha_creacion) || 0;
    const hideAt = deletionMs.get(`estructura:${est.id_marca}`) ?? Infinity;
    const entity = buildStructureEntity(est, viewer);
    if (entity) { mapRegistry.push({ entity, showAt, hideAt, type: "estructuras" }); countLayer("estructuras"); }
  }

  // Rutas tácticas
  for (const ruta of (snapshots.rutas_tacticas || [])) {
    const showAt = Date.parse(ruta.fecha_creacion) || 0;
    const hideAt = deletionMs.get(`ruta_operacion:${ruta.id_ruta}`) ?? Infinity;
    const entity = buildRouteEntity(ruta, viewer);
    if (entity) { mapRegistry.push({ entity, showAt, hideAt, type: "rutas" }); countLayer("rutas"); }
  }

  // Rutas de navegación
  for (const ruta of (snapshots.rutas_navegacion || [])) {
    const showAt = Date.parse(ruta.fecha_creacion) || 0;
    const hideAt = (ruta.activo === false && ruta.fecha_eliminacion)
      ? (Date.parse(ruta.fecha_eliminacion) ?? Infinity)
      : Infinity;
    const navEntities = buildNavRouteEntities(ruta, viewer);
    for (const entity of navEntities) {
      mapRegistry.push({ entity, showAt, hideAt, type: "rutas" });
    }
    if (navEntities.length) countLayer("rutas");
  }

  // Dibujos libres
  for (const dibujo of (snapshots.dibujos || [])) {
    const showAt = Date.parse(dibujo.fecha_creacion) || 0;
    const hideAt = deletionMs.get(`dibujo:${dibujo.id_dibujo}`) ?? Infinity;
    const entity = buildDrawingEntity(dibujo, viewer);
    if (entity) { mapRegistry.push({ entity, showAt, hideAt, type: "dibujos" }); countLayer("dibujos"); }
  }

  // Tracking con simbologia militar, igual que el mapa activo
  buildTrackingEntities(viewer, events, "tracking_personal", "id_personal", "#00BFFF", "personal", "personal");
  buildTrackingEntities(viewer, events, "tracking_vehiculo", "id_vehiculo", "#FFD700", "vehiculos", "vehiculo");
  buildTrackingEntities(viewer, events, "tracking_equipo", "id_equipo", "#B4FF39", "equipos", "equipo");
  buildTrackingEntities(viewer, events, "tracking_dispositivo", "id_dispositivo", "#FF8A3D", "dispositivos", "dispositivo");

  for (const { entity, type } of mapRegistry) {
    if (entity.label && LABEL_LAYERS.has(type)) entity.label.distanceDisplayCondition = LABEL_DISPLAY;
  }

  // Mostrar estado inicial
  updateMapToTime(replayState.startMs);
}

// ── Zona de operación (igual que dashboard) ──────────────

function buildZonaEntity(zona, viewer) {
  const geometry = parseGeoJsonObject(zona?.geometria ?? zona?.geometry);
  const ring = getPolygonRing(geometry);
  if (!Array.isArray(ring) || ring.length < 4) return;

  const points = ring
    .map(([lng, lat]) => ({ lng: Number(lng), lat: Number(lat) }))
    .filter(p => isFinite(p.lat) && isFinite(p.lng));

  if (points.length < 3) return;

  const first = points[0];
  const last = points[points.length - 1];
  if (first.lat === last.lat && first.lng === last.lng) points.pop();
  if (points.length < 3) return;

  const closedPoints = [...points, points[0]];
  const color = Cesium.Color.fromCssColorString(zona.color || "#3b82f6");

  viewer.entities.add({
    id: `zona_${zona.id_zona}`,
    name: zona.nombre || "Zona de operación",
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(toCartesianArray(points)),
      material: color.withAlpha(0.08),
      outline: false,
    },
    polyline: {
      positions: toCartesianArray(closedPoints),
      width: 3,
      material: new Cesium.PolylineDashMaterialProperty({ color, dashLength: 16 }),
      clampToGround: true,
    },
  });

  // Rosa de los vientos (igual que dashboard)
  renderWindRose(zona, viewer, closedPoints);
}

function renderWindRose(zona, viewer, points) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const boxCenterLat = (minLat + maxLat) / 2;
  const boxCenterLng = (minLng + maxLng) / 2;

  const cardinals = [
    { text: "N", lat: maxLat, lng: boxCenterLng, offset: new Cesium.Cartesian2(0, -15) },
    { text: "S", lat: minLat, lng: boxCenterLng, offset: new Cesium.Cartesian2(0, 15) },
    { text: "E", lat: boxCenterLat, lng: maxLng, offset: new Cesium.Cartesian2(15, 0) },
    { text: "W", lat: boxCenterLat, lng: minLng, offset: new Cesium.Cartesian2(-15, 0) },
  ];
  for (const lbl of cardinals) {
    viewer.entities.add({
      name: "Radar Estereográfico",
      position: Cesium.Cartesian3.fromDegrees(lbl.lng, lbl.lat),
      label: {
        text: lbl.text,
        font: "bold 24px monospace",
        fillColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.90)"),
        pixelOffset: lbl.offset,
      },
    });
  }
}

// ── Cuadrícula de operación ──────────────────────────────

function buildGridEntities(grid, zona, viewer) {
  const points = getOperationZonePoints(zona);
  if (!points || points.length < 3) return [];

  const bounds = getBounds(points);
  if (!bounds) return [];

  const sizeParts = String(grid.size || "").split("x");
  const rows = Number(grid.rows ?? grid.filas ?? sizeParts[0]);
  const cols = Number(grid.cols ?? grid.columnas ?? sizeParts[1]);
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows < 1 || cols < 1) return [];

  const latStep = (bounds.maxLat - bounds.minLat) / rows;
  const lngStep = (bounds.maxLng - bounds.minLng) / cols;
  if (!Number.isFinite(latStep) || !Number.isFinite(lngStep) || latStep <= 0 || lngStep <= 0) return [];

  const names = Array.isArray(grid.names)
    ? grid.names
    : Array.isArray(grid.nombres)
      ? grid.nombres
      : [];

  const colors = [
    "#FFA000", "#1E88E5", "#E53935", "#00897B", "#8E24AA",
    "#FB8C00", "#D81B60", "#039BE5", "#43A047", "#FDD835"
  ].map(color => Cesium.Color.fromCssColorString(color));
  const phonetic = [
    "ALFA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT", "GOLF", "HOTEL",
    "INDIA", "JULIETT", "KILO", "LIMA", "MIKE", "NOVEMBER", "OSCAR", "PAPA",
    "QUEBEC", "ROMEO", "SIERRA", "TANGO", "UNIFORM", "VICTOR", "WHISKEY", "X-RAY",
    "YANKEE", "ZULU"
  ];

  const entities = [];
  let colorIdx = 0;

  for (let col = 1; col < cols; col += 1) {
    const lng = bounds.minLng + col * lngStep;
    const color = colors[colorIdx % colors.length];
    colorIdx += 1;
    entities.push(viewer.entities.add({
      show: false,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray([lng, bounds.minLat, lng, bounds.maxLat]),
        width: 3,
        material: new Cesium.PolylineDashMaterialProperty({
          color: color.withAlpha(0.7),
          dashLength: 16
        }),
        clampToGround: true
      },
      properties: { tacticalType: "grid-part" }
    }));
  }

  for (let row = 1; row < rows; row += 1) {
    const lat = bounds.minLat + row * latStep;
    const color = colors[colorIdx % colors.length];
    colorIdx += 1;
    entities.push(viewer.entities.add({
      show: false,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray([bounds.minLng, lat, bounds.maxLng, lat]),
        width: 3,
        material: new Cesium.PolylineDashMaterialProperty({
          color: color.withAlpha(0.7),
          dashLength: 16
        }),
        clampToGround: true
      },
      properties: { tacticalType: "grid-part" }
    }));
  }

  let count = 0;
  for (let row = 0; row < rows; row += 1) {
    const latTop = bounds.maxLat - row * latStep;
    const latBottom = bounds.maxLat - (row + 1) * latStep;

    for (let col = 0; col < cols; col += 1) {
      const lngLeft = bounds.minLng + col * lngStep;
      const lngRight = bounds.minLng + (col + 1) * lngStep;
      const color = colors[count % colors.length];
      const baseName = phonetic[count % phonetic.length] || `Q${count + 1}`;
      const cycle = Math.floor(count / phonetic.length);
      const defaultName = cycle > 0 ? `${baseName}-${cycle + 1}` : baseName;
      const labelText = String(names[count] || defaultName);

      entities.push(viewer.entities.add({
        show: false,
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray([
            lngLeft, latBottom,
            lngRight, latBottom,
            lngRight, latTop,
            lngLeft, latTop
          ]),
          material: color.withAlpha(0.08),
        },
        properties: { tacticalType: "grid-part", quadrantId: count }
      }));

      entities.push(viewer.entities.add({
        show: false,
        position: Cesium.Cartesian3.fromDegrees(lngLeft, latTop),
        label: {
          text: ` ${labelText} `,
          font: "bold 13px monospace",
          fillColor: Cesium.Color.WHITE,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
          showBackground: true,
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(5, 5),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        properties: { tacticalType: "grid-part", quadrantId: count }
      }));

      count += 1;
    }
  }

  return entities;
}

function getOperationZonePoints(zona) {
  const geometry = parseGeoJsonObject(zona?.geometria ?? zona?.geometry);
  const ring = getPolygonRing(geometry);
  if (!Array.isArray(ring) || ring.length < 4) return null;

  const points = ring
    .map(([lng, lat]) => ({ lng: Number(lng), lat: Number(lat) }))
    .filter(point => Number.isFinite(point.lng) && Number.isFinite(point.lat));

  const first = points[0];
  const last = points[points.length - 1];
  if (first && last && first.lng === last.lng && first.lat === last.lat) points.pop();

  return points.length >= 3 ? points : null;
}

function getBounds(points) {
  const bounds = points.reduce((acc, point) => ({
    minLat: Math.min(acc.minLat, point.lat),
    maxLat: Math.max(acc.maxLat, point.lat),
    minLng: Math.min(acc.minLng, point.lng),
    maxLng: Math.max(acc.maxLng, point.lng),
  }), {
    minLat: Infinity,
    maxLat: -Infinity,
    minLng: Infinity,
    maxLng: -Infinity,
  });

  return [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng].every(Number.isFinite)
    ? bounds
    : null;
}

function buildWaypointEntity(poi, viewer) {
  const lat = Number(poi.latitud ?? poi.lat);
  const lng = Number(poi.longitud ?? poi.lon ?? poi.lng);
  if (!isFinite(lat) || !isFinite(lng)) return null;

  if (String(poi.tipo_poi || "").toUpperCase() === "RADAR") {
    // RADAR: solo punto coloreado
    return viewer.entities.add({
      show: false,
      name: poi.nombre || "Radar",
      position: Cesium.Cartesian3.fromDegrees(lng, lat),
      point: {
        pixelSize: 12,
        color: safeCesiumColor(poi.color, "#00BFFF").withAlpha(0.8),
        outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
      },
      label: labelOpts(poi.nombre || "Radar", new Cesium.Cartesian2(0, -18)),
    });
  }

  const sidc = pointObjectSidc(poi);
  const image = (sidc && renderPointObjectSymbol(sidc)) || resolveImage(poi.icono_src || poi.iconSrc);
  const color = safeCesiumColor(poi.color, "#FFD700");
  const label = String(poi.nombre || "Waypoint");

  return viewer.entities.add({
    show: false,
    name: label,
    position: Cesium.Cartesian3.fromDegrees(lng, lat),
    billboard: image ? {
      image,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      width: TRACKING_SYMBOL_SIZE,
      height: TRACKING_SYMBOL_SIZE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: TRACKING_SYMBOL_SCALE_BY_DIST,
    } : undefined,
    point: !image ? {
      pixelSize: 10,
      color,
      outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
    } : undefined,
    label: {
      text: label,
      font: "13px sans-serif",
      pixelOffset: image ? new Cesium.Cartesian2(0, 15) : new Cesium.Cartesian2(0, -20),
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: TRACKING_LABEL_SCALE_BY_DIST,
    },
  });
}

// ── Blancos (movimiento por rumbo/velocidad, igual que el mapa activo) ──

function buildTargetEntities(blanco, viewer, createdMs, hideAt) {
  const lat = Number(blanco.latitud ?? blanco.lat);
  const lng = Number(blanco.longitud ?? blanco.lon ?? blanco.lng);
  if (!isFinite(lat) || !isFinite(lng)) return [];

  const speedKmh = Math.max(0, Number(blanco.velocidad_kmh) || 0);
  const heading = Number(blanco.rumbo_grados);
  const hasHeading = blanco.rumbo_grados != null && isFinite(heading);
  const moving = speedKmh > 0 && hasHeading;

  // Posicion estimada en el instante reproducido: parte del punto de alta y
  // avanza a velocidad constante hasta la baja (o el instante actual).
  const positionAt = (ms) => {
    if (!moving) return { lat, lng };
    const elapsedS = Math.max(0, (Math.min(ms, hideAt) - createdMs) / 1000);
    return destinationPoint(lat, lng, heading, speedKmh / 3.6 * elapsedS);
  };
  const arrowFrom = (point) => {
    const to = destinationPoint(point.lat, point.lng, heading, TARGET_HEADING_ARROW_M);
    return Cesium.Cartesian3.fromDegreesArrayHeights([point.lng, point.lat, LINE_LIFT_M, to.lng, to.lat, LINE_LIFT_M]);
  };

  const sidc = pointObjectSidc(blanco) || "SUGP-----------";
  const image = renderPointObjectSymbol(sidc);
  const color = safeCesiumColor(blanco.color, "#FF4D5E");
  const label = String(blanco.nombre || "Blanco");
  const start = Cesium.Cartesian3.fromDegrees(lng, lat);
  const trailStart = Cesium.Cartesian3.fromDegrees(lng, lat, LINE_LIFT_M);

  const marker = viewer.entities.add({
    show: false,
    name: label,
    position: start,
    billboard: image ? {
      image,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      width: TRACKING_SYMBOL_SIZE,
      height: TRACKING_SYMBOL_SIZE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: TRACKING_SYMBOL_SCALE_BY_DIST,
    } : undefined,
    point: !image ? {
      pixelSize: 11,
      color,
      outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
    } : undefined,
    label: {
      text: label,
      font: "13px sans-serif",
      pixelOffset: new Cesium.Cartesian2(0, 15),
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: TRACKING_LABEL_SCALE_BY_DIST,
    },
  });
  const entities = [marker];

  // Flecha de rumbo: extension visual del blanco hacia su direccion de avance.
  const arrow = hasHeading ? viewer.entities.add({
    show: false,
    polyline: { positions: arrowFrom({ lat, lng }), width: 3, material: color.withAlpha(0.9) },
  }) : null;
  if (arrow) entities.push(arrow);

  // Estela desde el punto de alta hasta la posicion actual.
  const trail = moving ? viewer.entities.add({
    show: false,
    polyline: {
      positions: [trailStart, trailStart],
      width: 2,
      material: new Cesium.PolylineDashMaterialProperty({ color: color.withAlpha(0.55), dashLength: 12 }),
    },
  }) : null;
  if (trail) entities.push(trail);

  if (moving) {
    let lastSecond = null;
    dynamicUpdaters.push((ms) => {
      if (!marker.show) return;
      const second = Math.floor(Math.min(ms, hideAt) / 1000);
      if (second === lastSecond) return;
      lastSecond = second;
      const point = positionAt(ms);
      const current = Cesium.Cartesian3.fromDegrees(point.lng, point.lat);
      marker.position = current;
      arrow.polyline.positions = arrowFrom(point);
      trail.polyline.positions = [trailStart, Cesium.Cartesian3.fromDegrees(point.lng, point.lat, LINE_LIFT_M)];
    });
  }

  return entities;
}

function destinationPoint(lat, lng, headingDeg, distanceM) {
  const angular = distanceM / EARTH_RADIUS_M;
  const bearing = Cesium.Math.toRadians(headingDeg);
  const lat1 = Cesium.Math.toRadians(lat);
  const lng1 = Cesium.Math.toRadians(lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
  );
  return {
    lat: Cesium.Math.toDegrees(lat2),
    lng: ((Cesium.Math.toDegrees(lng2) + 540) % 360) - 180,
  };
}

// SIDC de un waypoint ("G...") o blanco ("S...") guardado en sidc o icono_src.
function pointObjectSidc(poi) {
  const candidates = [poi.sidc, poi.icono_src, poi.iconSrc].map(value => String(value || ""));
  // Blancos: 15 caracteres ("S" + ...); waypoints: 12 ("G" + afiliacion + "GP" + tipo + "---X").
  return candidates.find(value => /^[SG][A-Z0-9-]{9,14}$/i.test(value)) || null;
}

const pointSymbolCache = new Map();

// Los waypoints (graficos tacticos "G") se dibujan monocromaticos por
// identidad, igual que la vista previa del mapa activo; los blancos usan MIL Light.
function renderPointObjectSymbol(sidc) {
  if (!sidc || typeof ms === "undefined" || typeof ms.Symbol !== "function") return null;
  if (pointSymbolCache.has(sidc)) return pointSymbolCache.get(sidc);

  const monoColors = { F: "#F7FAFF", H: "#FF3347", N: "#00F53D", U: "#FFF000" };
  const options = sidc.charAt(0).toUpperCase() === "G"
    ? { size: TRACKING_SYMBOL_RENDER_SIZE, monoColor: monoColors[sidc.charAt(1).toUpperCase()] || "#FFF000", fill: false }
    : { size: TRACKING_SYMBOL_RENDER_SIZE, colorMode: "Light", fill: true };

  let canvas = null;
  try {
    canvas = new ms.Symbol(sidc, options).asCanvas();
  } catch {
    canvas = null;
  }
  pointSymbolCache.set(sidc, canvas);
  return canvas;
}

// ── GEO-MSG ───────────────────────────────────────────────

const geoMsgIconCache = new Map();

// Globo de mensaje con cola hacia el punto anclado.
function geoMsgIcon(isPublic) {
  const key = isPublic ? "public" : "private";
  if (geoMsgIconCache.has(key)) return geoMsgIconCache.get(key);

  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.beginPath();
  ctx.moveTo(14, 8);
  ctx.lineTo(82, 8);
  ctx.quadraticCurveTo(90, 8, 90, 16);
  ctx.lineTo(90, 56);
  ctx.quadraticCurveTo(90, 64, 82, 64);
  ctx.lineTo(56, 64);
  ctx.lineTo(48, 90);
  ctx.lineTo(40, 64);
  ctx.lineTo(14, 64);
  ctx.quadraticCurveTo(6, 64, 6, 56);
  ctx.lineTo(6, 16);
  ctx.quadraticCurveTo(6, 8, 14, 8);
  ctx.closePath();
  ctx.fillStyle = isPublic ? "#F59E0B" : "#64748B";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#0B1220";
  ctx.stroke();

  ctx.fillStyle = "#FFFFFF";
  [[24, 52], [36, 52], [48, 30]].forEach(([y, width]) => {
    ctx.fillRect(22, y, width, 6);
  });

  geoMsgIconCache.set(key, canvas);
  return canvas;
}

function buildGeoMsgEntity(geoMsg, viewer) {
  const lat = Number(geoMsg.lat);
  const lng = Number(geoMsg.lon ?? geoMsg.lng);
  if (!isFinite(lat) || !isFinite(lng)) return null;

  const text = String(geoMsg.texto ?? geoMsg.text ?? "").trim();
  const isPublic = String(geoMsg.visibilidad || "").toUpperCase() === "PUBLICO";
  const shortText = text.length > GEO_MSG_LABEL_MAX ? `${text.slice(0, GEO_MSG_LABEL_MAX - 1)}…` : text;

  return viewer.entities.add({
    show: false,
    name: text || "GEO-MSG",
    position: Cesium.Cartesian3.fromDegrees(lng, lat),
    billboard: {
      image: geoMsgIcon(isPublic),
      width: 34,
      height: 34,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: TRACKING_SYMBOL_SCALE_BY_DIST,
    },
    label: shortText ? {
      text: shortText,
      font: "12px sans-serif",
      pixelOffset: new Cesium.Cartesian2(0, -40),
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      fillColor: Cesium.Color.WHITE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("#0B1220").withAlpha(0.82),
      backgroundPadding: new Cesium.Cartesian2(7, 4),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: TRACKING_LABEL_SCALE_BY_DIST,
    } : undefined,
  });
}

// ── Área (igual que dashboard.buildAreaEntity) ────────────

function buildAreaEntity(area, viewer) {
  const geometry = area?.geometria;
  const meta = geometry?.meta || {};
  if (geometry?.type !== "Polygon") return null;

  const opacity = Number(meta.opacity ?? 0.35);
  const lineWidth = Number(meta.outline_width ?? 3);
  const colorHex = area.color || "#FF4500";
  const outline = safeCesiumColor(colorHex, "#FF4500");

  if (meta.shape === "circle") {
    const center = Array.isArray(meta.center) ? meta.center : null;
    const radius = Number(meta.radius_m);
    if (!center || center.length < 2 || !isFinite(radius) || radius <= 0) return null;
    const [lng, lat] = center;
    if (!isFinite(lat) || !isFinite(lng)) return null;

    return viewer.entities.add({
      show: false,
      name: area.nombre || "Círculo de cobertura",
      position: Cesium.Cartesian3.fromDegrees(lng, lat),
      ellipse: {
        semiMajorAxis: radius,
        semiMinorAxis: radius,
        material: outline.withAlpha(opacity),
        outline: true, outlineColor: outline, outlineWidth: lineWidth,
      },
      label: area.nombre ? labelOpts(area.nombre, new Cesium.Cartesian2(0, 0), true) : undefined,
    });
  }

  if (meta.shape !== "polygon") return null;

  const coordinates = Array.isArray(geometry?.coordinates?.[0]) ? geometry.coordinates[0] : null;
  if (!coordinates || coordinates.length < 4) return null;

  const ringPoints = coordinates
    .map(coord => ({ lng: Number(coord?.[0]), lat: Number(coord?.[1]) }))
    .filter(p => isFinite(p.lat) && isFinite(p.lng))
    .slice(0, -1);

  if (ringPoints.length < 3) return null;

  const center = polygonCentroid(ringPoints);

  return viewer.entities.add({
    show: false,
    name: area.nombre || "Zona",
    position: center ? Cesium.Cartesian3.fromDegrees(center.lng, center.lat) : undefined,
    polygon: {
      hierarchy: toCartesianArray(ringPoints),
      material: outline.withAlpha(opacity),
      outline: true, outlineColor: outline, outlineWidth: lineWidth,
      perPositionHeight: false,
    },
    label: (area.nombre && center) ? labelOpts(area.nombre, new Cesium.Cartesian2(0, 0), true) : undefined,
  });
}

// ── Estructura / Edificio (igual que dashboard) ───────────

function buildStructureEntity(estructura, viewer) {
  const lat = Number(estructura.latitud ?? estructura.lat);
  const lng = Number(estructura.longitud ?? estructura.lon ?? estructura.lng);
  if (!isFinite(lat) || !isFinite(lng)) return null;

  const type = String(estructura.tipo_estructura || "").toUpperCase();
  const isLabel = type === "ETIQUETA";
  const name = String(estructura.nombre || (isLabel ? "Etiqueta" : "Edificio"));

  return viewer.entities.add({
    show: false,
    name,
    position: Cesium.Cartesian3.fromDegrees(lng, lat),
    billboard: !isLabel ? {
      image: "img/estructuras/casa.png",
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      scale: 0.08,
      scaleByDistance: SCALE_BY_DIST,
    } : undefined,
    label: {
      text: name,
      font: "12px sans-serif",
      pixelOffset: isLabel ? new Cesium.Cartesian2(0, -18) : new Cesium.Cartesian2(0, 8),
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      scaleByDistance: SCALE_BY_DIST,
      showBackground: isLabel,
      backgroundColor: isLabel ? Cesium.Color.BLACK.withAlpha(0.7) : undefined,
      backgroundPadding: isLabel ? new Cesium.Cartesian2(6, 4) : undefined,
    },
  });
}

// ── Ruta táctica (igual que dashboard.buildRouteEntity) ───

function buildRouteEntity(ruta, viewer) {
  let geometry = ruta?.geometria;
  if (typeof geometry === "string") {
    try { geometry = JSON.parse(geometry); } catch { return null; }
  }
  if (geometry?.type !== "LineString" || !Array.isArray(geometry.coordinates)) return null;

  const points = geometry.coordinates
    .map(coord => ({ lng: Number(coord?.[0]), lat: Number(coord?.[1]) }))
    .filter(p => isFinite(p.lat) && isFinite(p.lng));
  if (points.length < 2) return null;

  const color = safeCesiumColor(ruta.color, "#1E90FF");

  return viewer.entities.add({
    show: false,
    name: ruta.nombre || "Línea táctica",
    polyline: {
      positions: toCartesianArray(points),
      width: Number(ruta.grosor || ruta.width || 3),
      material: color,
      clampToGround: true,
    },
  });
}

// ── Ruta de navegación ────────────────────────────────────

function buildNavRouteEntities(ruta, viewer) {
  const geojson = ruta.geojson;
  if (!geojson) return [];
  const coords = geojson.coordinates ?? geojson.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return [];

  const positions = coords.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));

  const entities = [];

  entities.push(viewer.entities.add({
    show: false,
    name: "Ruta de navegación",
    polyline: {
      positions,
      width: 3,
      material: safeCesiumColor(ruta.color, "#00C3FF").withAlpha(0.85),
      clampToGround: true,
    },
  }));

  const label = ruta.id_vehiculo ? `Vehiculo ${ruta.id_vehiculo}` : "Ruta General";
  const origin = makeRouteEndpointEntity(viewer, ruta.origen_lat, ruta.origen_lon, `ORIGEN: ${label}`, Cesium.Color.LIME);
  const destination = makeRouteEndpointEntity(viewer, ruta.destino_lat, ruta.destino_lon, `DESTINO: ${label}`, Cesium.Color.YELLOW);
  if (origin) entities.push(origin);
  if (destination) entities.push(destination);

  return entities;
}

function makeRouteEndpointEntity(viewer, latValue, lonValue, label, fallbackColor) {
  const lat = Number(latValue);
  const lon = Number(lonValue);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const symbol = makeTrackingSymbolBillboard("vehiculo", {});
  return viewer.entities.add({
    show: false,
    position: Cesium.Cartesian3.fromDegrees(lon, lat),
    billboard: symbol || undefined,
    point: symbol ? undefined : {
      pixelSize: 8,
      color: fallbackColor,
    },
    label: {
      text: label,
      font: "bold 14px sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 4,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -28),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
}

// ── Dibujo libre ──────────────────────────────────────────

function buildDrawingEntity(dibujo, viewer) {
  const puntos = dibujo.puntos;
  if (!Array.isArray(puntos) || puntos.length < 2) return null;

  const positions = puntos
    .map(p => {
      const lat = Number(p.lat ?? p.latitud);
      const lon = Number(p.lng ?? p.lon ?? p.longitud);
      return isFinite(lat) && isFinite(lon) ? Cesium.Cartesian3.fromDegrees(lon, lat) : null;
    })
    .filter(Boolean);

  if (positions.length < 2) return null;

  return viewer.entities.add({
    show: false,
    polyline: {
      positions,
      width: dibujo.grosor || 3,
      material: new Cesium.ColorMaterialProperty(safeCesiumColor(dibujo.color, "#FFFFFF").withAlpha(0.9)),
      clampToGround: true,
    },
  });
}

// ── Tracking (personal y vehículos) ──────────────────────

function buildTrackingEntities(viewer, events, tipoEvento, idKey, colorHex, type, tacticalType) {
  const byId = new Map();

  for (const ev of events) {
    if (ev.tipo_evento !== tipoEvento) continue;
    const p = ev.payload || {};
    const lat = Number(p.latitud);
    const lon = Number(p.longitud);
    const ms = Date.parse(ev.occurred_at);
    if (!isFinite(lat) || !isFinite(lon) || !isFinite(ms)) continue;

    const key = String(p[idKey]);
    if (!byId.has(key)) {
      const nombre = makeTrackingLabel(tacticalType, p);
      byId.set(key, { points: [], nombre, lastPayload: p });
    }
    const entry = byId.get(key);
    entry.points.push({ ms, lat, lon });
    entry.lastPayload = { ...entry.lastPayload, ...p };
  }

  const cesiumColor = Cesium.Color.fromCssColorString(colorHex);

  for (const data of byId.values()) {
    const { points, nombre } = data;
    if (!points.length) continue;
    points.sort((left, right) => left.ms - right.ms);

    const showAt = points[0].ms;

    const cartesians = points.map(pt => Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat));
    const times = points.map(pt => pt.ms);
    const liftedCartesians = points.map(pt => Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, LINE_LIFT_M));
    // Vertices del trazo reducidos a un maximo, para que el costo por actualizacion no crezca con los puntos.
    const step = Math.max(1, Math.ceil(points.length / MAX_PATH_VERTICES));
    const pathCartesians = [];
    const pathTimes = [];
    for (let i = 0; i < points.length; i += step) {
      pathCartesians.push(liftedCartesians[i]);
      pathTimes.push(times[i]);
    }

    const pathEntity = viewer.entities.add({
      show: false,
      polyline: {
        positions: [liftedCartesians[0], liftedCartesians[0]],
        width: tipoEvento === "tracking_vehiculo" ? 2.5 : 2,
        material: new Cesium.ColorMaterialProperty(cesiumColor.withAlpha(0.65)),
      },
    });

    const symbol = makeTrackingSymbolBillboard(tacticalType, data.lastPayload);
    const markerEntity = viewer.entities.add({
      show: false,
      position: cartesians[0],
      billboard: symbol || undefined,
      point: symbol ? undefined : {
        pixelSize: 10,
        color: cesiumColor.withAlpha(0.95),
        outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5,
      },
      label: nombre ? {
        text: nombre,
        font: "11px sans-serif",
        pixelOffset: new Cesium.Cartesian2(0, 17),
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: cesiumColor.withAlpha(0.6),
        backgroundPadding: new Cesium.Cartesian2(4, 2),
        scaleByDistance: TRACKING_LABEL_SCALE_BY_DIST,
      } : undefined,
    });

    let lastIndex = -2;
    dynamicUpdaters.push((ms) => {
      if (!markerEntity.show) return;
      const index = lastIndexAtOrBefore(times, ms);
      if (index === lastIndex || index < 0) return;
      lastIndex = index;
      markerEntity.position = cartesians[index];
      const pathEnd = lastIndexAtOrBefore(pathTimes, ms);
      const path = pathCartesians.slice(0, pathEnd + 1);
      if (path[path.length - 1] !== liftedCartesians[index]) path.push(liftedCartesians[index]);
      pathEntity.polyline.positions = path.length >= 2 ? path : [path[0], path[0]];
    });

    mapRegistry.push({ entity: pathEntity, showAt, hideAt: Infinity, type });
    mapRegistry.push({ entity: markerEntity, showAt, hideAt: Infinity, type });
    countLayer(type);
  }
}

function makeTrackingLabel(tacticalType, item = {}) {
  if (tacticalType === "vehiculo") {
    const codigo = item.codigo_interno || "";
    const alias = item.alias || "";
    return [codigo, alias].filter(Boolean).join(" - ") || `V-${item.id_vehiculo || ""}`;
  }

  if (tacticalType === "equipo") {
    const serie = item.numero_serie || "";
    const nombre = item.nombre || item.tipo_equipo || item.categoria || "";
    return [serie, nombre].filter(Boolean).join(" - ") || `E-${item.id_equipo || ""}`;
  }

  if (tacticalType === "dispositivo") {
    return [item.marca, item.modelo, item.numero_serie || item.imei].filter(Boolean).join(" - ")
      || item.tipo
      || `D-${item.id_dispositivo || ""}`;
  }

  return [item.nombre, item.apellido].filter(Boolean).join(" ").trim()
    || item.apodo
    || item.nombre
    || `P-${item.id_personal || ""}`;
}

// ── Update visibility ─────────────────────────────────────

function makeTrackingSymbolBillboard(tacticalType, item = {}) {
  const sidc = resolveTrackingMilSidc(tacticalType, item);
  const image = renderMilSymbol(sidc, TRACKING_SYMBOL_RENDER_SIZE);
  if (!image) return null;

  return new Cesium.BillboardGraphics({
    image,
    width: TRACKING_SYMBOL_SIZE,
    height: TRACKING_SYMBOL_SIZE,
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    scaleByDistance: TRACKING_SYMBOL_SCALE_BY_DIST,
  });
}

function resolveTrackingMilSidc(tacticalType, item = {}) {
  const provided = item.sidc || item.codigo_sidc || item.mil_sidc;
  if (provided) return String(provided);

  const text = normalizeText([
    tacticalType,
    item.rol_en_operacion,
    item.rol,
    item.tipo,
    item.categoria,
    item.nombre,
    item.alias,
    item.modelo,
    item.marca,
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
    if (textIncludes(text, "TELEFONO", "CELULAR", "TABLET", "RADIO", "COMUNIC")) return buildMilSidc("F", "G", "UCS---");
    if (textIncludes(text, "CAMARA", "SENSOR")) return buildMilSidc("F", "G", "EX----");
    return buildMilSidc("F", "G", "E-----");
  }

  if (textIncludes(text, "PATRULL", "POLIC", "SEGUR")) return buildMilSidc("F", "G", "UCF---");
  return buildMilSidc("F", "G", "UCI---");
}

function buildMilSidc(identity = "F", dimension = "G", icon = "U-----") {
  const safeIcon = String(icon || "U-----").padEnd(6, "-").slice(0, 6);
  return `S${identity}${dimension}P${safeIcon}-----`;
}

function textIncludes(text, ...needles) {
  return needles.some(needle => text.includes(needle));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

// Ultimo indice con times[i] <= value en una lista ordenada (-1 si no hay).
function lastIndexAtOrBefore(times, value) {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[mid] <= value) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

export function updateMapToTime(currentMs) {
  // Solo se escribe `show` cuando cambia: cada asignacion invalida la entidad.
  for (const item of mapRegistry) {
    const visible = (!item.type || visibleLayerTypes.has(item.type))
      && currentMs >= item.showAt && currentMs < item.hideAt;
    if (item.entity.show !== visible) item.entity.show = visible;
  }
  for (const update of dynamicUpdaters) update(currentMs);
  replayState.viewer?.scene?.requestRender?.();
}

export function setHistoryLayerVisibility(type, visible) {
  if (!type) return;
  if (visible) {
    visibleLayerTypes.add(type);
  } else {
    visibleLayerTypes.delete(type);
  }
  updateMapToTime(replayState.currentTimeMs || replayState.startMs || Date.now());
}

// Centra la camara en una coordenada (p. ej. al elegir un evento de la actividad).
export function flyToLocation(lat, lng, height = 1800) {
  const viewer = replayState.viewer;
  if (!viewer || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const duration = 0.9;
  // El guardia de camara revierte movimientos que no vienen del usuario.
  cameraGraceUntil = performance.now() + duration * 1000 + USER_CAMERA_GRACE_MS;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lng, lat, clampCameraHeight(height)),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration,
  });
}

export function resizeHistoryMap() {
  const viewer = replayState.viewer;
  if (!viewer) return;
  window.setTimeout(() => {
    viewer.resize();
    viewer.scene?.requestRender?.();
  }, 80);
}

function enableHistoryCameraControls(viewer) {
  configureGoogleLikeCamera(viewer, {
    minimumZoomDistance: MIN_CAMERA_DISTANCE,
    maximumZoomDistance: MAX_CAMERA_DISTANCE,
    inertiaSpin: 0,
    inertiaTranslate: 0,
    inertiaZoom: 0,
    maximumMovementRatio: 0.08,
    zoomFactor: 2.2,
  });
}

function bindUserOnlyCameraGuard(viewer) {
  const canvas = viewer?.canvas;
  if (!canvas || viewer.__historyCameraGuardBound) return;

  viewer.__historyCameraGuardBound = true;

  let applyingGuard = false;
  cameraGraceUntil = performance.now() + USER_CAMERA_GRACE_MS;
  let lastUserCameraView = captureCameraView(viewer.camera);

  const markUserCameraInput = () => {
    cameraGraceUntil = performance.now() + USER_CAMERA_GRACE_MS;
  };

  const markPointerMove = (event) => {
    if (event.buttons) markUserCameraInput();
  };

  canvas.addEventListener("pointerdown", markUserCameraInput, { passive: true });
  canvas.addEventListener("pointermove", markPointerMove, { passive: true });
  canvas.addEventListener("wheel", markUserCameraInput, { passive: true });
  canvas.addEventListener("touchstart", markUserCameraInput, { passive: true });
  canvas.addEventListener("touchmove", markUserCameraInput, { passive: true });

  viewer.camera.changed.addEventListener(() => {
    if (applyingGuard) return;

    if (performance.now() <= cameraGraceUntil) {
      lastUserCameraView = captureCameraView(viewer.camera);
      return;
    }

    if (!lastUserCameraView) {
      lastUserCameraView = captureCameraView(viewer.camera);
      return;
    }

    applyingGuard = true;
    viewer.camera.cancelFlight?.();
    viewer.scene?.tweens?.removeAll?.();
    viewer.camera.setView(lastUserCameraView);
    viewer.scene?.requestRender?.();
    window.requestAnimationFrame(() => {
      applyingGuard = false;
    });
  });
}

function captureCameraView(camera) {
  if (!camera || !window.Cesium) return null;

  return {
    destination: Cesium.Cartesian3.clone(camera.position),
    orientation: {
      direction: Cesium.Cartesian3.clone(camera.direction),
      up: Cesium.Cartesian3.clone(camera.up),
    },
  };
}

function getReplayOperationZone(replay) {
  return replay?.zona_operacion || replay?.snapshots?.zonas?.[0] || null;
}

function getZoneCameraTarget(zona) {
  let geometria = zona?.geometria ?? zona?.geometry;
  if (typeof geometria === "string") {
    try { geometria = JSON.parse(geometria); } catch { geometria = null; }
  }

  const lat = finiteNumber(zona?.centroide_lat, zona?.center_lat, zona?.latitud, zona?.lat);
  const lng = finiteNumber(zona?.centroide_lon, zona?.centroide_lng, zona?.center_lon, zona?.center_lng, zona?.longitud, zona?.lng, zona?.lon);
  const backendZoom = finiteNumber(zona?.zoom_inicial, zona?.zoom);

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return {
      lat,
      lng,
      height: clampCameraHeight(Number.isFinite(backendZoom) ? backendZoom : DEFAULT_ZONE_CAMERA_HEIGHT),
      source: "backend",
    };
  }

  return getGeometryCameraTarget(geometria, backendZoom);
}

function getGeometryCameraTarget(geometria, backendZoom = NaN) {
  const ring = getPolygonRing(parseGeoJsonObject(geometria));
  if (!Array.isArray(ring) || ring.length < 3) return null;

  const points = ring
    .map(([pointLng, pointLat]) => ({ lng: Number(pointLng), lat: Number(pointLat) }))
    .filter(point => Number.isFinite(point.lng) && Number.isFinite(point.lat));

  if (!points.length) return null;

  const bounds = points.reduce((acc, point) => ({
    minLat: Math.min(acc.minLat, point.lat),
    maxLat: Math.max(acc.maxLat, point.lat),
    minLng: Math.min(acc.minLng, point.lng),
    maxLng: Math.max(acc.maxLng, point.lng),
  }), {
    minLat: Infinity,
    maxLat: -Infinity,
    minLng: Infinity,
    maxLng: -Infinity,
  });

  if (![bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng].every(Number.isFinite)) return null;

  const span = Math.max(bounds.maxLat - bounds.minLat, bounds.maxLng - bounds.minLng);
  const fittedHeight = Math.max(DEFAULT_ZONE_CAMERA_HEIGHT, Math.min(MAX_CAMERA_DISTANCE, span * 140000));

  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lng: (bounds.minLng + bounds.maxLng) / 2,
    height: clampCameraHeight(Number.isFinite(backendZoom) ? backendZoom : fittedHeight),
    source: "geometry",
  };
}

function clampCameraHeight(value) {
  const height = Number(value);
  if (!Number.isFinite(height)) return DEFAULT_ZONE_CAMERA_HEIGHT;
  return Math.min(Math.max(height, MIN_CAMERA_DISTANCE), MAX_CAMERA_DISTANCE);
}

function logInitialCameraTarget(target) {
  if (!target) {
    console.info("[historial] camara inicial sin zona backend; usando vista default");
    return;
  }

  console.info("[historial] camara inicial zona", {
    source: target.source,
    lat: target.lat,
    lng: target.lng,
    height: target.height,
  });
}

function finiteNumber(...values) {
  for (const value of values) {
    if (value == null || String(value).trim() === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return NaN;
}

// ── Helpers ───────────────────────────────────────────────

function addHybridLayer(viewer) {
  const satellite = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      maximumLevel: 19,
    })
  );
  satellite.brightness = 0.78;
  satellite.contrast = 1.35;
  satellite.saturation = 1.15;
  satellite.gamma = 0.9;

  const reference = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      maximumLevel: 19,
      credit: "Esri Reference",
    })
  );
  reference.alpha = 0.78;
}

function toCartesianArray(points) {
  return points.map(p => Cesium.Cartesian3.fromDegrees(p.lng ?? p.lon, p.lat));
}

function labelOpts(text, offset, isCenter = false) {
  return {
    text: String(text),
    font: "14px sans-serif",
    pixelOffset: offset || new Cesium.Cartesian2(0, -20),
    fillColor: Cesium.Color.WHITE,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 3,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  };
}

function safeCesiumColor(cssColor, fallback) {
  try { return Cesium.Color.fromCssColorString(cssColor || fallback); } catch {
    return Cesium.Color.fromCssColorString(fallback);
  }
}

function parseGeoJsonObject(value) {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return parseGeoJsonObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (value?.type === "Feature") return parseGeoJsonObject(value.geometry);
  return value && typeof value === "object" ? value : null;
}

function getPolygonRing(geometry) {
  if (geometry?.type === "Polygon") return geometry.coordinates?.[0];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates?.[0]?.[0];
  return null;
}

function resolveImage(src) {
  if (!src) return null;
  if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:")) return src;
  return `${API_BASE.replace(/\/$/, "")}/${src.replace(/^\.?\//, "")}`;
}

function renderMilSymbol(sidc, size = 200) {
  if (!sidc || typeof ms === "undefined" || typeof ms.Symbol !== "function") return null;
  try {
    return new ms.Symbol(sidc, { size, colorMode: "Light" }).asCanvas();
  } catch {
    return null;
  }
}

function polygonCentroid(points) {
  if (!points.length) return null;
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}
