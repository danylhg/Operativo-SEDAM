import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middlewares/auth.js";
import { sendDbError } from "../utils/dbErrors.js";
import { isInt } from "../utils/validators.js";

const router = Router();

// ===============================
// POST /validate/disponibilidad
// Verifica si personal, vehículos o equipos están ocupados
// en operaciones cuyas fechas se solapan con las dadas.
// body: { fecha_inicio?, fecha_fin?, personal_ids:[], vehiculo_ids:[], equipo_ids:[] }
// ===============================
router.post("/validate/disponibilidad", requireAuth, async (req, res) => {
  try {
    const {
      fecha_inicio = null,
      fecha_fin = null,
      personal_ids = [],
      vehiculo_ids = [],
      equipo_ids = [],
    } = req.body ?? {};

    const pIds = (Array.isArray(personal_ids) ? personal_ids : []).map(Number).filter(isInt);
    const vIds = (Array.isArray(vehiculo_ids) ? vehiculo_ids : []).map(Number).filter(isInt);
    const eIds = (Array.isArray(equipo_ids) ? equipo_ids : []).map(Number).filter(isInt);

    if (!pIds.length && !vIds.length && !eIds.length) {
      return res.status(400).json({ ok: false, mensaje: "Debes enviar al menos un id en personal_ids, vehiculo_ids o equipo_ids." });
    }

    const conflictos = { personal: [], vehiculos: [], equipos: [] };

    // ── Personal ──────────────────────────────────────────────────────────
    if (pIds.length) {
      const params = [pIds];
      let cond = "TRUE";
      if (fecha_inicio || fecha_fin) {
        if (fecha_fin) { params.push(fecha_fin); cond = `(o.fecha_inicio IS NULL OR o.fecha_inicio <= $${params.length})`; }
        if (fecha_inicio) { params.push(fecha_inicio); cond += ` AND (o.fecha_fin IS NULL OR o.fecha_fin >= $${params.length})`; }
      }

      const { rows } = await pool.query(
        `SELECT
           a.id_personal,
           p.nombre,
           p.apellido,
           p.apodo,
           o.id_operacion,
           o.codigo   AS op_codigo,
           o.nombre   AS op_nombre,
           o.estado   AS op_estado,
           o.fecha_inicio AS op_inicio,
           o.fecha_fin    AS op_fin
         FROM asignacion_operacion_personal a
         JOIN personal  p ON p.id_personal  = a.id_personal
         JOIN operacion o ON o.id_operacion = a.id_operacion
         WHERE a.id_personal = ANY($1::int[])
           AND a.estado_asignacion NOT IN ('LIBERADO')
           AND o.estado IN ('PLANIFICADA', 'ACTIVA')
           AND ${cond}
         ORDER BY a.id_personal, o.id_operacion`,
        params
      );
      conflictos.personal = rows;
    }

    // ── Vehículos ─────────────────────────────────────────────────────────
    if (vIds.length) {
      const params = [vIds];
      let cond = "TRUE";
      if (fecha_inicio || fecha_fin) {
        if (fecha_fin) { params.push(fecha_fin); cond = `(o.fecha_inicio IS NULL OR o.fecha_inicio <= $${params.length})`; }
        if (fecha_inicio) { params.push(fecha_inicio); cond += ` AND (o.fecha_fin IS NULL OR o.fecha_fin >= $${params.length})`; }
      }

      const { rows } = await pool.query(
        `SELECT
           vo.id_vehiculo,
           v.codigo_interno,
           v.alias,
           v.tipo,
           o.id_operacion,
           o.codigo   AS op_codigo,
           o.nombre   AS op_nombre,
           o.estado   AS op_estado,
           o.fecha_inicio AS op_inicio,
           o.fecha_fin    AS op_fin
         FROM vehiculo_operacion vo
         JOIN vehiculo  v ON v.id_vehiculo  = vo.id_vehiculo
         JOIN operacion o ON o.id_operacion = vo.id_operacion
         WHERE vo.id_vehiculo = ANY($1::int[])
           AND vo.estado_asignacion NOT IN ('LIBERADO')
           AND o.estado IN ('PLANIFICADA', 'ACTIVA')
           AND ${cond}
         ORDER BY vo.id_vehiculo, o.id_operacion`,
        params
      );
      conflictos.vehiculos = rows;
    }

    // ── Equipos ───────────────────────────────────────────────────────────
    if (eIds.length) {
      const params = [eIds];
      let cond = "TRUE";
      if (fecha_inicio || fecha_fin) {
        if (fecha_fin) { params.push(fecha_fin); cond = `(o.fecha_inicio IS NULL OR o.fecha_inicio <= $${params.length})`; }
        if (fecha_inicio) { params.push(fecha_inicio); cond += ` AND (o.fecha_fin IS NULL OR o.fecha_fin >= $${params.length})`; }
      }

      const { rows } = await pool.query(
        `SELECT
           oe.id_equipo,
           e.nombre   AS equipo_nombre,
           e.numero_serie,
           e.categoria,
           o.id_operacion,
           o.codigo   AS op_codigo,
           o.nombre   AS op_nombre,
           o.estado   AS op_estado,
           o.fecha_inicio AS op_inicio,
           o.fecha_fin    AS op_fin
         FROM operacion_equipo oe
         JOIN equipo    e ON e.id_equipo    = oe.id_equipo
         JOIN operacion o ON o.id_operacion = oe.id_operacion
         WHERE oe.id_equipo = ANY($1::int[])
           AND oe.estado_asignacion NOT IN ('LIBERADO')
           AND o.estado IN ('PLANIFICADA', 'ACTIVA')
           AND ${cond}
         ORDER BY oe.id_equipo, o.id_operacion`,
        params
      );
      conflictos.equipos = rows;
    }

    const hayConflictos =
      conflictos.personal.length > 0 ||
      conflictos.vehiculos.length > 0 ||
      conflictos.equipos.length > 0;

    return res.json({
      ok: true,
      disponible: !hayConflictos,
      conflictos,
    });

  } catch (err) {
    return sendDbError(res, err, "Error verificando disponibilidad");
  }
});

export default router;
