import { dom } from "./historial.dom.js";
import { configureGoogleLikeCamera } from "../map.camera.js?v=20260723-map-data-safe-zoom";
import { replayState } from "./historial.state.js";

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

// Entidades con control de tiempo: { entity, showAt, hideAt (ms epoch) }
const mapRegistry = [];
const visibleLayerTypes = new Set(["personal", "vehiculos", "equipos", "dispositivos", "pois", "areas", "estructuras", "rutas", "dibujos", "grid"]);

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
  viewer.entities.removeAll();

  const snapshots = replay?.snapshots || {};
  const operationZone = getReplayOperationZone(replay);
  const events = replay?.timeline?.eventos || [];

  // Timestamps de eliminación por "tipo:id"
  const DELETION_EVENTS = new Set([
    "poi_eliminado", "area_eliminada", "estructura_eliminada",
    "ruta_tactica_eliminada", "ruta_navegacion_eliminada", "dibujo_eliminado"
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
  }

  // POIs
  for (const poi of (snapshots.pois || [])) {
    const showAt = Date.parse(poi.fecha_creacion) || 0;
    const hideAt = deletionMs.get(`poi:${poi.id_poi}`) ?? Infinity;
    const entity = buildPoiEntity(poi, viewer);
    if (entity) mapRegistry.push({ entity, showAt, hideAt, type: "pois" });
  }

  // Áreas
  for (const area of (snapshots.areas || [])) {
    const showAt = Date.parse(area.fecha_creacion) || 0;
    const hideAt = deletionMs.get(`area:${area.id_area}`) ?? Infinity;
    const entity = buildAreaEntity(area, viewer);
    if (entity) mapRegistry.push({ entity, showAt, hideAt, type: "areas" });
  }

  // Estructuras / edificios
  for (const est of (snapshots.estructuras || [])) {
    const showAt = Date.parse(est.fecha_creacion) || 0;
    const hideAt = deletionMs.get(`estructura:${est.id_marca}`) ?? Infinity;
    const entity = buildStructureEntity(est, viewer);
    if (entity) mapRegistry.push({ entity, showAt, hideAt, type: "estructuras" });
  }

  // Rutas tácticas
  for (const ruta of (snapshots.rutas_tacticas || [])) {
    const showAt = Date.parse(ruta.fecha_creacion) || 0;
    const hideAt = deletionMs.get(`ruta_operacion:${ruta.id_ruta}`) ?? Infinity;
    const entity = buildRouteEntity(ruta, viewer);
    if (entity) mapRegistry.push({ entity, showAt, hideAt, type: "rutas" });
  }

  // Rutas de navegación
  for (const ruta of (snapshots.rutas_navegacion || [])) {
    const showAt = Date.parse(ruta.fecha_creacion) || 0;
    const hideAt = (ruta.activo === false && ruta.fecha_eliminacion)
      ? (Date.parse(ruta.fecha_eliminacion) ?? Infinity)
      : Infinity;
    for (const entity of buildNavRouteEntities(ruta, viewer)) {
      mapRegistry.push({ entity, showAt, hideAt, type: "rutas" });
    }
  }

  // Dibujos libres
  for (const dibujo of (snapshots.dibujos || [])) {
    const showAt = Date.parse(dibujo.fecha_creacion) || 0;
    const hideAt = deletionMs.get(`dibujo:${dibujo.id_dibujo}`) ?? Infinity;
    const entity = buildDrawingEntity(dibujo, viewer);
    if (entity) mapRegistry.push({ entity, showAt, hideAt, type: "dibujos" });
  }

  // Tracking con simbologia militar, igual que el mapa activo
  buildTrackingEntities(viewer, events, "tracking_personal", "id_personal", "#00BFFF", "personal", "personal");
  buildTrackingEntities(viewer, events, "tracking_vehiculo", "id_vehiculo", "#FFD700", "vehiculos", "vehiculo");
  buildTrackingEntities(viewer, events, "tracking_equipo", "id_equipo", "#B4FF39", "equipos", "equipo");
  buildTrackingEntities(viewer, events, "tracking_dispositivo", "id_dispositivo", "#FF8A3D", "dispositivos", "dispositivo");

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
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  }
}

// ── POI (igual que dashboard.buildPoiEntity) ─────────────

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
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
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
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
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

function buildPoiEntity(poi, viewer) {
  const lat = Number(poi.latitud ?? poi.lat);
  const lng = Number(poi.longitud ?? poi.lon ?? poi.lng);
  if (!isFinite(lat) || !isFinite(lng)) return null;

  const tipo_poi_raw = String(poi.tipo_poi || "").toUpperCase();
  if (tipo_poi_raw === "RADAR") {
    // RADAR: solo punto colored
    return viewer.entities.add({
      show: false,
      name: poi.nombre || "Radar",
      position: Cesium.Cartesian3.fromDegrees(lng, lat),
      point: {
        pixelSize: 12,
        color: safeCesiumColor(poi.color, "#00BFFF").withAlpha(0.8),
        outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: labelOpts(poi.nombre || "Radar", new Cesium.Cartesian2(0, -18)),
    });
  }

  const sidc = poi.sidc || (poi.icono_src?.startsWith("S") ? poi.icono_src : null);
  let iconSrc = resolveImage(poi.icono_src || poi.iconSrc);
  if (sidc) iconSrc = renderMilSymbol(sidc) || iconSrc;

  const isMil = tipo_poi_raw === "MIL" || !!sidc;
  const cesiumColor = safeCesiumColor(poi.color, "#FFD700");
  const label = poi.nombre ? (isMil ? poi.nombre.replace(/\s\d{17}$/, "") : poi.nombre) : "PDI";

  return viewer.entities.add({
    show: false,
    name: label,
    position: Cesium.Cartesian3.fromDegrees(lng, lat),
    billboard: iconSrc ? {
      image: iconSrc,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      width: isMil ? 42 : undefined,
      height: isMil ? 42 : undefined,
      scale: isMil ? 1 : Number(poi.scale || 1.0),
    } : undefined,
    point: !iconSrc ? {
      pixelSize: 10,
      color: cesiumColor,
      outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    } : undefined,
    label: {
      text: label,
      font: "14px sans-serif",
      pixelOffset: iconSrc ? new Cesium.Cartesian2(0, 15) : new Cesium.Cartesian2(0, -20),
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      showBackground: !iconSrc,
      backgroundColor: !iconSrc ? cesiumColor.withAlpha(0.7) : undefined,
      backgroundPadding: !iconSrc ? new Cesium.Cartesian2(6, 4) : undefined,
    },
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
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
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
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
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
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
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
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
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
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
    label: {
      text: label,
      font: "bold 14px sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 4,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -28),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
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

    const pathEntity = viewer.entities.add({
      show: false,
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          const pts = points
            .filter(pt => pt.ms <= replayState.currentTimeMs)
            .map(pt => Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat));
          return pts.length >= 2 ? pts : (pts.length === 1 ? [pts[0], pts[0]] : null);
        }, false),
        width: tipoEvento === "tracking_vehiculo" ? 2.5 : 2,
        material: new Cesium.ColorMaterialProperty(cesiumColor.withAlpha(0.65)),
        clampToGround: true,
      },
    });

    const symbol = makeTrackingSymbolBillboard(tacticalType, data.lastPayload);
    const markerEntity = viewer.entities.add({
      show: false,
      position: new Cesium.CallbackProperty(() => {
        const visible = points.filter(pt => pt.ms <= replayState.currentTimeMs);
        if (!visible.length) return Cesium.Cartesian3.fromDegrees(0, 0, 0);
        const last = visible[visible.length - 1];
        return Cesium.Cartesian3.fromDegrees(last.lon, last.lat);
      }, false),
      billboard: symbol || undefined,
      point: symbol ? undefined : {
        pixelSize: 10,
        color: cesiumColor.withAlpha(0.95),
        outlineColor: Cesium.Color.BLACK, outlineWidth: 1.5,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: nombre ? {
        text: nombre,
        font: "11px sans-serif",
        pixelOffset: new Cesium.Cartesian2(0, 17),
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: cesiumColor.withAlpha(0.6),
        backgroundPadding: new Cesium.Cartesian2(4, 2),
        scaleByDistance: TRACKING_LABEL_SCALE_BY_DIST,
      } : undefined,
    });

    mapRegistry.push({ entity: pathEntity, showAt, hideAt: Infinity, type });
    mapRegistry.push({ entity: markerEntity, showAt, hideAt: Infinity, type });
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
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
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

export function updateMapToTime(currentMs) {
  for (const { entity, showAt, hideAt, type } of mapRegistry) {
    const layerVisible = !type || visibleLayerTypes.has(type);
    entity.show = layerVisible && currentMs >= showAt && currentMs < hideAt;
  }
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
  let userCameraUntil = performance.now() + USER_CAMERA_GRACE_MS;
  let lastUserCameraView = captureCameraView(viewer.camera);

  const markUserCameraInput = () => {
    userCameraUntil = performance.now() + USER_CAMERA_GRACE_MS;
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

    if (performance.now() <= userCameraUntil) {
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
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
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
