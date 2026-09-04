import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middlewares/auth.js";
import { sendDbError } from "../utils/dbErrors.js";
import { CESIUM_TOKEN } from "../config/env.js";

const router = Router();

router.get("/health", (req, res) => {
  res.json({ ok: true, mensaje: "API funcionando" });
});

router.get("/config/cesium-token", requireAuth, (req, res) => {
  if (!CESIUM_TOKEN) {
    return res.status(404).json({
      ok: false,
      mensaje: "Token de Cesium no configurado en el servidor.",
    });
  }

  return res.json({ ok: true, token: CESIUM_TOKEN });
});

router.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ conectado: true, hora_db: result.rows[0].now });
  } catch (err) {
    return sendDbError(res, err, "Error conectando a la base de datos");
  }
});

export default router;
