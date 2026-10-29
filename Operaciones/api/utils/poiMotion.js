// Posición actual de un POI en movimiento. La BD guarda el punto de origen y
// el instante desde el que avanza (movimiento_desde, o la creación); así todos
// los dispositivos reciben la misma posición y no reinician el recorrido.
// Usa la misma fórmula plana que el cliente (111320 m por grado).
export function advancedPoiPosition(poi, now = Date.now()) {
  const lat = Number(poi?.latitud);
  const lon = Number(poi?.longitud);
  const speedKmh = Number(poi?.velocidad_kmh);
  const heading = poi?.rumbo_grados == null ? NaN : Number(poi.rumbo_grados);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!(speedKmh > 0) || !Number.isFinite(heading)) return { lat, lon };
  // Un Blanco privado permanece quieto; solo avanza mientras es público.
  if (String(poi?.visibilidad || "PRIVADO").toUpperCase() !== "PUBLICO") return { lat, lon };
  const since = new Date(poi.movimiento_desde || poi.fecha_creacion || now).getTime();
  const elapsedSeconds = Number.isFinite(since) ? Math.max(0, (now - since) / 1000) : 0;
  const distanceM = (speedKmh / 3.6) * elapsedSeconds;
  const rad = (heading * Math.PI) / 180;
  return {
    lat: lat + (Math.cos(rad) * distanceM) / 111320,
    lon: lon + (Math.sin(rad) * distanceM) / (111320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)))
  };
}

// Los waypoints y los blancos comparten tabla (puntos_interes). Un blanco es un
// objeto MIL-STD-2525 de unidad (SIDC "S...") o con tipo_poi MIL; todo lo demas
// (SIDC de grafico tactico "G...", PDI) es un waypoint.
export function isTargetPoi(row) {
  const sidc = String(row?.sidc || row?.icono_src || "").toUpperCase();
  if (sidc.startsWith("S")) return true;
  if (sidc.startsWith("G")) return false;
  return String(row?.tipo_poi || "").toUpperCase() === "MIL";
}
