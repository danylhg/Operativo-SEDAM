import { getAdminId, getPersonalByUsername, getPersonalIdStrict } from "../helpers/personal.js";
import { getGrupoId } from "../helpers/lookup.js";
import { ensureChatParticipantUsuario, ensureChatParticipantPersonal } from "../helpers/chat.js";
import { seedOperationGrid } from "../helpers/grid.js";

export async function seedOperation4(client) {
  const creadoPor = await getAdminId(client);

  // =========================================================
  // OP-CANCELADA-004 — CANCELADA
  // =========================================================
  const OP4_CODIGO = "OP-CANCELADA-004";

  const personalOp4Usernames = [
    "atorres",
    "lhernandez",
    "mcruz",
    "jmartinez",
    "psanchez",
  ];

  const cutOp4 = await getPersonalIdStrict(client, "atorres");

  await client.query(
    `
    INSERT INTO operacion
      (codigo, nombre, descripcion, prioridad, estado, fecha_inicio, fecha_fin, creada_por, id_cut)
    VALUES
      ($1,$2,$3,'MEDIA','ACTIVA','2024-06-01 08:00:00-06','2024-08-31 23:59:59-06',$4,$5)
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
      OP4_CODIGO,
      "Operacion Cancelada 004",
      "Operacion planificada que fue cancelada antes de iniciar. Periodo junio-agosto 2024. CUT: atorres. Recursos liberados sin uso.",
      creadoPor,
      cutOp4,
    ]
  );

  const op4Row = await client.query(
    `SELECT id_operacion FROM operacion WHERE codigo = $1 LIMIT 1`,
    [OP4_CODIGO]
  );
  const idOp4 = op4Row.rows[0].id_operacion;

  const personalAsignado4 = [];

  for (const username of personalOp4Usernames) {
    const persona = await getPersonalByUsername(client, username);
    if (!persona) {
      console.warn(`WARN OP4: personal "${username}" no encontrado, se omite`);
      continue;
    }

    personalAsignado4.push(persona);

    await client.query(
      `
      INSERT INTO asignacion_operacion_personal
        (id_operacion, id_personal, rol_en_operacion, estado_asignacion, asignado_por)
      VALUES ($1,$2,$3,'ASIGNADO',$4)
      ON CONFLICT (id_operacion, id_personal) DO UPDATE
        SET rol_en_operacion  = EXCLUDED.rol_en_operacion,
            estado_asignacion = EXCLUDED.estado_asignacion,
            asignado_por      = EXCLUDED.asignado_por
      `,
      [idOp4, persona.id_personal, persona.rol, creadoPor]
    );
  }

  const cet4 = personalAsignado4.find((p) => p.username === "lhernandez");
  const cells4 = personalAsignado4.filter((p) => p.rol === "CELL");

  if (!cet4) throw new Error(`No se encontró lhernandez para OP-CANCELADA-004.`);

  for (const cell of cells4) {
    await client.query(
      `INSERT INTO mando_operacion (id_operacion, id_cet, id_cell, asignado_por)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id_operacion, id_cell) DO NOTHING`,
      [idOp4, cet4.id_personal, cell.id_personal, creadoPor]
    );
  }

  await client.query(
    `
    INSERT INTO grupo_operacion
      (id_operacion, nombre, apodo, id_grupo_padre, descripcion, creado_por)
    VALUES
      ($1,'Grupo CANCELADA','CANCELADA',NULL,'Grupo principal — Operacion Cancelada 004',$2)
    ON CONFLICT (id_operacion, nombre) DO NOTHING
    `,
    [idOp4, creadoPor]
  );

  const idPadre4 = await getGrupoId(client, idOp4, "Grupo CANCELADA");
  if (!idPadre4) throw new Error(`No se pudo obtener el grupo padre de OP-CANCELADA-004.`);

  await client.query(
    `
    INSERT INTO grupo_operacion
      (id_operacion, nombre, apodo, id_grupo_padre, descripcion, creado_por)
    VALUES ($1,'Jaguar 1',NULL,$2,'Subgrupo parcialmente organizado antes de cancelación',$3)
    ON CONFLICT (id_operacion, nombre) DO NOTHING
    `,
    [idOp4, idPadre4, creadoPor]
  );

  const idJaguar1 = await getGrupoId(client, idOp4, "Jaguar 1");
  if (!idJaguar1) throw new Error(`No se pudo obtener Jaguar 1 de OP-CANCELADA-004.`);

  for (const username of ["mcruz", "jmartinez", "psanchez"]) {
    const persona = personalAsignado4.find((p) => p.username === username);
    if (!persona) continue;
    await client.query(
      `INSERT INTO grupo_personal (id_grupo_operacion, id_personal, rol_en_grupo, asignado_por)
       VALUES ($1,$2,'CELL',$3)
       ON CONFLICT (id_grupo_operacion, id_personal) DO NOTHING`,
      [idJaguar1, persona.id_personal, creadoPor]
    );
  }

  // =========================================================
  // CHAT OP-CANCELADA-004
  // =========================================================
  const chat4Res = await client.query(
    `INSERT INTO chat_operacion (id_operacion, activo)
     VALUES ($1, FALSE)
     ON CONFLICT (id_operacion) DO UPDATE
       SET activo = FALSE
     RETURNING id_chat`,
    [idOp4]
  );

  let idChat4 = chat4Res.rows?.[0]?.id_chat;
  if (!idChat4) {
    const chat4Lookup = await client.query(
      `SELECT id_chat FROM chat_operacion WHERE id_operacion = $1 LIMIT 1`,
      [idOp4]
    );
    if (chat4Lookup.rowCount === 0) throw new Error(`No se pudo crear el chat de OP-CANCELADA-004.`);
    idChat4 = chat4Lookup.rows[0].id_chat;
  }

  const idPartAdmin4 = await ensureChatParticipantUsuario(client, idChat4, creadoPor);

  for (const persona of personalAsignado4) {
    await ensureChatParticipantPersonal(client, idChat4, persona.id_personal);
  }

  if (idPartAdmin4) {
    const msgCount4 = await client.query(
      `SELECT COUNT(*)::int AS total FROM mensaje_chat WHERE id_chat = $1`,
      [idChat4]
    );

    if ((msgCount4.rows[0]?.total ?? 0) === 0) {
      const mensajes4 = [
        { contenido: "Chat de OP-CANCELADA-004 inicializado. Operacion en fase de planeacion.", tipo: "SISTEMA" },
        { contenido: "Planeación inicial completada. Esperando autorización para activar.", tipo: "NORMAL" },
      ];

      for (const msg of mensajes4) {
        await client.query(
          `INSERT INTO mensaje_chat (id_chat, id_participante, contenido, tipo_mensaje)
           VALUES ($1,$2,$3,$4)`,
          [idChat4, idPartAdmin4, msg.contenido, msg.tipo]
        );
      }
    }
  }

  // =========================================================
  // ZONA OP-CANCELADA-004 — Oaxaca
  // =========================================================
  const zonaGeometria4 = {
    type: "Polygon",
    coordinates: [[
      [-96.7200, 17.0700],
      [-96.6500, 17.0700],
      [-96.6500, 17.0100],
      [-96.7200, 17.0100],
      [-96.7200, 17.0700],
    ]],
  };

  await client.query(
    `
    INSERT INTO zona_operacion
      (id_operacion, nombre, geometria, centroide_lat, centroide_lon, zoom_inicial, color, creado_por)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (id_operacion) DO UPDATE
      SET nombre        = EXCLUDED.nombre,
          geometria     = EXCLUDED.geometria,
          centroide_lat = EXCLUDED.centroide_lat,
          centroide_lon = EXCLUDED.centroide_lon,
          zoom_inicial  = EXCLUDED.zoom_inicial,
          color         = EXCLUDED.color,
          creado_por    = EXCLUDED.creado_por,
          fecha_creacion = NOW()
    `,
    [
      idOp4,
      "Zona Oaxaca",
      JSON.stringify(zonaGeometria4),
      17.0400,
      -96.6850,
      1000,
      "#dc2626",
      creadoPor,
    ]
  );

  const grid = await seedOperationGrid(client, {
    idOperacion: idOp4,
    size: "2x2",
    names: [
      "Planeacion NW", "Planeacion NE",
      "Reserva SW", "Reserva SE",
    ],
    idUsuario: creadoPor,
  });

  // =========================================================
  // CANCELACIÓN — liberar recursos y cancelar operación
  // =========================================================
  await client.query(
    `UPDATE asignacion_operacion_personal
     SET estado_asignacion = 'LIBERADO'
     WHERE id_operacion = $1`,
    [idOp4]
  );

  await client.query(
    `UPDATE vehiculo_operacion
     SET estado_asignacion = 'LIBERADO'
     WHERE id_operacion = $1`,
    [idOp4]
  );

  await client.query(
    `UPDATE operacion_equipo
     SET estado_asignacion = 'LIBERADO'
     WHERE id_operacion = $1`,
    [idOp4]
  );

  await client.query(
    `UPDATE operacion SET estado = 'CANCELADA' WHERE id_operacion = $1`,
    [idOp4]
  );

  return {
    codigo: OP4_CODIGO,
    estado: "CANCELADA",
    idOp: idOp4,
    personalAsignado: personalAsignado4.length,
    vehiculosFijos: 0,
    equiposFijos: 0,
    cuadricula: grid.size,
  };
}

