import { getAdminId, getPersonalByUsername, getPersonalIdStrict } from "../helpers/personal.js";
import { getVehiculoByCodigo, getEquipoBySerie, getGrupoId } from "../helpers/lookup.js";
import { ensureChatParticipantUsuario, ensureChatParticipantPersonal } from "../helpers/chat.js";
import { seedOperationGrid } from "../helpers/grid.js";

export async function seedOperation1(client) {
  const creadoPor = await getAdminId(client);

  const OP_CODIGO = "OP-PRUEBA-001";

  const personalOpUsernames = [
    "cramirez", // CUT
    "mlopez",   // CET
    "mcruz", "jmartinez", "psanchez", // CELL → Aguila 1
    "lgomez", "jflores", "smorales",  // CELL → Aguila 2
  ];

  // ── Operación ──────────────────────────────────────────────
  const cutOp1 = await getPersonalIdStrict(client, "cramirez");

  await client.query(
    `INSERT INTO operacion
       (codigo, nombre, descripcion, prioridad, estado, fecha_inicio, fecha_fin, creada_por, id_cut)
     VALUES ($1,$2,$3,'MEDIA','ACTIVA','2026-02-09 08:00:00-06','2026-12-31 23:59:59-06',$4,$5)
     ON CONFLICT (codigo) DO UPDATE SET
       nombre=$2, descripcion=$3, prioridad='MEDIA', estado='ACTIVA',
       fecha_inicio='2026-02-09 08:00:00-06', fecha_fin='2026-12-31 23:59:59-06',
       creada_por=$4, id_cut=$5`,
    [OP_CODIGO,
     "Operacion de Prueba SEDAM",
     "Operacion de validacion del sistema. CUT: cramirez. CET: mlopez. Dos subgrupos de 3 celulas.",
     creadoPor, cutOp1]
  );

  const { rows: [{ id_operacion: idOp }] } = await client.query(
    `SELECT id_operacion FROM operacion WHERE codigo=$1`, [OP_CODIGO]
  );

  // ── Personal → Operación ───────────────────────────────────
  const personalAsignado = [];
  for (const username of personalOpUsernames) {
    const p = await getPersonalByUsername(client, username);
    if (!p) { console.warn(`WARN: "${username}" no encontrado`); continue; }
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

  const cet   = personalAsignado.find(p => p.username === "mlopez");
  const ag1   = personalAsignado.filter(p => ["mcruz","jmartinez","psanchez"].includes(p.username));
  const ag2   = personalAsignado.filter(p => ["lgomez","jflores","smorales"].includes(p.username));

  if (!cet) throw new Error(`CET mlopez no encontrado`);

  // ── Mando CET → CELL ──────────────────────────────────────
  for (const cell of [...ag1, ...ag2]) {
    await client.query(
      `INSERT INTO mando_operacion (id_operacion, id_cet, id_cell, asignado_por)
       VALUES ($1,$2,$3,$4) ON CONFLICT (id_operacion, id_cell) DO NOTHING`,
      [idOp, cet.id_personal, cell.id_personal, creadoPor]
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

  // Flotilla (nivel intermedio)
  await client.query(
    `INSERT INTO grupo_operacion (id_operacion, nombre, apodo, descripcion, creado_por, id_grupo_padre)
     VALUES ($1,'Flotilla Alfa','FLOTILLA','Flotilla del CET mlopez',$2,$3)
     ON CONFLICT (id_operacion, nombre) DO NOTHING`,
    [idOp, creadoPor, idRaiz]
  );
  const idFlotilla = await getGrupoId(client, idOp, "Flotilla Alfa");

  // CET en la flotilla
  await client.query(
    `INSERT INTO grupo_personal (id_grupo_operacion, id_personal, asignado_por)
     VALUES ($1,$2,$3) ON CONFLICT (id_grupo_operacion, id_personal) DO NOTHING`,
    [idFlotilla, cet.id_personal, creadoPor]
  );

  // Subgrupos
  for (const nombre of ["Aguila 1", "Aguila 2"]) {
    await client.query(
      `INSERT INTO grupo_operacion (id_operacion, nombre, apodo, descripcion, creado_por, id_grupo_padre)
       VALUES ($1,$2,'CELULA',$3,$4,$5)
       ON CONFLICT (id_operacion, nombre) DO NOTHING`,
      [idOp, nombre, `Subgrupo ${nombre}`, creadoPor, idFlotilla]
    );
  }

  const idAg1 = await getGrupoId(client, idOp, "Aguila 1");
  const idAg2 = await getGrupoId(client, idOp, "Aguila 2");
  if (!idAg1 || !idAg2) throw new Error(`Subgrupos OP1 no encontrados`);

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
  const vh1 = await getVehiculoByCodigo(client, "VH-001");
  const vh3 = await getVehiculoByCodigo(client, "VH-003");
  const respAg1 = personalAsignado.find(p => p.username === "mcruz");
  const respAg2 = personalAsignado.find(p => p.username === "lgomez");

  for (const integrante of ag1) {
    await client.query(
      `INSERT INTO vehiculo_operacion
         (id_operacion, id_vehiculo, id_personal, id_grupo_operacion, nivel_asignacion, estado_asignacion, asignado_por)
       VALUES ($1,$2,$3,$4,'GRUPO','ASIGNADO',$5)
       ON CONFLICT (id_operacion, id_vehiculo, id_personal) DO NOTHING`,
      [idOp, vh1.id_vehiculo, integrante.id_personal, idAg1, creadoPor]
    );
  }
  await client.query(
    `INSERT INTO grupo_vehiculo (id_grupo_operacion, id_operacion, id_vehiculo, id_personal, asignado_por)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [idAg1, idOp, vh1.id_vehiculo, respAg1.id_personal, creadoPor]
  );

  for (const integrante of ag2) {
    await client.query(
      `INSERT INTO vehiculo_operacion
         (id_operacion, id_vehiculo, id_personal, id_grupo_operacion, nivel_asignacion, estado_asignacion, asignado_por)
       VALUES ($1,$2,$3,$4,'GRUPO','ASIGNADO',$5)
       ON CONFLICT (id_operacion, id_vehiculo, id_personal) DO NOTHING`,
      [idOp, vh3.id_vehiculo, integrante.id_personal, idAg2, creadoPor]
    );
  }
  await client.query(
    `INSERT INTO grupo_vehiculo (id_grupo_operacion, id_operacion, id_vehiculo, id_personal, asignado_por)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [idAg2, idOp, vh3.id_vehiculo, respAg2.id_personal, creadoPor]
  );

  // ── Equipos ────────────────────────────────────────────────
  const eqCom = await getEquipoBySerie(client, "HFC-001"); // radio → vehículo VH-001
  const eqDji = await getEquipoBySerie(client, "1581F7K3C25CD00DYNZD"); // DJI Matrice 4T → CET mlopez
  const eqOldDron = await getEquipoBySerie(client, "DRN-001"); // seed anterior, se libera de OP1

  // operacion_equipo (reserva global) — primero porque uso_equipo_operacion referencia esto
  for (const eq of [eqCom, eqDji]) {
    await client.query(
      `INSERT INTO operacion_equipo
         (id_operacion, id_equipo, cantidad, estado_asignacion, asignado_por)
       VALUES ($1,$2,1,'ASIGNADO',$3)
       ON CONFLICT (id_operacion, id_equipo) DO UPDATE SET
         estado_asignacion='ASIGNADO', asignado_por=$3, fecha_asignacion=NOW()`,
      [idOp, eq.id_equipo, creadoPor]
    );
  }

  await client.query(
    `DELETE FROM uso_equipo_operacion
     WHERE id_operacion = $1 AND id_equipo = $2`,
    [idOp, eqOldDron.id_equipo]
  );
  await client.query(
    `DELETE FROM grupo_equipo
     WHERE id_operacion = $1 AND id_equipo = $2`,
    [idOp, eqOldDron.id_equipo]
  );
  await client.query(
    `DELETE FROM operacion_equipo
     WHERE id_operacion = $1 AND id_equipo = $2`,
    [idOp, eqOldDron.id_equipo]
  );

  // uso_equipo_operacion — equipo de comunicación en vehículo VH-001
  await client.query(
    `INSERT INTO uso_equipo_operacion
       (id_operacion, id_equipo, id_personal, id_vehiculo_contexto, id_grupo_operacion, cantidad, asignado_por, notas)
     VALUES ($1,$2,$3,$4,$5,1,$6,$7)
     ON CONFLICT (id_operacion, id_equipo, id_personal, id_grupo_operacion) DO UPDATE SET
       id_vehiculo_contexto=$4, cantidad=1, asignado_por=$6, fecha_asignacion=NOW(), fecha_devolucion=NULL`,
    [idOp, eqCom.id_equipo, respAg1.id_personal, vh1.id_vehiculo, idAg1, creadoPor,
     "Radio instalada en VH-001 de Aguila 1"]
  );

  // uso_equipo_operacion — DJI Matrice 4T asignado a Maria Lopez (CET)
  await client.query(
    `INSERT INTO uso_equipo_operacion
       (id_operacion, id_equipo, id_personal, id_vehiculo_contexto, id_grupo_operacion, cantidad, asignado_por, notas)
     VALUES ($1,$2,$3,NULL,NULL,1,$4,$5)
     ON CONFLICT (id_operacion, id_equipo, id_personal, id_grupo_operacion) DO UPDATE SET
       id_vehiculo_contexto=NULL, cantidad=1, asignado_por=$4, fecha_asignacion=NOW(), fecha_devolucion=NULL`,
    [idOp, eqDji.id_equipo, cet.id_personal, creadoPor,
     "DJI Matrice 4T bajo resguardo de Maria Lopez"]
  );

  // ── Chat ───────────────────────────────────────────────────
  const chatRes = await client.query(
    `INSERT INTO chat_operacion (id_operacion, activo) VALUES ($1, TRUE)
     ON CONFLICT (id_operacion) DO UPDATE SET activo=TRUE, fecha_cierre=NULL
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
       VALUES ($1,$2,'OPERACIÓN INICIADA 9 DE FEBRERO DEL 2026.','SISTEMA')`,
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
    [idOp, "Zona Anton Lizardo",
     JSON.stringify({ type: "Polygon", coordinates: [[
       [-95.97565,19.05175],[-95.96850,19.05175],[-95.96850,19.04325],
       [-95.97565,19.04325],[-95.97565,19.05175]
     ]]}),
     19.0475, -95.972075, 1000, "#3b82f6", creadoPor]
  );

  const grid = await seedOperationGrid(client, {
    idOperacion: idOp,
    size: "3x3",
    names: [
      "Alfa NW", "Alfa Norte", "Alfa NE",
      "Aguila 1", "Puesto Mando", "Aguila 2",
      "Acceso SW", "Corredor Sur", "Acceso SE",
    ],
    idUsuario: creadoPor,
  });

  const externalStreams = [
    { label: "OBS", sourceType: "EXTERNAL", streamKey: "obs-01" },
    { label: "Dron 01", sourceType: "DRONE", streamKey: "dron-01" },
  ];

  for (const stream of externalStreams) {
    await client.query(
      `INSERT INTO media_stream_session (
         id_operacion, id_usuario, kind, status, label, protocol, source_type,
         stream_key, rtmp_publish_url, playback_url, external_device_id,
         consent_ack, foreground_notice, created_by_tabla, created_by_id
       )
       VALUES ($1,$2,'AUDIO_VIDEO','ACTIVE',$3,'RTMP',$4,$5,$6,$7,$5,
         TRUE,FALSE,'usuario',$2)
       ON CONFLICT (stream_key) DO UPDATE SET
         id_operacion = EXCLUDED.id_operacion,
         id_usuario = EXCLUDED.id_usuario,
         id_personal = NULL,
         kind = EXCLUDED.kind,
         status = 'ACTIVE',
         label = EXCLUDED.label,
         protocol = EXCLUDED.protocol,
         source_type = EXCLUDED.source_type,
         rtmp_publish_url = EXCLUDED.rtmp_publish_url,
         rtmp_playback_url = NULL,
         playback_url = EXCLUDED.playback_url,
         external_device_id = EXCLUDED.external_device_id,
         publisher_socket_id = NULL,
         viewer_count = 0,
         consent_ack = EXCLUDED.consent_ack,
         foreground_notice = EXCLUDED.foreground_notice,
         created_by_tabla = EXCLUDED.created_by_tabla,
         created_by_id = EXCLUDED.created_by_id,
         started_at = NOW(),
         last_seen_at = NULL,
         ended_at = NULL`,
      [
        idOp,
        creadoPor,
        stream.label,
        stream.sourceType,
        stream.streamKey,
        `rtmp://localhost/live/${stream.streamKey}`,
        `/runtime/ffmpeg-streams/${stream.streamKey}/index.m3u8`,
      ]
    );
  }

  return {
    codigo: OP_CODIGO,
    estado: "ACTIVA",
    idOp,
    personalAsignado: personalAsignado.length,
    vehiculosFijos: 2,
    equiposFijos: 2,
    cuadricula: grid.size,
  };
}
