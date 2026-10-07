// Metadatos compartidos del historial: capas del mapa, categorias de evento y
// clasificacion de objetos puntuales (waypoint / blanco / GEO-MSG).

export const LAYERS = [
  { key: "personal", label: "Personal", color: "#00BFFF" },
  { key: "vehiculos", label: "Vehículos", color: "#FFD700" },
  { key: "waypoints", label: "Waypoints", color: "#F7FAFF" },
  { key: "blancos", label: "Blancos", color: "#FF4D5E" },
  { key: "geomsg", label: "GEO-MSG", color: "#F59E0B" },
  { key: "areas", label: "Áreas", color: "#FF7A45" },
  { key: "estructuras", label: "Estructuras", color: "#A78BFA" },
  { key: "rutas", label: "Rutas", color: "#38BDF8" },
  { key: "dibujos", label: "Dibujos", color: "#CBD5E1" },
  { key: "grid", label: "Cuadrícula", color: "#34D399" },
];

const CATEGORY_COLORS = {
  ...Object.fromEntries(LAYERS.map(layer => [layer.key, layer.color])),
  operacion: "#60A5FA",
  aviso: "#FB923C",
  novedad: "#FBBF24",
  chat: "#38BDF8",
  otro: "#94A3B8",
};

// Un blanco es un objeto MIL-STD-2525 de unidad (SIDC "S...") o tipo_poi MIL.
// Todo lo demas (grafico tactico "G...", PDI) es un waypoint. Misma regla que
// replay.routes.js.
export function isTargetPoi(poi) {
  const sidc = String(poi?.sidc || poi?.icono_src || "").toUpperCase();
  if (sidc.startsWith("S")) return true;
  if (sidc.startsWith("G")) return false;
  return String(poi?.tipo_poi || "").toUpperCase() === "MIL";
}

export function categoryColor(category) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.otro;
}

const ENTITY_LABELS = {
  area: ["areas", "Área"],
  estructura: ["estructuras", "Estructura"],
  ruta_operacion: ["rutas", "Ruta táctica"],
  ruta_navegacion: ["rutas", "Ruta de navegación"],
  dibujo: ["dibujos", "Dibujo"],
  zona: ["operacion", "Zona de operación"],
  cuadricula: ["grid", "Cuadrícula"],
  geo_msg: ["geomsg", "GEO-MSG"],
  aviso_operacion: ["aviso", "Aviso"],
  novedad_operacion: ["novedad", "Novedad"],
  mensaje_chat: ["chat", "Mensaje"],
  operacion: ["operacion", "Operación"],
};

function actionOf(tipoEvento) {
  const text = String(tipoEvento || "").toLowerCase();
  if (/elimin|cancel|cerrad/.test(text)) return { key: "deleted", label: "Baja" };
  if (/actualiz|edit/.test(text)) return { key: "updated", label: "Cambio" };
  if (/cread|activad|guardad|registr/.test(text)) return { key: "created", label: "Alta" };
  return { key: "info", label: "Evento" };
}

function firstCoordinate(payload) {
  const lat = Number(payload.latitud ?? payload.lat);
  const lng = Number(payload.longitud ?? payload.lon ?? payload.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };

  let geometry = payload.geometria ?? payload.geometry;
  if (typeof geometry === "string") {
    try { geometry = JSON.parse(geometry); } catch { geometry = null; }
  }
  const center = geometry?.meta?.center;
  if (Array.isArray(center) && Number.isFinite(Number(center[0])) && Number.isFinite(Number(center[1]))) {
    return { lat: Number(center[1]), lng: Number(center[0]) };
  }
  let coord = geometry?.coordinates;
  while (Array.isArray(coord) && Array.isArray(coord[0])) coord = coord[0];
  if (Array.isArray(coord) && Number.isFinite(Number(coord[0])) && Number.isFinite(Number(coord[1]))) {
    return { lat: Number(coord[1]), lng: Number(coord[0]) };
  }
  return null;
}

function humanize(value) {
  return String(value || "evento").replace(/_/g, " ").replace(/^\w/, char => char.toUpperCase());
}

// Resume un evento del timeline en algo listo para mostrar y pintar.
export function describeEvent(event) {
  const payload = event?.payload || {};
  const tipo = String(event?.tipo_evento || "");
  const entity = String(event?.entidad_tipo || "");
  const action = actionOf(tipo);

  let category;
  let kind;
  if (entity === "poi") {
    category = isTargetPoi(payload) ? "blancos" : "waypoints";
    kind = category === "blancos" ? "Blanco" : "Waypoint";
  } else if (tipo.startsWith("operacion_")) {
    [category, kind] = ENTITY_LABELS.operacion;
  } else if (ENTITY_LABELS[entity]) {
    [category, kind] = ENTITY_LABELS[entity];
  } else {
    category = "otro";
    kind = humanize(entity || tipo);
  }

  const name = (entity === "geo_msg" ? payload.texto || payload.text : null)
    || payload.titulo || payload.nombre || payload.contenido || payload.descripcion
    || payload.nota || payload.codigo || kind;

  const detail = entity === "geo_msg" ? (payload.autor || payload.author || "") : "";

  return {
    category,
    kind,
    action,
    name: String(name),
    detail,
    color: categoryColor(category),
    position: firstCoordinate(payload),
  };
}

// Eventos "relevantes": los que merecen marca en la linea de tiempo y navegacion.
export function isRelevantEvent(event) {
  const tipo = String(event?.tipo_evento || "").toLowerCase();
  return !tipo.startsWith("tracking_")
    && !tipo.startsWith("signos_vitales")
    && !tipo.startsWith("telemetria_")
    && tipo !== "chat_mensaje";
}
