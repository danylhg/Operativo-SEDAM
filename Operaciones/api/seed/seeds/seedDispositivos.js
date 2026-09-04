import { getAdminId, getPersonalByUsername } from "../helpers/personal.js";

const dispositivos = [
  {
    imagen_disp: "./uploads/dispositivo/galaxy-tab-s6-lite-sm-p620.jpg",
    tipo: "TABLET",
    marca: "Samsung",
    modelo: "Galaxy Tab S6 Lite",
    numero_telefono: null,
    imei: null,
    numero_serie: "R52XC0BJRYP",
    sistema_operativo: "Android",
    estado: "DISPONIBLE",
    detalles: "Modelo tecnico: SM-P620; asignada a mcruz.",
    asignarA: "mcruz",
  },
  {
    imagen_disp: "./uploads/dispositivo/galaxy-s24-ultra-sm-s928b.jpg",
    tipo: "TELEFONO",
    marca: "Samsung",
    modelo: "Galaxy S24 Ultra",
    numero_telefono: "522841036710",
    imei: "357425221904731",
    numero_serie: "R5CY21M4JKB",
    sistema_operativo: "Android",
    estado: "DISPONIBLE",
    detalles: "Modelo tecnico: SM-S928B; Red: BAIT",
    asignarA: "mlopez",
  },
  {
    imagen_disp: "./uploads/dispositivo/SONIM-RS80-1.jpg",
    tipo: "TABLET",
    marca: "Generica",
    modelo: "M17X",
    numero_telefono: null,
    imei: null,
    numero_serie: "OR00806TA14N06228",
    sistema_operativo: "Android",
    estado: "DISPONIBLE",
    detalles: "Serie capturada desde Ajustes > Modelo; tablet generica sin asignacion activa.",
    asignarA: null,
  },
  {
    imagen_disp: "./uploads/dispositivo/galaxy-watch8-classic-sm-l500.jpg",
    tipo: "SMARTWATCH",
    marca: "Samsung",
    modelo: "Galaxy Watch8 Classic",
    numero_telefono: null,
    imei: null,
    numero_serie: "RFGL22D6RQK",
    sistema_operativo: "Wear OS",
    estado: "DISPONIBLE",
    detalles: "Codigo visible: 6RQK; Modelo tecnico: SM-L500",
    asignarA: "mlopez",
  },
];

async function getOperacionActiva(client) {
  const { rows } = await client.query(
    `SELECT id_operacion, codigo
     FROM operacion
     WHERE estado = 'ACTIVA'
     ORDER BY fecha_inicio DESC NULLS LAST, id_operacion DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

async function assignSeedDispositivos(client) {
  const operacion = await getOperacionActiva(client);
  if (!operacion) return 0;

  const asignadoPor = await getAdminId(client);
  let asignados = 0;
  let liberados = 0;

  for (const d of dispositivos.filter(item => item.asignarA === null)) {
    const { rows: deviceRows } = await client.query(
      `SELECT id_dispositivo
       FROM dispositivo
       WHERE numero_serie = $1
       LIMIT 1`,
      [d.numero_serie]
    );
    const dispositivo = deviceRows[0];
    if (!dispositivo) continue;

    const { rowCount } = await client.query(
      `UPDATE operacion_dispositivo
          SET estado_asignacion = 'LIBERADO',
              fecha_devolucion = COALESCE(fecha_devolucion, NOW())
        WHERE id_operacion = $1
          AND id_dispositivo = $2
          AND estado_asignacion = 'ASIGNADO'
          AND fecha_devolucion IS NULL`,
      [operacion.id_operacion, dispositivo.id_dispositivo]
    );
    liberados += rowCount;
  }

  for (const d of dispositivos.filter(item => item.asignarA)) {
    const personal = await getPersonalByUsername(client, d.asignarA);
    if (!personal) continue;

    const { rows: deviceRows } = await client.query(
      `SELECT id_dispositivo
       FROM dispositivo
       WHERE numero_serie = $1
       LIMIT 1`,
      [d.numero_serie]
    );
    const dispositivo = deviceRows[0];
    if (!dispositivo) continue;

    const { rowCount: personaEnOp } = await client.query(
      `SELECT 1
       FROM asignacion_operacion_personal
       WHERE id_operacion = $1
         AND id_personal = $2
         AND estado_asignacion NOT IN ('LIBERADO')
       LIMIT 1`,
      [operacion.id_operacion, personal.id_personal]
    );
    if (!personaEnOp) continue;

    await client.query(
      `INSERT INTO operacion_dispositivo
         (id_operacion, id_dispositivo, id_personal, estado_asignacion, asignado_por)
       VALUES ($1,$2,$3,'ASIGNADO',$4)
       ON CONFLICT (id_operacion, id_dispositivo) DO UPDATE SET
         id_personal = EXCLUDED.id_personal,
         estado_asignacion = 'ASIGNADO',
         fecha_devolucion = NULL,
         asignado_por = EXCLUDED.asignado_por,
         fecha_asignacion = NOW()`,
      [operacion.id_operacion, dispositivo.id_dispositivo, personal.id_personal, asignadoPor]
    );

    asignados += 1;
  }

  return { asignados, liberados };
}

export async function seedDispositivos(client) {
  await client.query("ALTER TABLE dispositivo ADD COLUMN IF NOT EXISTS imagen_disp TEXT");

  let insertados = 0;
  let actualizados = 0;

  for (const d of dispositivos) {
    const updateResult = await client.query(
      `
      UPDATE dispositivo
      SET imagen_disp = $1,
          tipo = $2,
          marca = $3,
          modelo = $4,
          numero_telefono = $5,
          imei = $6,
          sistema_operativo = $8,
          estado = $9,
          detalles = $10
      WHERE numero_serie = $7
      `,
      [
        d.imagen_disp,
        d.tipo,
        d.marca,
        d.modelo,
        d.numero_telefono,
        d.imei,
        d.numero_serie,
        d.sistema_operativo,
        d.estado,
        d.detalles,
      ]
    );

    if (updateResult.rowCount > 0) {
      actualizados += updateResult.rowCount;
      continue;
    }

    await client.query(
      `
      INSERT INTO dispositivo (
        imagen_disp,
        tipo,
        marca,
        modelo,
        numero_telefono,
        imei,
        numero_serie,
        sistema_operativo,
        estado,
        detalles
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        d.imagen_disp,
        d.tipo,
        d.marca,
        d.modelo,
        d.numero_telefono,
        d.imei,
        d.numero_serie,
        d.sistema_operativo,
        d.estado,
        d.detalles,
      ]
    );

    insertados += 1;
  }

  const { asignados, liberados } = await assignSeedDispositivos(client);

  return { insertados, actualizados, asignados, liberados, total: dispositivos.length };
}
