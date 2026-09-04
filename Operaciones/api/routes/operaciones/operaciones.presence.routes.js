import { Router } from "express";

import { requireAuth } from "../../middlewares/auth.js";
import { isInt } from "../../utils/validators.js";
import {
  markOperacionEnAsignacion,
  releaseOperacionEnAsignacion
} from "../../services/asignacionPresence.service.js";

const router = Router();

router.post("/ops/:id/asignacion-presence", requireAuth, (req, res) => {
  const id_operacion = Number(req.params.id);

  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  markOperacionEnAsignacion(id_operacion, req.user);
  return res.json({ ok: true });
});

router.delete("/ops/:id/asignacion-presence", requireAuth, (req, res) => {
  const id_operacion = Number(req.params.id);

  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  releaseOperacionEnAsignacion(id_operacion);
  return res.json({ ok: true });
});

export default router;
