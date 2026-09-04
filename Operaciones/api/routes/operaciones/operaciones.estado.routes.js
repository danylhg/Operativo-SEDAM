import { Router } from "express";

import { requireAuth } from "../../middlewares/auth.js";
import { sendDbError } from "../../utils/dbErrors.js";
import { isInt } from "../../utils/validators.js";
import {
  cambiarEstadoOperacion,
  OperationStateError
} from "../../services/operacionesEstado.service.js";

const router = Router();

function emitEstadoActualizado(req, operacion) {
  const io = req.app.get("io");
  if (!io || !operacion) return;

  io.emit("operacion_estado_actualizado", {
    operacion,
    automatico: false
  });
}

// PATCH /ops/:id/estado
// Cambia el estado de una operacion y aplica los efectos operativos:
// chat, mensajes de sistema, cierre/cancelacion y liberacion de recursos.
router.patch("/ops/:id/estado", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);

  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  try {
    const operacion = await cambiarEstadoOperacion({
      id_operacion,
      nuevoEstado: req.body?.estado,
      actor: req.user
    });

    emitEstadoActualizado(req, operacion);
    return res.json({ ok: true, operacion });
  } catch (err) {
    if (err instanceof OperationStateError) {
      return res.status(err.status).json({
        ok: false,
        mensaje: err.mensaje
      });
    }

    return sendDbError(res, err, "Error cambiando estado");
  }
});

export default router;
