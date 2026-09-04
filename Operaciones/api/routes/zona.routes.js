import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middlewares/auth.js";
import { sendDbError } from "../utils/dbErrors.js";
import { isInt } from "../utils/validators.js";
import { calcularCentroide } from "../utils/geo.js";

const router = Router();

async function requirePlannedOperation(id_operacion, res) {
  const { rows } = await pool.query(
    `SELECT estado FROM operacion WHERE id_operacion = $1 LIMIT 1`,
    [id_operacion]
  );
  if (!rows[0]) {
    res.status(404).json({ ok: false, mensaje: "Operacion no encontrada" });
    return false;
  }
  if (rows[0].estado !== "PLANIFICADA") {
    res.status(409).json({
      ok: false,
      mensaje: "La zona solo se puede modificar mientras la operacion esta PLANIFICADA"
    });
    return false;
  }
  return true;
}

// ===============================
// ZONA OPERACION
// ===============================

// GET /ops/:id/zona — zona principal (la app la usa para centrar el mapa)
router.get("/ops/:id/zona", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return res.status(400).json({ ok: false, mensaje: "id invalido" });
  try {
    const { rows } = await pool.query(
      `SELECT id_zona, id_operacion, nombre, geometria,
              centroide_lat, centroide_lon, zoom_inicial, color,
              estado_operacion_creacion
       FROM zona_operacion WHERE id_operacion = $1 LIMIT 1`,
      [id_operacion]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, mensaje: "Sin zona definida" });
    res.json({ ok: true, zona: rows[0] });
  } catch (err) {
    sendDbError(res, err, "Error obteniendo zona");
  }
});

// POST /ops/:id/zona — crear o actualizar zona (solo ADMIN o CUT)
router.post("/ops/:id/zona", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return res.status(400).json({ ok: false, mensaje: "id invalido" });

  if (!["ADMIN", "CUT"].includes(req.user.rol))
    return res.status(403).json({ ok: false, mensaje: "Solo ADMIN o CUT pueden definir la zona" });

  const { nombre, geometria, color } = req.body ?? {};
  if (!geometria || geometria.type !== "Polygon" || !Array.isArray(geometria.coordinates))
    return res.status(400).json({ ok: false, mensaje: "geometria debe ser un GeoJSON Polygon valido" });

  const centroide = calcularCentroide(geometria);
  if (!centroide)
    return res.status(400).json({ ok: false, mensaje: "No se pudo calcular el centroide" });

  const zoom = 1000;

  try {
    if (!(await requirePlannedOperation(id_operacion, res))) return;
    const { rows } = await pool.query(
      `INSERT INTO zona_operacion
         (id_operacion, nombre, geometria, centroide_lat, centroide_lon, zoom_inicial, color, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id_operacion) DO UPDATE SET
         nombre        = EXCLUDED.nombre,
         geometria     = EXCLUDED.geometria,
         centroide_lat = EXCLUDED.centroide_lat,
         centroide_lon = EXCLUDED.centroide_lon,
         zoom_inicial  = EXCLUDED.zoom_inicial,
         color         = EXCLUDED.color,
         creado_por    = EXCLUDED.creado_por,
         fecha_creacion = NOW()
       RETURNING *`,
      [id_operacion, nombre || "Zona principal", JSON.stringify(geometria),
        centroide.lat, centroide.lon, zoom, color || "#3b82f6", req.user.sub]
    );
    res.json({ ok: true, zona: rows[0] });
  } catch (err) {
    sendDbError(res, err, "Error guardando zona");
  }
});

// DELETE /ops/:id/zona
router.delete("/ops/:id/zona", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);
  if (!isInt(id_operacion)) return res.status(400).json({ ok: false, mensaje: "id invalido" });

  if (!["ADMIN", "CUT"].includes(req.user.rol))
    return res.status(403).json({ ok: false, mensaje: "Sin permiso" });

  try {
    if (!(await requirePlannedOperation(id_operacion, res))) return;
    const { rows } = await pool.query(
      `DELETE FROM zona_operacion WHERE id_operacion = $1 RETURNING id_zona`, [id_operacion]);
    if (!rows[0]) return res.status(404).json({ ok: false, mensaje: "No existe zona para esta operacion" });
    res.json({ ok: true, deleted: rows[0].id_zona });
  } catch (err) {
    sendDbError(res, err, "Error eliminando zona");
  }
});

export default router;
