// js/dashboard/dashboard.area.js

import { dashboardState } from "./dashboard.state.js";
import { dom } from "./dashboard.dom.js";
import { toCartesianArray, setTacticalUI } from "./dashboard.tactical.js";

export function clearAreaVertices() {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  dashboardState.areaVertexEntities.forEach(ent => viewer.entities.remove(ent));
  dashboardState.areaVertexEntities = [];
}

export function addAreaVertex(lat, lng, index) {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  const ent = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lng, lat),
    point: {
      pixelSize: 10,
      color: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    },
    label: {
      text: `${index + 1}`,
      font: "12px sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -18),
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    }
  });

  dashboardState.areaVertexEntities.push(ent);
}

export function clearPlanningArea() {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  if (dashboardState.planningAreaFill) {
    viewer.entities.remove(dashboardState.planningAreaFill);
  }
  if (dashboardState.planningAreaBorder) {
    viewer.entities.remove(dashboardState.planningAreaBorder);
  }
  if (dashboardState.planningAreaLabel) {
    viewer.entities.remove(dashboardState.planningAreaLabel);
  }
  if (dashboardState.areaPreviewLine) {
    viewer.entities.remove(dashboardState.areaPreviewLine);
  }

  dashboardState.planningAreaFill = null;
  dashboardState.planningAreaBorder = null;
  dashboardState.planningAreaLabel = null;
  dashboardState.areaPreviewLine = null;

  dashboardState.areaMode = false;
  dashboardState.areaDrawing = false;
  dashboardState.areaPoints = [];

  clearAreaVertices();

  if (dom.markAreaBtn) dom.markAreaBtn.textContent = "Marcar área";
  if (dom.areaInfo) dom.areaInfo.textContent = "Área de planeación eliminada.";

  setTacticalUI();
}

export function startAreaDrawing() {
  clearPlanningArea();

  dashboardState.areaMode = true;
  dashboardState.areaDrawing = true;
  dashboardState.areaPoints = [];

  if (dom.markAreaBtn) dom.markAreaBtn.textContent = "Marcando...";
  if (dom.areaInfo) {
    dom.areaInfo.textContent =
      "Haz clic para colocar puntos del área. Usa 'Terminar figura' para cerrar el perímetro.";
  }

  setTacticalUI();
}

export function updateAreaPreview(currentLat, currentLng) {
  const viewer = dashboardState.viewer;
  if (!viewer || dashboardState.areaPoints.length === 0) return;

  const previewPoints = [
    ...dashboardState.areaPoints,
    { lat: currentLat, lng: currentLng }
  ];

  const positions = toCartesianArray(previewPoints);

  if (dashboardState.areaPreviewLine) {
    viewer.entities.remove(dashboardState.areaPreviewLine);
  }

  dashboardState.areaPreviewLine = viewer.entities.add({
    polyline: {
      positions,
      width: 2,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.YELLOW,
        dashLength: 12
      }),
      clampToGround: true
    }
  });
}

export function finishPlanningAreaByPoints() {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  if (dashboardState.areaPoints.length < 3) {
    if (dom.areaInfo) {
      dom.areaInfo.textContent = "Debes marcar al menos 3 puntos para formar el área.";
    }
    return;
  }

  if (dashboardState.areaPreviewLine) {
    viewer.entities.remove(dashboardState.areaPreviewLine);
    dashboardState.areaPreviewLine = null;
  }

  const polygonPoints = [...dashboardState.areaPoints];
  const closedPoints = [...dashboardState.areaPoints, dashboardState.areaPoints[0]];

  dashboardState.planningAreaFill = viewer.entities.add({
    name: "Área de planeación",
    polygon: {
      hierarchy: toCartesianArray(polygonPoints),
      material: Cesium.Color.WHITE.withAlpha(0.05),
      outline: false,
      perPositionHeight: false
    },
    properties: {
      tacticalType: "planning-area",
      draggable: false
    }
  });

  dashboardState.planningAreaBorder = viewer.entities.add({
    name: "Perímetro del área",
    polyline: {
      positions: toCartesianArray(closedPoints),
      width: 3,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.BLACK.withAlpha(0.95),
        dashLength: 14
      }),
      clampToGround: true
    },
    properties: {
      tacticalType: "planning-area-border",
      draggable: false
    }
  });

  const center = dashboardState.areaPoints[0];

  dashboardState.planningAreaLabel = viewer.entities.add({
    name: "Área de planeación",
    position: Cesium.Cartesian3.fromDegrees(center.lng, center.lat),
    label: {
      text: "Área de planeación",
      font: "14px sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 4,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    },
    properties: {
      tacticalType: "planning-area-label",
      draggable: false
    }
  });

  dashboardState.areaMode = false;
  dashboardState.areaDrawing = false;

  if (dom.markAreaBtn) dom.markAreaBtn.textContent = "Marcar área";
  if (dom.areaInfo) dom.areaInfo.textContent = "Área delimitada correctamente por puntos.";

  setTacticalUI();
}

export function bindAreaEvents() {
  if (dom.markAreaBtn) {
    dom.markAreaBtn.addEventListener("click", () => {
      if (dashboardState.areaDrawing) {
        clearPlanningArea();
        if (dom.areaInfo) dom.areaInfo.textContent = "Marcado de área cancelado.";
        return;
      }

      dashboardState.pickMode = null;
      dashboardState.placingMode = false;
      startAreaDrawing();
    });
  }

  if (dom.clearAreaBtn) {
    dom.clearAreaBtn.addEventListener("click", clearPlanningArea);
  }
}
