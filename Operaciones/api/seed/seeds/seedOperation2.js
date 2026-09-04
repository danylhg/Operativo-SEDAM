import { getAdminId, getPersonalByUsername, getPersonalIdStrict } from "../helpers/personal.js";
import { getVehiculoByCodigo, getEquipoBySerie, getGrupoId } from "../helpers/lookup.js";
import { ensureChatParticipantUsuario, ensureChatParticipantPersonal } from "../helpers/chat.js";
import { seedOperationGrid } from "../helpers/grid.js";

export async function seedOperation2(client) {
  const creadoPor = await getAdminId(client);

  const OP_CODIGO = "OP-NORTE-002";

  const personalOpUsernames = [
    "atorres",                          // CUT
    "lhernandez",                       // CET → Flotilla Alfa
    "rvega",                            // CET → Flotilla Norte
    "drios", "fsilva", "anavarro",      // CELL → Aguila 1 (bajo lhernandez)
    "pmendoza", "hcastillo", "eruiz",   // CELL → Aguila 2 (bajo rvega)
  ];

  // ── Operación ──────────────────────────────────────────────
  const cutOp2 = await getPersonalIdStrict(client, "atorres");

  await client.query(
    `INSERT INTO operacion
       (codigo, nombre, descripcion, prioridad, estado, fecha_inicio, fecha_fin, creada_por, id_cut)
     VALUES ($1,$2,$3,'ALTA','PLANIFICADA','2026-09-01 08:00:00-06','2026-09-30 23:59:59-06',$4,$5)
     ON CONFLICT (codigo) DO UPDATE SET
       nombre=$2, descripcion=$3, prioridad='ALTA', estado='PLANIFICADA',
       fecha_inicio='2026-09-01 08:00:00-06', fecha_fin='2026-09-30 23:59:59-06',
       creada_por=$4, id_cut=$5`,
    [OP_CODIGO,
     "Operacion Norte 002",
     "Segunda operacion de prueba. CUT: atorres. CET lhernandez lidera Flotilla Alfa (Aguila 1). CET rvega lidera Flotilla Norte (Aguila 2).",
     creadoPor, cutOp2]
  );

  const { rows: [{ id_operacion: idOp }] } = await client.query(
    `SELECT id_operacion FROM operacion WHERE codigo=$1`, [OP_CODIGO]
  );

  // ── Personal → Operación ───────────────────────────────────
  const personalAsignado = [];
  for (const username of personalOpUsernames) {
    const p = await getPersonalByUsername(client, username);
    if (!p) { console.warn(`WARN OP2: "${username}" no encontrado`); continue; }
    personalAsignado.push(p);
    await client.query(
      `INSERT INTO asignacion_operacion_personal
         (id_operacion, id_personal, rol_en_operacion, estado_asignacion, asignado_por)
       VALUES ($1,$2,$3,'ASIGNADO',$4)
       ON CONFLICT (id_operacion, id_personal) DO UPDATE SET
         rol_en_operacion=EXCLUDED.rol_en_operacion,
         estado_asignacion='ASIGNADO', asignado_por=$4, fecha_asignacion=NOW()`,
      [idOp, p.id_personal, p.rol, creadoPor]
    );
  }

  const cet2a  = personalAsignado.find(p => p.username === "lhernandez");
  const cet2b  = personalAsignado.find(p => p.username === "rvega");
  const ag1    = personalAsignado.filter(p => ["drios","fsilva","anavarro"].includes(p.username));
  const ag2    = personalAsignado.filter(p => ["pmendoza","hcastillo","eruiz"].includes(p.username));

  if (!cet2a) throw new Error(`CET lhernandez no encontrado en OP-NORTE-002`);
  if (!cet2b) throw new Error(`CET rvega no encontrado en OP-NORTE-002`);

  // ── Mando CET → CELL ──────────────────────────────────────
  for (const cell of ag1) {
    await client.query(
      `INSERT INTO mando_operacion (id_operacion, id_cet, id_cell, asignado_por)
       VALUES ($1,$2,$3,$4) ON CONFLICT (id_operacion, id_cell) DO NOTHING`,
      [idOp, cet2a.id_personal, cell.id_personal, creadoPor]
    );
  }
  for (const cell of ag2) {
    await client.query(
      `INSERT INTO mando_operacion (id_operacion, id_cet, id_cell, asignado_por)
       VALUES ($1,$2,$3,$4) ON CONFLICT (id_operacion, id_cell) DO NOTHING`,
      [idOp, cet2b.id_personal, cell.id_personal, creadoPor]
    );
  }

  // ── Grupos ─────────────────────────────────────────────────
  // Raíz
  await client.query(
    `INSERT INTO grupo_operacion (id_operacion, nombre, apodo, descripcion, creado_por)
     VALUES ($1,'Mando Operativo','Mando','Grupo raíz de la operación',$2)
     ON CONFLICT (id_operacion, nombre) DO NOTHING`,
    [idOp, creadoPor]
  );
  const idRaiz = await getGrupoId(client, idOp, "Mando Operativo");

  // Flotilla Alfa (CET lhernandez)
  await client.query(
    `INSERT INTO grupo_operacion (id_operacion, nombre, apodo, descripcion, creado_por, id_grupo_padre)
     VALUES ($1,'Flotilla Alfa','FLOTILLA','Flotilla del CET lhernandez',$2,$3)
     ON CONFLICT (id_operacion, nombre) DO NOTHING`,
    [idOp, creadoPor, idRaiz]
  );
  const idFlotillaAlfa = await getGrupoId(client, idOp, "Flotilla Alfa");

  // Flotilla Norte (CET rvega)
  await client.query(
    `INSERT INTO grupo_operacion (id_operacion, nombre, apodo, descripcion, creado_por, id_grupo_padre)
     VALUES ($1,'Flotilla Norte','FLOTILLA','Flotilla del CET rvega',$2,$3)
     ON CONFLICT (id_operacion, nombre) DO NOTHING`,
    [idOp, creadoPor, idRaiz]
  );
  const idFlotillaNorte = await getGrupoId(client, idOp, "Flotilla Norte");

  if (!idFlotillaAlfa || !idFlotillaNorte) throw new Error(`Flotillas OP2 no encontradas`);

  // CET lhernandez en Flotilla Alfa
  await client.query(
    `INSERT INTO grupo_personal (id_grupo_operacion, id_personal, asignado_por)
     VALUES ($1,$2,$3) ON CONFLICT (id_grupo_operacion, id_personal) DO NOTHING`,
    [idFlotillaAlfa, cet2a.id_personal, creadoPor]
  );

  // CET rvega en Flotilla Norte
  await client.query(
    `INSERT INTO grupo_personal (id_grupo_operacion, id_personal, asignado_por)
     VALUES ($1,$2,$3) ON CONFLICT (id_grupo_operacion, id_personal) DO NOTHING`,
    [idFlotillaNorte, cet2b.id_personal, creadoPor]
  );

  // Subgrupos
  await client.query(
    `INSERT INTO grupo_operacion (id_operacion, nombre, apodo, descripcion, creado_por, id_grupo_padre)
     VALUES ($1,'Aguila 1','CELULA','Subgrupo Aguila 1',$2,$3)
     ON CONFLICT (id_operacion, nombre) DO NOTHING`,
    [idOp, creadoPor, idFlotillaAlfa]
  );
  await client.query(
    `INSERT INTO grupo_operacion (id_operacion, nombre, apodo, descripcion, creado_por, id_grupo_padre)
     VALUES ($1,'Aguila 2','CELULA','Subgrupo Aguila 2',$2,$3)
     ON CONFLICT (id_operacion, nombre) DO NOTHING`,
    [idOp, creadoPor, idFlotillaNorte]
  );

  const idAg1 = await getGrupoId(client, idOp, "Aguila 1");
  const idAg2 = await getGrupoId(client, idOp, "Aguila 2");
  if (!idAg1 || !idAg2) throw new Error(`Subgrupos OP2 no encontrados`);

  // Células en subgrupos
  for (const p of ag1) {
    await client.query(
      `INSERT INTO grupo_personal (id_grupo_operacion, id_personal, asignado_por)
       VALUES ($1,$2,$3) ON CONFLICT (id_grupo_operacion, id_personal) DO NOTHING`,
      [idAg1, p.id_personal, creadoPor]
    );
  }
  for (const p of ag2) {
    await client.query(
      `INSERT INTO grupo_personal (id_grupo_operacion, id_personal, asignado_por)
       VALUES ($1,$2,$3) ON CONFLICT (id_grupo_operacion, id_personal) DO NOTHING`,
      [idAg2, p.id_personal, creadoPor]
    );
  }

  // ── Vehículos ──────────────────────────────────────────────
  const vh4 = await getVehiculoByCodigo(client, "VH-004");
  const vh5 = await getVehiculoByCodigo(client, "VH-005");
  const respAg1 = personalAsignado.find(p => p.username === "drios");
  const respAg2 = personalAsignado.find(p => p.username === "pmendoza");

  for (const integrante of ag1) {
    await client.query(
      `INSERT INTO vehiculo_operacion
         (id_operacion, id_vehiculo, id_personal, id_grupo_operacion, nivel_asignacion, estado_asignacion, asignado_por)
       VALUES ($1,$2,$3,$4,'GRUPO','ASIGNADO',$5)
       ON CONFLICT (id_operacion, id_vehiculo, id_personal) DO NOTHING`,
      [idOp, vh4.id_vehiculo, integrante.id_personal, idAg1, creadoPor]
    );
  }
  await client.query(
    `INSERT INTO grupo_vehiculo (id_grupo_operacion, id_operacion, id_vehiculo, id_personal, asignado_por)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [idAg1, idOp, vh4.id_vehiculo, respAg1.id_personal, creadoPor]
  );

  for (const integrante of ag2) {
    await client.query(
      `INSERT INTO vehiculo_operacion
         (id_operacion, id_vehiculo, id_personal, id_grupo_operacion, nivel_asignacion, estado_asignacion, asignado_por)
       VALUES ($1,$2,$3,$4,'GRUPO','ASIGNADO',$5)
       ON CONFLICT (id_operacion, id_vehiculo, id_personal) DO NOTHING`,
      [idOp, vh5.id_vehiculo, integrante.id_personal, idAg2, creadoPor]
    );
  }
  await client.query(
    `INSERT INTO grupo_vehiculo (id_grupo_operacion, id_operacion, id_vehiculo, id_personal, asignado_por)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [idAg2, idOp, vh5.id_vehiculo, respAg2.id_personal, creadoPor]
  );

  // ── Equipos ────────────────────────────────────────────────
  const eqCom = await getEquipoBySerie(client, "HFC-002"); // radio → vehículo VH-004
  const eqTac = await getEquipoBySerie(client, "DRN-002"); // dron  → personal drios

  // operacion_equipo (reserva global) — primero porque uso_equipo_operacion referencia esto
  for (const eq of [eqCom, eqTac]) {
    await client.query(
      `INSERT INTO operacion_equipo
         (id_operacion, id_equipo, cantidad, estado_asignacion, asignado_por)
       VALUES ($1,$2,1,'ASIGNADO',$3)
       ON CONFLICT (id_operacion, id_equipo) DO UPDATE SET
         estado_asignacion='ASIGNADO', asignado_por=$3, fecha_asignacion=NOW()`,
      [idOp, eq.id_equipo, creadoPor]
    );
  }

  // uso_equipo_operacion — radio en vehículo VH-004
  await client.query(
    `INSERT INTO uso_equipo_operacion
       (id_operacion, id_equipo, id_personal, id_vehiculo_contexto, id_grupo_operacion, cantidad, asignado_por, notas)
     VALUES ($1,$2,$3,$4,$5,1,$6,$7)
     ON CONFLICT (id_operacion, id_equipo, id_personal, id_grupo_operacion) DO UPDATE SET
       id_vehiculo_contexto=$4, cantidad=1, asignado_por=$6, fecha_asignacion=NOW(), fecha_devolucion=NULL`,
    [idOp, eqCom.id_equipo, respAg1.id_personal, vh4.id_vehiculo, idAg1, creadoPor,
     "Radio instalada en VH-004 de Aguila 1"]
  );

  // uso_equipo_operacion — dron asignado a drios (personal)
  await client.query(
    `INSERT INTO uso_equipo_operacion
       (id_operacion, id_equipo, id_personal, id_vehiculo_contexto, id_grupo_operacion, cantidad, asignado_por, notas)
     VALUES ($1,$2,$3,NULL,$4,1,$5,$6)
     ON CONFLICT (id_operacion, id_equipo, id_personal, id_grupo_operacion) DO UPDATE SET
       id_vehiculo_contexto=NULL, cantidad=1, asignado_por=$5, fecha_asignacion=NOW(), fecha_devolucion=NULL`,
    [idOp, eqTac.id_equipo, respAg1.id_personal, idAg1, creadoPor,
     "Dron táctico bajo resguardo de drios en Aguila 1"]
  );

  // ── Chat ───────────────────────────────────────────────────
  const chatRes = await client.query(
    `INSERT INTO chat_operacion (id_operacion, activo) VALUES ($1, FALSE)
     ON CONFLICT (id_operacion) DO UPDATE SET activo=FALSE
     RETURNING id_chat`,
    [idOp]
  );
  let idChat = chatRes.rows?.[0]?.id_chat;
  if (!idChat) {
    const r = await client.query(`SELECT id_chat FROM chat_operacion WHERE id_operacion=$1`, [idOp]);
    idChat = r.rows[0].id_chat;
  }

  const idAdmin = await ensureChatParticipantUsuario(client, idChat, creadoPor);
  for (const p of personalAsignado) await ensureChatParticipantPersonal(client, idChat, p.id_personal);

  const { rows: [{ total }] } = await client.query(
    `SELECT COUNT(*)::int AS total FROM mensaje_chat WHERE id_chat=$1`, [idChat]
  );
  if (total === 0 && idAdmin) {
    await client.query(
      `INSERT INTO mensaje_chat (id_chat, id_participante, contenido, tipo_mensaje)
       VALUES ($1,$2,'Chat de OP-NORTE-002 inicializado. Operación en fase de planeación.','SISTEMA')`,
      [idChat, idAdmin]
    );
  }

  // ── Zona ───────────────────────────────────────────────────
  await client.query(
    `INSERT INTO zona_operacion
       (id_operacion, nombre, geometria, centroide_lat, centroide_lon, zoom_inicial, color, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id_operacion) DO UPDATE SET
       nombre=$2, geometria=$3, centroide_lat=$4, centroide_lon=$5,
       zoom_inicial=$6, color=$7, creado_por=$8, fecha_creacion=NOW()`,
    [idOp, "Zona Operacion Norte 002",
     JSON.stringify({ type: "Polygon", coordinates: [[
       [-96.9480,19.5660],[-96.9000,19.5660],[-96.9000,19.5150],
       [-96.9480,19.5150],[-96.9480,19.5660]
     ]]}),
     19.5405, -96.9240, 6500, "#f97316", creadoPor]
  );

  const grid = await seedOperationGrid(client, {
    idOperacion: idOp,
    size: "4x4",
    names: [
      "Norte A1", "Norte A2", "Norte A3", "Norte A4",
      "Alfa Oeste", "Aguila 1", "Mando Norte", "Alfa Este",
      "Bravo Oeste", "Aguila 2", "Flotilla Norte", "Bravo Este",
      "Sur A1", "Sur A2", "Sur A3", "Sur A4",
    ],
    idUsuario: creadoPor,
  });

  return {
    codigo: OP_CODIGO,
    estado: "PLANIFICADA",
    idOp,
    personalAsignado: personalAsignado.length,
    vehiculosFijos: 2,
    equiposFijos: 2,
    cuadricula: grid.size,
  };
}
