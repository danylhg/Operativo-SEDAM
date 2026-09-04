// js/dashboard/dashboard.state.js

export const dashboardState = {
  viewer: null,
  baseLayerKey: "hybrid",

  pickMode: null,
  startPoint: null,
  endPoint: null,
  lastRoute: null,

  startEntity: null,
  endEntity: null,
  routeEntity: null,

  areaMode: false,
  areaDrawing: false,
  areaPoints: [],
  areaVertexEntities: [],
  areaPreviewLine: null,
  planningAreaFill: null,
  planningAreaBorder: null,
  planningAreaLabel: null,
  operationZoneBorder: null,
  currentOperationZone: null,
  gridEntities: [],
  gridQuadrants: [],

  selectedEntity: null,
  draggingEntity: null,
  dragStartPosition: null,
  isDragging: false,

  tacticalEntities: [],
  placingMode: false,
  toolMode: "none",
  drawingPoints: [],
  drawingVertexEntities: [],
  tacticalPreviewLine: null,
  tacticalPreviewFill: null,

  // Freehand drawing
  drawingMode: null,        // "pencil" | "eraser" | null
  drawingEntities: [],      // freehand polyline entities

  currentChatChannel: "cet",
  mediaRecorder: null,
  audioChunks: [],

  // Rutas en tiempo real
  lastRouteId: null,              // id_ruta guardado en DB para la ruta activa del selector
  selectedRemoteRouteId: null,    // id_ruta de la ruta remota seleccionada en el mapa
  remoteRouteEntities: new Map(), // id_ruta → { ruta, entities: [cesiumEntity, ...] }
  trackingEntities: new Map(),    // "P:id_personal" | "V:id_vehiculo" → cesiumEntity
  trackingHeadingEntities: new Map(), // "P:id" | "V:id" | "E:id" | "D:id" → rumbo visual
  trackingDeviceLatest: new Map(), // "D:id" → último tracking recibido del dispositivo
  requestedDeviceTrackingKeys: new Set(), // dispositivos visibles por solicitud explícita
  trackingHistory: new Map(),     // "P:id" | "V:id" → { lat, lng, time, speed, bearing }
  trackingClusters: new Map(),    // "V:id" → Set(["P:id1", "P:id2"])
  followedTrackingKey: null,
  followedPersonalId: null,
  followedPersonalZoom: 800
};
