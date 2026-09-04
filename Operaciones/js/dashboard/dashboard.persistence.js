// js/dashboard/dashboard.persistence.js

import { dashboardState } from "./dashboard.state.js";
import { toCartesianArray, addTacticalEntity } from "./dashboard.tactical.js";

// ============================================================
// BACKEND: cartesianToLatLng() convierte coordenadas Cesium a lat/lng.
// Con backend sigue siendo necesaria para serializar entidades antes de
// enviarlas como body JSON a los endpoints de la API.
// ============================================================
export function cartesianToLatLng(cartesian) {
  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  return {
    lat: Cesium.Math.toDegrees(cartographic.latitude),
    lng: Cesium.Math.toDegrees(cartographic.longitude)
  };
}

export function cesiumColorFromObj(c) {
  if (!c) return Cesium.Color.WHITE;
  return new Cesium.Color(c.r, c.g, c.b, c.a !== undefined ? c.a : 1);
}

// ============================================================
// BACKEND: serializeEntity() convierte una entidad Cesium a JSON
// para guardarlo en localStorage. Con backend desaparece —
// cada entidad se guarda directamente al crearla via POST.
// El "serializado" equivalente es el body que se manda a la API:
//   lat/lng → latitud/longitud
//   polygonPoints → geometria (GeoJSON Polygon)
//   polylinePoints → geometria (GeoJSON LineString)
//   name → nombre
//   type → tipo_poi / tipo_estructura
// ============================================================
export function serializeEntity(ent) {
  const type = ent.properties?.tacticalType?.getValue?.() || ent.properties?.tacticalType || "unknown";
  const data = { type, name: ent.name || "" };

  // Position (for point-based entities)
  if (ent.position) {
    try {
      const pos = cartesianToLatLng(ent.position.getValue(Cesium.JulianDate.now()));
      data.lat = pos.lat;
      data.lng = pos.lng;
    } catch { }
  }

  // Billboard (for icons: mil-dropped, poi with icon, building)
  if (ent.billboard) {
    try {
      data.image = ent.billboard.image?.getValue?.(Cesium.JulianDate.now()) || ent.billboard.image;
      data.scale = ent.billboard.scale?.getValue?.(Cesium.JulianDate.now()) || ent.billboard.scale || 0.08;
    } catch { }
  }

  // Point (for basic POI)
  if (ent.point) {
    try {
      data.pixelSize = ent.point.pixelSize?.getValue?.(Cesium.JulianDate.now()) || 10;
      const c = ent.point.color?.getValue?.(Cesium.JulianDate.now());
      if (c) data.pointColor = { r: c.red, g: c.green, b: c.blue, a: c.alpha };
    } catch { }
  }

  // Label
  if (ent.label) {
    try {
      data.labelText = ent.label.text?.getValue?.(Cesium.JulianDate.now()) || ent.label.text || "";
      const fc = ent.label.fillColor?.getValue?.(Cesium.JulianDate.now());
      if (fc) data.labelColor = { r: fc.red, g: fc.green, b: fc.blue, a: fc.alpha };
    } catch { }
  }

  // Ellipse (circle)
  if (ent.ellipse) {
    try {
      data.semiMajorAxis = ent.ellipse.semiMajorAxis?.getValue?.(Cesium.JulianDate.now()) || 5000;
      const mat = ent.ellipse.material?.getValue?.(Cesium.JulianDate.now());
      if (mat?.color) data.fillColor = { r: mat.color.red, g: mat.color.green, b: mat.color.blue, a: mat.color.alpha };
      const oc = ent.ellipse.outlineColor?.getValue?.(Cesium.JulianDate.now());
      if (oc) data.outlineColor = { r: oc.red, g: oc.green, b: oc.blue, a: oc.alpha };
    } catch { }
  }

  // Polygon
  if (ent.polygon) {
    try {
      const h = ent.polygon.hierarchy?.getValue?.(Cesium.JulianDate.now());
      if (h) {
        data.polygonPoints = h.positions.map(p => cartesianToLatLng(p));
      }
      const mat = ent.polygon.material?.getValue?.(Cesium.JulianDate.now());
      if (mat?.color) data.fillColor = { r: mat.color.red, g: mat.color.green, b: mat.color.blue, a: mat.color.alpha };
    } catch { }
  }

  // Polyline (perimeter, polyline)
  if (ent.polyline) {
    try {
      const positions = ent.polyline.positions?.getValue?.(Cesium.JulianDate.now());
      if (positions) {
        data.polylinePoints = positions.map(p => cartesianToLatLng(p));
      }
      data.width = ent.polyline.width?.getValue?.(Cesium.JulianDate.now()) || 3;
      const mat = ent.polyline.material;
      if (mat) {
        const matVal = mat.getValue?.(Cesium.JulianDate.now());
        if (matVal?.color) data.lineColor = { r: matVal.color.red, g: matVal.color.green, b: matVal.color.blue, a: matVal.color.alpha };
        if (matVal?.dashLength) data.dashLength = matVal.dashLength;
      }
    } catch { }
  }

  return data;
}

// ============================================================
// BACKEND: saveTacticalData() guarda en localStorage hoy.
// Con backend cada tipo de entidad táctica se guarda en su
// endpoint correspondiente al crearse (no en un guardado bulk):
//   POI (punto, etiqueta, ícono mil) → POST /ops/:id/pois
//     body: { nombre, tipo_poi, latitud, longitud, descripcion }
//   Área (polígono, perímetro, círculo) → POST /ops/:id/areas
//     body: { nombre, geometria (GeoJSON), color }
//   Edificio/estructura → POST /ops/:id/edificios
//     body: { nombre, tipo_estructura, latitud, longitud }
// Al eliminar: DELETE /ops/:id/pois/:id_poi, etc.
// restoreTacticalData() se reemplaza por GET /ops/:id/mapa
// que devuelve todas las capas ya guardadas.
// ============================================================
export function autoSaveTacticalData() {
  const op = dashboardState.currentOperation;
  if (!op || !op.id) return;
  const phase = (op.phase || op.estado || "").toLowerCase();
  if (phase === "activa") {
    saveTacticalData();
  }
}

export function saveTacticalData() {
  const op = dashboardState.currentOperation;
  if (!op || !op.id) return;

  // Also serialize planning area
  let planningData = null;
  if (dashboardState.planningAreaFill) {
    try {
      const h = dashboardState.planningAreaFill.polygon.hierarchy.getValue(Cesium.JulianDate.now());
      planningData = { points: h.positions.map(p => cartesianToLatLng(p)) };
    } catch { }
  }

  // BACKEND: Para evitar que elementos ya eliminados reaparezcan cargados desde localStorage,
  // solo persistimos el área de planeación localmente. Los objetos tácticos (POIs, dibujos, áreas,
  // rutas, etc.) son gestionados en base de datos.
  const payload = { tactical: [], planningArea: planningData };
  localStorage.setItem(`tactical_data_${op.id}`, JSON.stringify(payload));
}

// BACKEND: restoreTacticalData() lee tactical_data de localStorage.
// Con backend se reemplaza por GET /ops/:id/mapa → data.capas[]
// que ya trae POIs, áreas y edificios listos para dibujar en Cesium.
export function restoreTacticalData() {
  const op = dashboardState.currentOperation;
  const viewer = dashboardState.viewer;
  if (!op || !op.id || !viewer) return;

  const raw = localStorage.getItem(`tactical_data_${op.id}`);
  if (!raw) return;

  let payload;
  try { payload = JSON.parse(raw); } catch { return; }

  // Restore planning area
  if (payload.planningArea?.points?.length >= 3) {
    const pts = payload.planningArea.points;
    const closed = [...pts, pts[0]];

    dashboardState.planningAreaFill = viewer.entities.add({
      name: "Área de planeación",
      polygon: {
        hierarchy: toCartesianArray(pts),
        material: Cesium.Color.WHITE.withAlpha(0.05),
        outline: false,
        perPositionHeight: false
      },
      properties: { tacticalType: "planning-area", draggable: false }
    });

    dashboardState.planningAreaBorder = viewer.entities.add({
      name: "Perímetro del área",
      polyline: {
        positions: toCartesianArray(closed),
        width: 3,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.BLACK.withAlpha(0.95),
          dashLength: 14
        }),
        clampToGround: true
      },
      properties: { tacticalType: "planning-area-border", draggable: false }
    });

    dashboardState.planningAreaLabel = viewer.entities.add({
      name: "Área de planeación",
      position: Cesium.Cartesian3.fromDegrees(pts[0].lng, pts[0].lat),
      label: {
        text: "Área de planeación",
        font: "14px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      },
      properties: { tacticalType: "planning-area-label", draggable: false }
    });
  }
}

export function restoreOneEntity(d) {
  const viewer = dashboardState.viewer;
  if (!viewer || !d?.type) return;

  if (d.type === "mil-dropped" && d.image && d.lat != null) {
    const ent = viewer.entities.add({
      name: d.name || d.labelText || "Símbolo MIL",
      position: Cesium.Cartesian3.fromDegrees(d.lng, d.lat),
      billboard: {
        image: d.image,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        scale: d.scale || 0.08
      },
      label: d.labelText ? {
        text: d.labelText,
        font: "14px sans-serif",
        pixelOffset: new Cesium.Cartesian2(0, 15),
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      } : undefined,
      properties: { tacticalType: "mil-dropped", draggable: true }
    });
    addTacticalEntity(ent);
    return;
  }

  if ((d.type === "poi" || d.type === "building") && d.lat != null) {
    const ent = viewer.entities.add({
      name: d.name || "Punto",
      position: Cesium.Cartesian3.fromDegrees(d.lng, d.lat),
      billboard: d.image ? {
        image: d.image,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        scale: d.scale || 0.08
      } : undefined,
      point: !d.image ? {
        pixelSize: d.pixelSize || 10,
        color: d.pointColor ? cesiumColorFromObj(d.pointColor) : Cesium.Color.RED,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      } : undefined,
      label: d.labelText ? {
        text: d.labelText,
        font: "14px sans-serif",
        pixelOffset: d.image ? new Cesium.Cartesian2(0, 15) : new Cesium.Cartesian2(0, -20),
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      } : undefined,
      properties: { tacticalType: d.type, draggable: true }
    });
    addTacticalEntity(ent);
    return;
  }

  if (d.type === "label" && d.lat != null) {
    const ent = viewer.entities.add({
      name: d.name || d.labelText || "Etiqueta",
      position: Cesium.Cartesian3.fromDegrees(d.lng, d.lat),
      label: {
        text: d.labelText || "Etiqueta",
        font: "16px sans-serif",
        fillColor: d.labelColor ? cesiumColorFromObj(d.labelColor) : Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      },
      properties: { tacticalType: "label", draggable: true }
    });
    addTacticalEntity(ent);
    return;
  }

  if (d.type === "circle" && d.lat != null) {
    const fill = d.fillColor ? cesiumColorFromObj(d.fillColor) : Cesium.Color.RED.withAlpha(0.35);
    const outline = d.outlineColor ? cesiumColorFromObj(d.outlineColor) : Cesium.Color.RED;
    const ent = viewer.entities.add({
      name: d.name || "Círculo táctico",
      position: Cesium.Cartesian3.fromDegrees(d.lng, d.lat),
      ellipse: {
        semiMajorAxis: d.semiMajorAxis || 5000,
        semiMinorAxis: d.semiMajorAxis || 5000,
        material: fill,
        outline: true,
        outlineColor: outline,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      },
      label: d.labelText ? {
        text: d.labelText,
        font: "14px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      } : undefined,
      properties: { tacticalType: "circle", draggable: true }
    });
    addTacticalEntity(ent);
    return;
  }

  if (d.type === "polygon" && d.polygonPoints) {
    const fill = d.fillColor ? cesiumColorFromObj(d.fillColor) : Cesium.Color.RED.withAlpha(0.35);
    const ent = viewer.entities.add({
      name: d.name || "Polígono táctico",
      polygon: {
        hierarchy: toCartesianArray(d.polygonPoints),
        material: fill,
        outline: true,
        outlineColor: fill.withAlpha(1),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        perPositionHeight: false
      },
      properties: { tacticalType: "polygon", draggable: false }
    });
    addTacticalEntity(ent);
    return;
  }

  if ((d.type === "perimeter" || d.type === "polyline") && d.polylinePoints) {
    const color = d.lineColor ? cesiumColorFromObj(d.lineColor) : Cesium.Color.RED;
    const mat = d.dashLength
      ? new Cesium.PolylineDashMaterialProperty({ color, dashLength: d.dashLength })
      : color;
    const ent = viewer.entities.add({
      name: d.name || (d.type === "perimeter" ? "Perímetro punteado" : "Línea táctica"),
      polyline: {
        positions: toCartesianArray(d.polylinePoints),
        width: d.width || 3,
        material: mat,
        clampToGround: true
      },
      properties: { tacticalType: d.type, draggable: false }
    });
    addTacticalEntity(ent);
  }
}
