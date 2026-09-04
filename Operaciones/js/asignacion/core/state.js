export const initialState = {
  // Estado persistente (lo que se guarda en storage)
  asignacionCelulas: {},
  asignacionVehiculos: [], // Estructura plana: [{ id_vehiculo, tipo_destino, id_personal, id_grupo_operacion }]
  asignacionEquipos: [], // Estructura plana: [{ id_equipo, tipo_destino, id_personal, id_grupo_operacion, categoria }]
  asignacionDispositivos: [], // Estructura plana: [{ id_dispositivo, id_personal }]

  // Estado de navegación y UI temporal
  categoria: null,
  pasoPersonal: "home",
  cetActivoIndex: 0,
  cetActivoIndexVeh: 0,

  // Selecciones temporales
  cutSeleccionado: null,
  cetSeleccionados: [],
  selectedVehicle: null,
  selectedCells: [],
  equipoCategoria: null,
  equipoDestino: null,
  equipoSelectedItems: [],
  equipoSelectedResource: null,
  equipoSelectedCet: null,
  equipoSelectedGrupo: null,
  dispositivoSelectedItems: [],
  dispositivoSelectedResource: null,
  dispositivoSelectedCet: null,
  dispositivoSelectedGrupo: null,
  dispositivosLiberadosLocalmente: [],
  dispositivosLeftScrollTop: 0,
  dispositivosRightScrollTop: 0,
  equiposLiberadosLocalmente: [],
  vehiculosLiberadosLocalmente: [],
  vehiculosGridScrollTop: 0,
  equiposLeftScrollTop: 0,
  equiposRightScrollTop: 0,

  // Datos de catálogo (cargados desde API/storage)
  cutList: [],
  cetList: [],
  celulasList: [],
  vehiclesList: [],
  tacticalEquipmentList: [],
  communicationEquipmentList: [],
  dispositivosList: [],

  // Mapeos para resolución de IDs (Nombre -> ID)
  personalMap: {}, // { "Nombre Apellido": id_personal }
  personalDetails: {}, // { "Apodo": { nombre, apellido, puesto, rol } }

  // Personal ocupado en otra operación: { "Nombre Apellido": "nombre de la operación" }
  personalEnOperacion: {},

  // Datos derivados o temporales
  flotillaByCet: {},
  flotillaOrderByCet: {},
  searchByCet: {},
  gruposByCet: {}
};

export const state = structuredClone(initialState);
