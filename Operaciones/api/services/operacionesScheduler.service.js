import { OPERATION_AUTO_ACTIVATION_INTERVAL_MS } from "../config/env.js";
import { pool } from "../db.js";
import { isOperacionEnAsignacion } from "./asignacionPresence.service.js";
import { cambiarEstadoOperacion, OperationStateError } from "./operacionesEstado.service.js";

let timer = null;
let running = false;

const FECHA_INICIO_WALL_TIME_ZONE = "America/Mexico_City";

function emitEstadoActualizado(io, operacion, automatico) {
  if (!io || !operacion) return;

  io.emit("operacion_estado_actualizado", {
    operacion,
    automatico
  });
}

export async function activarOperacionesProgramadas({ io = null, limit = 50 } = {}) {
  if (running) return [];
  running = true;

  try {
    const { rows } = await pool.query(
      `WITH programadas AS (
         SELECT
           id_operacion,
           codigo,
           nombre,
           fecha_inicio,
           hora_inicio,
           (
             (fecha_inicio AT TIME ZONE $2)::date
             + COALESCE(
                 CASE
                   WHEN hora_inicio ~ '^\\d{2}:\\d{2}$' THEN hora_inicio::time
                   ELSE NULL
                 END,
                 (fecha_inicio AT TIME ZONE $2)::time
               )
           ) AS inicio_programado_local
         FROM operacion
         WHERE estado = 'PLANIFICADA'
           AND fecha_inicio IS NOT NULL
       )
       SELECT id_operacion, codigo, nombre, fecha_inicio, hora_inicio
       FROM programadas
       WHERE inicio_programado_local <= (NOW() AT TIME ZONE $2)
       ORDER BY inicio_programado_local ASC, id_operacion ASC
       LIMIT $1`,
      [limit, FECHA_INICIO_WALL_TIME_ZONE]
    );

    const activadas = [];

    for (const op of rows) {
      if (isOperacionEnAsignacion(op.id_operacion)) {
        continue;
      }

      try {
        const operacion = await cambiarEstadoOperacion({
          id_operacion: op.id_operacion,
          nuevoEstado: "ACTIVA",
          automatico: true,
          preservarFechaInicio: true
        });

        activadas.push(operacion);
        emitEstadoActualizado(io, operacion, true);
        console.log(
          `[AUTO-ACTIVACION] Operacion ${op.codigo || op.id_operacion} activada por horario.`
        );
      } catch (err) {
        if (err instanceof OperationStateError && [404, 409].includes(err.status)) {
          continue;
        }

        console.error(
          `[AUTO-ACTIVACION] Error activando operacion ${op.id_operacion}:`,
          err.message
        );
      }
    }

    return activadas;
  } finally {
    running = false;
  }
}

export function startOperacionAutoActivator({
  io = null,
  intervalMs = OPERATION_AUTO_ACTIVATION_INTERVAL_MS,
  runImmediately = true
} = {}) {
  if (timer) return timer;

  const tick = () => {
    activarOperacionesProgramadas({ io }).catch((err) => {
      console.error("[AUTO-ACTIVACION] Error revisando operaciones:", err.message);
    });
  };

  if (runImmediately) tick();
  timer = setInterval(tick, intervalMs);

  console.log(`[AUTO-ACTIVACION] Revisor iniciado cada ${intervalMs}ms.`);
  return timer;
}

export function stopOperacionAutoActivator() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
