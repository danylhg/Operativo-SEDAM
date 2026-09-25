// js/dashboard/dashboard.map.js

import { dashboardState } from "./dashboard.state.js";
import { dom } from "./dashboard.dom.js";
import { getVehicleOccupants } from "./dashboard.tracking.clustering.js";
import { getCurrentOperation } from "./dashboard.storage.js";
import { updateSelectionInfo, setRouteInfo, showPersonnelDetail } from "./dashboard.ui.js?v=20260923-draggable-person-popup";
import {
  handleTacticalPlacement,
  updateTacticalPreview,
  isDraggableEntity,
  createMilSymbol,
  persistDraggedEntity,
  renderMilSymbolImage,
  openPointObjectEdit,
  openGeoMsgEditModal,
  updateGeoMsg,
  deleteGeoMsg,
  setGeoMsgVisibility
} from "./dashboard.tactical.js?v=20260923-geo-msg-edit-modal";
import { addAreaVertex, updateAreaPreview } from "./dashboard.area.js";
import { cartesianToLatLng, autoSaveTacticalData } from "./dashboard.persistence.js";
import { configureGoogleLikeCamera } from "../map.camera.js?v=20260723-map-data-safe-zoom";
import { clearEmbeddedCamera, renderEquipmentLiveCamera } from "./dashboard.camera.js?v=20260922-person-camera-stream";
import {
  persistRouteDataToCurrentOperation,
  autoCalcRoute,
  loadRouteForSelectedVehicle,
  clearRoute,
  applyRouteFilter,
  selectRemoteRoute,
  getRouteIdForEntity,
  deleteRemoteRouteById
} from "./dashboard.routes.js?v=20260922-route-syntax-fix-2";

const logAlert = (message) => {
  if (message) console.warn(message);
};

const providers = {
  osm: () => new Cesium.UrlTemplateImageryProvider({
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maximumLevel: 19,
    credit: "OpenStreetMap"
  }),
  satellite: () => new Cesium.UrlTemplateImageryProvider({
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 19,
    credit: "Esri World Imagery"
  }),
  reference: () => new Cesium.UrlTemplateImageryProvider({
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    maximumLevel: 19,
    credit: "Esri Reference"
  })
};

const BASE_LAYER_LABELS = {
  osm: "Normal",
  satellite: "Satélite",
  hybrid: "Híbrida"
};

function updateLayerControl(key) {
  const layerKey = BASE_LAYER_LABELS[key] ? key : "satellite";

  document.querySelectorAll("[data-map-layer]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mapLayer === layerKey);
  });
}

function addImageryLayer(providerFactory, options = {}) {
  const viewer = dashboardState.viewer;
  if (!viewer) return null;

  const provider = providerFactory();
  let failed = false;
  provider.errorEvent?.addEventListener?.((error) => {
    if (failed || options.fallback === false) return;
    failed = true;
    console.warn("[MAP] Capa de mapa no disponible, usando mapa normal:", error?.message || error);
    if (dashboardState.baseLayerKey !== "osm") setBaseLayer("osm", { fallback: false });
  });

  const layer = viewer.imageryLayers.addImageryProvider(provider);
  viewer.scene?.requestRender?.();
  return layer;
}

export class OpenStreetMapNominatimGeocoder {
  constructor() {
    this._credit = undefined;
  }

  get credit() {
    return this._credit;
  }

  async geocode(input) {
    const query = String(input || "").trim();
    if (!query) return [];

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=5`;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) return [];

      const results = await response.json();

      return results.map((item) => {
        const south = parseFloat(item.boundingbox[0]);
        const north = parseFloat(item.boundingbox[1]);
        const west = parseFloat(item.boundingbox[2]);
        const east = parseFloat(item.boundingbox[3]);

        return {
          displayName: item.display_name,
          destination: Cesium.Rectangle.fromDegrees(west, south, east, north)
        };
      });
    } catch {
      return [];
    }
  }
}

export function getMapClickPosition(screenPosition) {
  const viewer = dashboardState.viewer;
  if (!viewer) return null;

  const scene = viewer.scene;
  let cartesian = null;

  if (scene.pickPositionSupported) {
    cartesian = scene.pickPosition(screenPosition);
  }

  if (!cartesian) {
    cartesian = viewer.camera.pickEllipsoid(screenPosition, scene.globe.ellipsoid);
  }

  return cartesian;
}

export function setBaseLayer(key, options = {}) {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  dashboardState.baseLayerKey = key;
  updateLayerControl(key);
  viewer.imageryLayers.removeAll();

  if (key === "hybrid") {
    addImageryLayer(providers.osm, { fallback: false });
    const satelliteLayer = addImageryLayer(providers.satellite, options);
    if (!satelliteLayer) return;
    satelliteLayer.brightness = 0.78;
    satelliteLayer.contrast = 1.35;
    satelliteLayer.saturation = 1.15;
    satelliteLayer.gamma = 0.9;

    const referenceOverlay = addImageryLayer(providers.reference, options);
    if (referenceOverlay) referenceOverlay.alpha = 0.78;
    return;
  }

  const createProvider = providers[key] || providers.satellite;
  if (key === "satellite" || !providers[key]) {
    addImageryLayer(providers.osm, { fallback: false });
  }
  const layer = addImageryLayer(createProvider, options);
  if (!layer) return;
  if (key === "satellite" || !providers[key]) {
    layer.brightness = 0.78;
    layer.contrast = 1.35;
    layer.saturation = 1.15;
    layer.gamma = 0.9;
  }
}

function getEntityProperty(entity, key) {
  const value = entity?.properties?.[key];
  return value?.getValue?.(Cesium.JulianDate.now()) ?? value ?? "";
}

function isSelectableEntity(entity) {
  if (!entity) return false;
  const tacticalType = String(getEntityProperty(entity, "tacticalType"));
  return !["grid-part", "tracking-heading"].includes(tacticalType);
}

function getSelectablePickedEntity(position) {
  const viewer = dashboardState.viewer;
  if (!viewer) return null;

  const pickedItems = viewer.scene.drillPick?.(position, 12) || [];
  for (const picked of pickedItems) {
    if (picked?.id && isSelectableEntity(picked.id)) return picked.id;
  }

  const picked = viewer.scene.pick(position);
  return picked?.id && isSelectableEntity(picked.id) ? picked.id : null;
}

function getQuickMenuContext(entity) {
  const trackingKey = String(getEntityProperty(entity, "trackingKey") || "");
  if (!trackingKey) return null;

  if (trackingKey.startsWith("V:")) {
    return {
      type: "vehiculo",
      label: "Vehiculo",
      name: entity.name || "Vehiculo",
      actions: [
        { slot: "chat", kind: "vehiculo", text: "Mandar mensaje" },
        { slot: "route", kind: "ruta", text: "Ver ruta" }
      ]
    };
  }

  if (trackingKey.startsWith("P:")) {
    const role = String(getEntityProperty(entity, "trackingRole") || "").toUpperCase();
    if (!["CET", "CELL"].includes(role)) return null;

    const actions = role === "CET"
      ? [
        { slot: "chat", kind: "cet", text: "Mandar mensaje a CET" },
        { slot: "alert", kind: "flotilla", text: "Mandar mensaje a flotilla" },
        { slot: "route", kind: "ruta", text: "Ver ruta" }
      ]
      : [
        { slot: "chat", kind: "flotilla", text: "Mandar mensaje a flotilla" },
        { slot: "alert", kind: "grupo", text: "Mandar mensaje a grupo" },
        { slot: "route", kind: "ruta", text: "Ver ruta" }
      ];

    return {
      type: role,
      label: role,
      name: entity.name || role,
      actions
    };
  }

  if (trackingKey.startsWith("E:")) {
    const liveData = getEntityProperty(entity, "liveData") || {};
    const droneText = [
      entity.name,
      getEntityProperty(entity, "trackingRole"),
      liveData.nombre,
      liveData.categoria,
      liveData.tipo_equipo,
      liveData.marca,
      liveData.modelo
    ].filter(Boolean).join(" ");
    if (!/(dron|drone|uav|vant)/i.test(droneText)) return null;

    return {
      type: "dron",
      label: "Dron",
      name: entity.name || liveData.nombre || "Dron",
      actions: []
    };
  }

  return null;
}

function getEntityLatLng(entity) {
  const position = entity?.position?.getValue?.(Cesium.JulianDate.now()) ?? entity?.position;
  if (!position) return {};

  const cartographic = Cesium.Cartographic.fromCartesian(position);
  if (!cartographic) return {};

  return {
    lat: Cesium.Math.toDegrees(cartographic.latitude),
    lng: Cesium.Math.toDegrees(cartographic.longitude)
  };
}

function showQuickMenuForEntity(entity, clickPosition) {
  const context = getQuickMenuContext(entity);
  if (!dom.vehicleQuickMenu) return false;

  if (!context) {
    clearEmbeddedCamera(document.getElementById("droneQuickMenuCamera"));
    dom.vehicleQuickMenu.style.display = "none";
    return false;
  }

  if (dom.vehicleQuickMenuName) {
    dom.vehicleQuickMenuName.textContent = `${context.name} (${context.label})`;
  }

  const trackingKey = String(getEntityProperty(entity, "trackingKey") || "");
  const occupantsContainer = document.getElementById("vehicleQuickMenuOccupants");
  const occupantsList = document.getElementById("vehicleQuickMenuOccupantsList");
  const detailsContainer = document.getElementById("vehicleQuickMenuDetails");
  const droneInfo = document.getElementById("droneQuickMenuInfo");
  const droneCamera = document.getElementById("droneQuickMenuCamera");
  if (occupantsContainer && occupantsList) {
    if (context.type === "vehiculo") {
      const bdData = getCurrentOperation() || {};
      const personas = Array.isArray(bdData.personal) ? bdData.personal : [];
      const vehicleId = trackingKey.replace(/^V:/, "");
      const assignedOccupants = (Array.isArray(bdData.vehiculos) ? bdData.vehiculos : [])
        .filter((vehicle) => String(vehicle.id_vehiculo ?? vehicle.id ?? "") === vehicleId)
        .map((vehicle) => vehicle.id_personal)
        .filter((id) => id != null)
        .map((id) => `P:${id}`);
      const occupants = [...new Set([...getVehicleOccupants(trackingKey), ...assignedOccupants])];
      const occupantsNames = occupants.map(occId => {
        const id = occId.split(":")[1];
        const p = personas.find(x => String(x.id_personal) === String(id));
        if (p) {
          const fullName = [p.nombre, p.apellido]
            .map((part) => String(part || "").trim())
            .filter(Boolean)
            .join(" ");
          return fullName || String(p.nombre_completo || p.apodo || "").trim() || `Personal ${id}`;
        }
        return occId;
      });

      occupantsList.replaceChildren();
      if (occupantsNames.length > 0) {
        occupantsNames.forEach((name, index) => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "vehicleQuickMenuOccupant";
          const avatar = document.createElement("span");
          avatar.className = "vehicleQuickMenuOccupantAvatar";
          avatar.textContent = String(name || "P").trim().charAt(0).toUpperCase() || "P";
          const label = document.createElement("span");
          label.textContent = name;
          item.append(avatar, label);
          item.addEventListener("click", (event) => {
            const personKey = occupants[index];
            const personEntity = dashboardState.trackingEntities.get(personKey);
            event.stopPropagation();
            dashboardState.selectedEntity = personEntity || null;
            const menuRect = dom.vehicleQuickMenu.getBoundingClientRect();
            const personPopupWidth = Math.min(318, window.innerWidth - 28);
            const fitsOnRight = menuRect.right + personPopupWidth + 24 <= window.innerWidth;
            const personPopupLeft = fitsOnRight
              ? menuRect.right + 12
              : Math.max(12, menuRect.left - personPopupWidth - 12);
            showPersonnelDetail(personKey.replace(/^P:/, ""), {
              x: personPopupLeft + personPopupWidth / 2,
              y: menuRect.top + 235,
              name,
              ...(personEntity ? getEntityLatLng(personEntity) : {})
            });
          });
          occupantsList.appendChild(item);
        });
        occupantsContainer.style.display = "block";
      } else {
        occupantsList.innerHTML = '<div style="color:#94a3b8; font-size:10px;">Sin tripulación detectada.</div>';
        occupantsContainer.style.display = "block";
      }
    } else {
      occupantsContainer.style.display = "none";
    }
  }

  if (detailsContainer && droneInfo && droneCamera) {
    clearEmbeddedCamera(droneCamera);
    droneInfo.replaceChildren();
    if (context.type === "dron") {
      const equipmentId = trackingKey.replace(/^E:/, "");
      const operation = getCurrentOperation() || {};
      const liveData = getEntityProperty(entity, "liveData") || {};
      const equipment = (Array.isArray(operation.equipos) ? operation.equipos : [])
        .find((item) => String(item.id_equipo ?? item.id ?? "") === equipmentId) || {};
      const data = { ...equipment, ...liveData };
      const coords = getEntityLatLng(entity);
      const assignedPersonId = data.ueo_id_personal ?? data.id_personal_asignado ?? data.id_personal ?? data.personal_id;
      const assignedPerson = (Array.isArray(operation.personal) ? operation.personal : [])
        .find((person) => String(person.id_personal ?? person.id ?? "") === String(assignedPersonId ?? ""));
      const assignedPersonName = assignedPerson
        ? [assignedPerson.nombre, assignedPerson.apellido].filter(Boolean).join(" ")
          || assignedPerson.nombre_completo
          || assignedPerson.apodo
        : "";
      const assignedTo = data.asignado_a_personal
        || assignedPersonName
        || data.asignado_a_vehiculo
        || data.vehiculo_alias
        || data.grupo_asignado
        || data.flotilla_asignada
        || "Sin asignar";
      const rows = [
        ["Modelo", [data.marca, data.modelo].filter(Boolean).join(" ") || data.tipo_equipo || "No registrado"],
        ["Serie", data.numero_serie || data.external_device_id || "No registrada"],
        ["Asignado a", assignedTo],
        ["Posici\u00f3n", Number.isFinite(coords.lat) && Number.isFinite(coords.lng)
          ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`
          : "Sin ubicaci\u00f3n"]
      ];
      rows.forEach(([label, value]) => {
        const row = document.createElement("div");
        row.className = "vehicleQuickMenuDetailRow";
        const key = document.createElement("span");
        key.textContent = label;
        const content = document.createElement("strong");
        content.textContent = String(value);
        row.append(key, content);
        droneInfo.appendChild(row);
      });
      detailsContainer.style.display = "grid";
      dom.vehicleQuickMenu.dataset.equipmentId = equipmentId;
      void renderEquipmentLiveCamera(droneCamera, equipmentId, context.name);
    } else {
      detailsContainer.style.display = "none";
      dom.vehicleQuickMenu.dataset.equipmentId = "";
    }
  }

  const buttons = {
    chat: dom.btnVehQuickChat,
    alert: dom.btnVehQuickAlert,
    route: dom.btnVehQuickRoute
  };

  Object.values(buttons).forEach((button) => {
    if (!button) return;
    button.style.display = "none";
    button.dataset.actionKind = "";
  });

  context.actions.forEach((action) => {
    const button = buttons[action.slot];
    if (!button) return;
    button.textContent = action.text;
    button.dataset.actionKind = action.kind;
    button.style.display = "block";
  });

  dom.vehicleQuickMenu.dataset.contextType = context.type;

  const viewer = dashboardState.viewer;
  const rect = viewer.canvas.getBoundingClientRect();
  const x = clickPosition.x + rect.left + 15;
  const y = clickPosition.y + rect.top - 20;

  dom.vehicleQuickMenu.style.left = `${Math.min(x, window.innerWidth - 294)}px`;
  dom.vehicleQuickMenu.style.top = `${Math.max(y - 30, rect.top + 10)}px`;
  dom.vehicleQuickMenu.style.display = "block";
  return true;
}

function dispatchEntityChat(actionKind) {
  const selected = dashboardState.selectedEntity;
  if (!selected) return;

  const entityName = selected.name || dom.vehicleQuickMenuName?.textContent || "Elemento";
  const contextType = dom.vehicleQuickMenu?.dataset.contextType || "";

  document.dispatchEvent(new CustomEvent("openEntityChat", {
    detail: {
      entityName,
      contextType,
      target: actionKind,
      trackingKey: getEntityProperty(selected, "trackingKey"),
      role: getEntityProperty(selected, "trackingRole")
    }
  }));

  if (actionKind === "vehiculo") {
    document.dispatchEvent(new CustomEvent("openVehicleChat", { detail: { vehicleName: entityName } }));
  }

  if (dom.vehicleQuickMenu) dom.vehicleQuickMenu.style.display = "none";
}

function openSelectedEntityRoute() {
  const selected = dashboardState.selectedEntity;
  if (!selected) return;

  const trackingKey = getEntityProperty(selected, "trackingKey");
  if (trackingKey) {
    const id = String(trackingKey).split(":")[1];
    if (id) {
      let assignedRouteId = null;
      for (const [id_ruta, entry] of dashboardState.remoteRouteEntities.entries()) {
        if (String(entry.ruta.id_vehiculo) === String(id)) {
          assignedRouteId = id_ruta;
          break;
        }
      }

      if (assignedRouteId) {
        const selectEl = document.getElementById("routeVehicleSelect");
        if (selectEl) {
          selectEl.value = String(id);
        }
        selectRemoteRoute(assignedRouteId);
      } else {
        alert("No hay ruta asignada a este vehículo.");
      }
    }
  }

  if (dom.vehicleQuickMenu) dom.vehicleQuickMenu.style.display = "none";
}

function getRoutePopupName(routeId) {
  const entry = dashboardState.remoteRouteEntities.get(routeId);
  const ruta = entry?.ruta || {};
  if (ruta.nombre) return ruta.nombre;
  if (ruta.id_vehiculo != null) {
    const selectEl = document.getElementById("routeVehicleSelect");
    const option = [...(selectEl?.options || [])].find((opt) => String(opt.value) === String(ruta.id_vehiculo));
    const vehicleName = option?.textContent?.replace(/^Vehiculo:\s*/i, "").trim();
    return vehicleName ? `Ruta: ${vehicleName}` : "Ruta de vehiculo";
  }
  return "Ruta General";
}

function showRouteDeletePopup(routeId, clickPosition) {
  const viewer = dashboardState.viewer;
  if (!viewer || !dom.entityPopup) return;

  dom.entityPopup.classList.remove("geoMsgPopup");
  dom.entityPopup.querySelector(".geoMsgDetails")?.remove();

  dashboardState.selectedEntity = null;
  updateSelectionInfo(null);
  dom.personInfoPopup?.classList.add("hidden");
  if (dom.vehicleQuickMenu) dom.vehicleQuickMenu.style.display = "none";

  const route = dashboardState.remoteRouteEntities.get(routeId)?.ruta || {};
  if (dom.entityPopupName) dom.entityPopupName.textContent = getRoutePopupName(routeId);
  if (dom.entityPopupDelete) {
    dom.entityPopupDelete.textContent = "Eliminar ruta";
    dom.entityPopupDelete.style.display = isRouteOwnedByCurrentUser(route) ? "block" : "none";
  }
  const author = [
    abbreviateRank(route.creador_puesto || route.routeCreatorRank || route.cargo),
    route.creador_nombre || route.routeCreator || ""
  ].filter(Boolean).join(" ");
  setEntityPopupCreator(author);
  const creator = dom.entityPopup.querySelector(".entityPopupCreator");
  if (creator?.textContent) creator.textContent = creator.textContent.replace(/^Colocado por:/, "Creada por:");

  let details = dom.entityPopup.querySelector(".routePopupDetails");
  if (!details) {
    details = document.createElement("div");
    details.className = "routePopupDetails";
    dom.entityPopup.insertBefore(details, dom.entityPopupDelete);
  }
  const distance = Number(route.distancia_m || route.distance || 0);
  const duration = Number(route.duracion_s || route.duration || 0);
  const lat = Number(route.destino_lat ?? route.destination_lat);
  const lng = Number(route.destino_lon ?? route.destination_lon);
  const distanceText = distance > 0 ? `${(distance / 1000).toFixed(2)} km` : "No disponible";
  const durationMinutes = duration > 0 ? Math.max(1, Math.round(duration / 60)) : null;
  const durationText = durationMinutes == null
    ? "No disponible"
    : durationMinutes >= 60
      ? `${Math.floor(durationMinutes / 60)} h ${durationMinutes % 60} min`
      : `${durationMinutes} min`;
  const destinationText = Number.isFinite(lat) && Number.isFinite(lng)
    ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    : "No disponible";
  details.replaceChildren();
  [["Destino", destinationText], ["Distancia", distanceText], ["Duración", durationText]].forEach(([label, value]) => {
    const row = document.createElement("div");
    const key = document.createElement("span");
    const content = document.createElement("strong");
    key.textContent = label;
    content.textContent = value;
    row.append(key, content);
    details.appendChild(row);
  });

  dom.entityPopup.dataset.action = "delete-navigation-route";
  dom.entityPopup.dataset.routeId = String(routeId);

  const rect = viewer.canvas.getBoundingClientRect();
  const x = clickPosition.x + rect.left + 15;
  const y = clickPosition.y + rect.top - 20;

  dom.entityPopup.style.left = `${Math.min(x, window.innerWidth - 276)}px`;
  dom.entityPopup.style.top = `${Math.max(y - 70, rect.top + 10)}px`;
  dom.entityPopup.style.display = "block";
}

function getEntityCreatorName(entity) {
  const directName = String(
    getEntityProperty(entity, "creador_nombre") ||
    getEntityProperty(entity, "personal_nombre") ||
    getEntityProperty(entity, "usuario_nombre") ||
    ""
  ).trim();
  if (directName) return directName;

  const idPersonal = String(getEntityProperty(entity, "id_personal") || "").trim();
  if (idPersonal) {
    const personal = Array.isArray(getCurrentOperation()?.personal) ? getCurrentOperation().personal : [];
    const person = personal.find((item) => String(item.id_personal ?? item.id ?? "") === idPersonal);
    const name = [person?.apodo, [person?.nombre, person?.apellido].filter(Boolean).join(" ")]
      .find((value) => String(value || "").trim());
    if (name) return String(name).trim();
  }

  const idUsuario = String(getEntityProperty(entity, "id_usuario") || "").trim();
  if (idPersonal || idUsuario) {
    try {
      const userData = JSON.parse(localStorage.getItem("userData") || "{}");
      const samePersonal = idPersonal && String(userData.id_personal || "") === idPersonal;
      const sameUser = idUsuario && String(userData.id_usuario || "") === idUsuario;
      if (samePersonal || sameUser) {
        const localName = [
          userData.apodo,
          userData.username,
          [userData.nombre, userData.apellido].filter(Boolean).join(" ")
        ].find((value) => String(value || "").trim());
        if (localName) return String(localName).trim();
      }
    } catch { }
  }

  const creatorType = String(getEntityProperty(entity, "tipo_creador") || "").trim();
  if (creatorType) return creatorType;
  return "";
}

function setEntityPopupCreator(creatorName) {
  if (!dom.entityPopup) return;

  let creatorEl = dom.entityPopup.querySelector(".entityPopupCreator");
  if (!creatorEl) {
    creatorEl = document.createElement("div");
    creatorEl.className = "entityPopupCreator";
    const header = dom.entityPopup.firstElementChild;
    dom.entityPopup.insertBefore(creatorEl, dom.entityPopupDelete || header?.nextSibling || null);
  }

  const name = String(creatorName || "").trim();
  creatorEl.textContent = name ? `Colocado por: ${name}` : "";
  creatorEl.style.display = name ? "block" : "none";
}

function abbreviateRank(value) {
  let text = String(value || "").replace(/\s*\([^)]*\)/g, "").trim();
  const replacements = [
    [/\bCapit[aá]n\s+de\s+Nav[ií]o\b/gi, "Cap. Nav."],
    [/\bCapit[aá]n\s+de\s+Fragata\b/gi, "Cap. Frag."],
    [/\bCapit[aá]n\s+de\s+Corbeta\b/gi, "Cap. Corb."],
    [/\bCapit[aá]n\s+1(?:\/o|\.º|\.o|er|ro)?\b/gi, "Cap. 1/o"],
    [/\bCapit[aá]n\s+2(?:\/o|\.º|\.o|do|ndo)?\b/gi, "Cap. 2/o"],
    [/\bCapit[aá]n\b/gi, "Cap."],
    [/\bTeniente\s+de\s+Nav[ií]o\b/gi, "Tte. Nav."],
    [/\bTeniente\s+de\s+Fragata\b/gi, "Tte. Frag."],
    [/\bTeniente\s+de\s+Corbeta\b/gi, "Tte. Corb."],
    [/\bSubteniente\b/gi, "Subtte."],
    [/\bTeniente\b/gi, "Tte."],
    [/\bSargento\s+1(?:\/o|\.º|\.o|er|ro)?\b/gi, "Sgto. 1/o"],
    [/\bSargento\s+2(?:\/o|\.º|\.o|do|ndo)?\b/gi, "Sgto. 2/o"],
    [/\bSargento\b/gi, "Sgto."],
    [/\bCabo\b/gi, "Cbo."],
    [/\bMarinero\b/gi, "Mro."],
    [/\bSoldado\b/gi, "Sld."],
    [/\bGeneral\s+de\s+Divisi[oó]n\b/gi, "Gral. Div."],
    [/\bGeneral\s+de\s+Brigada\b/gi, "Gral. Bgda."],
    [/\bGeneral\s+Brigadier\b/gi, "Gral. Bgda."],
    [/\bGeneral\b/gi, "Gral."],
    [/\bVicealmirante\b/gi, "Valm."],
    [/\bContralmirante\b/gi, "Calm."],
    [/\bAlmirante\b/gi, "Alm."],
    [/\bCoronel\b/gi, "Cnel."],
    [/\bMayor\b/gi, "My."]
  ];
  replacements.forEach(([pattern, replacement]) => { text = text.replace(pattern, replacement); });
  return text.replace(/\b(CET|ADMIN|OPERADOR|USUARIO)\b\s*/gi, "").trim();
}

function isRouteOwnedByCurrentUser(route = {}) {
  let stored = {};
  let tokenPayload = {};
  try { stored = JSON.parse(localStorage.getItem("userData") || "{}"); } catch { }
  try {
    const token = localStorage.getItem("token") || "";
    tokenPayload = JSON.parse(atob(token.split(".")[1] || ""));
  } catch { }

  const table = String(tokenPayload.tabla || stored.tabla || "").toLowerCase();
  const currentPersonalId = tokenPayload.id_personal || stored.id_personal ||
    (table === "personal" ? tokenPayload.sub : null);
  const currentUserId = tokenPayload.id_usuario || stored.id_usuario ||
    (table === "usuario" ? tokenPayload.sub : null);
  const routePersonalId = route.id_personal ?? route.personal_id;
  const routeUserId = route.id_usuario ?? route.usuario_id;

  return (currentPersonalId != null && routePersonalId != null &&
      String(currentPersonalId) === String(routePersonalId)) ||
    (currentUserId != null && routeUserId != null &&
      String(currentUserId) === String(routeUserId));
}

function getEntityPopupName(entity) {
  const tacticalType = String(getEntityProperty(entity, "tacticalType") || "");
  if (tacticalType === "freehand-drawing") return "Dibujo";

  const trackingFullLabel = String(getEntityProperty(entity, "trackingFullLabel") || "");
  return entity?.name || trackingFullLabel || tacticalType || "Elemento tactico";
}

function isDeletePopupEntity(entity) {
  const trackingKey = String(getEntityProperty(entity, "trackingKey") || "");
  if (trackingKey.startsWith("P:")) return false;
  if (trackingKey.startsWith("E:") || trackingKey.startsWith("D:")) return true;

  const tacticalType = String(getEntityProperty(entity, "tacticalType") || "");
  return Boolean(tacticalType && !["planning-area", "planning-area-border", "planning-area-label"].includes(tacticalType));
}

function isWaypointOrTargetEntity(entity) {
  const poiId = getEntityProperty(entity, "id_poi");
  const sidc = String(getEntityProperty(entity, "sidc") || "");
  const tacticalType = String(getEntityProperty(entity, "tacticalType") || "");
  return Boolean(poiId && (/^[SG]/.test(sidc) || tacticalType === "mil-dropped" || tacticalType === "poi-heading"));
}

function isGeoMsgEntity(entity) {
  return String(getEntityProperty(entity, "tacticalType") || "") === "geomsg";
}

function isGeoMsgOwnedByCurrentUser(entity) {
  let user = {};
  try { user = JSON.parse(localStorage.getItem("userData") || "{}"); } catch { }
  const ownerIds = [
    getEntityProperty(entity, "id_personal_autor"),
    getEntityProperty(entity, "id_usuario_autor")
  ].filter((value) => value != null);
  const currentIds = [user.id_personal, user.id_usuario].filter((value) => value != null);
  return ownerIds.some((ownerId) => currentIds.some((currentId) => String(ownerId) === String(currentId)));
}

function showGeoMsgPopup(entity, clickPosition) {
  const viewer = dashboardState.viewer;
  if (!viewer || !dom.entityPopup) return false;
  const coords = getEntityLatLng(entity);
  const id = getEntityProperty(entity, "id_geo_msg");
  const isOwner = isGeoMsgOwnedByCurrentUser(entity);
  dom.entityPopup.classList.add("geoMsgPopup");
  dom.entityPopup.dataset.action = "geo-msg";
  dom.entityPopup.dataset.geoMsgId = String(id || "");
  dom.entityPopup.dataset.routeId = "";
  if (dom.entityPopupName) dom.entityPopupName.textContent = String(getEntityProperty(entity, "author") || "Usuario");
  setEntityPopupCreator("");
  dom.entityPopup.querySelector(".poiPopupDetails")?.remove();
  dom.entityPopup.querySelector(".routePopupDetails")?.remove();
  dom.entityPopup.querySelector(".geoMsgDetails")?.remove();
  const details = document.createElement("div");
  details.className = "geoMsgDetails";
  const message = document.createElement("div");
  message.className = "geoMsgText";
  message.textContent = String(getEntityProperty(entity, "text") || "");
  const coordinates = document.createElement("div");
  coordinates.className = "geoMsgCoordinates";
  coordinates.textContent = `LAT:  ${Number(coords.lat).toFixed(5)}   LON:  ${Number(coords.lng).toFixed(5)}`;
  details.append(message, coordinates);
  if (isOwner) {
    const visibility = document.createElement("label");
    visibility.className = "geoMsgVisibility";
    const visibilityLabel = document.createElement("span");
    const isPublic = String(getEntityProperty(entity, "visibilidad") || "PRIVADO").toUpperCase() === "PUBLICO";
    visibilityLabel.textContent = isPublic ? "Público" : "Privado";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "geoMsgVisibilityToggle";
    toggle.checked = isPublic;
    toggle.setAttribute("aria-label", "Cambiar privacidad del mensaje");
    visibility.append(visibilityLabel, toggle);
    details.append(visibility);
  }
  const actions = document.createElement("div");
  actions.className = "geoMsgActions";
  actions.innerHTML = '<button type="button" class="geoMsgEditButton" aria-label="Editar mensaje" title="Editar mensaje"><svg viewBox="0 0 24 24"><path d="m4 16.5-.7 4.2 4.2-.7L19 8.5 15.5 5 4 16.5Z"></path><path d="m14.5 6 3.5 3.5"></path></svg></button><button type="button" class="geoMsgDeleteButton" aria-label="Eliminar mensaje" title="Eliminar mensaje"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg></button>';
  details.append(actions);
  dom.entityPopup.insertBefore(details, dom.entityPopupDelete);
  if (dom.entityPopupDelete) dom.entityPopupDelete.style.display = "none";
  const rect = viewer.canvas.getBoundingClientRect();
  const x = clickPosition.x + rect.left;
  const y = clickPosition.y + rect.top;
  dom.entityPopup.style.left = `${Math.min(Math.max(x - 115, rect.left + 8), window.innerWidth - 250)}px`;
  dom.entityPopup.style.top = `${Math.max(y - 190, rect.top + 8)}px`;
  dom.entityPopup.style.display = "block";
  return true;
}

function isPoiOwnedByCurrentUser(entity) {
  let user = {};
  try { user = JSON.parse(localStorage.getItem("userData") || "{}"); } catch { }
  const creatorType = String(getEntityProperty(entity, "tipo_creador") || "").toUpperCase();
  const ownerId = creatorType === "PERSONAL"
    ? getEntityProperty(entity, "id_personal")
    : getEntityProperty(entity, "id_usuario");
  const currentId = creatorType === "PERSONAL" ? user.id_personal : user.id_usuario;
  return ownerId != null && currentId != null && String(ownerId) === String(currentId);
}

async function setPoiVisibility(entity, isPublic) {
  const poiId = Number(getEntityProperty(entity, "id_poi"));
  const opId = localStorage.getItem("active_operation_id");
  const token = localStorage.getItem("token");
  if (!poiId || !opId || !token || !isPoiOwnedByCurrentUser(entity)) return;
  const apiBase = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  const action = isPublic ? "publicar" : "privatizar";
  // El socket de privatización se entrega a toda la operación. Marcamos el
  // objeto propio antes de llamar al API para conservarlo en este cliente.
  if (!isPublic) entity._keepPrivateUntil = Date.now() + 8000;
  try {
    const res = await fetch(`${apiBase}/ops/${opId}/pois/${poiId}/${action}`, {
      method: "PATCH", headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) throw new Error(data?.mensaje || "No se pudo cambiar la visibilidad.");
    if (entity.properties?.visibilidad?.setValue) entity.properties.visibilidad.setValue(isPublic ? "PUBLICO" : "PRIVADO");
    else if (entity.properties) entity.properties.visibilidad = isPublic ? "PUBLICO" : "PRIVADO";
    const label = dom.entityPopup?.querySelector(".poiPopupVisibility > span");
    if (label) label.textContent = isPublic ? "Público" : "Privado";
  } catch (err) {
    delete entity._keepPrivateUntil;
    alert(err.message || "No se pudo cambiar la visibilidad.");
  }
}

async function editPoiName(entity) {
  const currentName = getEntityPopupName(entity);
  const name = window.prompt("Nombre del waypoint", currentName);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed || trimmed === currentName) return;
  const poiId = Number(getEntityProperty(entity, "id_poi"));
  const opId = localStorage.getItem("active_operation_id");
  const token = localStorage.getItem("token");
  const apiBase = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;
  try {
    const res = await fetch(`${apiBase}/ops/${opId}/pois/${poiId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nombre: trimmed })
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) throw new Error(data?.mensaje || "No se pudo editar el waypoint.");
    entity.name = trimmed;
    if (entity.label?.text?.setValue) entity.label.text.setValue(trimmed);
    else if (entity.label) entity.label.text = trimmed;
    if (dom.entityPopupName) dom.entityPopupName.textContent = trimmed;
  } catch (err) {
    alert(err.message || "No se pudo editar el waypoint.");
  }
}

function showPoiInfoPopup(entity, clickPosition) {
  const viewer = dashboardState.viewer;
  if (!viewer || !dom.entityPopup) return false;
  dom.entityPopup.classList.remove("geoMsgPopup");
  dom.entityPopup.querySelector(".geoMsgDetails")?.remove();
  entity.show = true;
  const headingArrow = viewer.entities.getById(`${entity.id}_heading`);
  if (headingArrow) headingArrow.show = true;
  const isOwner = isPoiOwnedByCurrentUser(entity);
  const visibility = String(getEntityProperty(entity, "visibilidad") || "PRIVADO").toUpperCase();
  const coords = getEntityLatLng(entity);
  const creator = [
    abbreviateRank(getEntityProperty(entity, "creador_puesto")),
    getEntityCreatorName(entity)
  ].filter(Boolean).join(" ");

  dom.entityPopup.dataset.action = "delete-tactical-entity";
  dom.entityPopup.dataset.routeId = "";
  dom.entityPopup.dataset.poiId = String(getEntityProperty(entity, "id_poi"));
  if (dom.entityPopupName) dom.entityPopupName.textContent = getEntityPopupName(entity);
  setEntityPopupCreator(creator);
  dom.entityPopup.querySelector(".routePopupDetails")?.remove();
  let details = dom.entityPopup.querySelector(".poiPopupDetails");
  if (!details) {
    details = document.createElement("div");
    details.className = "poiPopupDetails";
    dom.entityPopup.insertBefore(details, dom.entityPopupDelete);
  }
  details.replaceChildren();
  const visibilityRow = document.createElement("div");
  visibilityRow.className = "poiPopupVisibility";
  const visibilityLabel = document.createElement("span");
  visibilityLabel.textContent = visibility === "PUBLICO" ? "Público" : "Privado";
  visibilityRow.append(visibilityLabel);
  if (isOwner) {
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "poiVisibilityToggle";
    toggle.checked = visibility === "PUBLICO";
    toggle.setAttribute("aria-label", "Hacer waypoint público");
    visibilityRow.append(toggle);
  }
  const coordRow = document.createElement("div");
  coordRow.className = "poiPopupCoordinates";
  const coordinateText = `${Number(coords.lat).toFixed(5)}, ${Number(coords.lng).toFixed(5)}`;
  const locationIcon = document.createElement("span");
  locationIcon.className = "poiCoordinateIcon";
  locationIcon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.1 7-12A7 7 0 1 0 5 9c0 6.9 7 12 7 12Z"></path><circle cx="12" cy="9" r="2.3"></circle></svg>';
  const text = document.createElement("span");
  text.textContent = coordinateText;
  const coordinateValue = document.createElement("span");
  coordinateValue.className = "poiCoordinateValue";
  coordinateValue.append(locationIcon, text);
  coordRow.append(coordinateValue);
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "poiCopyCoordinates";
  copy.title = "Copiar coordenadas";
  copy.setAttribute("aria-label", "Copiar coordenadas");
  copy.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="1"></rect><path d="M15 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4"></path></svg>';
  coordRow.append(copy);
  details.append(visibilityRow, coordRow);
  const sidc = String(getEntityProperty(entity, "sidc") || "");
  if (sidc.startsWith("S")) {
    const heading = Number(getEntityProperty(entity, "rumbo_grados"));
    const speed = Number(getEntityProperty(entity, "velocidad_kmh"));
    const movement = document.createElement("div");
    movement.className = "poiPopupMovement";
    const rumbo = document.createElement("span");
    rumbo.textContent = `Rumbo: ${Number.isFinite(heading) ? `${Math.round(heading)}°` : "—"}`;
    const velocity = document.createElement("span");
    velocity.textContent = `Vel.: ${Number.isFinite(speed) ? `${speed.toFixed(1)} km/h` : "—"}`;
    movement.append(rumbo, velocity);
    details.append(movement);
  }

  dom.entityPopup.querySelector(".poiPopupActions")?.remove();
  if (isOwner) {
    const actions = document.createElement("div");
    actions.className = "poiPopupActions";
    actions.innerHTML = '<button type="button" class="poiEditButton"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.7 4.2 4.2-.7L19 8.5 15.5 5 4 16.5Z"></path><path d="m14.5 6 3.5 3.5"></path></svg>Editar</button><button type="button" class="poiDeleteButton"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg>Eliminar</button>';
    dom.entityPopup.insertBefore(actions, dom.entityPopupDelete);
  }
  if (dom.entityPopupDelete) dom.entityPopupDelete.style.display = "none";

  const rect = viewer.canvas.getBoundingClientRect();
  const x = clickPosition.x + rect.left + 15;
  const y = clickPosition.y + rect.top - 20;
  dom.entityPopup.style.left = `${Math.min(x, window.innerWidth - 250)}px`;
  dom.entityPopup.style.top = `${Math.max(y - 70, rect.top + 10)}px`;
  dom.entityPopup.style.display = "block";
  return true;
}

function showEntityDeletePopup(entity, clickPosition) {
  const viewer = dashboardState.viewer;
  if (!viewer || !dom.entityPopup || !entity) return false;
  dom.entityPopup.classList.remove("geoMsgPopup");
  dom.entityPopup.querySelector(".geoMsgDetails")?.remove();

  dom.personInfoPopup?.classList.add("hidden");
  if (dom.vehicleQuickMenu) dom.vehicleQuickMenu.style.display = "none";

  dom.entityPopup.dataset.action = "delete-tactical-entity";
  dom.entityPopup.dataset.routeId = "";
  if (dom.entityPopupDelete) dom.entityPopupDelete.textContent = "Eliminar";
  if (dom.entityPopupDelete) dom.entityPopupDelete.style.display = "block";
  const routeDetails = dom.entityPopup.querySelector(".routePopupDetails");
  if (routeDetails) routeDetails.remove();

  if (dom.entityPopupName) {
    dom.entityPopupName.textContent = getEntityPopupName(entity);
  }
  setEntityPopupCreator(getEntityCreatorName(entity));

  const rect = viewer.canvas.getBoundingClientRect();
  const x = clickPosition.x + rect.left + 15;
  const y = clickPosition.y + rect.top - 20;

  dom.entityPopup.style.left = `${Math.min(x, window.innerWidth - 240)}px`;
  dom.entityPopup.style.top = `${Math.max(y - 70, rect.top + 10)}px`;
  dom.entityPopup.style.display = "block";
  return true;
}

function handleEntitySelection(clickPosition) {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  const deselectRemoteRoute = () => {
    const selectedRouteId = dashboardState.selectedRemoteRouteId;
    if (selectedRouteId != null) selectRemoteRoute(selectedRouteId);
  };

  let pickedEntity = getSelectablePickedEntity(clickPosition);
  // La flecha de rumbo es una extensión visual del Blanco: cualquier clic en
  // ella se resuelve sobre el símbolo principal para que nunca se oculte ni
  // se comporte como un objeto separado.
  if (pickedEntity && String(getEntityProperty(pickedEntity, "tacticalType") || "") === "poi-heading") {
    const poiId = getEntityProperty(pickedEntity, "id_poi");
    pickedEntity = dashboardState.viewer?.entities.getById(`poi_${poiId}`) || pickedEntity;
  }

  const isDraw = (dashboardState.toolMode === "pencil" || dashboardState.toolMode === "eraser");
  if (isDraw) {
    if (dom.entityPopup) dom.entityPopup.style.display = "none";
    if (dom.vehicleQuickMenu) dom.vehicleQuickMenu.style.display = "none";
    dom.personInfoPopup?.classList.add("hidden");
    return;
  }

  if (pickedEntity) {
    // Si es el radar, no lo seleccionamos para no mostrar el popup "Eliminar" en todo el centro
    if (pickedEntity.name === "Radar Estereográfico") {
      dashboardState.selectedEntity = null;
      updateSelectionInfo(null);
      if (dom.entityPopup) dom.entityPopup.style.display = "none";
      if (dom.vehicleQuickMenu) dom.vehicleQuickMenu.style.display = "none";
      dom.personInfoPopup?.classList.add("hidden");
      return;
    }

    const routeId = getRouteIdForEntity(pickedEntity);
    if (routeId) {
      if (dashboardState.selectedRemoteRouteId !== routeId) {
        selectRemoteRoute(routeId);
      }
      showRouteDeletePopup(routeId, clickPosition);
      return;
    }

    deselectRemoteRoute();

    if (dashboardState.selectedEntity === pickedEntity) {
      if (isGeoMsgEntity(pickedEntity)) {
        showGeoMsgPopup(pickedEntity, clickPosition);
        return;
      }
      if (isWaypointOrTargetEntity(pickedEntity)) {
        showPoiInfoPopup(pickedEntity, clickPosition);
        return;
      }
      if (isDeletePopupEntity(pickedEntity)) {
        showEntityDeletePopup(pickedEntity, clickPosition);
        return;
      }

      dashboardState.selectedEntity = null;
      updateSelectionInfo(null);
      if (dom.entityPopup) dom.entityPopup.style.display = "none";
      if (dom.vehicleQuickMenu) dom.vehicleQuickMenu.style.display = "none";
      dom.personInfoPopup?.classList.add("hidden");
      return;
    }

    if (dashboardState.selectedEntity && dashboardState.selectedEntity.label && !isWaypointOrTargetEntity(dashboardState.selectedEntity)) {
      dashboardState.selectedEntity.label.show = false;
    }
    dashboardState.selectedEntity = pickedEntity;
    if (dashboardState.selectedEntity && dashboardState.selectedEntity.label) {
      dashboardState.selectedEntity.label.show = true;
    }
    updateSelectionInfo(dashboardState.selectedEntity);

    const trackingKey = String(getEntityProperty(dashboardState.selectedEntity, "trackingKey") || "");
    if (trackingKey.startsWith("P:")) {
      const id = trackingKey.split(":")[1];
      const rect = viewer.canvas.getBoundingClientRect();
      showPersonnelDetail(id, {
        x: clickPosition.x + rect.left,
        y: clickPosition.y + rect.top,
        ...getEntityLatLng(dashboardState.selectedEntity)
      });
      if (dom.entityPopup) dom.entityPopup.style.display = "none";
      if (dom.vehicleQuickMenu) dom.vehicleQuickMenu.style.display = "none";
      return;
    }

    const quickMenuShown = showQuickMenuForEntity(dashboardState.selectedEntity, clickPosition);

    if (!quickMenuShown && isWaypointOrTargetEntity(dashboardState.selectedEntity)) {
      showPoiInfoPopup(dashboardState.selectedEntity, clickPosition);
    } else if (!quickMenuShown && isGeoMsgEntity(dashboardState.selectedEntity)) {
      showGeoMsgPopup(dashboardState.selectedEntity, clickPosition);
    } else if (!quickMenuShown && isDeletePopupEntity(dashboardState.selectedEntity)) {
      showEntityDeletePopup(dashboardState.selectedEntity, clickPosition);
    } else if (dom.entityPopup) {
      dom.entityPopup.style.display = "none";
      if (!quickMenuShown) dom.personInfoPopup?.classList.add("hidden");
    }

  } else {
    deselectRemoteRoute();
    if (dashboardState.selectedEntity && dashboardState.selectedEntity.label && !isWaypointOrTargetEntity(dashboardState.selectedEntity)) {
      dashboardState.selectedEntity.label.show = false;
    }
    dashboardState.selectedEntity = null;
    updateSelectionInfo(null);
    if (dom.entityPopup) dom.entityPopup.style.display = "none";
    if (dom.vehicleQuickMenu) dom.vehicleQuickMenu.style.display = "none";
    dom.personInfoPopup?.classList.add("hidden");
  }
}

function handleAreaClick(lat, lng) {
  dashboardState.areaPoints.push({ lat, lng });
  addAreaVertex(lat, lng, dashboardState.areaPoints.length - 1);

  if (dom.areaInfo) {
    dom.areaInfo.textContent =
      `Punto ${dashboardState.areaPoints.length} agregado. Sigue marcando o presiona "Terminar figura".`;
  }
}

function handleRoutePick(lat, lng) {
  const viewer = dashboardState.viewer;
  if (!viewer) return false;

  if (dashboardState.pickMode === "start") {
    dashboardState.startPoint = { lat, lng };
    dashboardState.lastRoute = null;

    if (dom.opLat) dom.opLat.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    if (dashboardState.routeEntity) {
      viewer.entities.remove(dashboardState.routeEntity);
      dashboardState.routeEntity = null;
    }

    if (dashboardState.startEntity) viewer.entities.remove(dashboardState.startEntity);

    const vehSelect = document.getElementById("routeVehicleSelect");
    const opt = vehSelect?.options[vehSelect.selectedIndex];
    const sidc = opt?.dataset.sidc;
    const icono = opt?.dataset.icono;

    let billboard = null;
    if (sidc) {
      const canvas = renderMilSymbolImage(sidc, 150);
      if (canvas) billboard = { image: canvas.toDataURL(), scale: 0.12, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND };
    } else if (icono) {
      billboard = { image: icono, scale: 0.12, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND };
    }

    dashboardState.startEntity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat),
      point: billboard ? undefined : { pixelSize: 12, color: Cesium.Color.LIME },
      billboard: billboard || undefined,
      label: {
        text: "ORIGEN",
        font: "bold 14px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -28)
      }
    });

    dashboardState.pickMode = "end";

    persistRouteDataToCurrentOperation();

    setRouteInfo("Origen seleccionado. Ahora elige destino.");

    if (dashboardState.startPoint && dashboardState.endPoint) {
      autoCalcRoute();
    }
    return true;
  }

  if (dashboardState.pickMode === "end") {
    dashboardState.endPoint = { lat, lng };
    dashboardState.lastRoute = null;

    if (dom.opLng) dom.opLng.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    if (dashboardState.routeEntity) {
      viewer.entities.remove(dashboardState.routeEntity);
      dashboardState.routeEntity = null;
    }

    if (dashboardState.endEntity) viewer.entities.remove(dashboardState.endEntity);

    const vehSelect = document.getElementById("routeVehicleSelect");
    const opt = vehSelect?.options[vehSelect.selectedIndex];
    const sidc = opt?.dataset.sidc;
    const icono = opt?.dataset.icono;

    let billboard = null;
    if (sidc) {
      const canvas = renderMilSymbolImage(sidc, 150);
      if (canvas) billboard = { image: canvas.toDataURL(), scale: 0.12, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND };
    } else if (icono) {
      billboard = { image: icono, scale: 0.12, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND };
    }

    dashboardState.endEntity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat),
      point: billboard ? undefined : { pixelSize: 12, color: Cesium.Color.YELLOW },
      billboard: billboard || undefined,
      label: {
        text: "DESTINO",
        font: "bold 14px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -28)
      }
    });

    dashboardState.pickMode = null;

    persistRouteDataToCurrentOperation();

    setRouteInfo("Destino seleccionado. Ya puedes calcular ruta.");

    if (dashboardState.startPoint && dashboardState.endPoint) {
      autoCalcRoute();
    }
    return true;
  }

  return false;
}

function bindCesiumPointerEvents(handler) {
  const viewer = dashboardState.viewer;
  if (!viewer) return;

  handler.setInputAction((click) => {
    const cartesian = getMapClickPosition(click.position);

    if (!cartesian) {
      handleEntitySelection(click.position);
      return;
    }

    const pos = cartesianToLatLng(cartesian);
    const lat = pos.lat;
    const lng = pos.lng;

    if (dashboardState.areaDrawing) {
      handleAreaClick(lat, lng);
      return;
    }

    if (handleTacticalPlacement(lat, lng)) return;
    if (handleRoutePick(lat, lng)) return;

    handleEntitySelection(click.position);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction((click) => {
    if (dashboardState.toolMode === "pencil" || dashboardState.drawingMode === "pencil" || dashboardState.drawingMode === "eraser") {
      return;
    }

    const pickedEntity = getSelectablePickedEntity(click.position);
    if (!pickedEntity) return;

    if (isDraggableEntity(pickedEntity)) {
      dashboardState.draggingEntity = pickedEntity;
      dashboardState.dragStartPosition =
        pickedEntity.position?.getValue?.(Cesium.JulianDate.now()) ?? pickedEntity.position ?? null;
      dashboardState.selectedEntity = pickedEntity;
      dashboardState.isDragging = true;
      updateSelectionInfo(dashboardState.selectedEntity);
      viewer.scene.screenSpaceCameraController.enableRotate = false;
    }
  }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

  handler.setInputAction((movement) => {
    if (!dashboardState.isDragging && dashboardState.areaDrawing) {
      const cartesian = getMapClickPosition(movement.endPosition);
      if (cartesian) {
        const pos = cartesianToLatLng(cartesian);
        updateAreaPreview(pos.lat, pos.lng);
      }
    }

    if (
      !dashboardState.isDragging &&
      dashboardState.placingMode &&
      ["polygon", "polyline", "perimeter"].includes(dashboardState.toolMode)
    ) {
      const cartesian = getMapClickPosition(movement.endPosition);
      if (cartesian) {
        const pos = cartesianToLatLng(cartesian);
        updateTacticalPreview(pos.lat, pos.lng);
      }
    }

    if (!dashboardState.isDragging || !dashboardState.draggingEntity) return;

    const cartesian = getMapClickPosition(movement.endPosition);
    if (!cartesian) return;

    dashboardState.draggingEntity.position = cartesian;
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction(async () => {
    const draggedEntity = dashboardState.draggingEntity;
    const dragStartPosition = dashboardState.dragStartPosition;

    dashboardState.isDragging = false;
    dashboardState.draggingEntity = null;
    dashboardState.dragStartPosition = null;
    viewer.scene.screenSpaceCameraController.enableRotate = true;

    if (!draggedEntity) return;

    const saved = await persistDraggedEntity(draggedEntity);
    if (!saved && dragStartPosition) {
      draggedEntity.position = dragStartPosition;
    }
    autoSaveTacticalData();
  }, Cesium.ScreenSpaceEventType.LEFT_UP);
}

function bindMapDropEvents() {
  const viewer = dashboardState.viewer;
  if (!viewer || !dom.map) return;

  dom.map.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });

  dom.map.addEventListener("drop", (e) => {
    e.preventDefault();

    const src = e.dataTransfer.getData("text/plain");
    const sidc = e.dataTransfer.getData("application/sidc");
    const title = e.dataTransfer.getData("application/title");
    const isBuilding = e.dataTransfer.getData("application/building");

    if (!src && !sidc && !isBuilding) return;

    const rect = dom.map.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const cartesian = getMapClickPosition(new Cesium.Cartesian2(x, y));
    if (!cartesian) return;
    const coords = cartesianToLatLng(cartesian);
    if (!coords) return;

    if (isBuilding) {
      import("./dashboard.tactical.js").then(module => {
        const oldMode = dashboardState.toolMode;
        dashboardState.toolMode = "building";
        module.createPoi(coords.lat, coords.lng, "img/estructuras/casa.png");
        dashboardState.toolMode = oldMode;
      });
      return;
    }

    createMilSymbol(
      coords.lat,
      coords.lng,
      title || "Símbolo MIL",
      src || null,
      1,
      sidc || null
    );
  });
}

function bindMapUiEvents() {
  if (dom.routeVehicleSelect) {
    dom.routeVehicleSelect.addEventListener("change", (e) => {
      loadRouteForSelectedVehicle();
      applyRouteFilter(e.target.value);
    });
  }

  const markRouteBtn = document.getElementById("markRoute");
  if (markRouteBtn) {
    markRouteBtn.onclick = () => {
      dashboardState.areaMode = false;
      dashboardState.areaDrawing = false;
      if (dom.markAreaBtn) dom.markAreaBtn.textContent = "Marcar área";
      dashboardState.pickMode = "start";
      setRouteInfo("Modo ruta activo: haz clic en el origen.");
      dom.routePanel?.classList.add("open");
      dom.toggleRoutePanel?.classList.add("active");
    };
  }

  const createRouteBtn = document.getElementById("calcRoute");
  if (createRouteBtn) {
    createRouteBtn.onclick = () => {
      if (!dashboardState.startPoint || !dashboardState.endPoint) {
        setRouteInfo("Selecciona primero el origen y el destino en el mapa.");
        dashboardState.pickMode = dashboardState.startPoint ? "end" : "start";
        return;
      }
      autoCalcRoute();
    };
  }

  const clearRouteBtn = document.getElementById("clearRoute");
  if (clearRouteBtn) {
    clearRouteBtn.onclick = () => {
      dashboardState.pickMode = null;
      clearRoute();
    };
  }

  if (dom.mapLayerButton && dom.mapLayerControl) {
    dom.mapLayerButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = dom.mapLayerControl.classList.toggle("open");
      dom.mapLayerButton.setAttribute("aria-expanded", String(isOpen));
    });

    dom.mapLayerControl.querySelectorAll("[data-map-layer]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        setBaseLayer(button.dataset.mapLayer || "hybrid");
        dom.mapLayerControl.classList.remove("open");
        dom.mapLayerButton.setAttribute("aria-expanded", "false");
      });
    });

    document.addEventListener("click", (event) => {
      if (!dom.mapLayerControl.contains(event.target)) {
        dom.mapLayerControl.classList.remove("open");
        dom.mapLayerButton.setAttribute("aria-expanded", "false");
      }
    });
  }

  if (dom.btnVehQuickChat) {
    dom.btnVehQuickChat.addEventListener("click", () => {
      dispatchEntityChat(dom.btnVehQuickChat.dataset.actionKind || "vehiculo");
    });
  }

  if (dom.btnVehQuickAlert) {
    dom.btnVehQuickAlert.addEventListener("click", () => {
      const actionKind = dom.btnVehQuickAlert.dataset.actionKind || "";
      if (actionKind === "aviso-vehiculo") {
        const selected = dashboardState.selectedEntity;
        const entityName = selected?.name || dom.vehicleQuickMenuName?.textContent || "Vehiculo";
        document.dispatchEvent(new CustomEvent("sendVehicleAlert", { detail: { vehicleName: entityName } }));
        if (dom.vehicleQuickMenu) dom.vehicleQuickMenu.style.display = "none";
        logAlert("Aviso enviado.");
        return;
      }

      dispatchEntityChat(actionKind);
    });
  }

  if (dom.btnVehQuickRoute) {
    dom.btnVehQuickRoute.addEventListener("click", () => {
      const actionKind = dom.btnVehQuickRoute.dataset.actionKind || "ruta";
      if (actionKind === "ruta") {
        openSelectedEntityRoute();
        return;
      }

      dispatchEntityChat(actionKind);
    });
  }

  if (dom.entityPopupDelete) {
    dom.entityPopupDelete.addEventListener("click", async (event) => {
      if (dom.entityPopup?.dataset.action !== "delete-navigation-route") return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const routeIdText = dom.entityPopup.dataset.routeId;
      if (!routeIdText) return;
      const routeId = [...dashboardState.remoteRouteEntities.keys()]
        .find((id) => String(id) === String(routeIdText)) ?? routeIdText;

      const deleted = await deleteRemoteRouteById(routeId);
      if (!deleted) return;

      dom.entityPopup.style.display = "none";
      dom.entityPopup.dataset.action = "";
      dom.entityPopup.dataset.routeId = "";
      if (dom.entityPopupDelete) dom.entityPopupDelete.textContent = "Eliminar";
      setRouteInfo("Ruta eliminada.");
    });
  }

  if (dom.btnCloseEntityPopup) {
    dom.btnCloseEntityPopup.addEventListener("click", () => {
      dashboardState.selectedEntity = null;
      updateSelectionInfo(null);
      if (dom.entityPopup) {
        dom.entityPopup.style.display = "none";
        dom.entityPopup.classList.remove("geoMsgPopup");
        dom.entityPopup.querySelector(".geoMsgDetails")?.remove();
        dom.entityPopup.dataset.action = "";
        dom.entityPopup.dataset.routeId = "";
      }
      if (dom.entityPopupDelete) dom.entityPopupDelete.textContent = "Eliminar";
    });
  }

  if (dom.entityPopup) {
  dom.entityPopup.addEventListener("change", (event) => {
      const geoToggle = event.target.closest(".geoMsgVisibilityToggle");
      if (geoToggle && dashboardState.selectedEntity) {
        const label = geoToggle.parentElement?.querySelector("span");
        if (label) label.textContent = geoToggle.checked ? "Público" : "Privado";
        setGeoMsgVisibility(getEntityProperty(dashboardState.selectedEntity, "id_geo_msg"), geoToggle.checked, (ok, visibility) => {
          if (ok) return;
          const isPublic = String(visibility).toUpperCase() === "PUBLICO";
          geoToggle.checked = isPublic;
          if (label) label.textContent = isPublic ? "Público" : "Privado";
        });
        return;
      }
      const toggle = event.target.closest(".poiVisibilityToggle");
      if (!toggle || !dashboardState.selectedEntity) return;
      void setPoiVisibility(dashboardState.selectedEntity, toggle.checked);
    });
    dom.entityPopup.addEventListener("click", (event) => {
      const copy = event.target.closest(".poiCopyCoordinates");
      if (copy) {
        const value = copy.parentElement?.querySelector("span")?.textContent || "";
        const copied = () => {
          copy.classList.add("copied");
          setTimeout(() => copy.classList.remove("copied"), 1200);
        };
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(value).then(copied).catch(() => { });
        } else {
          const input = document.createElement("textarea");
          input.value = value;
          input.style.position = "fixed";
          input.style.opacity = "0";
          document.body.append(input);
          input.select();
          document.execCommand("copy");
          input.remove();
          copied();
        }
        return;
      }
      if (event.target.closest(".poiEditButton") && dashboardState.selectedEntity) {
        openPointObjectEdit(dashboardState.selectedEntity);
        return;
      }
      if (event.target.closest(".geoMsgEditButton") && dashboardState.selectedEntity) {
        const entity = dashboardState.selectedEntity;
        const current = String(getEntityProperty(entity, "text") || "");
        openGeoMsgEditModal(getEntityProperty(entity, "id_geo_msg"), current);
        dom.entityPopup.style.display = "none";
        return;
      }
      if (event.target.closest(".geoMsgDeleteButton") && dashboardState.selectedEntity) {
        const id = getEntityProperty(dashboardState.selectedEntity, "id_geo_msg");
        deleteGeoMsg(id);
        dashboardState.selectedEntity = null;
        updateSelectionInfo(null);
        dom.entityPopup.style.display = "none";
        return;
      }
      if (event.target.closest(".poiDeleteButton")) dom.entityPopupDelete?.click();
    });
  }

  if (dom.btnCloseVehicleQuickMenu) {
    dom.btnCloseVehicleQuickMenu.addEventListener("click", () => {
      dashboardState.selectedEntity = null;
      updateSelectionInfo(null);
      clearEmbeddedCamera(document.getElementById("droneQuickMenuCamera"));
      if (dom.vehicleQuickMenu) dom.vehicleQuickMenu.style.display = "none";
    });
  }
}

export function initCesium() {
  const viewer = new Cesium.Viewer("map", {
    timeline: false,
    animation: false,
    geocoder: [new OpenStreetMapNominatimGeocoder()],
    baseLayerPicker: false,
    sceneModePicker: false,
    navigationHelpButton: true,
    homeButton: true,
    fullscreenButton: false,
    selectionIndicator: false,
    infoBox: false
  });

  dashboardState.viewer = viewer;
  // Configure camera controls to enable translate/pan, zoom and sensible inertias
  try {
    configureGoogleLikeCamera(viewer);
  } catch (e) {
    console.warn("Failed to configure camera controls:", e);
  }
  viewer.geocoder.viewModel.destinationFound = function (_viewModel, destination) {
    viewer.camera.flyTo({ destination });
  };

  setBaseLayer("hybrid");

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-99.1332, 19.4326, 2500000)
  });

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  viewer.entities.collectionChanged.addEventListener(() => {
    if (dashboardState._saveTimer) clearTimeout(dashboardState._saveTimer);
    dashboardState._saveTimer = setTimeout(() => {
      autoSaveTacticalData();
    }, 1000);
  });

  bindCesiumPointerEvents(handler);
  bindMapDropEvents();
  bindMapUiEvents();
}

export function centerMapOnOperationZone(zona) {
  const viewer = dashboardState.viewer;
  if (!viewer || !zona) return;

  const lat = Number(zona.centroide_lat);
  const lng = Number(zona.centroide_lon);
  // No permitir que un zoom guardado antiguo (normalmente 1000 m) deje la
  // cámara por debajo de la cobertura disponible de las capas del mapa.
  const zoom = Math.max(Number(zona.zoom_inicial || 1800) || 1800, 1800);

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lng, lat, zoom)
    });
    return;
  }

  const ring = zona.geometria?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 3) return;

  const lons = ring.map(point => Number(point?.[0])).filter(Number.isFinite);
  const lats = ring.map(point => Number(point?.[1])).filter(Number.isFinite);
  if (!lons.length || !lats.length) return;

  const centerLon = lons.reduce((sum, value) => sum + value, 0) / lons.length;
  const centerLat = lats.reduce((sum, value) => sum + value, 0) / lats.length;

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, zoom)
  });
}
