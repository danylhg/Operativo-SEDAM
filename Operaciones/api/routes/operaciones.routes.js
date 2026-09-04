import { Router } from "express";

import crudRoutes from "./operaciones/operaciones.crud.routes.js";
import consultasRoutes from "./operaciones/operaciones.consultas.routes.js";
import asignacionesRoutes from "./operaciones/operaciones.asignaciones.routes.js";
import estadoRoutes from "./operaciones/operaciones.estado.routes.js";
import presenceRoutes from "./operaciones/operaciones.presence.routes.js";

const router = Router();

// ===============================
// OPERACIONES - RUTAS MODULARIZADAS
// ===============================

// OJO: primero consultas para que /ops/personal/:id_personal
// no choque con /ops/:id
router.use(consultasRoutes);
router.use(crudRoutes);
router.use(presenceRoutes);
router.use(asignacionesRoutes);
router.use(estadoRoutes);

export default router;
