import { state } from "../../core/state.js";
import { normalizeEquipoCategoria, generateUUID } from "../../core/utils.js";
import { DEFAULT_GROUP_INFO } from "../../core/constants.js";

// 1. Configuramos la base de la API igual que en tu control_personal.js
const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;

/**
 * Función auxiliar para centralizar las peticiones fetch con Token
 */
async function apiFetch(path, { required = false } = {}) {
  const token = localStorage.getItem("token");
  
  try {
    // IMPORTANTE: Verifica si tu server requiere el prefijo /api o no.
    // Si el router de express dice router.get("/catalog/..."), usa path directamente.
    const response = await fetch(`${API_BASE}${path}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    if (response.status === 404) {
      console.warn(`Ruta no encontrada: ${path}. Intenta quitar o poner el prefijo /api`);
    }

    if (!response.ok) throw new Error(`Error ${response.status}: ${response.statusText}`);
    
    const data = await response.json();
    if (!data.ok) {
      if (required) throw new Error(data.mensaje || `Respuesta invalida de ${path}`);
      return [];
    }
    return data.items || [];
  } catch (error) {
    console.error(`Fallo en petición [${path}]:`, error.message);
    if (required) throw error;
    return [];
  }
}

// --- Mappers ---

function mapPersonal(data) {
  return data
    .map(x => {
      const apodo = (x.apodo ?? "").trim();
      return {
        id: x.id_personal ?? generateUUID(),
        nombre: apodo,
        nombre_real: (x.nombre ?? "").trim(),
        apellido: (x.apellido ?? "").trim(),
        puesto: (x.puesto ?? "").trim(),
        rol: (x.rol ?? "").trim(),
        en_operacion: !!x.en_operacion,
        nombre_operacion: x.nombre_operacion ?? null
      };
    })
    .filter(x => x.nombre !== "");
}

function mapVehiculos(data) {
  return data.map(x => ({
    id: x.id_vehiculo ?? generateUUID(),
    name: (x.alias ?? "").trim() || x.codigo_interno || "Vehículo",
    image: x.imagen_veh ?? "",
    serialNumber: x.codigo_interno ?? "",
    type: x.tipo ?? "",
    alias: x.alias ?? "",
    status: x.estado ?? "DISPONIBLE",
    capacity: Number(x.capacidad ?? 0)
  })).filter(x => x.name !== "");
}

function mapEquipos(data) {
  return data.map(x => ({
    id: x.id_equipo ?? generateUUID(),
    nombre: x.nombre ?? "Equipo",
    tipo: normalizeEquipoCategoria(x.categoria),
    image: x.imagen_eq ?? "",
    numeroSerie: x.numero_serie ?? "",
    estado: x.estado ?? "DISPONIBLE",
    detalles: x.detalles ?? ""
  })).filter(x => x.nombre.trim() !== "");
}

function mapDispositivos(data) {
  return data.map(x => ({
    id: x.id_dispositivo ?? generateUUID(),
    tipo: x.tipo ?? "",
    marca: x.marca ?? "",
    modelo: x.modelo ?? "",
    image: x.imagen_disp ?? "",
    numeroTelefono: x.numero_telefono ?? "",
    imei: x.imei ?? "",
    numeroSerie: x.numero_serie ?? "",
    sistemaOperativo: x.sistema_operativo ?? "",
    estado: x.estado ?? "DISPONIBLE",
    responsable: x.responsable ?? "",
    detalles: x.detalles ?? ""
  })).filter(x => `${x.marca} ${x.modelo}`.trim() !== "");
}

// --- Función Principal ---

export async function hydrateCatalogsFromControl(excludeOpId = null) {
  // excludeOpId: en modo edición, excluye esta operación del chequeo de ocupación
  const opParam = excludeOpId ? `&exclude_op=${excludeOpId}` : "";

  const [rawCuts, rawCets, rawCells, rawVehiculos, rawEquipos, rawDispositivos] = await Promise.all([
    apiFetch(`/catalog/personal?rol=CUT${opParam}`),
    apiFetch(`/catalog/personal?rol=CET${opParam}`),
    apiFetch(`/catalog/personal?rol=CELL${opParam}`),
    apiFetch('/catalog/vehiculos'),
    apiFetch('/catalog/equipos'),
    apiFetch('/catalog/dispositivos')
  ]);

  // Personal
  const cuts = mapPersonal(rawCuts);
  const cets = mapPersonal(rawCets);
  const cells = mapPersonal(rawCells);

  state.cutList = cuts.map(x => x.nombre);
  state.cetList = cets.map(x => x.nombre);
  state.celulasList = cells.map(x => x.nombre);

  // Poblar mapa de búsqueda Nombre -> ID y mapa de ocupación
  state.personalMap = {};
  state.personalDetails = {};
  state.personalEnOperacion = {};
  [...cuts, ...cets, ...cells].forEach(p => {
    state.personalMap[p.nombre] = p.id;
    state.personalDetails[p.nombre] = {
      nombre: p.nombre_real,
      apellido: p.apellido,
      puesto: p.puesto,
      rol: p.rol,
      apodo: p.nombre
    };
    if (p.en_operacion && p.nombre_operacion) {
      state.personalEnOperacion[p.nombre] = p.nombre_operacion;
    }
  });

  // Vehículos
  const vehiculos = mapVehiculos(rawVehiculos);
  if (vehiculos.length > 0) state.vehiclesList = vehiculos;

  // Equipos
  const equipos = mapEquipos(rawEquipos);
  if (equipos.length > 0) {
    state.tacticalEquipmentList = equipos.filter(x => x.tipo === "tactico");
    state.communicationEquipmentList = equipos.filter(x => x.tipo === "comunicacion");
  }

  state.dispositivosList = mapDispositivos(rawDispositivos);
}

// Construye el nombre formateado igual que mapPersonal (puesto + nombre + apellido)
function buildNombre(row) {
  return (row.apodo ?? "").trim();
}

/**
 * Hidrata el state con la asignación ya guardada en BD para una operación existente.
 * Se llama cuando entry === "edit", después de hydrateCatalogsFromControl().
 */
export async function hydrateAsignacionFromBD(idOperacion) {
  state.equiposLiberadosLocalmente = [];
  state.vehiculosLiberadosLocalmente = [];
  state.vehiculosGridScrollTop = 0;
  state.equiposLeftScrollTop = 0;
  state.equiposRightScrollTop = 0;
  state.dispositivosLiberadosLocalmente = [];
  state.dispositivosLeftScrollTop = 0;
  state.dispositivosRightScrollTop = 0;

  const [personalRows, vehiculosRows, equiposRows, dispositivosRows] = await Promise.all([
    apiFetch(`/ops/${idOperacion}/personal`, { required: true }),
    apiFetch(`/ops/${idOperacion}/vehiculos-asignados`, { required: true }),
    apiFetch(`/ops/${idOperacion}/equipos-asignados`, { required: true }),
    apiFetch(`/ops/${idOperacion}/dispositivos-asignados`, { required: true })
  ]);

  console.log("[HYDRATE] personal rows →", personalRows);
  console.log("[HYDRATE] vehiculos rows →", vehiculosRows);
  console.log("[HYDRATE] equipos rows →", equiposRows);
  console.log("[HYDRATE] dispositivos rows →", dispositivosRows);

  // ── 1. PERSONAL ───────────────────────────────────────────────────────────
  // Deduplicar por id_personal (LEFT JOINs pueden duplicar)
  const seen = new Set();
  const personal = personalRows.filter(r => {
    if (seen.has(r.id_personal)) return false;
    seen.add(r.id_personal);
    return true;
  });

  state.cutSeleccionado = null;
  state.cetSeleccionados = [];
  state.flotillaByCet = {};
  state.asignacionCelulas = {};
  state.gruposByCet = {};

  // CUT
  const cutRow = personal.find(r => r.rol_en_operacion === "CUT");
  if (cutRow) state.cutSeleccionado = buildNombre(cutRow);

  // CETs (en orden)
  const cetRows = personal.filter(r => r.rol_en_operacion === "CET");
  state.cetSeleccionados = cetRows.map(r => buildNombre(r));

  // Flotilla por CET
  cetRows.forEach(r => {
    const cetNombre = buildNombre(r);
    if (r.cet_flotilla) state.flotillaByCet[cetNombre] = r.cet_flotilla;
  });

  // CELLS agrupadas por CET + reconstrucción de gruposByCet
  const cellRows = personal.filter(r => r.rol_en_operacion === "CELL");

  state.cetSeleccionados.forEach(cetNombre => {
    // Obtener id del CET para comparar con id_cet_ref
    const idCet = state.personalMap[cetNombre];
    const misCells = cellRows.filter(r => r.id_cet_ref === idCet);

    // asignacionCelulas: array de nombres de células
    state.asignacionCelulas[cetNombre] = misCells.map(r => buildNombre(r));

    // gruposByCet: reconstruir grupos (subgrupos nombrados)
    if (!state.gruposByCet[cetNombre]) {
      state.gruposByCet[cetNombre] = structuredClone(DEFAULT_GROUP_INFO);
    }
    const ginfo = state.gruposByCet[cetNombre];

    misCells.forEach(r => {
      const cellNombre = buildNombre(r);
      const grupoNombre = r.grupo_hijo_nombre; // null si está en mando directo

      if (grupoNombre) {
        if (!ginfo.names.includes(grupoNombre)) {
          ginfo.names.push(grupoNombre);
          ginfo.map[grupoNombre] = new Set();
        }
        ginfo.map[grupoNombre].add(cellNombre);
      }
      // Si grupoNombre es null → va a "sin grupo" (mando directo), no se agrega a ningún subgrupo
    });

    if (ginfo.idx === undefined) ginfo.idx = 0;
    if (ginfo.vehActive === undefined) ginfo.vehActive = null;

    if (ginfo.names.length > 0) {
      ginfo.idx = Math.max(0, Math.min(ginfo.idx, ginfo.names.length - 1));
      if (!ginfo.active || !ginfo.names.includes(ginfo.active)) {
        ginfo.active = ginfo.names[ginfo.idx];
      }
      if (!ginfo.vehActive || !ginfo.names.includes(ginfo.vehActive)) {
        ginfo.vehActive = ginfo.active;
      }
    } else {
      ginfo.active = null;
      ginfo.idx = 0;
      ginfo.vehActive = null;
    }
  });

  console.log("[HYDRATE] cutSeleccionado →", state.cutSeleccionado);
  console.log("[HYDRATE] cetSeleccionados →", state.cetSeleccionados);
  console.log("[HYDRATE] flotillaByCet →", state.flotillaByCet);
  console.log("[HYDRATE] asignacionCelulas →", JSON.stringify(state.asignacionCelulas, null, 2));
  console.log("[HYDRATE] gruposByCet →", JSON.stringify(
    Object.fromEntries(Object.entries(state.gruposByCet).map(([k, v]) => [k, {
      names: v.names,
      map: Object.fromEntries(Object.entries(v.map).map(([g, s]) => [g, [...s]]))
    }])),
    null, 2
  ));

  // ── 2. VEHÍCULOS ─────────────────────────────────────────────────────────
  // Cada fila = un par (id_vehiculo, id_personal)
  state.asignacionVehiculos = vehiculosRows
    .filter(r => r.id_vehiculo && r.id_personal)
    .map(r => ({
      id_vehiculo: r.id_vehiculo,
      tipo_destino: (r.tipo_destino || r.nivel_asignacion || "OPERACION").toUpperCase() === "GRUPO"
        ? "grupo"
        : "personal",
      id_personal: r.id_personal,
      // En frontend la referencia de grupo se maneja por nombre; al sincronizar se remapea a ID real.
      id_grupo_operacion: r.grupo_nombre ?? null
    }));

  console.log("[HYDRATE] asignacionVehiculos →", JSON.stringify(state.asignacionVehiculos, null, 2));

  // ── 3. EQUIPOS ───────────────────────────────────────────────────────────
  state.asignacionEquipos = equiposRows
    .filter(r =>
      r.ueo_id_personal != null ||
      r.id_vehiculo_contexto != null ||
      r.ueo_id_grupo_operacion != null
    )
    .map(r => {
      // Si el backend trae GRUPO pero además hay custodio personal, la UI de asignación
      // lo opera como equipo asignado a personal dentro de ese grupo.
      const rawTipoDestino = (r.tipo_destino || "PERSONAL").toLowerCase();
      const tipoDestino = rawTipoDestino === "grupo" ? "personal" : rawTipoDestino;
      const categoria = normalizeEquipoCategoria(r.categoria);
      return {
        id_equipo: r.id_equipo,
        tipo_destino: tipoDestino,
        id_personal: tipoDestino === "personal" ? r.ueo_id_personal : null,
        id_vehiculo: tipoDestino === "vehiculo"  ? r.id_vehiculo_contexto : null,
        categoria
      };
    });

  state.asignacionDispositivos = dispositivosRows
    .filter(r => r.id_dispositivo && r.id_personal)
    .map(r => ({
      id_dispositivo: r.id_dispositivo,
      id_personal: r.id_personal
    }));

  console.log("[HYDRATE] asignacionEquipos →", JSON.stringify(state.asignacionEquipos, null, 2));
  console.log("[HYDRATE] asignacionDispositivos →", JSON.stringify(state.asignacionDispositivos, null, 2));
  console.log("[HYDRATE] ✓ hidratación completa para operación", idOperacion);
}
