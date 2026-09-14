// js/dashboard/dashboard.ui.js

import { dom } from "./dashboard.dom.js";
import {
  escapeHtml,
  getCurrentOperation,
  getOperationDateTime,
  getJsonStorage,
  ASIGNACION_ACTUAL_KEY
} from "./dashboard.storage.js";
import { getVehicleOccupants } from "./dashboard.tracking.clustering.js";
import { dashboardState } from "./dashboard.state.js";
import { renderPersonnelLiveCamera } from "./dashboard.camera.js";

const PERSONAL_CONNECTION_STALE_MS = 30000;
const TRACKING_ACTIVE_STALE_MS = PERSONAL_CONNECTION_STALE_MS;
const personalLiveData = new Map();
let activePersonInfoPopup = null;
let personInfoRefreshTimer = null;
const DEFAULT_PERSONNEL_SIDC = "SFGPUCI--------";

export function setRouteInfo(text) {
  if (dom.routeInfo) dom.routeInfo.textContent = text;
}

export function formatDate(value) {
  if (!value) return "No disponible";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "No disponible";
  }
}

export function formatTime(dateIso) {
  try {
    return new Date(dateIso).toLocaleTimeString([], {
      timeZone: "America/Mexico_City",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

function normalizeOperationId(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

function normalizeHourText(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function getStoredOperationHour(operationId) {
  const targetId = normalizeOperationId(operationId || localStorage.getItem("active_operation_id"));
  const stored = getJsonStorage("operacion_actual", {}) || {};
  const storedId = normalizeOperationId(stored.id || stored.id_operacion);
  const storedHour = normalizeHourText(stored.hora_inicio || stored.hora || stored.time);
  if (storedHour && (!targetId || !storedId || storedId === targetId)) return storedHour;

  const ops = getJsonStorage("operations", []) || [];
  const match = Array.isArray(ops)
    ? ops.find(op => normalizeOperationId(op.id || op.id_operacion) === targetId)
    : null;
  return normalizeHourText(match?.hora_inicio || match?.hora || match?.time);
}

function getRawDateTimeHour(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function getOperationScheduledHour(operacion) {
  return normalizeHourText(
    operacion?.hora_inicio ||
    operacion?.hora ||
    operacion?.time ||
    operacion?.operationTime ||
    operacion?.horaOperacion ||
    operacion?.hora_operacion
  ) || getRawDateTimeHour(operacion?.fecha_inicio || operacion?.fechaHora || operacion?.datetime || operacion?.startAt)
    || getStoredOperationHour(operacion?.id_operacion || operacion?.id);
}

export function closeAllPanels() {
  dom.infoPanel?.classList.remove("open");
  dom.routePanel?.classList.remove("open");
  dom.tacticalPanel?.classList.remove("open");
  dom.chatAudiencePanel?.classList.remove("open");
  dom.chatPanel?.classList.remove("open");
  dom.chatGroupMembersPanel?.classList.remove("open");

  dom.toggleInfoPanel?.classList.remove("active");
  dom.toggleRoutePanel?.classList.remove("active");
  dom.toggleTacticalPanel?.classList.remove("active");
  dom.toggleChatPanel?.classList.remove("active");

  if (dom.chatGroupMembersToggle) {
    dom.chatGroupMembersToggle.textContent = ">";
    dom.chatGroupMembersToggle.setAttribute("aria-expanded", "false");
  }
}

export function openPanel(panel, button) {
  if (!panel) return;

  closeAllPanels();
  panel.classList.add("open");
  button?.classList.add("active");
}

export function togglePanel(panel, button) {
  if (!panel || !button) return;

  const wasOpen = panel.classList.contains("open");

  if (!wasOpen) {
    openPanel(panel, button);
    return;
  }

  closeAllPanels();
}

function normalizePersonal(personal) {
  return personal.map((p) => {
    if (!p?.rol_en_operacion) return p;

    const nombre = [p.nombre, p.apellido].filter(Boolean).join(" ").trim();
    const grupoDirecto = p.grupo_nombre || "";
    const grupoPadre = p.grupo_padre_nombre || "";
    const padreEsRaiz = grupoPadre.trim().toLowerCase() === "mando operativo";
    const tieneSubgrupo = Boolean(grupoPadre && !padreEsRaiz);

    return {
      cargo: p.rol_en_operacion,
      nombre,
      grupo: tieneSubgrupo ? grupoDirecto : "",
      flotilla: tieneSubgrupo ? grupoPadre : (grupoDirecto || grupoPadre || ""),
      id_personal: p.id_personal ?? null,
      lat: p.latitud ?? p.lat ?? null,
      lon: p.longitud ?? p.lon ?? p.lng ?? null,
      ultima_actualizacion: p.ultima_actualizacion ?? null,
      timestamp: p.timestamp ?? null,
      updated_at: p.updated_at ?? p.fecha_actualizacion ?? null,
      signos_actualizacion: p.signos_actualizacion ?? null
    };
  });
}

function isRootGroupName(value) {
  return String(value || "").trim().toLowerCase() === "mando operativo";
}

function formatRoleLabel(value) {
  const role = String(value || "").trim().toUpperCase();
  return role ? `(${role})` : "";
}

function formatPersonWithRole(nombre, rol) {
  const roleLabel = formatRoleLabel(rol);
  return [roleLabel, String(nombre || "").trim()].filter(Boolean).join(" ");
}

function makeTrackingKey(kind, id) {
  const cleanKind = String(kind || "").trim().toUpperCase();
  const cleanId = String(id ?? "").trim();
  return cleanKind && cleanId ? `${cleanKind}:${cleanId}` : "";
}

function isEmptyCoordinateValue(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function normalizeTrackingCoords(lat, lon) {
  if (isEmptyCoordinateValue(lat) || isEmptyCoordinateValue(lon)) return null;
  const nLat = Number(lat);
  const nLon = Number(lon);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) return null;
  if (Math.abs(nLat) > 90 || Math.abs(nLon) > 180) return null;
  if (nLat === 0 && nLon === 0) return null;
  return { lat: nLat, lon: nLon };
}

function getTrackingTimestamp(item = {}) {
  return firstValue(
    item.timestamp,
    item.updated_at,
    item.fecha_actualizacion,
    item.ultima_actualizacion,
    item.last_update,
    item.lastUpdated
  );
}

function isTrackingItemFresh(item = {}) {
  const timestamp = parseTimestamp(getTrackingTimestamp(item));
  if (!timestamp) return false;
  return Date.now() - timestamp <= TRACKING_ACTIVE_STALE_MS;
}

function normalizeDeviceIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function deviceIdentityValues(device = {}) {
  return [
    device.numero_serie,
    device.numeroSerie,
    device.serial_dispositivo,
    device.serial,
    device.imei,
    device.identificador_app,
    device.identificadorApp
  ]
    .map(normalizeDeviceIdentity)
    .filter(Boolean);
}

function getDeviceTrackingId(device = {}) {
  return firstValue(
    device.id_dispositivo,
    device.id,
    device.dispositivo_id,
    device.idDispositivo,
    device.device_id
  );
}

function getAssignedDeviceCandidates() {
  const op = getCurrentOperation() || {};
  const asignacion = getJsonStorage(ASIGNACION_ACTUAL_KEY, {}) || {};
  return [
    ...(Array.isArray(asignacion.dispositivos) ? asignacion.dispositivos : []),
    ...(Array.isArray(op.dispositivos) ? op.dispositivos : [])
  ];
}

function isDeviceTrackingConfirmed(device = {}, id = null) {
  const incomingIdentity = deviceIdentityValues(device);
  if (!incomingIdentity.length) return false;

  const cleanId = String(id ?? getDeviceTrackingId(device) ?? "").trim();
  const assigned = getAssignedDeviceCandidates();
  const sameId = cleanId
    ? assigned.filter((candidate) => String(getDeviceTrackingId(candidate) ?? "").trim() === cleanId)
    : [];
  if (!assigned.length) return true;
  const candidates = sameId.length ? sameId : assigned;

  return candidates.some((candidate) => {
    const candidateIdentity = deviceIdentityValues(candidate);
    return candidateIdentity.length &&
      incomingIdentity.some((value) => candidateIdentity.includes(value));
  });
}

// Evita duplicar prefijos como "Flotilla Flotilla Alfa" o "Grupo Grupo Alpha"
function labelConPrefijo(prefijo, nombre) {
  if (!nombre) return prefijo;
  if (nombre.trim().toLowerCase().startsWith(prefijo.toLowerCase())) return nombre.trim();
  return `${prefijo} ${nombre.trim()}`;
}

function trackingSpan(nombre, kind, id, lat, lon, item = {}, extraClasses = [], title = "Seguir ubicacion") {
  const safe = escapeHtml(nombre);
  const key = makeTrackingKey(kind, id);
  if (!key) return safe;

  const itemCoords = normalizeTrackingCoords(
    item?.latitud ?? item?.lat,
    item?.longitud ?? item?.lng ?? item?.lon
  );
  const activeItemCoords = itemCoords;
  const providedCoords = normalizeTrackingCoords(lat, lon);
  const activeProvidedCoords = providedCoords;
  const trackingAllowed = kind !== "D" || isDeviceTrackingConfirmed(item, id);
  const coords = trackingAllowed
    ? activeProvidedCoords || activeItemCoords || getTrackingEntityCoordinates(key)
    : null;

  const classes = coords ? [...extraClasses] : [];
  if (coords) {
    classes.unshift("tracking-link");
    classes.push("tracking-locatable", "has-connection-history");
    if (kind === "P") classes.push("personal-locatable");
  }

  const coordsAttrs = coords ? ` data-lat="${coords.lat}" data-lon="${coords.lon}"` : "";
  const personAttrs = kind === "P" ? ` data-pid="${id}" data-person-id="${id}"` : "";
  const classList = [...new Set(classes)].filter(Boolean);
  const classAttr = classList.length ? ` class="${classList.join(" ")}"` : "";
  const labelTitle = coords
    ? title
    : (kind === "D" && !trackingAllowed ? "Sin serie verificada" : "Sin ubicacion activa");
  return `<span${classAttr} data-tracking-key="${key}" data-tracking-kind="${kind}" data-tracking-id="${id}"${personAttrs}${coordsAttrs} title="${escapeHtml(labelTitle)}">${safe}</span>`;
}

function personSpan(nombre, id, lat, lon, person = {}) {
  const classes = ["person-link"];
  return trackingSpan(nombre, "P", id, lat, lon, person, classes, "Ver detalle");
}

function trackingLabel(nombre, kind, id, lat, lon, item = {}) {
  return trackingSpan(nombre, kind, id, lat, lon, item);
}

export function activatePersonalLocation(id, lat, lon) {
  activateTrackingLocation("P", id, lat, lon);
}

export function activateTrackingLocation(kind, id, lat, lon) {
  const key = makeTrackingKey(kind, id);
  if (!key) return;
  const coords = normalizeTrackingCoords(lat, lon);
  if (!coords) return;

  document.querySelectorAll(`[data-tracking-kind="${kind}"][data-tracking-id="${id}"]`).forEach(span => {
    span.dataset.lat = coords.lat;
    span.dataset.lon = coords.lon;
    span.classList.add("tracking-link", "tracking-locatable", "has-connection-history");
    if (kind === "P") span.classList.add("person-link", "personal-locatable");
    if (!span.classList.contains("person-link")) span.title = "Seguir ubicacion";
  });

  document.querySelectorAll(`[data-pid="${id}"]`).forEach(span => {
    span.dataset.lat = coords.lat;
    span.dataset.lon = coords.lon;
    if (!span.classList.contains("personal-locatable")) {
      span.classList.add("personal-locatable");
      span.title = "Ir a ubicacion";
    }
    span.classList.add("has-connection-history");
  });
}

function getTrackingEntityCoordinates(key) {
  const viewer = dashboardState.viewer;
  const entity = dashboardState.trackingEntities?.get(key);
  const position = entity?.position?.getValue?.(viewer?.clock?.currentTime) ?? entity?.position;
  if (!position) return null;

  const carto = Cesium.Cartographic.fromCartesian(position);
  return {
    lat: Cesium.Math.toDegrees(carto.latitude),
    lon: Cesium.Math.toDegrees(carto.longitude)
  };
}

function getPersonalEntityCoordinates(id) {
  return getTrackingEntityCoordinates(`P:${id}`);
}

function setFollowedTrackingStyle(key) {
  document.querySelectorAll(".tracking-locatable").forEach(span => {
    const selected = String(span.dataset.trackingKey || "") === String(key || "");
    span.classList.toggle("is-followed", selected);
    if (!span.classList.contains("person-link")) {
      span.title = selected ? "Siguiendo ubicacion" : "Seguir ubicacion";
    }
  });
}

export function followPersonalLocation(id, lat, lon) {
  followTrackingLocation(`P:${id}`, lat, lon);
}

export function followTrackingLocation(key, lat, lon) {
  const viewer = dashboardState.viewer;
  if (!viewer || !key) return;
  const trackingKey = String(key);

  const liveCoords =
    getTrackingEntityCoordinates(trackingKey) ||
    normalizeTrackingCoords(lat, lon);
  if (!liveCoords) return;

  dashboardState.followedTrackingKey = trackingKey;
  dashboardState.followedPersonalId = trackingKey.startsWith("P:") ? trackingKey.slice(2) : null;
  setFollowedTrackingStyle(trackingKey);
  document.dispatchEvent(new CustomEvent("dashboard:tracking-follow-requested", {
    detail: {
      key: trackingKey,
      lat: liveCoords.lat,
      lon: liveCoords.lon
    }
  }));

  const entity = dashboardState.trackingEntities?.get(trackingKey);
  if (entity) {
    dashboardState.selectedEntity = entity;
    updateSelectionInfo(entity);
  }

  updateFollowedTrackingLocation(trackingKey, liveCoords.lat, liveCoords.lon, 0.45);
}

export function updateFollowedPersonalLocation(id, lat, lon, duration = 0.28) {
  updateFollowedTrackingLocation(`P:${id}`, lat, lon, duration);
}

export function updateFollowedTrackingLocation(key, lat, lon, duration = 0.28) {
  const viewer = dashboardState.viewer;
  if (!viewer || String(dashboardState.followedTrackingKey || "") !== String(key || "")) return;
  const coords = normalizeTrackingCoords(lat, lon);
  if (!coords) return;

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      coords.lon,
      coords.lat,
      Math.max(dashboardState.followedPersonalZoom || 1200, 1200)
    ),
    orientation: {
      heading: viewer.camera.heading,
      pitch: viewer.camera.pitch,
      roll: viewer.camera.roll
    },
    duration
  });
}

function renderPersonalHtml(personalNorm) {
  if (!personalNorm.length) return "<p>Sin personal asignado.</p>";

  let html = "";

  const cuts = personalNorm.filter(
    (p) => ["CUT", "Comandante de Unidad de Trabajo"].includes(p.cargo || p.rol)
  );
  const cets = personalNorm.filter(
    (p) => ["CET", "Comandante de Equipo de trabajo"].includes(p.cargo || p.rol)
  );
  const cells = personalNorm.filter(
    (p) => ["Célula", "CELL", "Celulas", "Células"].includes(p.cargo || p.rol)
  );

  cuts.forEach((cut) => {
    html += `
      <div class="miniCard" style="border-left: 3px solid #10b981;">
        <p><strong>CUT:</strong> ${personSpan(cut.nombre || cut.name, cut.id_personal, cut.lat, cut.lon, cut)}</p>
      </div>
    `;
  });

  cets.forEach((cet) => {
    const flotillaNombre = cet.flotilla || "Sin flotilla";
    const directos = [];
    const grupos = new Map();

    cells.forEach((cell) => {
      if (cell.flotilla !== flotillaNombre) return;

      const nameHtml = personSpan(formatPersonWithRole(cell.nombre, cell.cargo), cell.id_personal, cell.lat, cell.lon, cell);
      if (cell.grupo) {
        if (!grupos.has(cell.grupo)) grupos.set(cell.grupo, []);
        grupos.get(cell.grupo).push(nameHtml);
      } else {
        directos.push(nameHtml);
      }
    });

    html += `
      <div class="miniCard" style="border-left: 3px solid #3b82f6; margin-top:8px;">
        <p><strong>(CET)</strong> ${personSpan(cet.nombre, cet.id_personal, cet.lat, cet.lon, cet)}</p>
        <p style="margin-top:8px;"><strong>${escapeHtml(labelConPrefijo("Flotilla", flotillaNombre))}</strong></p>
    `;

    directos.forEach((nameHtml) => {
      html += `
        <p style="padding-left:20px; margin:2px 0;">-- ${nameHtml}</p>
      `;
    });

    Array.from(grupos.entries()).forEach(([grupoNombre, integrantes]) => {
      html += `
        <p style="margin-top:12px;"><strong>${escapeHtml(labelConPrefijo("Grupo", grupoNombre))}</strong></p>
      `;

      integrantes.forEach((nameHtml) => {
        html += `
          <p style="padding-left:20px; margin:2px 0;">-- ${nameHtml}</p>
        `;
      });
    });

    html += "</div>";
  });

  return html || "<p>Sin personal asignado.</p>";
}

function buildVehiculoTree(vehiculos) {
  const byVehiculo = new Map();

  for (const v of vehiculos) {
    const key = v.id_vehiculo ?? v.codigo_interno;
    if (!byVehiculo.has(key)) {
      byVehiculo.set(key, {
        id_vehiculo: v.id_vehiculo ?? null,
        codigo_interno: v.codigo_interno || "",
        alias: v.alias || "",
        tipo: v.tipo || "",
        latitud: v.latitud ?? v.lat ?? null,
        longitud: v.longitud ?? v.lng ?? v.lon ?? null,
        rows: []
      });
    }
    const vehiculo = byVehiculo.get(key);
    vehiculo.id_vehiculo = vehiculo.id_vehiculo ?? v.id_vehiculo ?? null;
    vehiculo.latitud = vehiculo.latitud ?? v.latitud ?? v.lat ?? null;
    vehiculo.longitud = vehiculo.longitud ?? v.longitud ?? v.lng ?? v.lon ?? null;
    byVehiculo.get(key).rows.push(v);
  }

  return byVehiculo;
}

function getVehiculoPersonalNombre(row) {
  const nombreCompleto = [
    row.personal_nombre || row.asignado_a_nombre || "",
    row.personal_apellido || row.asignado_a_apellido || ""
  ].filter(Boolean).join(" ").trim();

  if (nombreCompleto) {
    const baseName = row.personal_puesto
      ? `${row.personal_puesto} ${nombreCompleto}`.trim()
      : nombreCompleto;
    return formatPersonWithRole(baseName, row.personal_rol);
  }

  return formatPersonWithRole(row.asignado_a_apodo || "", row.personal_rol);
}

function renderVehiculosHierarchyHtml(vehiculos) {
  if (!vehiculos.length) return "<p>Sin vehiculos asignados.</p>";

  const byVehiculo = buildVehiculoTree(vehiculos);
  let html = "";

  for (const [, veh] of byVehiculo) {
    const nombre = veh.codigo_interno && veh.alias
      ? `${veh.codigo_interno} - ${veh.alias}`
      : (veh.codigo_interno || veh.alias || "Vehiculo");

    const nombreHtml = trackingLabel(nombre, "V", veh.id_vehiculo, veh.latitud, veh.longitud, veh);
    html += `<div class="miniCard"><p>${nombreHtml}</p>`;

    // flotilla_nombre → { directos: [], grupos: Map<string, []> }
    const cets = new Map();
    const sinContexto = [];

    for (const row of veh.rows) {
      const personal = getVehiculoPersonalNombre(row);
      const cetNombre = row.cet_nombre || row.cet_apodo || "Sin CET";

      // Campos nuevos del endpoint mapa (con fallback al endpoint vehiculos-asignados)
      const grupoDirecto = row.grupo_directo_nombre || row.grupo_nombre || "";
      const grupoPadre  = row.grupo_padre_nombre || "";
      const nivel       = (row.nivel_asignacion || "").toUpperCase();
      const padreUtil = isRootGroupName(grupoPadre) ? "" : grupoPadre;

      let flotillaNombre, grupoNombre;

      if (padreUtil) {
        flotillaNombre = padreUtil;
        grupoNombre    = grupoDirecto;
      } else if (grupoDirecto) {
        if (nivel === "GRUPO") {
          flotillaNombre = "";
          grupoNombre    = grupoDirecto;
        } else {
          flotillaNombre = grupoDirecto;
          grupoNombre    = "";
        }
      } else {
        if (personal) sinContexto.push(personal);
        continue;
      }

      if (!cets.has(cetNombre)) {
        cets.set(cetNombre, new Map());
      }
      const flotillas = cets.get(cetNombre);
      const fKey = flotillaNombre || "__sin_flotilla__";
      if (!flotillas.has(fKey)) {
        flotillas.set(fKey, { nombre: flotillaNombre, directos: [], grupos: new Map() });
      }
      const flt = flotillas.get(fKey);

      if (grupoNombre) {
        if (!flt.grupos.has(grupoNombre)) flt.grupos.set(grupoNombre, []);
        if (personal) flt.grupos.get(grupoNombre).push(personal);
      } else {
        if (personal) flt.directos.push(personal);
      }
    }

    for (const [cetNombre, flotillas] of cets) {
      html += `<p style="margin-top:8px;"><strong>${escapeHtml(cetNombre)} (CET)</strong></p>`;
      for (const [, flt] of flotillas) {
        if (flt.nombre) {
          html += `<p style="margin-top:8px; padding-left:12px; font-size:12px; color:#94a3b8;"><strong>${escapeHtml(labelConPrefijo("Flotilla", flt.nombre))}</strong></p>`;
        }
        flt.directos.forEach((p) => {
          html += `<p style="padding-left:24px; margin:2px 0; font-size:12px;">-- ${escapeHtml(p)}</p>`;
        });
        for (const [grupoNom, integrantes] of flt.grupos) {
          html += `<p style="padding-left:24px; margin-top:6px; font-size:12px; color:#64748b;"><strong>${escapeHtml(labelConPrefijo("Grupo", grupoNom))}</strong></p>`;
          integrantes.forEach((p) => {
            html += `<p style="padding-left:36px; margin:2px 0; font-size:12px;">-- ${escapeHtml(p)}</p>`;
          });
        }
      }
    }

    sinContexto.forEach((p) => {
      html += `<p style="padding-left:12px; margin:2px 0; font-size:12px;">-- ${escapeHtml(p)}</p>`;
    });

    html += "</div>";
  }

  return html;
}

function normalizeEquipos(equipos) {
  return equipos.map((e) => {
    if (e.numero_serie !== undefined && !e.nombre_display) {
      const tipoDestino = e.tipo_destino || null;
      const grupoAsignado = String(e.grupo_asignado || "").trim();
      const flotillaAsignada = String(e.flotilla_asignada || "").trim();
      const personalGrupo = String(e.personal_grupo_nombre || "").trim();
      const personalFlotilla = String(e.personal_flotilla_nombre || "").trim();
      const gruposVehiculo = String(e.grupos_vinculados || "").split(",").map(v => v.trim()).filter(Boolean);
      const flotillasVehiculo = String(e.flotillas_vinculadas || "").split(",").map(v => v.trim()).filter(Boolean);

      let grupos = [];
      let flotillas = [];

      if (tipoDestino === "VEHICULO") {
        grupos = gruposVehiculo;
        flotillas = flotillasVehiculo.filter(v => !isRootGroupName(v));

        if (!flotillas.length && grupos.length === 1) {
          flotillas = grupos;
          grupos = [];
        }
      } else if (tipoDestino === "GRUPO") {
        const flotillaUtil = !isRootGroupName(flotillaAsignada) ? flotillaAsignada : "";
        if (flotillaUtil) {
          flotillas = [flotillaUtil];
          grupos = grupoAsignado ? [grupoAsignado] : [];
        } else if (grupoAsignado && !isRootGroupName(grupoAsignado)) {
          flotillas = [grupoAsignado];
          grupos = [];
        }
      } else {
        const flotillaUtil = !isRootGroupName(personalFlotilla) ? personalFlotilla : "";
        if (flotillaUtil) {
          flotillas = [flotillaUtil];
          grupos = personalGrupo ? [personalGrupo] : [];
        } else if (personalGrupo && !isRootGroupName(personalGrupo)) {
          flotillas = [personalGrupo];
          grupos = [];
        }
      }

      const flotillasNorm = [...new Set(flotillas.map(v => v.trim()).filter(v => v && !isRootGroupName(v)))];
      const gruposNorm = [...new Set(
        grupos
          .map(v => v.trim())
          .filter(v => v && !isRootGroupName(v))
          .filter(v => !flotillasNorm.some(f => f.toLowerCase() === v.toLowerCase()))
      )];

      return {
        id_equipo: e.id_equipo,
        nombre: e.nombre,
        numero: e.numero_serie || "",
        categoria: e.categoria || "",
        tipo_equipo: e.tipo_equipo || e.tipo_tactico || [e.marca, e.modelo].filter(Boolean).join(" ") || e.categoria || "Equipo",
        tipo_destino: tipoDestino,
        id_personal_asignado: firstValue(e.ueo_id_personal, e.id_personal_asignado, e.id_personal, e.personal_id),
        id_vehiculo_asignado: firstValue(e.id_vehiculo_contexto, e.id_vehiculo_asignado, e.id_vehiculo, e.vehiculo_id),
        asignadoA: e.asignado_a_personal || "",
        personalRol: e.personal_rol || "",
        vehiculo: tipoDestino === "VEHICULO"
          ? [e.asignado_a_vehiculo, e.vehiculo_alias].filter(Boolean).join(" - ")
          : "",
        latitud: e.latitud ?? e.lat ?? null,
        longitud: e.longitud ?? e.lng ?? e.lon ?? null,
        ultima_actualizacion: e.ultima_actualizacion || e.timestamp || e.updated_at || e.fecha_actualizacion || "",
        grupos: gruposNorm,
        flotillas: flotillasNorm
      };
    }
    return e;
  });
}

function renderEquiposGroupedHtml(equiposNorm) {
  if (!equiposNorm.length) return "<p>sin equipos asignados</p>";

  const groups = [
    {
      title: "Equipos de Comunicacion",
      items: equiposNorm.filter((e) => String(e.categoria || "").toUpperCase() === "COMUNICACION")
    },
    {
      title: "Equipos Tacticos",
      items: equiposNorm.filter((e) => String(e.categoria || "").toUpperCase() === "TACTICO")
    },
    {
      title: "Otros equipos",
      items: equiposNorm.filter((e) => !["COMUNICACION", "TACTICO"].includes(String(e.categoria || "").toUpperCase()))
    }
  ].filter(group => group.items.length);

  const renderCard = (e) => {
    const flotillas = [...new Set((e.flotillas || []).filter(Boolean))];
    const grupos = [...new Set((e.grupos || []).filter(Boolean))];
    const destinoBase = e.vehiculo || e.asignadoA || "";
    const destinoRaw = e.vehiculo
      ? destinoBase
      : [e.personalRol ? `(${String(e.personalRol).toUpperCase()})` : "", destinoBase].filter(Boolean).join(" ");
    const contexto = new Set([...flotillas, ...grupos].map((v) => String(v).trim().toLowerCase()));
    const destinoFinal = contexto.has(String(destinoBase).trim().toLowerCase()) ? "" : destinoRaw;

    return `
      <div class="miniCard">
        <p><strong>Nombre de equipo:</strong> ${trackingLabel(e.nombre || "Equipo", "E", e.id_equipo, e.latitud ?? e.lat, e.longitud ?? e.lng ?? e.lon, e)}</p>
        <p><strong>Identificador:</strong> ${escapeHtml(e.numero || "Sin numero")}</p>
        ${flotillas.length ? `<p style="margin-top:8px;"><strong>Flotilla:</strong> ${escapeHtml(flotillas.join(", "))}</p>` : ""}
        ${grupos.length ? `<p style="margin-top:8px;"><strong>Grupo:</strong> ${escapeHtml(grupos.join(", "))}</p>` : ""}
        ${destinoFinal ? `<p style="padding-left:12px; margin-top:8px;">-- ${escapeHtml(destinoFinal)}</p>` : ""}
      </div>
    `;
  };

  return groups.map((group) => `
    <div style="margin-bottom:16px;">
      <h4 style="margin:0 0 8px 0; color:#a0c4ff;">${escapeHtml(group.title)}</h4>
      ${group.items.map(renderCard).join("")}
    </div>
  `).join("");
}

function normalizeDispositivos(dispositivos) {
  return dispositivos.map((d) => {
    const tipo = String(d.tipo || "").toUpperCase();
    const asignadoA = [
      d.personal_puesto,
      d.personal_nombre,
      d.personal_apellido
    ].filter(Boolean).join(" ").trim() ||
      d.responsable ||
      d.asignado_a_personal ||
      d.personal_apodo ||
      "";

    return {
      id_dispositivo: d.id_dispositivo || d.id,
      tipo,
      marca: d.marca || "",
      modelo: d.modelo || d.nombre || d.name || "",
      numero_telefono: d.numero_telefono || d.numeroTelefono || "",
      imei: d.imei || "",
      numero_serie: d.numero_serie || d.numeroSerie || "",
      identificador_app: d.identificador_app || d.identificadorApp || "",
      serial_dispositivo: d.serial_dispositivo || d.serial || "",
      sistema_operativo: d.sistema_operativo || d.os || "",
      estado: d.estado_asignacion || d.estado || d.dispositivo_estado || "",
      id_personal: firstValue(d.id_personal, d.personal_id, d.idPersonal, d.id_personal_asignado),
      personal_apodo: d.personal_apodo || d.personalApodo || "",
      personal_nombre: d.personal_nombre || d.personalNombre || "",
      personal_apellido: d.personal_apellido || d.personalApellido || "",
      asignadoA,
      bateria_pct: d.bateria_pct ?? d.bateria ?? d.battery ?? null,
      latitud: d.latitud ?? d.lat ?? null,
      longitud: d.longitud ?? d.lng ?? d.lon ?? null,
      ultima_actualizacion: d.ultima_actualizacion || d.updated_at || d.timestamp || ""
    };
  });
}

function getDispositivoGroup(tipo) {
  if (tipo === "TELEFONO") return "Telefonos";
  if (tipo === "SMARTWATCH") return "Relojes / wearables";
  if (tipo === "TABLET") return "Tablets";
  if (tipo === "GPS" || tipo === "LORA") return "GPS / LoRa";
  if (tipo === "LAPTOP") return "Laptops";
  if (tipo === "RADIO") return "Radios";
  return "Otros dispositivos";
}

function getDispositivoName(d) {
  return [d.marca, d.modelo].filter(Boolean).join(" ").trim() ||
    d.tipo ||
    `Dispositivo ${d.id_dispositivo || ""}`.trim();
}

function getDispositivoCode(d) {
  return d.numero_telefono || d.numero_serie || d.imei || "Sin identificador";
}

function normalizeLookupText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(soldado|marinero|cabo|capitan|teniente|sargento|primero|segundo)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getPositiveId(...values) {
  const raw = firstValue(...values);
  if (raw === undefined || raw === null) return "";
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) return String(Math.trunc(num));
  const clean = String(raw).trim();
  return clean && clean !== "0" ? clean : "";
}

function addLocation(map, key, coords) {
  if (!key || !coords || map.has(key)) return;
  map.set(key, coords);
}

function addTextLocation(map, value, coords) {
  addLocation(map, normalizeLookupText(value), coords);
}

function itemTrackingCoords(kind, id, item = {}) {
  return normalizeTrackingCoords(
    item?.latitud ?? item?.lat,
    item?.longitud ?? item?.lng ?? item?.lon
  ) || getTrackingEntityCoordinates(makeTrackingKey(kind, id));
}

function withResolvedPersonalDeviceLocations(personalNorm, dispositivosNorm) {
  const deviceByPersonalId = new Map();
  const deviceByPersonalText = new Map();

  dispositivosNorm.forEach((d) => {
    const id = getPositiveId(d.id_dispositivo, d.id);
    const coords = itemTrackingCoords("D", id, d);
    if (!coords || !isDeviceTrackingConfirmed(d, id)) return;

    addLocation(deviceByPersonalId, getPositiveId(d.id_personal, d.personal_id, d.idPersonal), coords);
    addTextLocation(deviceByPersonalText, d.asignadoA, coords);
    addTextLocation(deviceByPersonalText, d.personal_apodo, coords);
    addTextLocation(deviceByPersonalText, [d.personal_nombre, d.personal_apellido].filter(Boolean).join(" "), coords);
    addTextLocation(deviceByPersonalText, [d.personal_puesto, d.personal_nombre, d.personal_apellido].filter(Boolean).join(" "), coords);
  });

  return personalNorm.map((p) => {
    const id = getPositiveId(p.id_personal, p.id, p.personal_id);
    const existing = itemTrackingCoords("P", id, p);
    if (existing) return p;

    const coords = deviceByPersonalId.get(id) ||
      deviceByPersonalText.get(normalizeLookupText(p.nombre || p.name)) ||
      deviceByPersonalText.get(normalizeLookupText(p.apodo)) ||
      null;

    return coords
      ? { ...p, lat: coords.lat, lon: coords.lon, latitud: coords.lat, longitud: coords.lon }
      : p;
  });
}

function renderDispositivosGroupedHtml(dispositivosNorm) {
  if (!dispositivosNorm.length) return "<p>sin dispositivos asignados</p>";

  const order = [
    "Telefonos",
    "Relojes / wearables",
    "Tablets",
    "GPS / LoRa",
    "Radios",
    "Laptops",
    "Otros dispositivos"
  ];

  const groups = order
    .map((title) => ({
      title,
      items: dispositivosNorm.filter((d) => getDispositivoGroup(d.tipo) === title)
    }))
    .filter((group) => group.items.length);

  const renderCard = (d) => {
    const nombre = getDispositivoName(d);
    const codigo = getDispositivoCode(d);
    const bateria = d.bateria_pct != null && d.bateria_pct !== "" ? `${d.bateria_pct}%` : "";
    const ubicacion = normalizeTrackingCoords(d.latitud, d.longitud);

    return `
      <div class="miniCard">
        <p><strong>Dispositivo:</strong> ${trackingLabel(nombre, "D", d.id_dispositivo, d.latitud, d.longitud, d)}</p>
        <p><strong>Identificador:</strong> ${escapeHtml(codigo)}</p>
        ${d.sistema_operativo ? `<p><strong>Sistema:</strong> ${escapeHtml(d.sistema_operativo)}</p>` : ""}
        ${d.asignadoA ? `<p><strong>Custodio:</strong> ${escapeHtml(d.asignadoA)}</p>` : ""}
        ${bateria ? `<p><strong>Bateria:</strong> ${escapeHtml(bateria)}</p>` : ""}
        ${ubicacion ? `<p><strong>Ubicacion:</strong> ${escapeHtml(formatCoord(ubicacion.lat))}, ${escapeHtml(formatCoord(ubicacion.lon))}</p>` : ""}
      </div>
    `;
  };

  return groups.map((group) => `
    <div style="margin-bottom:16px;">
      <h4 style="margin:0 0 8px 0; color:#a0c4ff;">${escapeHtml(group.title)}</h4>
      ${group.items.map(renderCard).join("")}
    </div>
  `).join("");
}

export function renderInfoPanel(bdData = null) {
  const container = document.getElementById("infoPanelContent");
  if (!container) return;

  const operacion = bdData?.operacion ?? getCurrentOperation() ?? {};

  let personal;
  let vehiculos;
  let equipos;
  let dispositivos;
  if (bdData) {
    personal = bdData.personal || [];
    vehiculos = bdData.vehiculos || [];
    equipos = bdData.equipos || [];
    dispositivos = bdData.dispositivos || [];
  } else {
    const asignacion = getJsonStorage(ASIGNACION_ACTUAL_KEY, {}) || {};
    personal = Array.isArray(asignacion.personal) && asignacion.personal.length
      ? asignacion.personal
      : (Array.isArray(operacion.personal) ? operacion.personal : []);
    vehiculos = Array.isArray(asignacion.vehiculos) && asignacion.vehiculos.length
      ? asignacion.vehiculos
      : (Array.isArray(operacion.vehiculos) ? operacion.vehiculos : []);
    equipos = Array.isArray(asignacion.equipos) && asignacion.equipos.length
      ? asignacion.equipos
      : (Array.isArray(operacion.equipos) ? operacion.equipos : []);
    dispositivos = Array.isArray(asignacion.dispositivos) && asignacion.dispositivos.length
      ? asignacion.dispositivos
      : (Array.isArray(operacion.dispositivos) ? operacion.dispositivos : []);
  }

  const esActiva = (operacion.phase || operacion.estado?.toLowerCase?.()) === "activa";

  const titulo = operacion.nombre || operacion.title || operacion.titulo || operacion.name || "Sin titulo";
  const descripcion = operacion.descripcion || operacion.description || operacion.desc || "Sin descripcion";
  const programada = getOperationDateTime(operacion);

  let fechaP = "No definida";
  let horaP = getOperationScheduledHour(operacion) || "No definida";

  if (operacion.fecha_inicio) {
    const d = new Date(operacion.fecha_inicio);
    if (!isNaN(d)) {
      fechaP = new Intl.DateTimeFormat("es-MX", {
        timeZone: "America/Mexico_City",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      }).format(d).replace(/\//g, "-");
      if (horaP === "No definida") {
        horaP = new Intl.DateTimeFormat("es-MX", {
          timeZone: "America/Mexico_City",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }).format(d);
      }
    } else {
      fechaP = operacion.fecha_inicio;
    }
  } else if (programada) {
    fechaP = programada.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).replace(/\//g, "-");
  }

  const fecha = formatDate(operacion.fecha_creacion || operacion.created_at);

  const dispositivosNorm = normalizeDispositivos(dispositivos);
  const personalNorm = withResolvedPersonalDeviceLocations(normalizePersonal(personal), dispositivosNorm);
  const personalHtml = renderPersonalHtml(personalNorm);

  const vehiculosHtml = renderVehiculosHierarchyHtml(vehiculos);

  const equiposNorm = normalizeEquipos(equipos);
  const equiposHtml = renderEquiposGroupedHtml(equiposNorm);
  const dispositivosHtml = renderDispositivosGroupedHtml(dispositivosNorm);

  container.innerHTML = `
    <div class="infoBlock">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="margin:0;">Operacion</h3>
        ${!esActiva ? `<button id="editOpInfoBtn" style="padding:4px 12px; font-size:12px; font-weight:700; border-radius:8px; border:1px solid #38bdf8; background:rgba(56,189,248,0.12); color:#38bdf8; cursor:pointer;">Editar</button>` : ""}
      </div>
      <p><strong>Titulo:</strong> ${escapeHtml(titulo)}</p>
      <p><strong>Descripcion:</strong> ${escapeHtml(descripcion)}</p>
      <p><strong>Fecha programada:</strong> ${escapeHtml(fechaP)}</p>
      <p><strong>Hora programada:</strong> ${escapeHtml(horaP)}</p>
      <p><strong>Creada:</strong> ${escapeHtml(fecha)}</p>
    </div>

    <div class="infoBlock">
      <h3>Personal asignado</h3>
      ${personalHtml}
    </div>

    <div class="infoBlock">
      <h3>Vehiculos asignados</h3>
      ${vehiculosHtml}
    </div>

    <div class="infoBlock">
      <h3>Equipos asignados</h3>
      ${equiposHtml}
    </div>

    <div class="infoBlock">
      <h3>Dispositivos asignados</h3>
      ${dispositivosHtml}
    </div>
  `;

  const editBtn = document.getElementById("editOpInfoBtn");
  if (editBtn) {
    editBtn.addEventListener("click", () => {
      const op = getCurrentOperation();
      if (op?.id) localStorage.setItem("active_operation_id", op.id);
      sessionStorage.setItem("asignacion_entry", "edit");
      window.location.href = "asignacion.html";
    });
  }

  container.onclick = (e) => {
    if (e.target.closest(".person-link")) return;
    const el = e.target.closest(".tracking-locatable");
    if (!el) return;
    const key = el.dataset.trackingKey;
    const lat = parseFloat(el.dataset.lat);
    const lon = parseFloat(el.dataset.lon);
    if (!normalizeTrackingCoords(lat, lon) && !getTrackingEntityCoordinates(key)) return;
    followTrackingLocation(key, lat, lon);
  };
}

export function updateChatAvailability() {
  const op = getCurrentOperation();
  const phase = String(op.phase || op.estado || "").toLowerCase();
  const active = phase === "activa";
  const closed = phase === "cerrada" || phase === "cancelada";
  const planned = phase === "planificada" || !phase;

  const badge = document.getElementById("opStatusBadge");
  const title = document.getElementById("topbarTitle");
  const dot = document.getElementById("brandDot");
  const actionBtns = document.getElementById("mapActionButtons");
  const activateOpBtn = document.getElementById("activateOpBtn");
  const closeActiveBtn = document.getElementById("closeActiveOpBtn");
  const saveOpMapBtn = document.getElementById("saveOpMapBtn");
  const cancelOpMapBtn = document.getElementById("cancelOpMapBtn");
  const operationZoneControls = document.getElementById("operationZoneControls");
  const operationName = op.nombre || op.title || op.titulo || op.name || "Panorama tactico";

  if (badge) badge.style.display = active ? "inline-flex" : "none";
  if (closeActiveBtn) closeActiveBtn.textContent = "Terminar operación";
  if (title) {
    title.textContent = operationName;
    title.title = operationName;
  }
  if (dot) {
    dot.style.display = "none";
  }
  if (actionBtns) actionBtns.style.display = planned ? "flex" : "none";
  if (operationZoneControls) operationZoneControls.style.display = (planned || active) ? "" : "none";
  if (saveOpMapBtn) {
    saveOpMapBtn.style.display = planned ? "" : "none";
    saveOpMapBtn.disabled = !planned || closed;
  }
  if (cancelOpMapBtn) {
    cancelOpMapBtn.style.display = planned ? "" : "none";
    cancelOpMapBtn.disabled = !planned || closed;
  }
  if (activateOpBtn) {
    activateOpBtn.style.display = planned ? "inline-flex" : "none";
    activateOpBtn.disabled = !planned || closed;
  }
  if (closeActiveBtn) {
    closeActiveBtn.style.display = active ? "inline-flex" : "none";
    closeActiveBtn.disabled = !active;
  }

  if (dom.toggleChatPanel) {
    dom.toggleChatPanel.style.display = active ? "flex" : "none";
    dom.toggleChatPanel.disabled = !active;
  }
  if (dom.toggleCameraPanel) {
    dom.toggleCameraPanel.style.display = active ? "flex" : "none";
    dom.toggleCameraPanel.disabled = !active;
  }

  if (!active) {
    dom.chatAudiencePanel?.classList.remove("open");
    dom.chatPanel?.classList.remove("open");
    dom.chatGroupMembersPanel?.classList.remove("open");
    if (dom.chatGroupMembersToggle) {
      dom.chatGroupMembersToggle.textContent = ">";
      dom.chatGroupMembersToggle.setAttribute("aria-expanded", "false");
    }
    dom.toggleChatPanel?.classList.remove("active");
    dom.cameraPanel?.classList.remove("open");
    dom.toggleCameraPanel?.classList.remove("active");
  }

  if (dom.chatInput) dom.chatInput.disabled = !active;
  if (dom.sendChatBtn) dom.sendChatBtn.disabled = !active;
  if (dom.chatImageBtn) dom.chatImageBtn.disabled = !active;
  if (dom.chatEmojiBtn) dom.chatEmojiBtn.disabled = !active;
  if (dom.chatAttachmentBtn) dom.chatAttachmentBtn.disabled = !active;
  if (dom.chatAudioBtn) dom.chatAudioBtn.disabled = !active;
  if (dom.chatGroupMembersToggle) dom.chatGroupMembersToggle.disabled = !active;
  if (dom.chatTargetPicker) dom.chatTargetPicker.disabled = !active;
  document.querySelectorAll("[data-chat-channel]").forEach((btn) => {
    btn.disabled = !active;
  });
  if (dom.cameraWebRtcBtn) dom.cameraWebRtcBtn.disabled = !active;
  if (dom.cameraRtmpBtn) dom.cameraRtmpBtn.disabled = !active;
  if (dom.chatTabCet) dom.chatTabCet.disabled = !active;
  if (dom.chatTabCells) dom.chatTabCells.disabled = !active;
}

export function updateSelectionInfo(selectedEntity) {
  if (!dom.selectionInfo) return;

  if (!selectedEntity) {
    dom.selectionInfo.textContent = "No hay elemento seleccionado.";
    return;
  }

  const name = selectedEntity.name || "Elemento tactico";
  let type =
    selectedEntity.properties?.tacticalType?.getValue?.() ||
    selectedEntity.properties?.tacticalType ||
    "Sin tipo";

  const trackingKey = selectedEntity.properties?.trackingKey?.getValue?.() || selectedEntity.properties?.trackingKey;
  
  if (trackingKey && trackingKey.startsWith("V:")) {
    type = "Vehículo (Rastreo)";
    const occupants = getVehicleOccupants(trackingKey);
    
    // Convertir P:1 a nombres:
    const bdData = getCurrentOperation();
    const personas = Array.isArray(bdData.personal) ? bdData.personal : [];
    const ocupantesNombres = occupants.map(occId => {
      const id = occId.split(":")[1];
      const p = personas.find(x => String(x.id_personal) === String(id));
      if (p) return [p.nombre, p.apellido].filter(Boolean).join(" ");
      return occId;
    });

    const ocupantesHtml = ocupantesNombres.length > 0
      ? ocupantesNombres.map(n => `<span style="display:inline-block; background:rgba(0,191,255,0.2); padding:2px 6px; border-radius:4px; margin:2px 4px 2px 0;">${escapeHtml(n)}</span>`).join("")
      : `<span style="color:#94a3b8; font-size:11px;">Sin tripulación detectada.</span>`;

    dom.selectionInfo.innerHTML = `
      <div style="font-weight:bold; color:#00ffa6; margin-bottom:4px;">${escapeHtml(name)}</div>
      <div style="font-size:11px; margin-bottom:8px;">Tipo: ${escapeHtml(type)}</div>
      <div style="font-size:11px; font-weight:bold; margin-bottom:4px;">Pasajeros a bordo:</div>
      <div style="margin-bottom:12px;">${ocupantesHtml}</div>
      <button id="btnChatVehiculo" class="btnBeige" style="width:100%; font-size:12px; padding:6px;">Mensaje a Tripulación</button>
    `;

    // Asignar evento al botón dinámicamente
    const btnChat = document.getElementById("btnChatVehiculo");
    if (btnChat) {
      btnChat.addEventListener("click", () => {
        // Enviar evento para abrir chat con el tag del vehículo
        document.dispatchEvent(new CustomEvent("openVehicleChat", { detail: { vehicleName: name } }));
      });
    }
  } else {
    if (trackingKey && trackingKey.startsWith("P:")) type = "Personal (Rastreo)";
    if (trackingKey && trackingKey.startsWith("E:")) type = "Equipo (Rastreo)";
    if (trackingKey && trackingKey.startsWith("D:")) type = "Dispositivo (Rastreo)";

    dom.selectionInfo.innerHTML = `
      <div style="font-weight:bold; color:#00ffa6;">${escapeHtml(name)}</div>
      <div style="font-size:11px; margin-top:2px;">Tipo: ${escapeHtml(type)}</div>
    `;
  }
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function formatCoord(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(6) : "-";
}

function formatBattery(value) {
  const battery = firstValue(value);
  if (battery == null) return "-";
  const text = String(battery).trim();
  return text.endsWith("%") ? text : `${text}%`;
}

function isRealBiometricValue(value) {
  const raw = firstValue(value);
  if (raw == null) return false;
  const text = String(raw).trim();
  if (!text || ["-", "N/A", "NA", "NULL", "UNDEFINED", "SIN DATOS"].includes(text.toUpperCase())) return false;
  const number = Number(text.replace("%", ""));
  return Number.isFinite(number) ? number > 0 : true;
}

function renderPersonBiometricRow(label, value, unit = "") {
  if (!isRealBiometricValue(value)) return "";
  return `<div class="personInfoLabel">${escapeHtml(label)}:</div><div class="personInfoValue">${escapeHtml(String(value))}${unit}</div>`;
}

function normalizeDegrees(value) {
  const raw = firstValue(value);
  if (raw == null || raw === "-") return "-";
  const num = Number(String(raw).replace("°", "").trim());
  if (!Number.isFinite(num)) return raw;
  const normalized = ((num % 360) + 360) % 360;
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1);
}

function parseTimestamp(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatStatusTime(timestamp) {
  return timestamp ? formatTime(new Date(timestamp).toISOString()) : "";
}

function getPersonalLiveRecord(personId, anchor = {}) {
  const id = String(personId || "").trim();
  const stored = personalLiveData.get(id) || {};
  const history = dashboardState.trackingHistory?.get(`P:${id}`) || {};
  const liveData = history.liveData || {};
  return {
    ...stored,
    ...liveData,
    ...anchor,
    lat: firstValue(anchor.lat, liveData.lat, liveData.latitud, stored.lat, stored.latitud, history.lat),
    lng: firstValue(anchor.lng, anchor.lon, liveData.lng, liveData.lon, liveData.longitud, stored.lng, stored.lon, stored.longitud, history.lng),
    timestamp: firstValue(
      anchor.timestamp,
      anchor.updated_at,
      liveData.timestamp,
      liveData.updated_at,
      liveData.fecha_actualizacion,
      liveData.ultima_actualizacion,
      stored.timestamp,
      stored.updated_at,
      history.time
    ),
    rumbo_grados: firstValue(
      anchor.rumbo_grados,
      anchor.rumboGrados,
      anchor.headingDegrees,
      anchor.heading,
      anchor.bearing,
      liveData.rumbo_grados,
      liveData.rumboGrados,
      liveData.headingDegrees,
      liveData.heading,
      liveData.bearing,
      stored.rumbo_grados,
      stored.rumboGrados,
      stored.headingDegrees,
      stored.heading,
      stored.bearing
    )
  };
}

function getConnectionStatus(personId, person = {}, live = {}) {
  const timestamp = parseTimestamp(live.timestamp);
  if (!timestamp) {
    return {
      online: false,
      text: "SIN CONEXIÓN",
      detail: "Sin ubicación reciente",
      timestamp: null
    };
  }

  const ageMs = Date.now() - timestamp;
  if (ageMs <= PERSONAL_CONNECTION_STALE_MS) {
    return {
      online: true,
      text: "EN LÍNEA",
      detail: `Actualizado ${formatStatusTime(timestamp)}`,
      timestamp
    };
  }

  return {
    online: false,
    text: "SIN CONEXIÓN",
    detail: `Última vez ${formatStatusTime(timestamp)}`,
    timestamp
  };
}

function sameText(a, b) {
  const clean = (value) => String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return clean(a) && clean(a) === clean(b);
}

function normalizeSidcText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function sidcTextIncludes(text, ...needles) {
  return needles.some((needle) => text.includes(needle));
}

function buildTrackingSidc(identity = "F", dimension = "G", icon = "U-----") {
  const safeIcon = String(icon || "U-----").padEnd(6, "-").slice(0, 6);
  return `S${identity}${dimension}P${safeIcon}-----`;
}

function getPersonalSidc(person = {}, live = {}) {
  const provided = firstValue(
    person.sidc,
    person.codigo_sidc,
    person.mil_sidc,
    live.sidc,
    live.codigo_sidc,
    live.mil_sidc
  );
  if (provided) return String(provided);

  const text = normalizeSidcText([
    person.rol_en_operacion,
    person.rol,
    live.rol_en_operacion,
    live.rol,
    person.puesto,
    person.nombre,
    person.apellido,
    person.apodo
  ].filter(Boolean).join(" "));

  if (sidcTextIncludes(text, "CUT", "CET")) return buildTrackingSidc("F", "G", "U-----");
  return buildTrackingSidc("F", "G", "UCP---");
}

function getPersonId(person = {}) {
  return firstValue(
    person.id_personal,
    person.id,
    person.id_usuario,
    person.id_persona,
    person.personal_id,
    person.usuario_id
  );
}

function getPersonName(person = {}) {
  return [person.nombre, person.apellido].filter(Boolean).join(" ").trim() ||
    person.apodo ||
    person.name ||
    person.nombre_completo ||
    "";
}

function getAvailablePersonal() {
  const op = getCurrentOperation();
  const asignacion = getJsonStorage(ASIGNACION_ACTUAL_KEY, {}) || {};
  return [
    ...(Array.isArray(asignacion.personal) ? asignacion.personal : []),
    ...(Array.isArray(op.personal) ? op.personal : [])
  ];
}

function findPerson(personId, fallbackName = "") {
  const people = getAvailablePersonal();
  const id = String(personId || "").trim();
  const byId = people.find((person) => String(getPersonId(person) || "").trim() === id);
  if (byId) return byId;
  return people.find((person) => sameText(getPersonName(person), fallbackName));
}

function getDeviceId(device = {}) {
  return firstValue(
    device.id_dispositivo,
    device.id,
    device.dispositivo_id,
    device.idDispositivo,
    device.device_id
  );
}

function getDeviceDisplayName(device = {}) {
  return [
    device.tipo,
    device.marca,
    device.modelo
  ].filter(Boolean).join(" ").trim() ||
    device.nombre ||
    device.name ||
    (getDeviceId(device) ? `Dispositivo ${getDeviceId(device)}` : "Dispositivo");
}

function getDeviceCompactName(device = {}) {
  return [
    device.marca,
    device.modelo
  ].filter(Boolean).join(" ").trim() ||
    device.modelo ||
    device.marca ||
    device.tipo ||
    device.nombre ||
    device.name ||
    "Dispositivo";
}

function getDeviceCodeValue(device = {}) {
  return firstValue(
    device.numeroSerie,
    device.numero_serie,
    device.serial,
    device.serial_dispositivo,
    device.imei,
    device.numeroTelefono,
    device.numero_telefono,
    device.telefono,
    device.phone
  ) || "Sin identificador";
}

function uniqueDeviceKey(device = {}) {
  const id = getDeviceId(device);
  if (id != null && String(id).trim() !== "") return `id:${String(id).trim()}`;

  const code = getDeviceCodeValue(device);
  if (code && code !== "Sin identificador") return `code:${String(code).trim()}`;

  return `name:${getDeviceDisplayName(device).toLowerCase()}`;
}

function deviceMatchesIdentifier(device = {}, identifier) {
  const target = String(identifier || "").trim().toLowerCase();
  if (!target) return false;

  return [
    getDeviceId(device),
    device.dispositivo_id,
    device.idDispositivo,
    device.device_id,
    device.numeroTelefono,
    device.numero_telefono,
    device.telefono,
    device.phone,
    device.imei,
    device.numeroSerie,
    device.numero_serie,
    device.serial,
    device.serial_dispositivo
  ].some((value) => String(value || "").trim().toLowerCase() === target);
}

function formatBiometricOrigin(value) {
  const text = String(value || "").trim().replace(/[_-]+/g, " ");
  if (!text) return "";
  if (text === text.toUpperCase()) {
    return text.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return text;
}

function getAssignedDevices(person = {}, personId, personName) {
  const op = getCurrentOperation();
  const asignacion = getJsonStorage(ASIGNACION_ACTUAL_KEY, {}) || {};
  const devices = [
    ...(Array.isArray(asignacion.dispositivos) ? asignacion.dispositivos : []),
    ...(Array.isArray(op.dispositivos) ? op.dispositivos : []),
    ...(Array.isArray(person.dispositivos) ? person.dispositivos : []),
    ...(Array.isArray(person.devices) ? person.devices : [])
  ];
  const assignments = [
    ...(Array.isArray(asignacion.asignacionDispositivos) ? asignacion.asignacionDispositivos : []),
    ...(Array.isArray(op.asignacionDispositivos) ? op.asignacionDispositivos : []),
    ...(Array.isArray(op.asignacion_dispositivos) ? op.asignacion_dispositivos : [])
  ];
  const id = String(personId || getPersonId(person) || "").trim();
  const name = personName || getPersonName(person);
  const matched = [];
  const seen = new Set();
  const pushDevice = (device) => {
    if (!device) return;
    const key = uniqueDeviceKey(device);
    if (seen.has(key)) return;
    seen.add(key);
    matched.push(device);
  };

  devices
    .filter((device) =>
      String(device.id_personal || device.personal_id || device.id_persona || "").trim() === id
    )
    .forEach(pushDevice);

  assignments
    .filter((a) => String(a.id_personal || "").trim() === id)
    .forEach((directAssignment) => {
      const assignedId = String(directAssignment.id_dispositivo || directAssignment.id || "").trim();
      if (assignedId) {
        const byId = devices.find((device) =>
          String(device.id_dispositivo || device.id || "").trim() === assignedId
        );
        pushDevice(byId || directAssignment);
      }
    });

  devices
    .filter((device) =>
      sameText(device.responsable || device.asignado_a_personal || device.personal_nombre, name)
    )
    .forEach(pushDevice);

  return matched;
}

function getBiometricSourceLabel(live = {}, person = {}, assignedDevices = [], assignedDevice = {}) {
  const metadata = [
    live.metadata,
    live.signos_metadata,
    person.metadata,
    person.signos_metadata
  ].find((value) => value && typeof value === "object" && !Array.isArray(value)) || {};
  const sourceId = firstValue(
    live.dispositivo_id,
    live.signos_dispositivo_id,
    live.device_id,
    live.deviceId,
    person.dispositivo_id,
    person.signos_dispositivo_id
  );
  const metadataOrigin = firstValue(
    metadata.device_name,
    metadata.deviceName,
    metadata.nombre_dispositivo,
    metadata.modelo,
    metadata.model,
    metadata.origen,
    metadata.source
  );
  const origin = firstValue(
    metadataOrigin,
    live.origen,
    live.signos_origen,
    live.source,
    live.fuente,
    person.origen,
    person.signos_origen
  );

  const sourceDevice = sourceId
    ? assignedDevices.find((device) => deviceMatchesIdentifier(device, sourceId))
    : null;
  if (sourceDevice) return getDeviceCompactName(sourceDevice);

  const originText = formatBiometricOrigin(origin);
  if (originText) {
    const byType = assignedDevices.find((device) => sameText(device.tipo, originText));
    if (byType) return getDeviceCompactName(byType);
    return originText;
  }

  const wearable = assignedDevices.find((device) =>
    ["SMARTWATCH", "WEARABLE", "RELOJ"].includes(String(device.tipo || "").trim().toUpperCase())
  );
  if (wearable) return getDeviceCompactName(wearable);

  return assignedDevice && Object.keys(assignedDevice).length ? getDeviceCompactName(assignedDevice) : "";
}

function normalizeCameraProtocol(value) {
  const protocol = String(value || "WEBRTC").trim().toUpperCase();
  return protocol === "RTMP" ? "RTMP" : "WEBRTC";
}

function getPersonCameraProtocol(person = {}, live = {}) {
  return normalizeCameraProtocol(firstValue(
    live.camera_protocol,
    live.protocolo_camara,
    live.protocol,
    person.camera_protocol,
    person.protocolo_camara,
    person.protocol
  ));
}

function renderWaitingCameraSignal(protocol) {
  const label = normalizeCameraProtocol(protocol);
  return `
    <div class="personCameraWaiting" data-protocol="${escapeHtml(label)}">
      <span>Esperando señal</span>
    </div>
  `;
}

function placePersonInfoPopup(anchor = {}) {
  if (!dom.personInfoPopup) return;

  const width = Math.min(318, window.innerWidth - 28);
  const x = Number(anchor.x);
  const y = Number(anchor.y);

  if (Number.isFinite(x) && Number.isFinite(y)) {
    const leftPanelEdge = Math.max(
      dom.infoPanel?.getBoundingClientRect?.().right || 0,
      dom.chatAudiencePanel?.getBoundingClientRect?.().right || 0,
      dom.chatPanel?.getBoundingClientRect?.().right || 0,
      dom.routePanel?.getBoundingClientRect?.().right || 0,
      dom.tacticalPanel?.getBoundingClientRect?.().right || 0,
      88
    );
    const preferredLeft = x < leftPanelEdge + 40
      ? leftPanelEdge + 14
      : x - width / 2;

    dom.personInfoPopup.style.right = "auto";
    dom.personInfoPopup.style.left = `${Math.max(12, Math.min(preferredLeft, window.innerWidth - width - 12))}px`;
    dom.personInfoPopup.style.top = `${Math.max(80, Math.min(y - 235, window.innerHeight - 300))}px`;
    return;
  }

  dom.personInfoPopup.style.right = "22px";
  dom.personInfoPopup.style.top = "132px";
  dom.personInfoPopup.style.left = "auto";
}

export function showPersonnelDetail(personId, anchor = {}) {
  if (!dom.personInfoPopup || !dom.personInfoPopupContent || personId == null) return;

  const person = findPerson(personId, anchor.name);
  if (!person) {
    console.warn("[PERSONAL] No se encontro informacion para:", personId, anchor.name);
    return;
  }

  const id = String(personId);
  const live = getPersonalLiveRecord(id, anchor);
  const nombre = getPersonName(person) || anchor.name || `Personal ${personId}`;
  const assignedDevices = getAssignedDevices(person, personId, nombre);
  const assignedDevice = assignedDevices[0] || {};
  const liveCoords = getPersonalEntityCoordinates(personId);
  const lat = firstValue(live.lat, liveCoords?.lat, person.latitud, person.lat);
  const lng = firstValue(live.lng, liveCoords?.lon, person.longitud, person.lng, person.lon);
  const velocidad = firstValue(live.velocidad, live.speed, live.velocidad_kmh, person.velocidad, person.speed, person.velocidad_kmh, "0.00");
  const connectionStatus = getConnectionStatus(id, person, live);
  const fc = firstValue(live.frecuencia_cardiaca_bpm, live.frecuencia_cardiaca, live.fc, live.heart_rate_bpm, live.heart_rate, person.frecuencia_cardiaca_bpm, person.frecuencia_cardiaca, person.fc, person.heart_rate_bpm, person.heart_rate, assignedDevice.frecuencia_cardiaca_bpm, assignedDevice.frecuencia_cardiaca, assignedDevice.fc, assignedDevice.heart_rate_bpm, assignedDevice.heart_rate);
  const spo2 = firstValue(live.oxigenacion_spo2, live.spo2, live.oxigenacion, person.oxigenacion_spo2, person.spo2, person.oxigenacion, assignedDevice.oxigenacion_spo2, assignedDevice.spo2, assignedDevice.oxigenacion);
  const temp = firstValue(live.temperatura_c, live.temperatura, live.temperature_c, person.temperatura_c, person.temperatura, person.temperature_c);
  const resp = firstValue(live.frecuencia_respiratoria_rpm, live.respiracion, live.respiratory_rate, person.frecuencia_respiratoria_rpm, person.respiracion, person.respiratory_rate);
  const baro = firstValue(live.presion_barometrica_hpa, live.barometro, live.baro, live.presion, live.pressure, person.presion_barometrica_hpa, person.barometro, person.baro, person.presion, person.pressure);
  const bateria = formatBattery(firstValue(live.bateria_pct, live.bateria, live.battery, live.battery_level, person.bateria_pct, person.bateria, person.battery, person.battery_level, assignedDevice.bateria_pct, assignedDevice.bateria, assignedDevice.battery, assignedDevice.battery_level, assignedDevice.nivel_bateria));
  const actualizado = firstValue(live.signos_actualizacion, live.timestamp, person.signos_actualizacion, person.updated_at, person.fecha_actualizacion, person.ultima_actualizacion, person.timestamp);
  const cameraProtocol = getPersonCameraProtocol(person, live);
  const dispositivosHtml = assignedDevices.length
    ? assignedDevices.map((device) => {
      const code = getDeviceCodeValue(device);
      return `<div class="personInfoDeviceLine">${escapeHtml(`${getDeviceDisplayName(device)} (${code})`)}</div>`;
    }).join("")
    : `<div class="personInfoDeviceLine muted">-</div>`;
  const hasBiometricData = [fc, spo2, temp, resp, baro].some(isRealBiometricValue);
  const biometricSource = hasBiometricData ? getBiometricSourceLabel(live, person, assignedDevices, assignedDevice) : "";
  const biometricTitle = biometricSource ? `Biometricos (${biometricSource})` : "Biometricos";
  const biometricRows = [
    renderPersonBiometricRow("FC", fc, " bpm"),
    renderPersonBiometricRow("SpO2", spo2, "%"),
    renderPersonBiometricRow("Temp", temp, " C"),
    renderPersonBiometricRow("Resp", resp, " rpm"),
    renderPersonBiometricRow("Baro", baro, " hPa"),
    bateria !== "-" ? `<div class="personInfoLabel">Bateria:</div><div class="personInfoValue">${escapeHtml(bateria)}</div>` : ""
  ].filter(Boolean).join("");
  const biometricHtml = hasBiometricData ? `
    <div class="personInfoBio">
      <div class="personInfoBioTitle">${escapeHtml(biometricTitle)}</div>
      <div class="personInfoGrid">
        ${biometricRows}
      </div>
      <div class="personInfoUpdated">${escapeHtml(actualizado ? `Actualizado ${formatTime(actualizado)}` : "Sin datos recientes")}</div>
    </div>
  ` : "";

  dom.personInfoPopupContent.innerHTML = `
    <h3 class="personInfoTitle">${escapeHtml(nombre)}</h3>
    <div class="personInfoGrid">
      <div class="personInfoLabel">Lat:</div><div class="personInfoValue">${escapeHtml(formatCoord(lat))}</div>
      <div class="personInfoLabel">Lng:</div><div class="personInfoValue">${escapeHtml(formatCoord(lng))}</div>
      <div class="personInfoLabel">Vel:</div><div class="personInfoValue">${escapeHtml(String(velocidad))} km/h</div>
    </div>
    <div class="personInfoDevices">
      <div class="personInfoDeviceLabel">Dispositivos:</div>
      <div class="personInfoDeviceList">${dispositivosHtml}</div>
    </div>
    <div class="personInfoStatus ${connectionStatus.online ? "online" : "offline"}">
      Estado <strong>${escapeHtml(connectionStatus.text)}</strong>
      <span>${escapeHtml(connectionStatus.detail)}</span>
    </div>
    ${biometricHtml}
    <div class="personInfoCamera">
      ${renderWaitingCameraSignal(cameraProtocol)}
    </div>
    <button class="personInfoMessageBtn" type="button">Enviar mensaje</button>
  `;

  dom.personInfoPopupContent.querySelector(".personInfoMessageBtn")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dom.chatAudiencePanel?.classList.add("open");
    dom.chatPanel?.classList.add("open");
    dom.toggleChatPanel?.classList.add("active");
    document.dispatchEvent(new CustomEvent("openEntityChat", {
      detail: {
        entityName: nombre,
        contextType: "PERSONAL",
        target: "person",
        trackingKey: `P:${id}`,
        role: person.rol_en_operacion || person.rol || ""
      }
    }));
    dom.personInfoPopup?.classList.add("hidden");
    window.setTimeout(() => dom.chatInput?.focus(), 0);
  });

  const cameraContainer = dom.personInfoPopupContent.querySelector(".personInfoCamera");
  try {
    Promise.resolve(renderPersonnelLiveCamera(cameraContainer, personId, nombre)).catch((err) => {
      console.warn("[PERSONAL] No se pudo cargar la camara en la ficha:", err);
    });
  } catch (err) {
    console.warn("[PERSONAL] No se pudo iniciar la camara en la ficha:", err);
  }

  if (dom.btnClosePersonInfoPopup) {
    dom.btnClosePersonInfoPopup.onclick = () => {
      dom.personInfoPopup?.classList.add("hidden");
      activePersonInfoPopup = null;
      stopPersonInfoRefreshTimer();
    };
  }

  activePersonInfoPopup = { personId: id, anchor };
  startPersonInfoRefreshTimer();
  dom.personInfoPopup.classList.remove("hidden");
  placePersonInfoPopup(anchor);
}

function startPersonInfoRefreshTimer() {
  if (personInfoRefreshTimer) return;
  personInfoRefreshTimer = window.setInterval(() => {
    if (!activePersonInfoPopup || dom.personInfoPopup?.classList.contains("hidden")) {
      stopPersonInfoRefreshTimer();
    }
  }, 5000);
}

function stopPersonInfoRefreshTimer() {
  if (!personInfoRefreshTimer) return;
  window.clearInterval(personInfoRefreshTimer);
  personInfoRefreshTimer = null;
}

export function refreshPersonnelInfoPopup(personId, data = {}) {
  const id = String(personId || data?.id_personal || "").trim();
  if (!id) return;

  personalLiveData.set(id, {
    ...(personalLiveData.get(id) || {}),
    ...data,
    timestamp: firstValue(
      data.timestamp,
      data.updated_at,
      data.fecha_actualizacion,
      data.ultima_actualizacion,
      Date.now()
    )
  });

  if (!activePersonInfoPopup || activePersonInfoPopup.personId !== id || dom.personInfoPopup?.classList.contains("hidden")) {
    return;
  }

  // No re-render the full popup while it is open, to avoid restarting the live camera feed.
  // The camera should remain playing continuously even as tracking data updates.
}
