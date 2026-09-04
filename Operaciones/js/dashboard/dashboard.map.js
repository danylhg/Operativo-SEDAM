// js/dashboard/dashboard.map.js

import { dashboardState } from "./dashboard.state.js";
import { dom } from "./dashboard.dom.js";
import { getVehicleOccupants } from "./dashboard.tracking.clustering.js";
import { getCurrentOperation } from "./dashboard.storage.js";
import { updateSelectionInfo, setRouteInfo, showPersonnelDetail } from "./dashboard.ui.js";
import {
  handleTacticalPlacement,
  updateTacticalPreview,
  isDraggableEntity,
  createMilSymbol,
  persistDraggedEntity,
  renderMilSymbolImage
} from "./dashboard.tactical.js";
import { addAreaVertex, updateAreaPreview } from "./dashboard.area.js";
import { cartesianToLatLng, autoSaveTacticalData } from "./dashboard.persistence.js";
import { configureGoogleLikeCamera } from "../map.camera.js?v=20260723-map-data-safe-zoom";
import { clearEmbeddedCamera, renderEquipmentLiveCamera } from "./dashboard.camera.js";
import {
  persistRouteDataToCurrentOperation,
  autoCalcRoute,
  loadRouteForSelectedVehicle,
  clearRoute,
  applyRouteFilter,
  selectRemoteRoute,
  getRouteIdForEntity,
  deleteRemoteRouteById
} from "./dashboard.routes.js";

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

  dashboardState.selectedEntity = null;
  updateSelectionInfo(null);
  dom.personInfoPopup?.classList.add("hidden");
  if (dom.vehicleQuickMenu) dom.vehicleQuickMenu.style.display = "none";

  if (dom.entityPopupName) dom.entityPopupName.textContent = getRoutePopupName(routeId);
  if (dom.entityPopupDelete) dom.entityPopupDelete.textContent = "Eliminar ruta";
  setEntityPopupCreator("");

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

function showEntityDeletePopup(entity, clickPosition) {
  const viewer = dashboardState.viewer;
  if (!viewer || !dom.entityPopup || !entity) return false;

  dom.personInfoPopup?.classList.add("hidden");
  if (dom.vehicleQuickMenu) dom.vehicleQuickMenu.style.display = "none";

  dom.entityPopup.dataset.action = "delete-tactical-entity";
  dom.entityPopup.dataset.routeId = "";
  if (dom.entityPopupDelete) dom.entityPopupDelete.textContent = "Eliminar";

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

  const pickedEntity = getSelectablePickedEntity(clickPosition);

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

    if (dashboardState.selectedEntity === pickedEntity) {
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

    if (dashboardState.selectedEntity && dashboardState.selectedEntity.label) {
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

    if (!quickMenuShown && isDeletePopupEntity(dashboardState.selectedEntity)) {
      showEntityDeletePopup(dashboardState.selectedEntity, clickPosition);
    } else if (dom.entityPopup) {
      dom.entityPopup.style.display = "none";
      if (!quickMenuShown) dom.personInfoPopup?.classList.add("hidden");
    }

  } else {
    if (dashboardState.selectedEntity && dashboardState.selectedEntity.label) {
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
        dom.entityPopup.dataset.action = "";
        dom.entityPopup.dataset.routeId = "";
      }
      if (dom.entityPopupDelete) dom.entityPopupDelete.textContent = "Eliminar";
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
  const zoom = Number(zona.zoom_inicial || 1000) || 1000;

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
