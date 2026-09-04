// Calcula el centroide simple de un GeoJSON Polygon.
// Usa el promedio de vertices y omite el ultimo punto porque repite el primero.
export function calcularCentroide(geojson) {
  try {
    const coords = geojson.coordinates[0];
    let sumLat = 0, sumLon = 0;
    const n = coords.length - 1;

    for (let i = 0; i < n; i++) {
      sumLon += coords[i][0];
      sumLat += coords[i][1];
    }

    return { lat: sumLat / n, lon: sumLon / n };
  } catch {
    // Si la geometria no tiene el formato esperado, deja que el caller decida.
    return null;
  }
}

// Estima zoom segun el tamano del bounding box del poligono.
// Devuelve una distancia aproximada para la camara inicial.
export function calcularZoom(geojson) {
  try {
    const coords = geojson.coordinates[0];
    const lats = coords.map(c => c[1]);
    const lons = coords.map(c => c[0]);
    const deltaLat = Math.max(...lats) - Math.min(...lats);
    const deltaLon = Math.max(...lons) - Math.min(...lons);
    const delta = Math.max(deltaLat, deltaLon);
    const metros = delta * 111000 * 1.5;

    return Math.min(Math.max(Math.round(metros), 500), 500000);
  } catch {
    // Valor seguro para una zona mediana cuando no se puede calcular.
    return 8000;
  }
}
