import { getAdminId, getPersonalByUsername, getPersonalIdStrict } from "../helpers/personal.js";
import { getEquipoBySerie, getGrupoId, getVehiculoByCodigo } from "../helpers/lookup.js";
import { ensureChatParticipantUsuario, ensureChatParticipantPersonal } from "../helpers/chat.js";
import { ensureSeedGridSchema, seedOperationGrid } from "../helpers/grid.js";

const OP3_CODIGO = "OP-HISTORICA-003";
const OP3_INICIO = "2024-09-12 06:00:00-06";
const OP3_FIN = "2024-09-12 21:30:00-06";
const SIM_START = new Date("2024-09-12T06:00:00-06:00");
const SIM_END = new Date("2024-09-12T21:30:00-06:00");

const ZONA_TERRESTRE = {
  type: "Polygon",
  coordinates: [[
    [-96.98500, 19.58500],
    [-96.84500, 19.58500],
    [-96.84500, 19.43500],
    [-96.98500, 19.43500],
    [-96.98500, 19.58500],
  ]],
};

const PUESTO_MANDO = { lat: 19.53630, lon: -96.91320 };
const BASE_REUNION = { lat: 19.52820, lon: -96.92160 };

const RUTAS_TERRESTRES = {
  condor1: [
    { lat: 19.53630, lon: -96.91320 },
    { lat: 19.54340, lon: -96.89960 },
    { lat: 19.55580, lon: -96.88680 },
    { lat: 19.56440, lon: -96.87220 },
    { lat: 19.55820, lon: -96.86180 },
    { lat: 19.54680, lon: -96.87260 },
    { lat: 19.53720, lon: -96.89220 },
    { lat: 19.53630, lon: -96.91320 },
  ],
  condor2: [
    { lat: 19.53630, lon: -96.91320 },
    { lat: 19.52040, lon: -96.92500 },
    { lat: 19.49920, lon: -96.93980 },
    { lat: 19.48070, lon: -96.94940 },
    { lat: 19.46380, lon: -96.95870 },
    { lat: 19.45220, lon: -96.96040 },
    { lat: 19.46800, lon: -96.94600 },
    { lat: 19.50040, lon: -96.92600 },
    { lat: 19.53630, lon: -96.91320 },
  ],
  mando: [
    { lat: 19.52820, lon: -96.92160 },
    { lat: 19.53380, lon: -96.91200 },
    { lat: 19.54020, lon: -96.91600 },
    { lat: 19.53630, lon: -96.91320 },
    { lat: 19.52820, lon: -96.92160 },
  ],
};

const PERSONAL_OP3 = [
  "cramirez",
  "lhernandez",
  "iperez",
  "dortega",
  "oreyes",
  "dperez",
  "dortiz",
  "olopez",
];

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function round(value, digits = 5) {
  return Number(value.toFixed(digits));
}

function routePoint(route, index, total, offset = 0) {
  if (!route.length) return { ...PUESTO_MANDO };
  if (route.length === 1 || total <= 1) return { ...route[0] };

  const routeProgress = (index / (total - 1)) * (route.length - 1);
  const segment = Math.min(Math.floor(routeProgress), route.length - 2);
  const local = routeProgress - segment;
  const a = route[segment];
  const b = route[segment + 1];

  const jitterLat = Math.sin(index * 0.43 + offset) * 0.00018;
  const jitterLon = Math.cos(index * 0.37 + offset) * 0.00018;

  return {
    lat: round(a.lat + (b.lat - a.lat) * local + jitterLat, 5),
    lon: round(a.lon + (b.lon - a.lon) * local + jitterLon, 5),
  };
}

function headingFromPoints(prev, current) {
  if (!prev || !current) return 0;
  const dy = current.lat - prev.lat;
  const dx = current.lon - prev.lon;
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return round((deg + 360) % 360, 2);
}

function lineString(route) {
  return {
    type: "LineString",
    coordinates: route.map((point) => [point.lon, point.lat]),
  };
}

function polygonFromCenter(center, radius = 0.004) {
  return {
    type: "Polygon",
    coordinates: [[
      [round(center.lon - radius, 6), round(center.lat + radius, 6)],
      [round(center.lon + radius, 6), round(center.lat + radius, 6)],
      [round(center.lon + radius, 6), round(center.lat - radius, 6)],
      [round(center.lon - radius, 6), round(center.lat - radius, 6)],
      [round(center.lon - radius, 6), round(center.lat + radius, 6)],
    ]],
    meta: {
      shape: "polygon",
      opacity: 0.25,
      outline_width: 2,
    },
  };
}

function circleGeometry(center, radiusMeters) {
  const points = [];
  const segments = 48;
  const earthRadius = 6378137;
  const latRad = (center.lat * Math.PI) / 180;
  const lonRad = (center.lon * Math.PI) / 180;
  const angularDistance = radiusMeters / earthRadius;

  for (let i = 0; i <= segments; i += 1) {
    const bearing = (2 * Math.PI * i) / segments;
    const pointLat = Math.asin(
      Math.sin(latRad) * Math.cos(angularDistance) +
      Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const pointLon = lonRad + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
      Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(pointLat)
    );

    points.push([
      round((pointLon * 180) / Math.PI, 6),
      round((pointLat * 180) / Math.PI, 6),
    ]);
  }

  return {
    type: "Polygon",
    coordinates: [points],
    meta: {
      shape: "circle",
      center: [round(center.lon, 6), round(center.lat, 6)],
      radius_m: radiusMeters,
      opacity: 0.18,
      outline_width: 2,
    },
  };
}

function valuePlaceholders(rowIndex, columns, jsonbColumns) {
  const base = rowIndex * columns.length;
  return `(${columns.map((column, index) => {
    const placeholder = `$${base + index + 1}`;
    return jsonbColumns.has(column) ? `${placeholder}::jsonb` : placeholder;
  }).join(",")})`;
}

function sqlColumnName(column) {
  return column === "timestamp" ? "\"timestamp\"" : column;
}

async function bulkInsert(client, table, columns, rows, {
  chunkSize = 500,
  jsonbColumns = [],
  returning = "",
} = {}) {
  if (!rows.length) return [];

  const inserted = [];
  const jsonbSet = new Set(jsonbColumns);

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const placeholders = chunk
      .map((_, rowIndex) => valuePlaceholders(rowIndex, columns, jsonbSet))
      .join(",");
    const values = chunk.flatMap((row) => columns.map((column) => {
      const value = row[column];
      return jsonbSet.has(column) && typeof value !== "string"
        ? JSON.stringify(value)
        : value;
    }));
    const query = `
      INSERT INTO ${table} (${columns.map(sqlColumnName).join(", ")})
      VALUES ${placeholders}
      ${returning ? `RETURNING ${returning}` : ""}
    `;
    const result = await client.query(query, values);
    inserted.push(...(result.rows || []));
  }

  return inserted;
}

async function resetOp3Simulation(client, idOp3) {
  await ensureSeedGridSchema(client);
  await client.query(`DELETE FROM operacion_cuadricula WHERE id_operacion = $1`, [idOp3]);

  await client.query(
    `DELETE FROM mensaje_chat
     WHERE id_chat IN (SELECT id_chat FROM chat_operacion WHERE id_operacion = $1)`,
    [idOp3]
  );

  for (const table of [
    "operacion_evento",
    "tracking_personal",
    "tracking_vehiculo",
    "aviso_operacion",
    "novedad_operacion",
    "puntos_interes",
    "dibujo_libre_operacion",
    "area_interes",
    "ruta_operacion",
    "marca_edificio",
    "ruta_navegacion",
    "grupo_vehiculo",
    "grupo_equipo",
    "uso_equipo_operacion",
    "operacion_equipo",
    "vehiculo_operacion",
    "mando_operacion",
    "grupo_operacion",
  ]) {
    await client.query(`DELETE FROM ${table} WHERE id_operacion = $1`, [idOp3]);
  }
}

function buildTrackingPersonalRows(idOp3, personalAsignado) {
  const rows = [];
  const totalPerPerson = 320;
  const routeByUsername = {
    cramirez: RUTAS_TERRESTRES.mando,
    lhernandez: RUTAS_TERRESTRES.mando,
    iperez: RUTAS_TERRESTRES.condor1,
    dortega: RUTAS_TERRESTRES.condor1,
    oreyes: RUTAS_TERRESTRES.condor1,
    dperez: RUTAS_TERRESTRES.condor2,
    dortiz: RUTAS_TERRESTRES.condor2,
    olopez: RUTAS_TERRESTRES.condor2,
  };

  personalAsignado.forEach((persona, personIndex) => {
    const route = routeByUsername[persona.username] || RUTAS_TERRESTRES.mando;
    const offset = personIndex * 0.91;

    for (let index = 0; index < totalPerPerson; index += 1) {
      const point = routePoint(route, index, totalPerPerson, offset);
      const isMando = ["cramirez", "lhernandez"].includes(persona.username);
      const precision = isMando ? 8 + (index % 5) : 5 + (index % 7);

      rows.push({
        id_operacion: idOp3,
        id_personal: persona.id_personal,
        latitud: point.lat,
        longitud: point.lon,
        altitud: round(1415 + Math.sin(index / 10 + offset) * 12, 2),
        precision_m: round(precision, 2),
        timestamp: addMinutes(SIM_START, 22 + index * 2.55 + personIndex * 0.35),
      });
    }
  });

  return rows;
}

function buildTrackingVehiculoRows(idOp3, vehiculosAsignados) {
  const rows = [];
  const totalPerVehicle = 340;

  vehiculosAsignados.forEach((item, vehicleIndex) => {
    const route = item.route;
    let previous = null;

    for (let index = 0; index < totalPerVehicle; index += 1) {
      const point = routePoint(route, index, totalPerVehicle, vehicleIndex * 1.23);
      const heading = headingFromPoints(previous, point);
      const baseSpeed = item.codigo === "VH-015" ? 24 : 31;
      const paused = index % 57 > 49;

      rows.push({
        id_operacion: idOp3,
        id_vehiculo: item.vehiculo.id_vehiculo,
        latitud: point.lat,
        longitud: point.lon,
        altitud: round(1412 + Math.cos(index / 12 + vehicleIndex) * 10, 2),
        velocidad_kmh: paused ? round(4 + (index % 4), 2) : round(baseSpeed + Math.sin(index / 8) * 8, 2),
        rumbo_grados: heading,
        precision_m: round(4 + (index % 6), 2),
        timestamp: addMinutes(SIM_START, 18 + index * 2.42 + vehicleIndex * 0.8),
      });

      previous = point;
    }
  });

  return rows;
}

function buildTacticalPois(idOp3, creadoPor, personalAsignado) {
  const pois = [];
  const creators = personalAsignado.filter((p) => p.rol === "CELL");
  const tacticalTypes = [
    { label: "Punto control", tipo: "MIL", sidc: "SFGPUCI----K", color: "#22c55e" },
    { label: "Observacion", tipo: "MIL", sidc: "SFGPUCR----K", color: "#38bdf8" },
    { label: "Interdiccion", tipo: "MIL", sidc: "SFGPUCAA---K", color: "#f97316" },
    { label: "Apoyo", tipo: "MIL", sidc: "SFGPUS----K", color: "#a855f7" },
    { label: "Riesgo vial", tipo: "RADAR", sidc: null, color: "#ef4444" },
    { label: "Punto seguro", tipo: "GENERAL", sidc: null, color: "#eab308" },
  ];

  const combinedRoute = [
    ...RUTAS_TERRESTRES.condor1,
    ...RUTAS_TERRESTRES.condor2,
    ...RUTAS_TERRESTRES.mando,
  ];

  for (let index = 0; index < 72; index += 1) {
    const creator = creators[index % creators.length] || personalAsignado[0];
    const base = combinedRoute[index % combinedRoute.length];
    const type = tacticalTypes[index % tacticalTypes.length];
    const lat = round(base.lat + Math.sin(index * 1.7) * 0.0065, 6);
    const lon = round(base.lon + Math.cos(index * 1.3) * 0.0065, 6);

    pois.push({
      tipo_creador: creator ? "PERSONAL" : "USUARIO",
      id_usuario: creator ? null : creadoPor,
      id_personal: creator?.id_personal ?? null,
      nombre: `OP3 ${type.label} ${String(index + 1).padStart(2, "0")}`,
      tipo_poi: type.tipo,
      latitud: lat,
      longitud: lon,
      descripcion: `${type.label} terrestre registrado durante barrido Condor. Sin afectacion a poblacion civil.`,
      color: type.color,
      icono_src: null,
      sidc: type.sidc,
      id_operacion: idOp3,
      fecha_creacion: addMinutes(SIM_START, 52 + index * 9),
    });
  }

  return pois;
}

function buildMapLayers(idOp3, creadoPor, cet) {
  const areas = [
    {
      nombre: "Anillo de seguridad norte",
      descripcion: "Cobertura de observacion para accesos norte.",
      geometria: circleGeometry({ lat: 19.55880, lon: -96.88120 }, 850),
      color: "#22c55e",
      fecha_creacion: addMinutes(SIM_START, 35),
    },
    {
      nombre: "Anillo de seguridad sur",
      descripcion: "Cobertura de observacion hacia corredor terrestre sur.",
      geometria: circleGeometry({ lat: 19.47520, lon: -96.95440 }, 950),
      color: "#f97316",
      fecha_creacion: addMinutes(SIM_START, 85),
    },
    {
      nombre: "Bolsa logistica",
      descripcion: "Punto de reagrupamiento y abastecimiento tactico.",
      geometria: polygonFromCenter(BASE_REUNION, 0.0035),
      color: "#3b82f6",
      fecha_creacion: addMinutes(SIM_START, 120),
    },
    {
      nombre: "Sector contacto controlado",
      descripcion: "Zona de cierre preventivo por reporte ciudadano.",
      geometria: polygonFromCenter({ lat: 19.50250, lon: -96.93280 }, 0.0042),
      color: "#ef4444",
      fecha_creacion: addMinutes(SIM_START, 238),
    },
    {
      nombre: "Area de inspeccion vehicular",
      descripcion: "Revision terrestre escalonada sin bloqueo total.",
      geometria: polygonFromCenter({ lat: 19.54160, lon: -96.89510 }, 0.0038),
      color: "#eab308",
      fecha_creacion: addMinutes(SIM_START, 318),
    },
    {
      nombre: "Cierre perimetral final",
      descripcion: "Perimetro usado para repliegue ordenado.",
      geometria: circleGeometry(PUESTO_MANDO, 700),
      color: "#14b8a6",
      fecha_creacion: addMinutes(SIM_START, 670),
    },
  ];

  const rutas = [
    {
      nombre: "Ruta tactica Condor 1",
      descripcion: "Patrullaje terrestre de sector norte y oriente.",
      geometria: lineString(RUTAS_TERRESTRES.condor1),
      color: "#22c55e",
      estado: "COMPLETADA",
      fecha_creacion: addMinutes(SIM_START, 42),
    },
    {
      nombre: "Ruta tactica Condor 2",
      descripcion: "Patrullaje terrestre de sector sur y corredor logistico.",
      geometria: lineString(RUTAS_TERRESTRES.condor2),
      color: "#f97316",
      estado: "COMPLETADA",
      fecha_creacion: addMinutes(SIM_START, 46),
    },
    {
      nombre: "Ruta mando movil",
      descripcion: "Traslado corto de mando entre puesto y reagrupamiento.",
      geometria: lineString(RUTAS_TERRESTRES.mando),
      color: "#38bdf8",
      estado: "COMPLETADA",
      fecha_creacion: addMinutes(SIM_START, 58),
    },
    {
      nombre: "Desvio seguro norte",
      descripcion: "Ruta alterna para evitar congestion civil.",
      geometria: lineString([
        { lat: 19.54520, lon: -96.90150 },
        { lat: 19.54980, lon: -96.89210 },
        { lat: 19.55220, lon: -96.88040 },
      ]),
      color: "#a855f7",
      estado: "COMPLETADA",
      fecha_creacion: addMinutes(SIM_START, 188),
    },
    {
      nombre: "Corredor sanitario",
      descripcion: "Paso reservado para ambulancia municipal.",
      geometria: lineString([
        { lat: 19.51980, lon: -96.92560 },
        { lat: 19.51040, lon: -96.92980 },
        { lat: 19.50130, lon: -96.93410 },
      ]),
      color: "#06b6d4",
      estado: "COMPLETADA",
      fecha_creacion: addMinutes(SIM_START, 300),
    },
    {
      nombre: "Repliegue final",
      descripcion: "Salida escalonada hacia base de reunion.",
      geometria: lineString([
        { lat: 19.45220, lon: -96.96040 },
        { lat: 19.48070, lon: -96.94940 },
        { lat: 19.52040, lon: -96.92500 },
        BASE_REUNION,
      ]),
      color: "#eab308",
      estado: "COMPLETADA",
      fecha_creacion: addMinutes(SIM_START, 748),
    },
  ];

  const estructuras = [
    { nombre: "Puesto de mando", tipo: "ETIQUETA", point: PUESTO_MANDO, fecha: 25 },
    { nombre: "Base de reunion", tipo: "ETIQUETA", point: BASE_REUNION, fecha: 30 },
    { nombre: "Escuela usada como referencia", tipo: "REFERENCIA", point: { lat: 19.54410, lon: -96.89990 }, fecha: 150 },
    { nombre: "Clinica municipal cercana", tipo: "REFERENCIA", point: { lat: 19.50860, lon: -96.93070 }, fecha: 210 },
    { nombre: "Bodega sin ocupantes", tipo: "REFERENCIA", point: { lat: 19.47880, lon: -96.95110 }, fecha: 260 },
    { nombre: "Cruce prioritario", tipo: "ETIQUETA", point: { lat: 19.55250, lon: -96.88160 }, fecha: 330 },
    { nombre: "Reten temporal", tipo: "ETIQUETA", point: { lat: 19.50140, lon: -96.93400 }, fecha: 412 },
    { nombre: "Salida controlada", tipo: "ETIQUETA", point: { lat: 19.52870, lon: -96.92210 }, fecha: 730 },
  ];

  const dibujos = [
    {
      puntos: RUTAS_TERRESTRES.condor1.slice(1, 5).map((point) => ({ lat: point.lat, lng: point.lon })),
      color: "#22c55e",
      grosor: 3,
      fecha_creacion: addMinutes(SIM_START, 100),
    },
    {
      puntos: RUTAS_TERRESTRES.condor2.slice(1, 5).map((point) => ({ lat: point.lat, lng: point.lon })),
      color: "#f97316",
      grosor: 3,
      fecha_creacion: addMinutes(SIM_START, 160),
    },
    {
      puntos: [
        { lat: 19.55250, lng: -96.88160 },
        { lat: 19.54160, lng: -96.89510 },
        { lat: 19.53630, lng: -96.91320 },
      ],
      color: "#eab308",
      grosor: 4,
      fecha_creacion: addMinutes(SIM_START, 405),
    },
    {
      puntos: [
        { lat: 19.50140, lng: -96.93400 },
        { lat: 19.52040, lng: -96.92500 },
        { lat: 19.52820, lng: -96.92160 },
      ],
      color: "#38bdf8",
      grosor: 4,
      fecha_creacion: addMinutes(SIM_START, 690),
    },
  ];

  const rutasNavegacion = rutas.map((ruta, index) => {
    const coords = ruta.geometria.coordinates;
    const first = coords[0];
    const last = coords[coords.length - 1];

    return {
      id_operacion: idOp3,
      geojson: ruta.geometria,
      origen_lat: first[1],
      origen_lon: first[0],
      destino_lat: last[1],
      destino_lon: last[0],
      distancia_m: 1800 + index * 430,
      duracion_s: 420 + index * 95,
      created_by_tipo: "PERSONAL",
      id_usuario: null,
      id_personal: cet.id_personal,
      id_vehiculo: null,
      activo: false,
      fecha_eliminacion: addMinutes(SIM_START, 790 + index * 4),
      eliminado_por_tipo: "PERSONAL",
      id_usuario_elim: null,
      id_personal_elim: cet.id_personal,
      fecha_creacion: ruta.fecha_creacion,
    };
  });

  return {
    areas: areas.map((area) => ({
      id_operacion: idOp3,
      tipo_creador: "USUARIO",
      id_usuario: creadoPor,
      id_personal: null,
      nombre: area.nombre,
      descripcion: area.descripcion,
      geometria: area.geometria,
      color: area.color,
      estado: "ACTIVA",
      fecha_creacion: area.fecha_creacion,
    })),
    rutas: rutas.map((ruta) => ({
      id_operacion: idOp3,
      tipo_creador: "PERSONAL",
      id_usuario: null,
      id_personal: cet.id_personal,
      nombre: ruta.nombre,
      descripcion: ruta.descripcion,
      geometria: ruta.geometria,
      color: ruta.color,
      estado: ruta.estado,
      fecha_creacion: ruta.fecha_creacion,
    })),
    estructuras: estructuras.map((item) => ({
      id_operacion: idOp3,
      tipo_creador: "PERSONAL",
      id_usuario: null,
      id_personal: cet.id_personal,
      nombre: item.nombre,
      tipo_estructura: item.tipo,
      latitud: item.point.lat,
      longitud: item.point.lon,
      estado: "ACTIVO",
      fecha_creacion: addMinutes(SIM_START, item.fecha),
    })),
    dibujos: dibujos.map((item) => ({
      tipo_creador: "PERSONAL",
      id_usuario: null,
      id_personal: cet.id_personal,
      id_operacion: idOp3,
      puntos: item.puntos,
      color: item.color,
      grosor: item.grosor,
      activo: true,
      fecha_creacion: item.fecha_creacion,
    })),
    rutasNavegacion,
  };
}

function buildMessages(idChat3, participants, personalAsignado) {
  const rows = [];
  const actores = personalAsignado.filter((p) => participants.byUsername[p.username]);
  const phaseMessages = [
    "Puesto de mando instalado. Se confirma zona logica terrestre y canales abiertos.",
    "Condor 1 toma ruta norte. Transito civil con flujo moderado.",
    "Condor 2 inicia desplazamiento hacia corredor sur. Sin contacto hostil.",
    "Dron VANT 03 en preparacion. Ventana de vuelo despejada.",
    "AVISO: vecinos reportan vehiculo detenido sobre vialidad secundaria. Se verifica sin intervenir domicilios.",
    "Se inserta punto de control preventivo. Personal mantiene distancia de seguridad.",
    "Condor 1 reporta cierre parcial por obra publica. Se habilita desvio seguro.",
    "Condor 2 confirma apoyo a transito local. No hay lesionados.",
    "AVISO: posible concentracion de civiles en mercado. Se baja velocidad y se evita bloqueo total.",
    "VANT 04 transmite imagen estable. Se actualiza objeto tactico de observacion.",
    "CET confirma lectura comun de mapa. Mantener seguimiento cada dos minutos.",
    "CUT autoriza fase de contencion discreta. Prioridad: proteger movilidad civil.",
    "Condor 1 inserta referencia tactica en cruce norte.",
    "Condor 2 inserta referencia tactica en corredor logistico.",
    "AVISO: unidad sanitaria solicita paso. Se abre corredor sanitario.",
    "Panther queda como reserva movil cerca de puesto de mando.",
    "Se descarta riesgo en bodega revisada desde exterior.",
    "Condor 1 finaliza barrido oriente. Sin hallazgos criticos.",
    "Condor 2 confirma retorno escalonado desde sur.",
    "Objetivos cumplidos. Preparar liberacion de recursos y cierre formal.",
  ];

  for (let index = 0; index < 260; index += 1) {
    const actor = actores[index % actores.length];
    const participant = participants.byUsername[actor.username];
    const urgent = index % 37 === 0 || phaseMessages[index % phaseMessages.length].startsWith("AVISO:");
    const tipo = urgent ? "URGENTE" : (index % 41 === 0 ? "SISTEMA" : "NORMAL");
    const target = actor.rol === "CELL" ? "CELL,CET" : "GLOBAL";
    const cycle = phaseMessages[index % phaseMessages.length];
    const km = (1.2 + (index % 19) * 0.28).toFixed(1);
    const minuto = String(index + 1).padStart(3, "0");
    const suffix = index % 5 === 0
      ? ` Marcador OP3-${minuto} actualizado.`
      : ` Avance estimado ${km} km desde ultimo punto.`;

    rows.push({
      id_chat: idChat3,
      id_participante: participant,
      contenido: `[${actor.apodo || actor.username}] ${cycle}${suffix}`,
      tipo_mensaje: tipo,
      destinatario_rol: target,
      destino_tipo: target === "GLOBAL" ? "GLOBAL" : null,
      destino_id: null,
      destino_label: target === "GLOBAL" ? "Canal global" : "Celulas y mando",
      fecha_envio: addMinutes(SIM_START, 12 + index * 3.35),
    });
  }

  return rows;
}

function buildAvisos(idOp3, personalAsignado, cet, cut) {
  const cells = personalAsignado.filter((p) => p.rol === "CELL");
  const contenidos = [
    "Reporte ciudadano de camioneta detenida; verificada como falla mecanica.",
    "Cruce con alto flujo peatonal; se reduce velocidad de desplazamiento.",
    "Objeto abandonado revisado visualmente; corresponde a costal de material.",
    "Unidad sanitaria solicita paso prioritario por corredor sur.",
    "Dron detecta congestion vehicular moderada en acceso norte.",
    "Vecinos solicitan informacion; se canaliza con enlace municipal.",
    "Condiciones de lluvia ligera; se ajusta separacion entre vehiculos.",
    "Punto tactico de observacion reubicado por visibilidad reducida.",
  ];

  const rows = [];
  for (let index = 0; index < 32; index += 1) {
    const emisor = cells[index % cells.length] || cet;
    const receptor = index % 4 === 0 ? cut : cet;
    const tipo = index % 11 === 0 ? "EMERGENCIA" : (index % 3 === 0 ? "CONTACTO" : (index % 2 === 0 ? "NOVEDAD" : "INFORMATIVO"));
    const sentAt = addMinutes(SIM_START, 65 + index * 21);

    rows.push({
      id_operacion: idOp3,
      id_personal_emisor: emisor.id_personal,
      tipo_receptor: "PERSONAL",
      id_personal_receptor: receptor.id_personal,
      id_usuario_receptor: null,
      tipo_aviso: tipo,
      contenido: `${contenidos[index % contenidos.length]} Folio AV-OP3-${String(index + 1).padStart(2, "0")}.`,
      estado: "ATENDIDO",
      fecha_envio: sentAt,
      fecha_atencion: addMinutes(sentAt, 6 + (index % 9)),
    });
  }

  return rows;
}

function buildNovedades(idOp3, personalAsignado, creadoPor) {
  const creators = personalAsignado.filter((p) => p.rol !== "CUT");
  const tipos = ["SITUACION", "DECISION", "ORDEN", "CAMBIO_PLAN", "INCIDENTE", "OTRO"];
  const titulos = [
    "Ajuste de ruta por flujo civil",
    "Insercion de punto tactico",
    "Confirmacion de sector limpio",
    "Cambio de cadencia de reportes",
    "Incidente menor de vialidad",
    "Cierre parcial de barrido",
    "Repliegue escalonado",
    "Liberacion de corredor sanitario",
  ];

  return Array.from({ length: 32 }, (_, index) => {
    const personal = creators[index % creators.length];
    const tipoUsuario = index % 8 === 0;

    return {
      id_operacion: idOp3,
      tipo_creador: tipoUsuario ? "USUARIO" : "PERSONAL",
      id_usuario: tipoUsuario ? creadoPor : null,
      id_personal: tipoUsuario ? null : personal.id_personal,
      tipo_novedad: tipos[index % tipos.length],
      titulo: `${titulos[index % titulos.length]} ${String(index + 1).padStart(2, "0")}`,
      descripcion: `Registro historico OP3: decision documentada durante operacion terrestre cerrada, con seguimiento de mando y sin afectacion mayor.`,
      solo_mando: index % 5 !== 0,
      fecha_registro: addMinutes(SIM_START, 80 + index * 19),
    };
  });
}

function buildTimelineEvents(idOp3, creadoPor, avisos, novedades) {
  const metaEvents = [
    {
      id_operacion: idOp3,
      tipo_evento: "operacion_activada",
      entidad_tipo: "operacion",
      entidad_id: String(idOp3),
      payload: { codigo: OP3_CODIGO, estado: "ACTIVA", nota: "Operacion terrestre activada para simulacion historica." },
      actor_tipo: "USUARIO",
      id_usuario: creadoPor,
      id_personal: null,
      occurred_at: SIM_START,
    },
    {
      id_operacion: idOp3,
      tipo_evento: "fase_operativa",
      entidad_tipo: "operacion",
      entidad_id: String(idOp3),
      payload: { fase: "contencion_y_verificacion", nota: "Se ejecutan patrullajes terrestres, avisos y objetos tacticos." },
      actor_tipo: "USUARIO",
      id_usuario: creadoPor,
      id_personal: null,
      occurred_at: addMinutes(SIM_START, 260),
    },
    {
      id_operacion: idOp3,
      tipo_evento: "operacion_cerrada",
      entidad_tipo: "operacion",
      entidad_id: String(idOp3),
      payload: { codigo: OP3_CODIGO, estado: "CERRADA", nota: "Recursos liberados y operacion cerrada sin pendientes criticos." },
      actor_tipo: "USUARIO",
      id_usuario: creadoPor,
      id_personal: null,
      occurred_at: SIM_END,
    },
  ];

  const avisoEvents = avisos.map((aviso) => ({
    id_operacion: idOp3,
    tipo_evento: "aviso_operacion",
    entidad_tipo: "aviso_operacion",
    entidad_id: String(aviso.id_aviso),
    payload: aviso,
    actor_tipo: "PERSONAL",
    id_usuario: null,
    id_personal: aviso.id_personal_emisor,
    occurred_at: aviso.fecha_envio,
  }));

  const novedadEvents = novedades.map((novedad) => ({
    id_operacion: idOp3,
    tipo_evento: "novedad_operacion",
    entidad_tipo: "novedad_operacion",
    entidad_id: String(novedad.id_novedad),
    payload: novedad,
    actor_tipo: novedad.tipo_creador,
    id_usuario: novedad.id_usuario,
    id_personal: novedad.id_personal,
    occurred_at: novedad.fecha_registro,
  }));

  return [...metaEvents, ...avisoEvents, ...novedadEvents];
}

async function seedOp3VehiculosYEquipos(client, {
  idOp3,
  creadoPor,
  personalAsignado3,
  idCondor1,
  idCondor2,
}) {
  const vehicles = [
    {
      codigo: "VH-009",
      vehiculo: await getVehiculoByCodigo(client, "VH-009"),
      grupo: idCondor1,
      responsable: personalAsignado3.find((p) => p.username === "iperez"),
      route: RUTAS_TERRESTRES.condor1,
      uso: "Patrullaje terrestre Condor 1",
    },
    {
      codigo: "VH-012",
      vehiculo: await getVehiculoByCodigo(client, "VH-012"),
      grupo: idCondor2,
      responsable: personalAsignado3.find((p) => p.username === "dperez"),
      route: RUTAS_TERRESTRES.condor2,
      uso: "Patrullaje terrestre Condor 2",
    },
    {
      codigo: "VH-015",
      vehiculo: await getVehiculoByCodigo(client, "VH-015"),
      grupo: idCondor1,
      responsable: personalAsignado3.find((p) => p.username === "oreyes"),
      route: RUTAS_TERRESTRES.mando,
      uso: "Reserva blindada y enlace de mando",
    },
  ];

  for (const item of vehicles) {
    if (!item.responsable) throw new Error(`Responsable no encontrado para ${item.codigo}`);

    await client.query(
      `INSERT INTO vehiculo_operacion
         (id_operacion, id_vehiculo, id_personal, id_grupo_operacion, nivel_asignacion, uso_en_operacion, estado_asignacion, asignado_por, fecha_asignacion)
       VALUES ($1,$2,$3,$4,'GRUPO',$5,'EN_USO',$6,$7)
       ON CONFLICT (id_operacion, id_vehiculo, id_personal) DO UPDATE SET
         id_grupo_operacion = EXCLUDED.id_grupo_operacion,
         nivel_asignacion = EXCLUDED.nivel_asignacion,
         uso_en_operacion = EXCLUDED.uso_en_operacion,
         estado_asignacion = EXCLUDED.estado_asignacion,
         asignado_por = EXCLUDED.asignado_por,
         fecha_asignacion = EXCLUDED.fecha_asignacion,
         fecha_fin_asignacion = NULL`,
      [idOp3, item.vehiculo.id_vehiculo, item.responsable.id_personal, item.grupo, item.uso, creadoPor, SIM_START]
    );

    await client.query(
      `INSERT INTO grupo_vehiculo
         (id_grupo_operacion, id_operacion, id_vehiculo, id_personal, uso_en_grupo, estado_asignacion, asignado_por, fecha_asignacion)
       VALUES ($1,$2,$3,$4,$5,'EN_USO',$6,$7)
       ON CONFLICT (id_grupo_operacion, id_vehiculo, id_personal) DO UPDATE SET
         uso_en_grupo = EXCLUDED.uso_en_grupo,
         estado_asignacion = EXCLUDED.estado_asignacion,
         asignado_por = EXCLUDED.asignado_por,
         fecha_asignacion = EXCLUDED.fecha_asignacion,
         fecha_fin_asignacion = NULL`,
      [item.grupo, idOp3, item.vehiculo.id_vehiculo, item.responsable.id_personal, item.uso, creadoPor, SIM_START]
    );
  }

  const equipos = [
    {
      serie: "HFC-003",
      equipo: await getEquipoBySerie(client, "HFC-003"),
      grupo: idCondor1,
      responsable: personalAsignado3.find((p) => p.username === "iperez"),
      vehiculo: vehicles[0].vehiculo,
      uso: "Radio principal Condor 1",
    },
    {
      serie: "HFC-004",
      equipo: await getEquipoBySerie(client, "HFC-004"),
      grupo: idCondor2,
      responsable: personalAsignado3.find((p) => p.username === "dperez"),
      vehiculo: vehicles[1].vehiculo,
      uso: "Radio principal Condor 2",
    },
    {
      serie: "HFC-005",
      equipo: await getEquipoBySerie(client, "HFC-005"),
      grupo: idCondor1,
      responsable: personalAsignado3.find((p) => p.username === "oreyes"),
      vehiculo: vehicles[2].vehiculo,
      uso: "Radio reserva mando movil",
    },
    {
      serie: "DRN-003",
      equipo: await getEquipoBySerie(client, "DRN-003"),
      grupo: idCondor1,
      responsable: personalAsignado3.find((p) => p.username === "dortega"),
      vehiculo: null,
      uso: "Dron tactico de observacion norte",
    },
    {
      serie: "DRN-004",
      equipo: await getEquipoBySerie(client, "DRN-004"),
      grupo: idCondor2,
      responsable: personalAsignado3.find((p) => p.username === "dortiz"),
      vehiculo: null,
      uso: "Dron tactico de observacion sur",
    },
    {
      serie: "DRN-005",
      equipo: await getEquipoBySerie(client, "DRN-005"),
      grupo: idCondor2,
      responsable: personalAsignado3.find((p) => p.username === "olopez"),
      vehiculo: null,
      uso: "Dron tactico reserva y documentacion",
    },
  ];

  for (const item of equipos) {
    if (!item.responsable) throw new Error(`Responsable no encontrado para ${item.serie}`);

    await client.query(
      `INSERT INTO operacion_equipo
         (id_operacion, id_equipo, cantidad, uso_en_operacion, estado_asignacion, asignado_por, fecha_asignacion)
       VALUES ($1,$2,1,$3,'EN_USO',$4,$5)
       ON CONFLICT (id_operacion, id_equipo) DO UPDATE SET
         cantidad = 1,
         uso_en_operacion = EXCLUDED.uso_en_operacion,
         estado_asignacion = EXCLUDED.estado_asignacion,
         asignado_por = EXCLUDED.asignado_por,
         fecha_asignacion = EXCLUDED.fecha_asignacion,
         fecha_fin_asignacion = NULL`,
      [idOp3, item.equipo.id_equipo, item.uso, creadoPor, SIM_START]
    );

    await client.query(
      `INSERT INTO grupo_equipo
         (id_grupo_operacion, id_operacion, id_equipo, cantidad, uso_en_grupo, estado_asignacion, asignado_por, fecha_asignacion)
       VALUES ($1,$2,$3,1,$4,'EN_USO',$5,$6)
       ON CONFLICT (id_grupo_operacion, id_equipo) DO UPDATE SET
         cantidad = 1,
         uso_en_grupo = EXCLUDED.uso_en_grupo,
         estado_asignacion = EXCLUDED.estado_asignacion,
         asignado_por = EXCLUDED.asignado_por,
         fecha_asignacion = EXCLUDED.fecha_asignacion,
         fecha_fin_asignacion = NULL`,
      [item.grupo, idOp3, item.equipo.id_equipo, item.uso, creadoPor, SIM_START]
    );

    await client.query(
      `INSERT INTO uso_equipo_operacion
         (id_operacion, id_equipo, id_personal, id_vehiculo_contexto, id_grupo_operacion, cantidad, fecha_asignacion, asignado_por, notas)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)
       ON CONFLICT (id_operacion, id_equipo, id_personal, id_grupo_operacion) DO UPDATE SET
         id_vehiculo_contexto = EXCLUDED.id_vehiculo_contexto,
         cantidad = 1,
         fecha_asignacion = EXCLUDED.fecha_asignacion,
         asignado_por = EXCLUDED.asignado_por,
         notas = EXCLUDED.notas,
         fecha_devolucion = NULL`,
      [
        idOp3,
        item.equipo.id_equipo,
        item.responsable.id_personal,
        item.vehiculo?.id_vehiculo ?? null,
        item.grupo,
        SIM_START,
        creadoPor,
        item.uso,
      ]
    );
  }

  return { vehicles, equipos };
}

export async function seedOperation3(client) {
  const creadoPor = await getAdminId(client);
  const cutOp3 = await getPersonalIdStrict(client, "cramirez");

  await client.query(
    `
    INSERT INTO operacion
      (codigo, nombre, descripcion, prioridad, estado, fecha_inicio, fecha_fin, creada_por, id_cut)
    VALUES
      ($1,$2,$3,'ALTA','ACTIVA',$4,$5,$6,$7)
    ON CONFLICT (codigo) DO UPDATE
      SET estado       = 'ACTIVA',
          nombre       = EXCLUDED.nombre,
          descripcion  = EXCLUDED.descripcion,
          prioridad    = EXCLUDED.prioridad,
          fecha_inicio = EXCLUDED.fecha_inicio,
          fecha_fin    = EXCLUDED.fecha_fin,
          creada_por   = EXCLUDED.creada_por,
          id_cut       = EXCLUDED.id_cut
    `,
    [
      OP3_CODIGO,
      "Operacion Historica 003",
      "Operacion terrestre cerrada en zona logica Xalapa-Coatepec. Incluye tracking historico, mensajes, avisos, objetos tacticos y liberacion de recursos.",
      OP3_INICIO,
      OP3_FIN,
      creadoPor,
      cutOp3,
    ]
  );

  const op3Row = await client.query(
    `SELECT id_operacion FROM operacion WHERE codigo = $1 LIMIT 1`,
    [OP3_CODIGO]
  );
  const idOp3 = op3Row.rows[0].id_operacion;

  await resetOp3Simulation(client, idOp3);

  const personalAsignado3 = [];

  for (const username of PERSONAL_OP3) {
    const persona = await getPersonalByUsername(client, username);
    if (!persona) {
      console.warn(`WARN OP3: personal "${username}" no encontrado, se omite`);
      continue;
    }

    personalAsignado3.push(persona);

    await client.query(
      `
      INSERT INTO asignacion_operacion_personal
        (id_operacion, id_personal, rol_en_operacion, estado_asignacion, asignado_por, fecha_asignacion)
      VALUES ($1,$2,$3,'ASIGNADO',$4,$5)
      ON CONFLICT (id_operacion, id_personal) DO UPDATE
        SET rol_en_operacion     = EXCLUDED.rol_en_operacion,
            estado_asignacion    = EXCLUDED.estado_asignacion,
            asignado_por         = EXCLUDED.asignado_por,
            fecha_asignacion     = EXCLUDED.fecha_asignacion,
            fecha_fin_asignacion = NULL
      `,
      [idOp3, persona.id_personal, persona.rol, creadoPor, SIM_START]
    );
  }

  const cut3 = personalAsignado3.find((p) => p.username === "cramirez");
  const cet3 = personalAsignado3.find((p) => p.username === "lhernandez");
  const cells3 = personalAsignado3.filter((p) => p.rol === "CELL");

  if (!cut3) throw new Error(`No se encontro cramirez para OP-HISTORICA-003.`);
  if (!cet3) throw new Error(`No se encontro lhernandez para OP-HISTORICA-003.`);

  for (const cell of cells3) {
    await client.query(
      `INSERT INTO mando_operacion (id_operacion, id_cet, id_cell, asignado_por, fecha_asignacion)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id_operacion, id_cell) DO UPDATE
         SET id_cet = EXCLUDED.id_cet,
             asignado_por = EXCLUDED.asignado_por,
             fecha_asignacion = EXCLUDED.fecha_asignacion`,
      [idOp3, cet3.id_personal, cell.id_personal, creadoPor, SIM_START]
    );
  }

  await client.query(
    `
    INSERT INTO grupo_operacion
      (id_operacion, nombre, apodo, id_grupo_padre, descripcion, creado_por, fecha_creacion)
    VALUES
      ($1,'Mando Terrestre OP3','HISTORICA',NULL,'Grupo raiz terrestre de Operacion Historica 003',$2,$3)
    ON CONFLICT (id_operacion, nombre) DO UPDATE
      SET apodo = EXCLUDED.apodo,
          descripcion = EXCLUDED.descripcion,
          creado_por = EXCLUDED.creado_por,
          fecha_creacion = EXCLUDED.fecha_creacion
    `,
    [idOp3, creadoPor, SIM_START]
  );

  const idPadre3 = await getGrupoId(client, idOp3, "Mando Terrestre OP3");
  if (!idPadre3) throw new Error(`No se pudo obtener el grupo padre de OP-HISTORICA-003.`);

  for (const nombre of ["Condor 1", "Condor 2"]) {
    await client.query(
      `
      INSERT INTO grupo_operacion
        (id_operacion, nombre, apodo, id_grupo_padre, descripcion, creado_por, fecha_creacion)
      VALUES ($1,$2,'CELULA',$3,$4,$5,$6)
      ON CONFLICT (id_operacion, nombre) DO UPDATE
        SET apodo = EXCLUDED.apodo,
            id_grupo_padre = EXCLUDED.id_grupo_padre,
            descripcion = EXCLUDED.descripcion,
            creado_por = EXCLUDED.creado_por,
            fecha_creacion = EXCLUDED.fecha_creacion
      `,
      [idOp3, nombre, idPadre3, `Celula terrestre ${nombre}`, creadoPor, SIM_START]
    );
  }

  const idCondor1 = await getGrupoId(client, idOp3, "Condor 1");
  const idCondor2 = await getGrupoId(client, idOp3, "Condor 2");

  if (!idCondor1 || !idCondor2) {
    throw new Error(`No se pudieron obtener los subgrupos de OP-HISTORICA-003.`);
  }

  for (const username of ["iperez", "dortega", "oreyes"]) {
    const persona = personalAsignado3.find((p) => p.username === username);
    if (!persona) continue;
    await client.query(
      `INSERT INTO grupo_personal (id_grupo_operacion, id_personal, rol_en_grupo, asignado_por, fecha_asignacion)
       VALUES ($1,$2,'CELL',$3,$4)
       ON CONFLICT (id_grupo_operacion, id_personal) DO UPDATE
         SET rol_en_grupo = EXCLUDED.rol_en_grupo,
             asignado_por = EXCLUDED.asignado_por,
             fecha_asignacion = EXCLUDED.fecha_asignacion`,
      [idCondor1, persona.id_personal, creadoPor, SIM_START]
    );
  }

  for (const username of ["dperez", "dortiz", "olopez"]) {
    const persona = personalAsignado3.find((p) => p.username === username);
    if (!persona) continue;
    await client.query(
      `INSERT INTO grupo_personal (id_grupo_operacion, id_personal, rol_en_grupo, asignado_por, fecha_asignacion)
       VALUES ($1,$2,'CELL',$3,$4)
       ON CONFLICT (id_grupo_operacion, id_personal) DO UPDATE
         SET rol_en_grupo = EXCLUDED.rol_en_grupo,
             asignado_por = EXCLUDED.asignado_por,
             fecha_asignacion = EXCLUDED.fecha_asignacion`,
      [idCondor2, persona.id_personal, creadoPor, SIM_START]
    );
  }

  const { vehicles: vehiculosOp3 } = await seedOp3VehiculosYEquipos(client, {
    idOp3,
    creadoPor,
    personalAsignado3,
    idCondor1,
    idCondor2,
  });

  const chat3Res = await client.query(
    `INSERT INTO chat_operacion (id_operacion, activo, fecha_creacion, fecha_cierre)
     VALUES ($1, TRUE, $2, NULL)
     ON CONFLICT (id_operacion) DO UPDATE
       SET activo = TRUE,
           fecha_creacion = EXCLUDED.fecha_creacion,
           fecha_cierre = NULL
     RETURNING id_chat`,
    [idOp3, SIM_START]
  );

  let idChat3 = chat3Res.rows?.[0]?.id_chat;
  if (!idChat3) {
    const chat3Lookup = await client.query(
      `SELECT id_chat FROM chat_operacion WHERE id_operacion = $1 LIMIT 1`,
      [idOp3]
    );
    if (chat3Lookup.rowCount === 0) throw new Error(`No se pudo crear el chat de OP-HISTORICA-003.`);
    idChat3 = chat3Lookup.rows[0].id_chat;
  }

  const participants = {
    admin: await ensureChatParticipantUsuario(client, idChat3, creadoPor),
    byUsername: {},
  };

  for (const persona of personalAsignado3) {
    participants.byUsername[persona.username] = await ensureChatParticipantPersonal(client, idChat3, persona.id_personal);
  }

  await client.query(
    `
    INSERT INTO zona_operacion
      (id_operacion, nombre, geometria, centroide_lat, centroide_lon, zoom_inicial, color, creado_por, fecha_creacion)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (id_operacion) DO UPDATE
      SET nombre        = EXCLUDED.nombre,
          geometria     = EXCLUDED.geometria,
          centroide_lat = EXCLUDED.centroide_lat,
          centroide_lon = EXCLUDED.centroide_lon,
          zoom_inicial  = EXCLUDED.zoom_inicial,
          color         = EXCLUDED.color,
          creado_por    = EXCLUDED.creado_por,
          fecha_creacion = EXCLUDED.fecha_creacion
    `,
    [
      idOp3,
      "Zona Logica Terrestre Xalapa-Coatepec",
      JSON.stringify(ZONA_TERRESTRE),
      19.51000,
      -96.91500,
      13000,
      "#16a34a",
      creadoPor,
      SIM_START,
    ]
  );

  const grid = await seedOperationGrid(client, {
    idOperacion: idOp3,
    size: "5x5",
    names: [
      "NW Reserva", "Norte 1", "Norte 2", "Norte 3", "NE Salida",
      "Condor 1 W", "Condor 1", "Punto Control", "Ruta Norte", "Observacion NE",
      "Mando W", "Base Reunion", "Puesto Mando", "Corredor Medio", "Mando E",
      "Condor 2 W", "Ruta Sur", "Area Inspeccion", "Condor 2", "Salida SE",
      "SW Logistica", "Sur 1", "Sur 2", "Sur 3", "SE Cierre",
    ],
    idUsuario: creadoPor,
    fecha: SIM_START,
  });

  const mapLayers = buildMapLayers(idOp3, creadoPor, cet3);
  const pois = buildTacticalPois(idOp3, creadoPor, personalAsignado3);
  const trackingPersonal = buildTrackingPersonalRows(idOp3, personalAsignado3);
  const trackingVehiculos = buildTrackingVehiculoRows(idOp3, vehiculosOp3);
  const mensajes = buildMessages(idChat3, participants, personalAsignado3);
  const avisos = buildAvisos(idOp3, personalAsignado3, cet3, cut3);
  const novedades = buildNovedades(idOp3, personalAsignado3, creadoPor);

  await bulkInsert(client, "tracking_personal", [
    "id_operacion",
    "id_personal",
    "latitud",
    "longitud",
    "altitud",
    "precision_m",
    "timestamp",
  ], trackingPersonal);

  await bulkInsert(client, "tracking_vehiculo", [
    "id_operacion",
    "id_vehiculo",
    "latitud",
    "longitud",
    "altitud",
    "velocidad_kmh",
    "rumbo_grados",
    "precision_m",
    "timestamp",
  ], trackingVehiculos);

  await bulkInsert(client, "mensaje_chat", [
    "id_chat",
    "id_participante",
    "contenido",
    "tipo_mensaje",
    "destinatario_rol",
    "destino_tipo",
    "destino_id",
    "destino_label",
    "fecha_envio",
  ], mensajes);

  await bulkInsert(client, "puntos_interes", [
    "tipo_creador",
    "id_usuario",
    "id_personal",
    "nombre",
    "tipo_poi",
    "latitud",
    "longitud",
    "descripcion",
    "color",
    "icono_src",
    "sidc",
    "id_operacion",
    "fecha_creacion",
  ], pois);

  await bulkInsert(client, "area_interes", [
    "id_operacion",
    "tipo_creador",
    "id_usuario",
    "id_personal",
    "nombre",
    "descripcion",
    "geometria",
    "color",
    "estado",
    "fecha_creacion",
  ], mapLayers.areas, { jsonbColumns: ["geometria"] });

  await bulkInsert(client, "ruta_operacion", [
    "id_operacion",
    "tipo_creador",
    "id_usuario",
    "id_personal",
    "nombre",
    "descripcion",
    "geometria",
    "color",
    "estado",
    "fecha_creacion",
  ], mapLayers.rutas, { jsonbColumns: ["geometria"] });

  await bulkInsert(client, "marca_edificio", [
    "id_operacion",
    "tipo_creador",
    "id_usuario",
    "id_personal",
    "nombre",
    "tipo_estructura",
    "latitud",
    "longitud",
    "estado",
    "fecha_creacion",
  ], mapLayers.estructuras);

  await bulkInsert(client, "dibujo_libre_operacion", [
    "tipo_creador",
    "id_usuario",
    "id_personal",
    "id_operacion",
    "puntos",
    "color",
    "grosor",
    "activo",
    "fecha_creacion",
  ], mapLayers.dibujos, { jsonbColumns: ["puntos"] });

  await bulkInsert(client, "ruta_navegacion", [
    "id_operacion",
    "geojson",
    "origen_lat",
    "origen_lon",
    "destino_lat",
    "destino_lon",
    "distancia_m",
    "duracion_s",
    "created_by_tipo",
    "id_usuario",
    "id_personal",
    "id_vehiculo",
    "activo",
    "fecha_eliminacion",
    "eliminado_por_tipo",
    "id_usuario_elim",
    "id_personal_elim",
    "fecha_creacion",
  ], mapLayers.rutasNavegacion, { jsonbColumns: ["geojson"] });

  const avisosInsertados = await bulkInsert(client, "aviso_operacion", [
    "id_operacion",
    "id_personal_emisor",
    "tipo_receptor",
    "id_personal_receptor",
    "id_usuario_receptor",
    "tipo_aviso",
    "contenido",
    "estado",
    "fecha_envio",
    "fecha_atencion",
  ], avisos, { returning: "*" });

  const novedadesInsertadas = await bulkInsert(client, "novedad_operacion", [
    "id_operacion",
    "tipo_creador",
    "id_usuario",
    "id_personal",
    "tipo_novedad",
    "titulo",
    "descripcion",
    "solo_mando",
    "fecha_registro",
  ], novedades, { returning: "*" });

  const timelineEvents = buildTimelineEvents(idOp3, creadoPor, avisosInsertados, novedadesInsertadas);
  timelineEvents.push({
    id_operacion: idOp3,
    tipo_evento: "cuadricula_guardada",
    entidad_tipo: "cuadricula",
    entidad_id: grid.id_cuadricula,
    payload: grid,
    actor_tipo: "USUARIO",
    id_usuario: creadoPor,
    id_personal: null,
    occurred_at: grid.fecha_actualizacion,
  });
  await bulkInsert(client, "operacion_evento", [
    "id_operacion",
    "tipo_evento",
    "entidad_tipo",
    "entidad_id",
    "payload",
    "actor_tipo",
    "id_usuario",
    "id_personal",
    "occurred_at",
  ], timelineEvents, { jsonbColumns: ["payload"] });

  // Los triggers de destino esperan que el personal siga activo al liberar recursos.
  await client.query(
    `UPDATE grupo_vehiculo
     SET estado_asignacion = 'LIBERADO',
         fecha_fin_asignacion = $2
     WHERE id_operacion = $1`,
    [idOp3, SIM_END]
  );

  await client.query(
    `UPDATE grupo_equipo
     SET estado_asignacion = 'LIBERADO',
         fecha_fin_asignacion = $2
     WHERE id_operacion = $1`,
    [idOp3, SIM_END]
  );

  await client.query(
    `UPDATE uso_equipo_operacion
     SET fecha_devolucion = $2
     WHERE id_operacion = $1`,
    [idOp3, SIM_END]
  );

  await client.query(
    `UPDATE vehiculo_operacion
     SET estado_asignacion = 'LIBERADO',
         fecha_fin_asignacion = $2
     WHERE id_operacion = $1`,
    [idOp3, SIM_END]
  );

  await client.query(
    `UPDATE operacion_equipo
     SET estado_asignacion = 'LIBERADO',
         fecha_fin_asignacion = $2
     WHERE id_operacion = $1`,
    [idOp3, SIM_END]
  );

  await client.query(
    `UPDATE asignacion_operacion_personal
     SET estado_asignacion = 'LIBERADO',
         fecha_fin_asignacion = $2
     WHERE id_operacion = $1`,
    [idOp3, SIM_END]
  );

  await client.query(
    `UPDATE chat_operacion
     SET activo = FALSE, fecha_cierre = $2
     WHERE id_operacion = $1`,
    [idOp3, SIM_END]
  );

  await client.query(
    `UPDATE operacion
     SET estado = 'CERRADA', fecha_fin = $2
     WHERE id_operacion = $1`,
    [idOp3, OP3_FIN]
  );

  await client.query(
    `UPDATE chat_operacion
     SET activo = FALSE, fecha_cierre = $2
     WHERE id_operacion = $1`,
    [idOp3, SIM_END]
  );

  const eventCount =
    trackingPersonal.length +
    trackingVehiculos.length +
    mensajes.length +
    pois.length +
    mapLayers.areas.length +
    mapLayers.rutas.length +
    mapLayers.estructuras.length +
    mapLayers.dibujos.length +
    mapLayers.rutasNavegacion.length +
    1 +
    timelineEvents.length;

  return {
    codigo: OP3_CODIGO,
    estado: "CERRADA",
    idOp: idOp3,
    personalAsignado: personalAsignado3.length,
    eventosSimulados: eventCount,
    trackingPersonal: trackingPersonal.length,
    trackingVehiculos: trackingVehiculos.length,
    mensajes: mensajes.length,
    objetosTacticos: pois.length,
    avisos: avisosInsertados.length,
    cuadricula: grid.size,
  };
}
