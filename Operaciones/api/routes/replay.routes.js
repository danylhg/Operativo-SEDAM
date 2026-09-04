import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middlewares/auth.js";
import { sendDbError } from "../utils/dbErrors.js";
import { isInt } from "../utils/validators.js";
import { ensureTimelineSchema } from "../utils/timeline.js";
import { fetchOperationGrid } from "../utils/grid.js";
import { ensureExtendedTrackingSchema } from "../utils/trackingSchema.js";

const router = Router();
const MAX_TRACKING_EVENTS_PER_LAYER = 100000;
const MAX_TIMELINE_EVENTS = 100000;

function rowsToEvents(rows, mapFn) {
  return rows.map(mapFn).filter(Boolean);
}

function sampleRows(rows, maxRows = MAX_TRACKING_EVENTS_PER_LAYER) {
  if (!Array.isArray(rows) || rows.length <= maxRows) return rows || [];
  if (maxRows <= 2) return rows.slice(0, maxRows);

  const sampled = [];
  const lastIndex = rows.length - 1;
  const used = new Set();

  for (let index = 0; index < maxRows; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (maxRows - 1));
    if (!used.has(sourceIndex)) {
      used.add(sourceIndex);
      sampled.push(rows[sourceIndex]);
    }
  }

  return sampled;
}

function compactTrackingPayload(row, entityKey, labelFields = []) {
  const payload = {
    id_tracking: row.id_tracking,
    [entityKey]: row[entityKey],
    latitud: row.latitud,
    longitud: row.longitud,
    altitud: row.altitud,
    velocidad_kmh: row.velocidad_kmh,
    rumbo_grados: row.rumbo_grados,
    precision_m: row.precision_m,
    bateria_pct: row.bateria_pct,
    timestamp: row.timestamp,
  };

  for (const field of labelFields) {
    if (row[field] != null) payload[field] = row[field];
  }

  return payload;
}

function toTimestamp(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : NaN;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : NaN;
  }
  if (!value) return NaN;

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function firstTimestamp(...values) {
  for (const value of values) {
    const ms = toTimestamp(value);
    if (Number.isFinite(ms)) return ms;
  }
  return NaN;
}

function minTimestamp(values) {
  let min = Infinity;
  for (const value of values) {
    if (Number.isFinite(value) && value < min) {
      min = value;
    }
  }
  return min === Infinity ? NaN : min;
}

function maxTimestamp(values) {
  let max = -Infinity;
  for (const value of values) {
    if (Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  return max === -Infinity ? NaN : max;
}

async function optionalReplayQuery(sql, params) {
  try {
    return await pool.query(sql, params);
  } catch (error) {
    if (["42P01", "42703"].includes(error?.code)) {
      console.warn("[replay] tabla o columna opcional no disponible:", error.message);
      return { rows: [] };
    }
    throw error;
  }
}

router.get("/ops/:id/replay", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  try {
    await ensureTimelineSchema(pool);

    const { rows: opRows } = await pool.query(
      `SELECT id_operacion, codigo, nombre, descripcion, prioridad, estado,
              fecha_inicio, fecha_fin, fecha_creacion, fecha_actualizacion, creada_por, id_cut
         FROM operacion
        WHERE id_operacion = $1
        LIMIT 1`,
      [id_operacion]
    );

    if (!opRows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Operacion no existe" });
    }

    await ensureExtendedTrackingSchema();

    const [
      zona,
      eventos,
      chat,
      avisosOperacionales,
      novedadesOperacionales,
      trackingPersonal,
      trackingVehiculos,
      trackingEquipos,
      trackingDispositivos,
      capas,
      personalAsignado,
      vehiculosAsignados,
      equiposAsignados,
      grid
    ] = await Promise.all([
      pool.query(
        `SELECT id_zona, id_operacion, nombre, geometria, centroide_lat, centroide_lon, zoom_inicial, color
           FROM zona_operacion
          WHERE id_operacion = $1
          ORDER BY id_zona ASC
          LIMIT 1`,
        [id_operacion]
      ),
      pool.query(
        `SELECT *
           FROM operacion_evento
          WHERE id_operacion = $1
          ORDER BY occurred_at ASC, id_evento ASC`,
        [id_operacion]
      ),
      pool.query(
        `SELECT v.*
           FROM v_chat_feed v
           JOIN chat_operacion co ON co.id_chat = v.id_chat
          WHERE co.id_operacion = $1
          ORDER BY v.fecha_envio ASC, v.id_mensaje ASC`,
        [id_operacion]
      ),
      optionalReplayQuery(
        `SELECT a.*,
                pe.apodo AS emisor_apodo,
                pe.rol AS emisor_rol,
                pr.apodo AS receptor_personal_apodo,
                u.nombre || ' ' || u.apellido AS receptor_usuario_nombre
           FROM aviso_operacion a
           LEFT JOIN personal pe ON pe.id_personal = a.id_personal_emisor
           LEFT JOIN personal pr ON pr.id_personal = a.id_personal_receptor
           LEFT JOIN usuario u ON u.id_usuario = a.id_usuario_receptor
          WHERE a.id_operacion = $1
          ORDER BY a.fecha_envio ASC, a.id_aviso ASC`,
        [id_operacion]
      ),
      optionalReplayQuery(
        `SELECT n.*
           FROM novedad_operacion n
          WHERE n.id_operacion = $1
          ORDER BY n.fecha_registro ASC, n.id_novedad ASC`,
        [id_operacion]
      ),
      pool.query(
        `SELECT tp.*, p.rol, p.apodo, p.nombre, p.apellido
           FROM tracking_personal tp
           LEFT JOIN personal p ON p.id_personal = tp.id_personal
          WHERE tp.id_operacion = $1
          ORDER BY tp.timestamp ASC, tp.id_tracking ASC`,
        [id_operacion]
      ),
      pool.query(
        `SELECT tv.*, v.tipo, v.codigo_interno, v.alias
           FROM tracking_vehiculo tv
           LEFT JOIN vehiculo v ON v.id_vehiculo = tv.id_vehiculo
          WHERE tv.id_operacion = $1
          ORDER BY tv.timestamp ASC, tv.id_tracking ASC`,
        [id_operacion]
      ),
      pool.query(
        `SELECT te.*, e.numero_serie, e.nombre, e.categoria
           FROM tracking_equipo te
           LEFT JOIN equipo e ON e.id_equipo = te.id_equipo
          WHERE te.id_operacion = $1
          ORDER BY te.timestamp ASC, te.id_tracking ASC`,
        [id_operacion]
      ),
      pool.query(
        `SELECT td.*, d.tipo, d.marca, d.modelo, d.numero_serie, d.imei
           FROM tracking_dispositivo td
           LEFT JOIN dispositivo d ON d.id_dispositivo = td.id_dispositivo
          WHERE td.id_operacion = $1
          ORDER BY td.timestamp ASC, td.id_tracking ASC`,
        [id_operacion]
      ),
      Promise.all([
        pool.query(`SELECT * FROM puntos_interes WHERE id_operacion = $1 ORDER BY fecha_creacion ASC`, [id_operacion]),
        pool.query(`SELECT * FROM area_interes WHERE id_operacion = $1 ORDER BY fecha_creacion ASC`, [id_operacion]),
        pool.query(`SELECT * FROM marca_edificio WHERE id_operacion = $1 ORDER BY fecha_creacion ASC`, [id_operacion]),
        pool.query(`SELECT * FROM ruta_operacion WHERE id_operacion = $1 ORDER BY fecha_creacion ASC`, [id_operacion]),
        pool.query(`SELECT * FROM ruta_navegacion WHERE id_operacion = $1 ORDER BY fecha_creacion ASC`, [id_operacion]),
        pool.query(`SELECT * FROM dibujo_libre_operacion WHERE id_operacion = $1 ORDER BY fecha_creacion ASC`, [id_operacion]),
        pool.query(`SELECT * FROM zona_operacion WHERE id_operacion = $1 ORDER BY fecha_creacion ASC`, [id_operacion])
      ]),
      pool.query(
        `SELECT DISTINCT ON (p.id_personal)
            p.id_personal,
            p.apodo,
            p.nombre,
            p.apellido,
            p.rol,
            p.puesto,
            a.rol_en_operacion,
            a.estado_asignacion,
            a.estado_operacion_creacion,
            go.id_grupo_operacion,
            go.nombre AS grupo_nombre,
            go.apodo AS grupo_apodo,
            gp_padre.id_grupo_operacion AS grupo_padre_id,
            gp_padre.nombre AS grupo_padre_nombre,
            gp_padre.apodo AS grupo_padre_apodo,
            t.latitud,
            t.longitud,
            t.ultima_actualizacion
         FROM asignacion_operacion_personal a
         JOIN personal p ON p.id_personal = a.id_personal
         LEFT JOIN (
           SELECT gper2.id_personal, gper2.id_grupo_operacion
           FROM grupo_personal gper2
           JOIN grupo_operacion go2 ON go2.id_grupo_operacion = gper2.id_grupo_operacion
           WHERE go2.id_operacion = $1
         ) gper ON gper.id_personal = p.id_personal
         LEFT JOIN grupo_operacion go ON go.id_grupo_operacion = gper.id_grupo_operacion
         LEFT JOIN grupo_operacion gp_padre ON gp_padre.id_grupo_operacion = go.id_grupo_padre
         LEFT JOIN v_ultima_posicion_personal t
           ON t.id_personal = a.id_personal AND t.id_operacion = a.id_operacion
         WHERE a.id_operacion = $1
         ORDER BY p.id_personal,
                  CASE WHEN go.id_grupo_padre IS NOT NULL THEN 0 ELSE 1 END,
                  CASE WHEN go.id_grupo_operacion IS NULL THEN 1 ELSE 0 END,
                  go.id_grupo_operacion`,
        [id_operacion]
      ),
      pool.query(
        `WITH personal_ctx AS (
            SELECT DISTINCT ON (p.id_personal)
              p.id_personal,
              p.apodo,
              p.nombre,
              p.apellido,
              p.puesto,
              aop.rol_en_operacion AS personal_rol,
              go.id_grupo_operacion AS grupo_personal_id,
              go.nombre AS grupo_personal_nombre,
              go.apodo AS grupo_personal_apodo,
              gp_padre.nombre AS grupo_personal_padre_nombre,
              gp_padre.apodo AS grupo_personal_padre_apodo,
              CASE
                WHEN p.rol = 'CET' THEN p.id_personal
                ELSE mo.id_cet
              END AS id_cet_ref,
              CASE
                WHEN p.rol = 'CET' THEN p.apodo
                ELSE cet.apodo
              END AS cet_apodo,
              CASE
                WHEN p.rol = 'CET' THEN CONCAT_WS(' ', p.nombre, p.apellido)
                ELSE CONCAT_WS(' ', cet.nombre, cet.apellido)
              END AS cet_nombre
            FROM asignacion_operacion_personal aop
            JOIN personal p
              ON p.id_personal = aop.id_personal
            LEFT JOIN grupo_personal gper
              ON gper.id_personal = p.id_personal
             AND EXISTS (
               SELECT 1
               FROM grupo_operacion gox
               WHERE gox.id_grupo_operacion = gper.id_grupo_operacion
                 AND gox.id_operacion = aop.id_operacion
             )
            LEFT JOIN grupo_operacion go
              ON go.id_grupo_operacion = gper.id_grupo_operacion
            LEFT JOIN grupo_operacion gp_padre
              ON gp_padre.id_grupo_operacion = go.id_grupo_padre
            LEFT JOIN mando_operacion mo
              ON mo.id_operacion = aop.id_operacion
             AND mo.id_cell = aop.id_personal
            LEFT JOIN personal cet
              ON cet.id_personal = mo.id_cet
            WHERE aop.id_operacion = $1
            ORDER BY
              p.id_personal,
              CASE WHEN go.id_grupo_padre IS NOT NULL THEN 0 ELSE 1 END,
              CASE WHEN go.id_grupo_operacion IS NULL THEN 1 ELSE 0 END,
              go.id_grupo_operacion
         )
         SELECT
            v.id_vehiculo,
            v.codigo_interno,
            v.tipo,
            v.alias,
            v.alias AS nombre,
            vo.estado_asignacion,
            vo.estado_operacion_creacion,
            vo.nivel_asignacion,
            vo.nivel_asignacion AS tipo_destino,
            vo.id_personal,
            per_ctx.apodo AS asignado_a_apodo,
            per_ctx.nombre AS asignado_a_nombre,
            per_ctx.apellido AS asignado_a_apellido,
            per_ctx.nombre AS personal_nombre,
            per_ctx.apellido AS personal_apellido,
            per_ctx.puesto AS personal_puesto,
            per_ctx.personal_rol,
            per_ctx.id_cet_ref,
            per_ctx.cet_apodo,
            per_ctx.cet_nombre,
            COALESCE(go_dest.nombre, per_ctx.grupo_personal_nombre, '') AS grupo_nombre,
            COALESCE(go_dest.apodo, per_ctx.grupo_personal_apodo, '') AS grupo_apodo,
            CASE
              WHEN go_dest.id_grupo_operacion IS NOT NULL THEN go_dest.nombre
              ELSE COALESCE(per_ctx.grupo_personal_nombre, '')
            END AS grupo_directo_nombre,
            CASE
              WHEN go_dest.id_grupo_operacion IS NOT NULL THEN COALESCE(gp_dest.nombre, '')
              ELSE COALESCE(per_ctx.grupo_personal_padre_nombre, '')
            END AS grupo_padre_nombre,
            tv.latitud,
            tv.longitud,
            tv.ultima_actualizacion
         FROM vehiculo_operacion vo
         JOIN vehiculo v
           ON v.id_vehiculo = vo.id_vehiculo
         LEFT JOIN personal_ctx per_ctx
           ON per_ctx.id_personal = vo.id_personal
         LEFT JOIN grupo_operacion go_dest
           ON go_dest.id_grupo_operacion = vo.id_grupo_operacion
         LEFT JOIN grupo_operacion gp_dest
           ON gp_dest.id_grupo_operacion = go_dest.id_grupo_padre
         LEFT JOIN v_ultima_posicion_vehiculo tv
           ON tv.id_vehiculo = vo.id_vehiculo AND tv.id_operacion = vo.id_operacion
         WHERE vo.id_operacion = $1
         ORDER BY
           v.tipo,
           v.codigo_interno,
           CASE per_ctx.personal_rol WHEN 'CET' THEN 0 ELSE 1 END,
           per_ctx.cet_nombre,
           per_ctx.nombre,
           per_ctx.apellido`,
        [id_operacion]
      ),
      pool.query(
        `WITH personal_ctx AS (
            SELECT DISTINCT ON (p.id_personal)
              p.id_personal,
              go.nombre AS grupo_nombre,
              gp_padre.nombre AS grupo_padre_nombre
            FROM asignacion_operacion_personal aop
            JOIN personal p ON p.id_personal = aop.id_personal
            LEFT JOIN grupo_personal gper
              ON gper.id_personal = p.id_personal
             AND EXISTS (
               SELECT 1
               FROM grupo_operacion gox
               WHERE gox.id_grupo_operacion = gper.id_grupo_operacion
                 AND gox.id_operacion = aop.id_operacion
             )
            LEFT JOIN grupo_operacion go ON go.id_grupo_operacion = gper.id_grupo_operacion
            LEFT JOIN grupo_operacion gp_padre ON gp_padre.id_grupo_operacion = go.id_grupo_padre
            WHERE aop.id_operacion = $1
            ORDER BY
              p.id_personal,
              CASE WHEN go.id_grupo_padre IS NOT NULL THEN 0 ELSE 1 END,
              CASE WHEN go.id_grupo_operacion IS NULL THEN 1 ELSE 0 END,
              go.id_grupo_operacion
          )
          SELECT
            e.id_equipo,
            e.numero_serie,
            e.nombre,
            e.categoria,
            e.estado,
            oe.cantidad,
            oe.uso_en_operacion,
            oe.estado_asignacion,
            oe.estado_operacion_creacion,
            ueo.estado_operacion_creacion AS uso_estado_operacion_creacion,
            COALESCE(ec.imagen_eqcom, et.imagen_eqtac) AS imagen_eq,
            ec.marca,
            ec.modelo,
            et.tipo_tactico,
            CASE
              WHEN UPPER(COALESCE(e.categoria, '')) = 'COMUNICACION'
                THEN COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ec.marca, ec.modelo)), ''), 'Equipo de comunicacion')
              WHEN UPPER(COALESCE(e.categoria, '')) = 'TACTICO'
                THEN COALESCE(NULLIF(TRIM(et.tipo_tactico), ''), 'Equipo tactico')
              ELSE COALESCE(NULLIF(TRIM(e.categoria), ''), 'Equipo')
            END AS tipo_equipo,
            CASE
              WHEN ueo.id_vehiculo_contexto IS NOT NULL THEN 'VEHICULO'
              WHEN ueo.id_grupo_operacion   IS NOT NULL THEN 'GRUPO'
              WHEN ueo.id_personal          IS NOT NULL THEN 'PERSONAL'
              ELSE NULL
            END AS tipo_destino,
            COALESCE(
              NULLIF(TRIM(CONCAT_WS(' ', p_ueo.puesto, p_ueo.nombre, p_ueo.apellido)), ''),
              p_ueo.apodo
            ) AS asignado_a_personal,
            p_ueo.rol AS personal_rol,
            v_ueo.codigo_interno AS asignado_a_vehiculo,
            v_ueo.alias          AS vehiculo_alias,
            go_ueo.nombre AS grupo_asignado,
            gp_ueo.nombre AS flotilla_asignada,
            per_ctx.grupo_nombre AS personal_grupo_nombre,
            per_ctx.grupo_padre_nombre AS personal_flotilla_nombre,
            veh_ctx.flotillas_vinculadas,
            veh_ctx.grupos_vinculados
          FROM operacion_equipo oe
          JOIN equipo e ON e.id_equipo = oe.id_equipo
          LEFT JOIN equipo_comunicacion ec ON ec.id_equipo = e.id_equipo
          LEFT JOIN equipo_tactico et ON et.id_equipo = e.id_equipo
          LEFT JOIN uso_equipo_operacion ueo
            ON ueo.id_operacion = oe.id_operacion
           AND ueo.id_equipo    = oe.id_equipo
           AND ueo.fecha_devolucion IS NULL
          LEFT JOIN personal        p_ueo  ON p_ueo.id_personal          = ueo.id_personal
          LEFT JOIN vehiculo        v_ueo  ON v_ueo.id_vehiculo           = ueo.id_vehiculo_contexto
          LEFT JOIN grupo_operacion go_ueo ON go_ueo.id_grupo_operacion   = ueo.id_grupo_operacion
          LEFT JOIN grupo_operacion gp_ueo ON gp_ueo.id_grupo_operacion   = go_ueo.id_grupo_padre
          LEFT JOIN personal_ctx per_ctx   ON per_ctx.id_personal         = ueo.id_personal
          LEFT JOIN LATERAL (
            SELECT
              STRING_AGG(DISTINCT COALESCE(pc.grupo_padre_nombre, pc.grupo_nombre), ', ')
                FILTER (WHERE COALESCE(pc.grupo_padre_nombre, pc.grupo_nombre) IS NOT NULL) AS flotillas_vinculadas,
              STRING_AGG(DISTINCT pc.grupo_nombre, ', ')
                FILTER (WHERE pc.grupo_nombre IS NOT NULL) AS grupos_vinculados
            FROM vehiculo_operacion vo2
            LEFT JOIN personal_ctx pc ON pc.id_personal = vo2.id_personal
            WHERE vo2.id_operacion = oe.id_operacion
              AND vo2.id_vehiculo = ueo.id_vehiculo_contexto
          ) veh_ctx ON TRUE
          WHERE oe.id_operacion = $1
          ORDER BY
            CASE
              WHEN UPPER(COALESCE(e.categoria, '')) = 'COMUNICACION' THEN 0
              WHEN UPPER(COALESCE(e.categoria, '')) = 'TACTICO' THEN 1
              ELSE 2
            END,
            e.nombre,
            e.numero_serie`,
        [id_operacion]
      ),
      fetchOperationGrid(pool, id_operacion)
    ]);

    const [pois, areas, estructuras, rutasTacticas, rutasNavegacion, dibujos, zonas] = capas;
    const loggedKeys = new Set(
      eventos.rows.map(e => `${e.tipo_evento}:${e.entidad_tipo}:${e.entidad_id ?? ""}`)
    );
    const eventIfMissing = (tipo_evento, entidad_tipo, entidad_id, occurred_at, payload) => {
      const key = `${tipo_evento}:${entidad_tipo}:${entidad_id ?? ""}`;
      if (!occurred_at || loggedKeys.has(key)) return null;
      return {
        tipo_evento,
        entidad_tipo,
        entidad_id: entidad_id == null ? null : String(entidad_id),
        occurred_at,
        payload
      };
    };

    const generatedEvents = [
      eventIfMissing("operacion_activada", "operacion", id_operacion, opRows[0].fecha_inicio || opRows[0].fecha_creacion, {
        codigo: opRows[0].codigo,
        nombre: opRows[0].nombre,
        estado: opRows[0].estado,
      }),
      opRows[0].fecha_fin ? eventIfMissing("operacion_cerrada", "operacion", id_operacion, opRows[0].fecha_fin, {
        codigo: opRows[0].codigo,
        nombre: opRows[0].nombre,
        estado: opRows[0].estado,
      }) : null,
      ...rowsToEvents(chat.rows, row => eventIfMissing("chat_mensaje", "mensaje_chat", row.id_mensaje, row.fecha_envio, row)),
      ...rowsToEvents(avisosOperacionales.rows, row => eventIfMissing("aviso_operacion", "aviso_operacion", row.id_aviso, row.fecha_envio, row)),
      ...rowsToEvents(novedadesOperacionales.rows, row => eventIfMissing("novedad_operacion", "novedad_operacion", row.id_novedad, row.fecha_registro, row)),
      ...rowsToEvents(sampleRows(trackingPersonal.rows), row => ({
        tipo_evento: "tracking_personal",
        entidad_tipo: "tracking_personal",
        entidad_id: String(row.id_tracking),
        occurred_at: row.timestamp,
        payload: compactTrackingPayload(row, "id_personal", ["rol", "apodo", "nombre", "apellido"])
      })),
      ...rowsToEvents(sampleRows(trackingVehiculos.rows), row => ({
        tipo_evento: "tracking_vehiculo",
        entidad_tipo: "tracking_vehiculo",
        entidad_id: String(row.id_tracking),
        occurred_at: row.timestamp,
        payload: compactTrackingPayload(row, "id_vehiculo", ["tipo", "codigo_interno", "alias"])
      })),
      ...rowsToEvents(sampleRows(trackingEquipos.rows), row => ({
        tipo_evento: "tracking_equipo",
        entidad_tipo: "tracking_equipo",
        entidad_id: String(row.id_tracking),
        occurred_at: row.timestamp,
        payload: compactTrackingPayload(row, "id_equipo", ["numero_serie", "nombre", "categoria"])
      })),
      ...rowsToEvents(sampleRows(trackingDispositivos.rows), row => ({
        tipo_evento: "tracking_dispositivo",
        entidad_tipo: "tracking_dispositivo",
        entidad_id: String(row.id_tracking),
        occurred_at: row.timestamp,
        payload: compactTrackingPayload(row, "id_dispositivo", ["tipo", "marca", "modelo", "numero_serie", "imei"])
      })),
      ...rowsToEvents(pois.rows, row => eventIfMissing("poi_creado", "poi", row.id_poi, row.fecha_creacion, row)),
      ...rowsToEvents(pois.rows, row => !row.activo
        ? eventIfMissing("poi_eliminado", "poi", row.id_poi, row.fecha_actualizacion, row)
        : null),
      ...rowsToEvents(areas.rows, row => eventIfMissing("area_creada", "area", row.id_area, row.fecha_creacion, row)),
      ...rowsToEvents(areas.rows, row => row.estado === "ELIMINADA"
        ? eventIfMissing("area_eliminada", "area", row.id_area, row.fecha_actualizacion, row)
        : null),
      ...rowsToEvents(estructuras.rows, row => eventIfMissing("estructura_creada", "estructura", row.id_marca, row.fecha_creacion, row)),
      ...rowsToEvents(estructuras.rows, row => row.estado === "INACTIVO"
        ? eventIfMissing("estructura_eliminada", "estructura", row.id_marca, row.fecha_actualizacion, row)
        : null),
      ...rowsToEvents(rutasTacticas.rows, row => eventIfMissing("ruta_tactica_creada", "ruta_operacion", row.id_ruta, row.fecha_creacion, row)),
      ...rowsToEvents(rutasTacticas.rows, row => row.estado === "CANCELADA"
        ? eventIfMissing("ruta_tactica_eliminada", "ruta_operacion", row.id_ruta, row.fecha_actualizacion, row)
        : null),
      ...rowsToEvents(rutasNavegacion.rows, row => eventIfMissing("ruta_navegacion_creada", "ruta_navegacion", row.id_ruta, row.fecha_creacion, row)),
      ...rowsToEvents(rutasNavegacion.rows, row => row.activo === false
        ? eventIfMissing("ruta_navegacion_eliminada", "ruta_navegacion", row.id_ruta, row.fecha_eliminacion, row)
        : null),
      ...rowsToEvents(dibujos.rows, row => eventIfMissing("dibujo_creado", "dibujo", row.id_dibujo, row.fecha_creacion, row)),
      ...rowsToEvents(zonas.rows, row => eventIfMissing("zona_creada", "zona", row.id_zona, row.fecha_creacion, row)),
      grid ? eventIfMissing(
        "cuadricula_guardada",
        "cuadricula",
        grid.id_cuadricula,
        grid.fecha_actualizacion || grid.fecha_creacion,
        grid
      ) : null
    ].filter(Boolean);

    const allEvents = [...eventos.rows, ...generatedEvents].sort((a, b) => {
      const at = toTimestamp(a.occurred_at);
      const bt = toTimestamp(b.occurred_at);
      return at - bt;
    });
    const timelineEvents = sampleRows(allEvents, MAX_TIMELINE_EVENTS);
    const eventTimes = allEvents
      .map(event => toTimestamp(event.occurred_at))
      .filter(Number.isFinite);
    const opStartMs = firstTimestamp(opRows[0].fecha_inicio, opRows[0].fecha_creacion);
    const opEndMs = firstTimestamp(opRows[0].fecha_fin, opRows[0].fecha_actualizacion);
    const fallbackMs = firstTimestamp(opStartMs, eventTimes[0], Date.now());
    const activationMs = toTimestamp(opRows[0].fecha_inicio);
    const timelineStartMs = Number.isFinite(activationMs)
      ? activationMs
      : minTimestamp([opStartMs, ...eventTimes, fallbackMs]);
    const timelineEndMs = Math.max(
      timelineStartMs,
      maxTimestamp([opEndMs, ...eventTimes, timelineStartMs])
    );
    const timelineStart = new Date(timelineStartMs).toISOString();
    const timelineEnd = new Date(timelineEndMs).toISOString();

    res.json({
      ok: true,
      operacion: opRows[0],
      zona_operacion: zona.rows[0] || null,
      timeline: {
        inicio: timelineStart,
        fin: timelineEnd,
        eventos: timelineEvents,
        total_eventos: allEvents.length,
        eventos_muestreados: timelineEvents.length < allEvents.length
      },
      snapshots: {
        pois: pois.rows,
        areas: areas.rows,
        estructuras: estructuras.rows,
        rutas_tacticas: rutasTacticas.rows,
        rutas_navegacion: rutasNavegacion.rows,
        dibujos: dibujos.rows,
        zonas: zonas.rows,
        cuadriculas: grid ? [grid] : []
      },
      cuadricula_operacion: grid,
      grid,
      asignacion: {
        personal: personalAsignado.rows,
        vehiculos: vehiculosAsignados.rows,
        equipos: equiposAsignados.rows
      },
      personal: personalAsignado.rows,
      vehiculos: vehiculosAsignados.rows,
      equipos: equiposAsignados.rows
    });
  } catch (err) {
    sendDbError(res, err, "Error obteniendo replay de operacion");
  }
});

export default router;
