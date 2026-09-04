import { pool } from "../db.js";

export const ESTADOS_OPERACION = ["PLANIFICADA", "ACTIVA", "CERRADA", "CANCELADA"];

const TRANSICIONES = {
  PLANIFICADA: ["ACTIVA", "CANCELADA"],
  ACTIVA: ["CERRADA", "CANCELADA"],
  CERRADA: [],
  CANCELADA: []
};

export class OperationStateError extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.name = "OperationStateError";
    this.status = status;
    this.mensaje = mensaje;
  }
}

function formatHoraOficial(date = new Date()) {
  return date.toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "long",
    timeStyle: "short"
  });
}

function normalizeActor(actor, fallbackUsuarioId) {
  const tabla = String(actor?.tabla || "").toLowerCase();

  if (tabla === "personal") {
    const id = Number(actor?.sub ?? actor?.id ?? actor?.id_personal);
    if (Number.isFinite(id) && id > 0) return { tipo: "PERSONAL", id };
  }

  const idPersonal = Number(actor?.id_personal);
  if (Number.isFinite(idPersonal) && idPersonal > 0) {
    return { tipo: "PERSONAL", id: idPersonal };
  }

  const idUsuario = Number(actor?.sub ?? actor?.id ?? actor?.id_usuario ?? fallbackUsuarioId);
  if (Number.isFinite(idUsuario) && idUsuario > 0) {
    return { tipo: "USUARIO", id: idUsuario };
  }

  throw new OperationStateError(500, "No se pudo resolver actor para cambiar estado");
}

async function getOrCreateParticipante(client, idChat, actor) {
  const col = actor.tipo === "PERSONAL" ? "id_personal" : "id_usuario";

  const { rows } = await client.query(
    `INSERT INTO participante_chat (id_chat, tipo, ${col})
     VALUES ($1, $2, $3)
     ON CONFLICT (id_chat, ${col}) DO NOTHING
     RETURNING id_participante`,
    [idChat, actor.tipo, actor.id]
  );

  if (rows[0]) return rows[0].id_participante;

  const { rows: existentes } = await client.query(
    `SELECT id_participante
     FROM participante_chat
     WHERE id_chat = $1 AND ${col} = $2
     LIMIT 1`,
    [idChat, actor.id]
  );

  const idParticipante = existentes[0]?.id_participante;
  if (!idParticipante) {
    throw new OperationStateError(500, "No se pudo crear participante de chat");
  }

  return idParticipante;
}

async function getOperacionActualizada(client, idOperacion) {
  const { rows } = await client.query(
    `SELECT id_operacion, codigo, nombre, descripcion, prioridad, estado,
            fecha_inicio, hora_inicio, fecha_fin, fecha_creacion, creada_por
     FROM operacion
     WHERE id_operacion = $1`,
    [idOperacion]
  );

  return rows[0] || null;
}

async function liberarRecursosOperacion(client, idOperacion, ahora, { incluirPersonal = false } = {}) {
  await client.query(
    `UPDATE uso_equipo_operacion
     SET fecha_devolucion = COALESCE(fecha_devolucion, $1)
     WHERE id_operacion = $2 AND fecha_devolucion IS NULL`,
    [ahora, idOperacion]
  );

  await client.query(
    `UPDATE operacion_equipo
     SET estado_asignacion = 'LIBERADO', fecha_fin_asignacion = $1
     WHERE id_operacion = $2 AND estado_asignacion != 'LIBERADO'`,
    [ahora, idOperacion]
  );

  await client.query(
    `UPDATE vehiculo_operacion
     SET estado_asignacion = 'LIBERADO', fecha_fin_asignacion = $1
     WHERE id_operacion = $2 AND estado_asignacion != 'LIBERADO'`,
    [ahora, idOperacion]
  );

  if (incluirPersonal) {
    await client.query(
      `UPDATE asignacion_operacion_personal
       SET estado_asignacion = 'LIBERADO', fecha_fin_asignacion = $1
       WHERE id_operacion = $2 AND estado_asignacion != 'LIBERADO'`,
      [ahora, idOperacion]
    );
  }
}

export async function cambiarEstadoOperacion({
  id_operacion,
  nuevoEstado,
  actor = null,
  automatico = false,
  preservarFechaInicio = false
}) {
  const idOperacion = Number(id_operacion);
  const estadoDestino = String(nuevoEstado || "").toUpperCase();

  if (!Number.isInteger(idOperacion) || idOperacion <= 0) {
    throw new OperationStateError(400, "id invalido");
  }

  if (!ESTADOS_OPERACION.includes(estadoDestino)) {
    throw new OperationStateError(
      400,
      `estado invalido (${ESTADOS_OPERACION.join("|")})`
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: opRows } = await client.query(
      `SELECT estado, nombre, codigo, creada_por, fecha_inicio
       FROM operacion
       WHERE id_operacion = $1
       FOR UPDATE`,
      [idOperacion]
    );

    if (!opRows[0]) {
      throw new OperationStateError(404, "Operacion no existe");
    }

    const op = opRows[0];
    const estadoActual = op.estado;

    if (!TRANSICIONES[estadoActual]?.includes(estadoDestino)) {
      throw new OperationStateError(
        409,
        `No se puede pasar de ${estadoActual} a ${estadoDestino}`
      );
    }

    const actorChat = normalizeActor(actor, op.creada_por);

    if (estadoDestino === "CERRADA" || estadoDestino === "CANCELADA") {
      await liberarRecursosOperacion(client, idOperacion, new Date().toISOString(), {
        incluirPersonal: estadoDestino === "CANCELADA"
      });

      const { rows: chatRows } = await client.query(
        `SELECT id_chat
         FROM chat_operacion
         WHERE id_operacion = $1 AND activo = TRUE
         LIMIT 1`,
        [idOperacion]
      );

      if (chatRows[0]) {
        const idChat = chatRows[0].id_chat;
        const idParticipante = await getOrCreateParticipante(client, idChat, actorChat);

        if (estadoDestino === "CERRADA") {
          await client.query(
            `INSERT INTO mensaje_chat (id_chat, id_participante, contenido, tipo_mensaje)
             VALUES ($1, $2, $3, 'SISTEMA')`,
            [
              idChat,
              idParticipante,
              `OPERACION CERRADA\nCodigo: ${op.codigo}\nNombre: ${op.nombre}\nHora oficial de cierre: ${formatHoraOficial()}`
            ]
          );
        }

        await client.query(
          `UPDATE chat_operacion
           SET activo = FALSE, fecha_cierre = NOW()
           WHERE id_chat = $1`,
          [idChat]
        );
      }
    }

    const params = [estadoDestino, idOperacion];
    let updateSql = `UPDATE operacion SET estado = $1`;

    if (estadoDestino === "ACTIVA") {
      updateSql += preservarFechaInicio
        ? `, fecha_inicio = COALESCE(fecha_inicio, NOW())`
        : `, fecha_inicio = NOW()`;
    }

    if (estadoDestino === "CERRADA") {
      updateSql += `, fecha_fin = NOW()`;
    }

    if (estadoDestino === "CANCELADA") {
      updateSql += `, nombre = $3`;
      params.push(`${op.nombre} - CANCELADA`);
    }

    await client.query(`${updateSql} WHERE id_operacion = $2`, params);

    if (estadoDestino === "ACTIVA") {
      const { rows: chatRows } = await client.query(
        `INSERT INTO chat_operacion (id_operacion, activo, fecha_cierre)
         VALUES ($1, TRUE, NULL)
         ON CONFLICT (id_operacion)
         DO UPDATE SET activo = TRUE, fecha_cierre = NULL
         RETURNING id_chat`,
        [idOperacion]
      );

      const idChat = chatRows[0].id_chat;
      const idParticipante = await getOrCreateParticipante(client, idChat, actorChat);
      const tipoActivacion = automatico ? "ACTIVADA AUTOMATICAMENTE" : "ACTIVADA";

      await client.query(
        `INSERT INTO mensaje_chat (id_chat, id_participante, contenido, tipo_mensaje)
         VALUES ($1, $2, $3, 'SISTEMA')`,
        [
          idChat,
          idParticipante,
          `OPERACION ${tipoActivacion}\nCodigo: ${op.codigo}\nNombre: ${op.nombre}\nHora oficial de inicio: ${formatHoraOficial()}`
        ]
      );
    }

    const operacion = await getOperacionActualizada(client, idOperacion);

    await client.query("COMMIT");
    return operacion;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
