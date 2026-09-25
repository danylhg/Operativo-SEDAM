// js/dashboard/dashboard.routes.js

import { dashboardState } from "./dashboard.state.js";
import { dom } from "./dashboard.dom.js";
import { setRouteInfo } from "./dashboard.ui.js?v=20260923-draggable-person-popup";
import { renderMilSymbolImage } from "./dashboard.tactical.js";

const OSRM_BASE = "https://router.project-osrm.org";
const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;

const ROUTE_COLOR_HEX = [
  "#FF00FF", "#FFA500", "#32CD32",
  "#FFC0CB", "#00BFFF", "#FF69B4",
  "#FFD700", "#EE82EE", "#00FF7F"
];

// Colores por rol — mismos que la app Android (map.html)
function getRolColor(rol) {
  switch ((rol || "").toUpperCase()) {
    default: return Cesium.Color.fromCssColorString("#00BFFF");
  }
}

// IDs de rutas que yo acabo de enviar (evita redibujar lo que ya dibujé localmente)
const _mySentRouteIds = new Set();

// ── Helpers ──────────────────────────────────────────────────

function apiFetch(path, opts = {}) {
  const token = localStorage.getItem("token");
  return fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) }
  });
}

function getStableColor(id) {
  if (!id || id === "global") return Cesium.Color.fromCssColorString("#00FFFF");
  let hash = 0;
  for (let i = 0; i < String(id).length; i++) {
    hash = String(id).charCodeAt(i) + ((hash << 5) - hash);
  }
  return Cesium.Color.fromCssColorString(ROUTE_COLOR_HEX[Math.abs(hash) % ROUTE_COLOR_HEX.length]);
}

// Igual que Android: color explícito, color reconocido del creador o uno
// estable derivado del creador/vehículo.
function getRouteColor(ruta = {}) {
  const explicit = String(ruta.color || "").trim();
  if (/^#[0-9A-F]{6}$/i.test(explicit) && explicit.toUpperCase() !== "#1E90FF") {
    return Cesium.Color.fromCssColorString(explicit);
  }
  const creator = String(ruta.creador_nombre || ruta.routeCreator || ruta.creador || ruta.createdBy || "").toLowerCase();
  if (creator.includes("pineda")) return Cesium.Color.fromCssColorString("#9333EA");
  if (creator.includes("campos")) return Cesium.Color.fromCssColorString("#F97316");
  return getStableColor(creator || ruta.id_vehiculo || "global");
}

let destinationPinImage = null;

function getDestinationPinIcon() {
  if (destinationPinImage) return destinationPinImage;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 8, 0, 148);
  gradient.addColorStop(0, "#38BDF8");
  gradient.addColorStop(1, "#1261B5");
  ctx.beginPath();
  ctx.moveTo(64, 148);
  ctx.bezierCurveTo(58, 138, 20, 91, 20, 54);
  ctx.arc(64, 54, 44, Math.PI, 0, false);
  ctx.bezierCurveTo(108, 91, 70, 138, 64, 148);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(64, 54, 24, 0, Math.PI * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#1261B5";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(64, 54, 8, 0, Math.PI * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  destinationPinImage = canvas.toDataURL("image/png");
  return destinationPinImage;
}

function routeProperties(ruta, extra = {}) {
  return {
    tacticalType: "navigation-route",
    routeId: ruta.id_ruta,
    routeCreator: ruta.creador_nombre || ruta.routeCreator || ruta.creador || ruta.createdBy || "",
    routeCreatorRank: ruta.creador_puesto || ruta.routeCreatorRank || ruta.cargo || "",
    routeDistanceM: Number(ruta.distancia_m || ruta.distance || 0),
    routeDurationS: Number(ruta.duracion_s || ruta.duration || 0),
    routeDestinationLat: Number(ruta.destino_lat ?? ruta.destination_lat),
    routeDestinationLon: Number(ruta.destino_lon ?? ruta.destination_lon),
    ...extra
  };
}

function selectedVehicleId() {
  const el = document.getElementById("routeVehicleSelect");
  return el?.value || "global";
}

// ── Cesium drawing ───────────────────────────────────────────

function drawPolyline(coords, color, width = 5, alpha = 0.95) {
  const viewer = dashboardState.viewer;
  if (!viewer) return null;
  const positions = coords.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
  return viewer.entities.add({
    polyline: { positions, width, material: color.withAlpha(alpha), clampToGround: true }
  });
}

function drawPoint(lat, lon, color, label, pixelSize = 12, sidc = null, icono = null) {
  const viewer = dashboardState.viewer;
  if (!viewer) return null;

  let billboard = null;
  if (sidc) {
    const canvas = renderMilSymbolImage(sidc, 150);
    if (canvas) billboard = { image: canvas.toDataURL(), scale: 0.12, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND };
  } else if (icono) {
    billboard = { image: icono, scale: 0.12, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND };
  }

  return viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat),
    point: billboard ? undefined : { pixelSize, color },
    billboard: billboard || undefined,
    label: {
      text: label,
      font: "bold 14px sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 4,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -28)
    }
  });
}

function removeEntity(ent) {
  if (ent && dashboardState.viewer) dashboardState.viewer.entities.remove(ent);
}

function zoomToCoords(coords) {
  const viewer = dashboardState.viewer;
  if (!viewer || !coords?.length) return;
  let west = 180, east = -180, south = 90, north = -90;
  for (const [lon, lat] of coords) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(west, south, east, north) });
}

// ── Rutas propias (selected route) ──────────────────────────

function drawSelectedRoute(geojson, selectedId) {
  removeEntity(dashboardState.routeEntity);
  dashboardState.routeEntity = drawPolyline(geojson.coordinates, getStableColor(selectedId));
}

function clearSelectedRouteEntities() {
  removeEntity(dashboardState.startEntity);
  removeEntity(dashboardState.endEntity);
  removeEntity(dashboardState.routeEntity);
  dashboardState.startEntity = null;
  dashboardState.endEntity = null;
  dashboardState.routeEntity = null;
  dashboardState.startPoint = null;
  dashboardState.endPoint = null;
  dashboardState.lastRoute = null;
  dashboardState.lastRouteId = null;
}

function getVehicleName(id_vehiculo) {
  if (!id_vehiculo) return null;
  const selectEl = document.getElementById("routeVehicleSelect");
  if (!selectEl) return null;
  const opt = [...selectEl.options].find(o => o.value === String(id_vehiculo));
  if (opt) {
    return opt.textContent.replace("Vehículo: ", "").trim();
  }
  return null;
}

// ── Rutas remotas (otros clientes / Android) ─────────────────

function drawRemoteRoute(ruta) {
  const viewer = dashboardState.viewer;
  if (!viewer) return;
  if (dashboardState.remoteRouteEntities.has(ruta.id_ruta)) return; // ya dibujada

  const color = getRouteColor(ruta);
  const geojson = typeof ruta.geojson === "string" ? JSON.parse(ruta.geojson) : ruta.geojson;
  const entities = [];
  // Rutas sincronizadas: misma composición que Android, sin marcador de
  // origen, con pin final y una franja táctil transparente para seleccionarla.
  if (geojson?.coordinates?.length) {
    const lastCoord = geojson.coordinates.at(-1);
    const destinationLat = Number(ruta.destino_lat ?? ruta.destination_lat ?? lastCoord?.[1]);
    const destinationLon = Number(ruta.destino_lon ?? ruta.destination_lon ?? lastCoord?.[0]);
    const routeData = { ...ruta, destino_lat: destinationLat, destino_lon: destinationLon };

    const lineEnt = drawPolyline(geojson.coordinates, color, 4, 0.9);
    if (lineEnt) {
      lineEnt._routeId = ruta.id_ruta;
      lineEnt._routeVisual = true;
      lineEnt.name = "Ruta de navegación";
      lineEnt.properties = routeProperties(routeData);
      entities.push(lineEnt);
    }

    const hitAreaEnt = drawPolyline(geojson.coordinates, Cesium.Color.WHITE, 18, 0.001);
    if (hitAreaEnt) {
      hitAreaEnt._routeId = ruta.id_ruta;
      hitAreaEnt._routeHitArea = true;
      hitAreaEnt.name = "Ruta de navegación";
      hitAreaEnt.properties = routeProperties(routeData, { routeHitArea: true });
      entities.push(hitAreaEnt);
    }

    if (Number.isFinite(destinationLat) && Number.isFinite(destinationLon)) {
      const destinationEnt = viewer.entities.add({
        id: `remote_route_destination_${ruta.id_ruta}`,
        name: "Destino de ruta",
        position: Cesium.Cartesian3.fromDegrees(destinationLon, destinationLat),
        billboard: {
          image: getDestinationPinIcon(),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          scale: 0.35,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        properties: routeProperties(routeData, { tacticalType: "route-destination" })
      });
      destinationEnt._routeId = ruta.id_ruta;
      destinationEnt._routeDestination = true;
      entities.push(destinationEnt);
    }

    dashboardState.remoteRouteEntities.set(ruta.id_ruta, { ruta: routeData, entities });
    return;
  }

  const vehId = ruta.id_vehiculo != null ? String(ruta.id_vehiculo) : null;
  const vehNombre = vehId ? getVehicleName(vehId) : null;
  const labelText = vehId ? (vehNombre || "Vehículo") : "Ruta General";

  // Buscar metadatos del vehiculo en el selector para el icono
  let sidc = null, icono = null;
  if (vehId) {
    const opt = [...(document.getElementById("routeVehicleSelect")?.options || [])].find(o => o.value === vehId);
    if (opt) {
      sidc = opt.dataset.sidc;
      icono = opt.dataset.icono;
    }
  }

  const originEnt = drawPoint(ruta.origen_lat, ruta.origen_lon, Cesium.Color.LIME,
    `ORIGEN: ${labelText}`, 8, sidc, icono);
  if (originEnt) {
    originEnt._routeId = ruta.id_ruta;
    entities.push(originEnt);
  }

  const destEnt = drawPoint(ruta.destino_lat, ruta.destino_lon, Cesium.Color.YELLOW,
    `DESTINO: ${labelText}`, 8, sidc, icono);
  if (destEnt) {
    destEnt._routeId = ruta.id_ruta;
    entities.push(destEnt);
  }

  if (geojson?.coordinates?.length) {
    const lineEnt = drawPolyline(geojson.coordinates, color, 3, 0.75);
    if (lineEnt) {
      lineEnt._routeId = ruta.id_ruta;
      entities.push(lineEnt);
    }
  }

  dashboardState.remoteRouteEntities.set(ruta.id_ruta, { ruta, entities });
}

function removeRemoteRoute(id_ruta) {
  const entry = dashboardState.remoteRouteEntities.get(id_ruta);
  if (!entry) return;
  entry.entities.forEach(removeEntity);
  dashboardState.remoteRouteEntities.delete(id_ruta);
  if (dashboardState.selectedRemoteRouteId === id_ruta) {
    dashboardState.selectedRemoteRouteId = null;
  }
}

export async function deleteRemoteRouteById(id_ruta) {
  if (!id_ruta) return false;
  const deleted = await deleteRoutFromDB(id_ruta);
  if (!deleted) return false;
  removeRemoteRoute(id_ruta);
  return true;
}

function clearAllRemoteRoutes() {
  dashboardState.remoteRouteEntities.forEach(entry => entry.entities.forEach(removeEntity));
  dashboardState.remoteRouteEntities.clear();
  dashboardState.selectedRemoteRouteId = null;
}

// Dado un entity de Cesium, devuelve el id_ruta al que pertenece (o null)
export function getRouteIdForEntity(entity) {
  if (!entity) return null;
  return entity._routeId ?? null;
}

// ── Tracking (posiciones Android en tiempo real) ─────────────

function updateTrackingMarker(key, lat, lon, labelText, color) {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  const existing = dashboardState.trackingEntities.get(key);
  if (existing) viewer.entities.remove(existing);

  const ent = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat),
    point: {
      pixelSize: 10,
      color: color.withAlpha(0.18),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: new Cesium.NearFarScalar(1e3, 1.0, 2e6, 0.8)
    },
    label: {
      text: labelText,
      font: "bold 12px sans-serif",
      fillColor: Cesium.Color.WHITE,
      pixelOffset: new Cesium.Cartesian2(0, -22),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 50000)
    }
  });

  dashboardState.trackingEntities.set(key, ent);
}

// ── OSRM ────────────────────────────────────────────────────

async function getOsrmRoute(start, end) {
  const url = `${OSRM_BASE}/route/v1/driving/` +
    `${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("OSRM no disponible");
  const data = await r.json();
  if (!data.routes?.length) throw new Error("Sin ruta disponible");
  return data.routes[0];
}

// ── Guardar ruta en DB ────────────────────────────────────────

async function saveRouteToDB(start, end, route) {
  const opId = localStorage.getItem("active_operation_id");
  if (!opId) return null;

  try {
    const selectedId = selectedVehicleId();
    const body = {
      geojson: route.geometry,
      origen_lat: start.lat, origen_lon: start.lng,
      destino_lat: end.lat, destino_lon: end.lng,
      distancia_m: route.distance,
      duracion_s: route.duration
    };
    if (selectedId !== "global") body.id_vehiculo = Number(selectedId);

    const res = await apiFetch(`/ops/${opId}/rutas/navegacion`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.ok) return null;
    // Marcar como "mía" para no redibujar cuando llegue el socket event
    const id_ruta = data.ruta.id_ruta;

    // Si el socket event ya llegó antes que esta respuesta y dibujó la ruta remota,
    // eliminar el duplicado local. Si no llegó aún, bloquearlo cuando llegue.
    if (dashboardState.remoteRouteEntities.has(id_ruta)) {
      removeEntity(dashboardState.routeEntity);
      dashboardState.routeEntity = null;
    } else {
      _mySentRouteIds.add(id_ruta);
      setTimeout(() => _mySentRouteIds.delete(id_ruta), 5000);
    }

    return data.ruta;
  } catch (err) {
    console.error("[RUTAS] Error guardando ruta:", err);
    return null;
  }
}

// ── Eliminar ruta en DB ───────────────────────────────────────

async function deleteRoutFromDB(id_ruta) {
  const opId = localStorage.getItem("active_operation_id");
  if (!opId || !id_ruta) return false;
  try {
    const res = await apiFetch(`/ops/${opId}/rutas/navegacion/${id_ruta}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.mensaje || "No se pudo eliminar la ruta.");
    }
    const data = await res.json().catch(() => ({}));
    return data?.ok !== false;
  } catch (err) {
    console.error("[RUTAS] Error eliminando ruta:", err);
    setRouteInfo(err.message || "No se pudo eliminar la ruta.");
    return false;
  }
}

// ── Cargar rutas existentes al iniciar ────────────────────────

async function loadExistingRoutes() {
  const opId = localStorage.getItem("active_operation_id");
  if (!opId) return;
  try {
    const res = await apiFetch(`/ops/${opId}/rutas/navegacion`);
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.items)) return;
    data.items.forEach(ruta => drawRemoteRoute(ruta));
  } catch (err) {
    console.error("[RUTAS] Error cargando rutas existentes:", err);
  }
}

// ── API pública ──────────────────────────────────────────────

export async function autoCalcRoute() {
  if (!dashboardState.startPoint || !dashboardState.endPoint) return;

  setRouteInfo("Calculando ruta con OSRM...");

  try {
    const route = await getOsrmRoute(dashboardState.startPoint, dashboardState.endPoint);
    dashboardState.lastRoute = route;

    const selectedId = selectedVehicleId();
    drawSelectedRoute(route.geometry, selectedId);

    const km = route.distance / 1000;
    const min = route.duration / 60;
    setRouteInfo(`Ruta lista. ${km.toFixed(2)} km · ${min.toFixed(1)} min`);

    // Eliminar ruta previa del mismo vehículo (solo una ruta por vehículo/global)
    for (const [id_ruta_prev, entry] of dashboardState.remoteRouteEntities) {
      const rutaVehId = entry.ruta.id_vehiculo != null ? String(entry.ruta.id_vehiculo) : "global";
      if (rutaVehId === selectedId) {
        const deleted = await deleteRoutFromDB(id_ruta_prev);
        if (deleted) removeRemoteRoute(id_ruta_prev);
      }
    }

    // Ocultar labels locales para evitar texto doble con la ruta remota
    if (dashboardState.startEntity && dashboardState.startEntity.label) {
      dashboardState.startEntity.label.show = new Cesium.ConstantProperty(false);
    }
    if (dashboardState.endEntity && dashboardState.endEntity.label) {
      dashboardState.endEntity.label.show = new Cesium.ConstantProperty(false);
    }

    // Guardar en DB (el socket event llegará al room; yo ya la dibujé)
    const savedRoute = await saveRouteToDB(dashboardState.startPoint, dashboardState.endPoint, route);
    if (savedRoute?.id_ruta) {
      clearSelectedRouteEntities();
      drawRemoteRoute(savedRoute);
      dashboardState.lastRouteId = savedRoute.id_ruta;
    }
  } catch (err) {
    setRouteInfo(`Error: ${err.message}`);
  }
}

export async function clearRoute() {
  const selectedId = selectedVehicleId();
  let deletedAny = false;

  // Si hay una ruta remota seleccionada manualmente, o pertenece al vehículo seleccionado, o fue la última creada
  for (const [id_ruta, entry] of dashboardState.remoteRouteEntities) {
    const rutaVehId = entry.ruta.id_vehiculo != null ? String(entry.ruta.id_vehiculo) : "global";
    if (
      rutaVehId === selectedId || 
      dashboardState.selectedRemoteRouteId === id_ruta || 
      dashboardState.lastRouteId === id_ruta
    ) {
      const deleted = await deleteRoutFromDB(id_ruta);
      if (deleted) {
        removeRemoteRoute(id_ruta);
        deletedAny = true;
      }
    }
  }

  // Limpiar variables locales temporales
  clearSelectedRouteEntities();
  
  if (dom.opLat) dom.opLat.value = "";
  if (dom.opLng) dom.opLng.value = "";

  if (deletedAny) {
    setRouteInfo("Ruta eliminada del mapa y la base de datos.");
  } else {
    setRouteInfo("Ruta local limpiada del mapa.");
  }
}

export function populateRouteVehicleSelect(vehiculos = []) {
  const selectEl = document.getElementById("routeVehicleSelect");
  if (!selectEl) return;

  const prevValue = selectEl.value;
  selectEl.innerHTML = '<option value="global">Ruta General</option>';

  const seen = new Set();
  vehiculos.forEach(v => {
    // Acepta formato del backend (id_vehiculo, alias, tipo, codigo_interno)
    // o formato legacy (id, nombre, unidad, alias)
    const id = v.id_vehiculo ?? v.id ?? v.unidad ?? v.nombre;
    const label = [v.tipo, v.alias].filter(Boolean).join(" ") || v.codigo_interno || v.nombre || "Vehículo";
    if (!id) return;
    const key = String(id);
    if (seen.has(key)) return;
    seen.add(key);
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `Vehículo: ${label}`;
    opt.dataset.sidc = v.sidc || "";
    opt.dataset.icono = v.icono_src || "";
    selectEl.appendChild(opt);
  });

  if ([...selectEl.options].some(o => o.value === prevValue)) selectEl.value = prevValue;
}

// Mantener compatibilidad con dashboard.js que la llama con la operación completa
export function populateRouteVehicleSelectFromOp(operacion) {
  populateRouteVehicleSelect(operacion?.vehiculos || []);
}

export function loadRouteForSelectedVehicle() {
  // Con el nuevo sistema las rutas vienen de DB via socket.
  // Esta función limpia la selección actual y deja listo para nueva ruta.
  clearSelectedRouteEntities();
  setRouteInfo("Selecciona puntos de inicio y destino en el mapa.");
  if (dom.opLat) dom.opLat.value = "";
  if (dom.opLng) dom.opLng.value = "";
}

// ── Filtro / resaltado de rutas remotas ─────────────────────

export function applyRouteFilter(vehiculoIdStr) {
  dashboardState.remoteRouteEntities.forEach((entry, id_ruta) => {
    const { ruta, entities } = entry;
    const isSelected = dashboardState.selectedRemoteRouteId === id_ruta;

    const matches = vehiculoIdStr === "global"
      ? true
      : String(ruta.id_vehiculo ?? "") === vehiculoIdStr;

    const lineEnt = entities.find(e => e._routeVisual) || entities.find(e => e.polyline);
    const pointEnts = entities.filter(e => e._routeDestination || e.point);

    if (lineEnt) {
      const baseColor = getRouteColor(ruta);
      if (isSelected) {
        lineEnt.polyline.width = new Cesium.ConstantProperty(8);
        lineEnt.polyline.material = new Cesium.ColorMaterialProperty(Cesium.Color.WHITE.withAlpha(0.97));
      } else if (matches) {
        lineEnt.polyline.width = new Cesium.ConstantProperty(5);
        lineEnt.polyline.material = new Cesium.ColorMaterialProperty(baseColor.withAlpha(0.95));
      } else {
        lineEnt.polyline.width = new Cesium.ConstantProperty(2);
        lineEnt.polyline.material = new Cesium.ColorMaterialProperty(baseColor.withAlpha(0.25));
      }
    }

    // Puntos de origen/destino: visibles si coincide o está seleccionada
    pointEnts.forEach(e => { e.show = matches || isSelected; });
  });
}

export function selectRemoteRoute(id_ruta) {
  const vehiculoIdStr = document.getElementById("routeVehicleSelect")?.value || "global";

  // Toggle: si ya está seleccionada, deseleccionar
  if (dashboardState.selectedRemoteRouteId === id_ruta) {
    dashboardState.selectedRemoteRouteId = null;
    applyRouteFilter(vehiculoIdStr);
    setRouteInfo("");
    return;
  }

  dashboardState.selectedRemoteRouteId = id_ruta;
  applyRouteFilter(vehiculoIdStr);
  setRouteInfo(`Ruta seleccionada. Pulsa "Limpiar ruta" para eliminarla del mapa y la base de datos.`);
}

// ── Inicialización con Socket.io ──────────────────────────────

export function initRoutes(socket) {
  // Ruta nueva creada (por web u Android)
  socket.on("ruta_navegacion_creada", ({ ruta }) => {
    if (_mySentRouteIds.has(ruta.id_ruta)) return; // ya la dibujé localmente
    drawRemoteRoute(ruta);
    setRouteInfo(`Nueva ruta recibida de ${ruta.creador_nombre || "otro cliente"}.`);
  });

  // Ruta eliminada (por web u Android)
  socket.on("ruta_navegacion_eliminada", ({ id_ruta }) => {
    removeRemoteRoute(id_ruta);
    // Si era la ruta activa del selector, limpiar
    if (dashboardState.lastRouteId === id_ruta) {
      clearSelectedRouteEntities();
      setRouteInfo("La ruta activa fue eliminada.");
    }
  });

  // Tracking de personal (Android envía posición GPS)
  loadExistingRoutes();
  return;
  socket.on("tracking_personal", (data) => {
    if (!data?.id_personal || data.latitud == null || data.longitud == null) return;
    updateTrackingMarker(
      `P:${data.id_personal}`,
      Number(data.latitud), Number(data.longitud),
      data.nombre || `P-${data.id_personal}`,
      getRolColor(data.rol)
    );
  });

  // Tracking de vehículos (Android envía posición GPS)
  socket.on("tracking_vehiculo", (data) => {
    if (!data?.id_vehiculo || data.latitud == null || data.longitud == null) return;
    updateTrackingMarker(
      `V:${data.id_vehiculo}`,
      Number(data.latitud), Number(data.longitud),
      data.nombre || `V-${data.id_vehiculo}`,
      Cesium.Color.fromCssColorString("#3b82f6")
    );
  });

  // Cargar rutas ya existentes en la operación
  loadExistingRoutes();
}

// Compatibilidad con dashboard.map.js (sigue importando persistRouteDataToCurrentOperation)
export function persistRouteDataToCurrentOperation() {
  // No-op: persistencia ahora es via DB
}
