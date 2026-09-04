// Importa Router de Express para declarar rutas agrupadas
import { Router } from "express";

// Pool de PostgreSQL para ejecutar consultas manuales
import { pool } from "../db.js";

// Middleware que exige autenticación antes de acceder a las rutas
import { requireAuth } from "../middlewares/auth.js";

// Helper para responder errores de BD/backend de forma uniforme
import { sendDbError } from "../utils/dbErrors.js";

// Helper para validar enteros
import { isInt } from "../utils/validators.js";

// Importa handlers/controladores ya separados para catálogo de personal y listado de vehículos
import {
  listPersonal,
  listVehiculos,
  createPersonal,
  updatePersonal,
  deletePersonal,
  listDispositivos,
  createDispositivo,
  updateDispositivo,
  deleteDispositivo,
} from "../controllers/catalog.controller.js";

// Crea instancia de router
const router = Router();


// ===============================
// PERSONAL
// ===============================

// =========================================================
// GET /catalog/personal
// Qué hace:
//   Lista el catálogo de personal.
// Nota:
//   La lógica real está delegada al controller listPersonal.
// =========================================================
router.get("/catalog/personal", requireAuth, listPersonal);

// =========================================================
// GET /catalog/vehiculos
// Qué hace:
//   Lista el catálogo de vehículos.
// Nota:
//   La lógica real está delegada al controller listVehiculos.
// =========================================================
router.get("/catalog/vehiculos", requireAuth, listVehiculos);

// =========================================================
// POST /catalog/personal
// Qué hace:
//   Crea un nuevo registro en el catálogo de personal.
// Nota:
//   La lógica real está delegada al controller createPersonal.
// =========================================================
router.post("/catalog/personal", requireAuth, createPersonal);

// =========================================================
// PUT /catalog/personal/:id
// Qué hace:
//   Edita un registro existente del catálogo de personal.
// Nota:
//   La lógica real está delegada al controller updatePersonal.
// =========================================================
router.put("/catalog/personal/:id", requireAuth, updatePersonal);

// =========================================================
// DELETE /catalog/personal/:id
// Qué hace:
//   Elimina un registro del catálogo de personal.
// Nota:
//   La lógica real está delegada al controller deletePersonal.
// =========================================================
router.delete("/catalog/personal/:id", requireAuth, deletePersonal);


// ===============================
// DISPOSITIVOS
// ===============================

// Catálogo de teléfonos, tablets, smart watch, LoRa y otros dispositivos.
router.get("/catalog/dispositivos", requireAuth, listDispositivos);
router.post("/catalog/dispositivos", requireAuth, createDispositivo);
router.put("/catalog/dispositivos/:id", requireAuth, updateDispositivo);
router.delete("/catalog/dispositivos/:id", requireAuth, deleteDispositivo);


// ===============================
// EQUIPOS
// ===============================

// =========================================================
// GET /catalog/equipos
// Qué hace:
//   Lista todo el catálogo de equipos.
// Además:
//   une la tabla base equipo con sus tablas hijas:
//   - equipo_comunicacion
//   - equipo_tactico
// Para devolver:
//   - imagen consolidada
//   - detalles/notas consolidadas
//   - fecha de registro
// Orden:
//   por nombre y número de serie.
// =========================================================
router.get("/catalog/equipos", requireAuth, async (req, res) => {
  try {
    // Consulta equipos base y sus datos especializados
    const { rows } = await pool.query(`
      SELECT
        e.id_equipo,
        e.numero_serie,
        e.nombre,
        e.categoria,
        e.estado,

        -- Toma la imagen de la tabla hija que exista
        COALESCE(ec.imagen_eqcom, et.imagen_eqtac) AS imagen_eq,

        -- Toma notas/detalles de la tabla hija que exista
        COALESCE(ec.notas, et.notas) AS detalles,

        -- Renombra fecha_creacion para salida amigable
        e.fecha_creacion AS fecha_registro
      FROM equipo e
      LEFT JOIN equipo_comunicacion ec ON ec.id_equipo = e.id_equipo
      LEFT JOIN equipo_tactico et ON et.id_equipo = e.id_equipo
      ORDER BY e.nombre ASC, e.numero_serie ASC
    `);

    // Devuelve lista completa
    return res.json({ ok: true, items: rows });
  } catch (err) {
    // Manejo uniforme de error
    return sendDbError(res, err, "Error obteniendo equipos");
  }
});


// =========================================================
// POST /catalog/equipos
// Qué hace:
//   Crea un nuevo equipo en catálogo.
// Flujo:
//   1. Inserta en tabla base equipo
//   2. Inserta en la tabla hija correcta según categoría:
//      - equipo_comunicacion
//      - equipo_tactico
//   3. Borra de la otra tabla hija para mantener consistencia
//   4. Devuelve el equipo completo consolidado
// Validaciones:
//   - numero_serie obligatorio
//   - nombre obligatorio
//   - categoria obligatoria
//   - categoria solo puede ser COMUNICACION o TACTICO
// =========================================================
router.post("/catalog/equipos", requireAuth, async (req, res) => {
  // Obtiene conexión manual porque aquí se usa transacción
  const client = await pool.connect();
  try {
    // Normaliza campos del body
    const numero_serie = (req.body?.numero_serie || "").trim();
    const nombre = (req.body?.nombre || "").trim();
    const categoria = (req.body?.categoria || "").trim().toUpperCase();
    const estado = (req.body?.estado || "DISPONIBLE").trim().toUpperCase();
    const imagen_eq = req.body?.imagen_eq || null;
    const detalles = req.body?.detalles || null;

    // Valida obligatorios
    if (!numero_serie || !nombre || !categoria) {
      return res.status(400).json({ ok: false, mensaje: "Faltan campos obligatorios" });
    }

    // Valida categoría permitida
    if (!["COMUNICACION", "TACTICO"].includes(categoria)) {
      return res.status(400).json({
        ok: false,
        mensaje: "Categoría inválida. Solo se permite COMUNICACION o TACTICO"
      });
    }

    // Inicia transacción
    await client.query("BEGIN");

    // Inserta en tabla base equipo
    const insEquipo = await client.query(
      `INSERT INTO equipo (numero_serie, nombre, categoria, estado)
       VALUES ($1, $2, $3, $4)
       RETURNING id_equipo, numero_serie, nombre, categoria, estado, fecha_creacion`,
      [numero_serie, nombre, categoria, estado]
    );

    // Equipo recién creado
    const equipo = insEquipo.rows[0];

    // Si es de comunicación, guarda su ficha en equipo_comunicacion
    if (categoria === "COMUNICACION") {
      await client.query(
        `INSERT INTO equipo_comunicacion (id_equipo, imagen_eqcom, marca, modelo, notas)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id_equipo) DO UPDATE SET
           imagen_eqcom = EXCLUDED.imagen_eqcom,
           marca = EXCLUDED.marca,
           modelo = EXCLUDED.modelo,
           notas = EXCLUDED.notas`,
        [
          equipo.id_equipo,
          imagen_eq,
          req.body?.marca || null,
          req.body?.modelo || null,
          detalles
        ]
      );

      // Elimina cualquier registro táctico para este equipo
      await client.query(`DELETE FROM equipo_tactico WHERE id_equipo = $1`, [equipo.id_equipo]);
    } else {
      // Si es táctico, guarda su ficha en equipo_tactico
      await client.query(
        `INSERT INTO equipo_tactico (id_equipo, imagen_eqtac, tipo_tactico, calibre, nivel, notas)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id_equipo) DO UPDATE SET
           imagen_eqtac = EXCLUDED.imagen_eqtac,
           tipo_tactico = EXCLUDED.tipo_tactico,
           calibre = EXCLUDED.calibre,
           nivel = EXCLUDED.nivel,
           notas = EXCLUDED.notas`,
        [
          equipo.id_equipo,
          imagen_eq,
          req.body?.tipo_tactico || "GENERAL",
          req.body?.calibre || null,
          req.body?.nivel || null,
          detalles
        ]
      );

      // Elimina cualquier registro de comunicación para este equipo
      await client.query(`DELETE FROM equipo_comunicacion WHERE id_equipo = $1`, [equipo.id_equipo]);
    }

    // Confirma transacción
    await client.query("COMMIT");

    // Vuelve a consultar el equipo ya consolidado para responderlo completo
    const { rows } = await client.query(
      `SELECT e.id_equipo, e.numero_serie, e.nombre, e.categoria, e.estado,
              COALESCE(ec.imagen_eqcom, et.imagen_eqtac) AS imagen_eq,
              COALESCE(ec.notas, et.notas) AS detalles,
              e.fecha_creacion AS fecha_registro
       FROM equipo e
       LEFT JOIN equipo_comunicacion ec ON ec.id_equipo = e.id_equipo
       LEFT JOIN equipo_tactico et ON et.id_equipo = e.id_equipo
       WHERE e.id_equipo = $1`,
      [equipo.id_equipo]
    );

    // Devuelve el equipo recién creado
    return res.json({ ok: true, item: rows[0] });
  } catch (err) {
    // Revierte si algo falla
    await client.query("ROLLBACK");
    return sendDbError(res, err, "Error creando equipo");
  } finally {
    // Libera conexión
    client.release();
  }
});


// =========================================================
// PUT /catalog/equipos/:id
// Qué hace:
//   Actualiza un equipo existente del catálogo.
// Flujo:
//   1. Valida id
//   2. Actualiza la tabla base equipo
//   3. Inserta/actualiza la tabla hija correspondiente
//   4. Borra la tabla hija contraria
//   5. Devuelve el registro consolidado
// Validaciones:
//   - id válido
//   - numero_serie, nombre y categoria obligatorios
//   - categoria solo puede ser COMUNICACION o TACTICO
// =========================================================
router.put("/catalog/equipos/:id", requireAuth, async (req, res) => {
  // Convierte id a número
  const id_equipo = Number(req.params.id);

  // Conexión manual por transacción
  const client = await pool.connect();
  try {
    // Valida id
    if (!Number.isInteger(id_equipo)) {
      return res.status(400).json({ ok: false, mensaje: "id inválido" });
    }

    // Normaliza datos de entrada
    const numero_serie = (req.body?.numero_serie || "").trim();
    const nombre = (req.body?.nombre || "").trim();
    const categoria = (req.body?.categoria || "").trim().toUpperCase();
    const estado = (req.body?.estado || "DISPONIBLE").trim().toUpperCase();
    const imagen_eq = req.body?.imagen_eq || null;
    const detalles = req.body?.detalles || null;

    // Valida obligatorios
    if (!numero_serie || !nombre || !categoria) {
      return res.status(400).json({ ok: false, mensaje: "Faltan campos obligatorios" });
    }

    // Valida categoría permitida
    if (!["COMUNICACION", "TACTICO"].includes(categoria)) {
      return res.status(400).json({
        ok: false,
        mensaje: "Categoría inválida. Solo se permite COMUNICACION o TACTICO"
      });
    }

    // Inicia transacción
    await client.query("BEGIN");

    // Actualiza tabla base equipo
    await client.query(
      `UPDATE equipo SET numero_serie=$1, nombre=$2, categoria=$3, estado=$4 WHERE id_equipo=$5`,
      [numero_serie, nombre, categoria, estado, id_equipo]
    );

    // Si ahora es comunicación, actualiza esa tabla hija y limpia la otra
    if (categoria === "COMUNICACION") {
      await client.query(
        `INSERT INTO equipo_comunicacion (id_equipo, imagen_eqcom, marca, modelo, notas)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id_equipo) DO UPDATE SET
           imagen_eqcom = EXCLUDED.imagen_eqcom, marca = EXCLUDED.marca,
           modelo = EXCLUDED.modelo, notas = EXCLUDED.notas`,
        [id_equipo, imagen_eq, req.body?.marca || null, req.body?.modelo || null, detalles]
      );

      await client.query(`DELETE FROM equipo_tactico WHERE id_equipo = $1`, [id_equipo]);
    } else {
      // Si ahora es táctico, actualiza esa tabla hija y limpia la otra
      await client.query(
        `INSERT INTO equipo_tactico (id_equipo, imagen_eqtac, tipo_tactico, calibre, nivel, notas)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id_equipo) DO UPDATE SET
           imagen_eqtac = EXCLUDED.imagen_eqtac, tipo_tactico = EXCLUDED.tipo_tactico,
           calibre = EXCLUDED.calibre, nivel = EXCLUDED.nivel, notas = EXCLUDED.notas`,
        [
          id_equipo,
          imagen_eq,
          req.body?.tipo_tactico || "GENERAL",
          req.body?.calibre || null,
          req.body?.nivel || null,
          detalles
        ]
      );

      await client.query(`DELETE FROM equipo_comunicacion WHERE id_equipo = $1`, [id_equipo]);
    }

    // Confirma cambios
    await client.query("COMMIT");

    // Recupera el registro completo consolidado
    const { rows } = await client.query(
      `SELECT e.id_equipo, e.numero_serie, e.nombre, e.categoria, e.estado,
              COALESCE(ec.imagen_eqcom, et.imagen_eqtac) AS imagen_eq,
              COALESCE(ec.notas, et.notas) AS detalles,
              e.fecha_creacion AS fecha_registro
       FROM equipo e
       LEFT JOIN equipo_comunicacion ec ON ec.id_equipo = e.id_equipo
       LEFT JOIN equipo_tactico et ON et.id_equipo = e.id_equipo
       WHERE e.id_equipo = $1`,
      [id_equipo]
    );

    // Si no existe después de actualizar, devuelve 404
    if (!rows[0]) return res.status(404).json({ ok: false, mensaje: "Equipo no existe" });

    // Respuesta final
    return res.json({ ok: true, item: rows[0] });
  } catch (err) {
    // Revierte en caso de error
    await client.query("ROLLBACK");
    return sendDbError(res, err, "Error actualizando equipo");
  } finally {
    // Libera conexión
    client.release();
  }
});


// =========================================================
// DELETE /catalog/equipos/:id
// Qué hace:
//   Elimina un equipo del catálogo.
// Validaciones:
//   - id válido
// Manejo especial:
//   - si el equipo está referenciado por otras tablas, responde 409
// =========================================================
router.delete("/catalog/equipos/:id", requireAuth, async (req, res) => {
  // Convierte id a número
  const id_equipo = Number(req.params.id);

  // Valida entero
  if (!isInt(id_equipo)) return res.status(400).json({ ok: false, mensaje: "id inválido" });

  try {
    // Borra el equipo base; por FK/cascade pueden borrarse hijas asociadas
    await pool.query(`DELETE FROM equipo WHERE id_equipo = $1`, [id_equipo]);

    // Respuesta de borrado exitoso
    return res.json({ ok: true, deleted: true, id_equipo });
  } catch (err) {
    // Si hay violación de FK, significa que sigue en uso
    if (err.code === "23503") {
      return res.status(409).json({
        ok: false,
        mensaje: "No se puede borrar porque el equipo está referenciado en operaciones, grupos o asignaciones.",
        error: err.detail || err.message,
      });
    }

    return sendDbError(res, err, "Error eliminando equipo");
  }
});


// =========================================================
// POST /ops/:id/equipos
// Qué hace:
//   Asigna equipos a una operación.
// Flujo general:
//   1. valida operación
//   2. verifica que no esté cerrada/cancelada
//   3. borra asignaciones previas de equipo de esa operación
//   4. recorre items y valida el destino de cada equipo
//   5. inserta en uso_equipo_operacion el destino real
//   6. inserta/acumula en operacion_equipo el stock reservado
//
// Destinos permitidos:
//   - PERSONAL
//   - VEHICULO
//   - GRUPO
//
// Nota importante:
//   Esta ruta reemplaza todo el set de equipos de la operación.
// =========================================================
router.post("/ops/:id/equipos", requireAuth, async (req, res) => {
  // Convierte id_operacion
  const id_operacion = Number(req.params.id);

  // Valida entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id inválido" });
  }

  try {
    // Extrae usuario asignador e items
    const { asignado_por, items } = req.body ?? {};

    // Usa asignado_por explícito o usuario autenticado
    const who = Number(asignado_por || req.user.sub);

    // items debe ser arreglo
    if (!Array.isArray(items)) {
      return res.status(400).json({ ok: false, mensaje: "items inválido" });
    }

    // Conexión manual para transacción
    const client = await pool.connect();
    try {
      // Inicia transacción
      await client.query("BEGIN");

      // Verifica estado actual de la operación
      const opStatEq = await client.query(
        `SELECT estado FROM operacion WHERE id_operacion=$1`,
        [id_operacion]
      );

      // Si no existe, 404
      if (opStatEq.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, mensaje: "Operación no encontrada" });
      }

      // Si ya no es modificable, bloquea
      if (opStatEq.rows[0].estado === 'CANCELADA' || opStatEq.rows[0].estado === 'CERRADA') {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          mensaje: `Operación ${opStatEq.rows[0].estado}. No se puede modificar.`
        });
      }

      // Borra primero la reserva agregada de equipo por operación
      await client.query(`DELETE FROM operacion_equipo WHERE id_operacion = $1`, [id_operacion]);

      // Borra también el uso real/destino de equipos en la operación
      await client.query(`DELETE FROM uso_equipo_operacion WHERE id_operacion = $1`, [id_operacion]);

      // Recorre cada item recibido
      for (const it of items) {
        const id_equipo = Number(it.id_equipo);
        const cantidad = Number(it.cantidad || 1);
        const tipo_destino = (it.tipo_destino || "").toUpperCase();

        // Si el id no es válido, ignora
        if (!isInt(id_equipo)) continue;

        // Si cantidad no es entero positivo, ignora
        if (!Number.isInteger(cantidad) || cantidad <= 0) continue;

        // Variables de destino; solo una debe quedar con valor
        let id_personal = null;
        let id_vehiculo = null;
        let id_grupo_operacion = null;

        // Resuelve el destino según tipo_destino
        if (tipo_destino === "PERSONAL") {
          id_personal = Number(it.id_personal);
        } else if (tipo_destino === "VEHICULO") {
          id_vehiculo = Number(it.id_vehiculo);
        } else if (tipo_destino === "GRUPO") {
          id_grupo_operacion = Number(it.id_grupo_operacion);
        } else {
          // Si el tipo no es válido, revierte todo
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            mensaje: `tipo_destino inválido para equipo ${id_equipo}`
          });
        }

        // Cuenta cuántos destinos concretos trae
        const destinos = [id_personal, id_vehiculo, id_grupo_operacion].filter(Boolean);

        // Un equipo debe tener exactamente un destino
        if (destinos.length !== 1) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            mensaje: `El equipo ${id_equipo} debe tener un solo destino`
          });
        }

        // Si el destino es vehículo, valida que ese vehículo ya esté asignado a la operación
        if (id_vehiculo) {
          const vehExists = await client.query(
            `SELECT 1 FROM vehiculo_operacion WHERE id_operacion=$1 AND id_vehiculo=$2`,
            [id_operacion, id_vehiculo]
          );

          if (vehExists.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              ok: false,
              mensaje: `El vehículo ${id_vehiculo} no está asignado a esta operación`
            });
          }
        }

        // Si el destino es grupo, valida que el grupo pertenezca a la operación
        if (id_grupo_operacion) {
          const grupExists = await client.query(
            `SELECT 1 FROM grupo_operacion WHERE id_grupo_operacion=$1 AND id_operacion=$2`,
            [id_grupo_operacion, id_operacion]
          );

          if (grupExists.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              ok: false,
              mensaje: "Grupo no válido para esta operación"
            });
          }
        }

        // Revisa si ese mismo equipo ya estaba asignado a ese mismo destino en esta operación
        const existeEq = await client.query(
          `SELECT 1 FROM uso_equipo_operacion
           WHERE id_operacion=$1 AND id_equipo=$2
           AND COALESCE(id_personal,0)=COALESCE($3,0)
           AND COALESCE(id_vehiculo_contexto,0)=COALESCE($4,0)
           AND COALESCE(id_grupo_operacion,0)=COALESCE($5,0)
           AND fecha_devolucion IS NULL`,
          [id_operacion, id_equipo, id_personal, id_vehiculo, id_grupo_operacion]
        );

        if (existeEq.rowCount > 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            mensaje: `El equipo ${id_equipo} ya está asignado a ese destino`
          });
        }

        // Revisa si ese equipo está activo en otra operación abierta
        const enOtraOpEq = await client.query(
          `SELECT o.nombre FROM uso_equipo_operacion ue
           JOIN operacion o ON o.id_operacion = ue.id_operacion
           WHERE ue.id_equipo = $1
             AND ue.fecha_devolucion IS NULL
             AND ue.id_operacion != $2
             AND o.estado NOT IN ('CERRADA', 'CANCELADA')`,
          [id_equipo, id_operacion]
        );

        if (enOtraOpEq.rowCount > 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            mensaje: `El equipo ${id_equipo} ya está activo en la operación "${enOtraOpEq.rows[0].nombre}"`
          });
        }

        // Para destino vehículo: id_personal es obligatorio (NOT NULL).
        // Buscamos al primer custodio de ese vehículo en esta operación.
        let id_personal_final = id_personal;
        if (tipo_destino === "VEHICULO" && id_vehiculo && !id_personal_final) {
          const custodio = await client.query(
            `SELECT id_personal FROM vehiculo_operacion
             WHERE id_operacion=$1 AND id_vehiculo=$2
             LIMIT 1`,
            [id_operacion, id_vehiculo]
          );
          if (custodio.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              ok: false,
              mensaje: `El vehículo ${id_vehiculo} no tiene custodio asignado en esta operación`
            });
          }
          id_personal_final = custodio.rows[0].id_personal;
        }

        // Primero: reserva global del equipo en la operación (uso_equipo_operacion la referencia por FK)
        await client.query(
          `INSERT INTO operacion_equipo
             (id_operacion, id_equipo, cantidad, estado_asignacion, asignado_por)
           VALUES ($1,$2,$3,'ASIGNADO',$4)
           ON CONFLICT (id_operacion, id_equipo)
           DO UPDATE SET cantidad = operacion_equipo.cantidad + EXCLUDED.cantidad`,
          [id_operacion, id_equipo, cantidad, who]
        );

        // Después: uso real del equipo con su destino concreto.
        // id_vehiculo_contexto es el vehículo cuando el destino es un vehículo.
        // id_personal es siempre NOT NULL (custodio responsable).
        await client.query(
          `INSERT INTO uso_equipo_operacion
             (id_operacion, id_equipo, cantidad, id_personal, id_vehiculo_contexto, id_grupo_operacion, asignado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id_operacion, id_equipo, cantidad, id_personal_final, id_vehiculo, id_grupo_operacion, who]
        );
      }

      // Confirma transacción
      await client.query("COMMIT");
      return res.json({ ok: true });
    } catch (e) {
      // Revierte si algo falla en la transacción
      await client.query("ROLLBACK");
      throw e;
    } finally {
      // Libera conexión
      client.release();
    }
  } catch (err) {
    return sendDbError(res, err, "Error guardando equipos");
  }
});


// ===============================
// VEHÍCULOS CRUD
// ===============================

// =========================================================
// POST /catalog/vehiculos
// Qué hace:
//   Crea un nuevo vehículo en catálogo.
// Valida:
//   - codigo_interno obligatorio
//   - capacidad válida si viene
//   - estado dentro de catálogo permitido
// Manejo especial:
//   - si codigo_interno ya existe, responde 409
// =========================================================
router.post("/catalog/vehiculos", requireAuth, async (req, res) => {
  try {
    // Normaliza campos del body
    const codigo_interno = (req.body?.codigo_interno || "").toString().trim();
    const tipo = (req.body?.tipo || "").toString().trim() || null;
    const alias = (req.body?.alias || "").toString().trim() || null;
    const imagen_veh = (req.body?.imagen_veh || "").toString().trim() || null;
    const capacidad = req.body?.capacidad != null ? Number(req.body.capacidad) : null;
    const estado = (req.body?.estado || "DISPONIBLE").toString().trim().toUpperCase();

    // codigo_interno es obligatorio
    if (!codigo_interno) {
      return res.status(400).json({ ok: false, mensaje: "Falta codigo_interno" });
    }

    // Si capacidad viene, debe ser entero >= 0
    if (capacidad != null && (!Number.isInteger(capacidad) || capacidad < 0)) {
      return res.status(400).json({ ok: false, mensaje: "capacidad inválida" });
    }

    // Catálogo permitido de estados
    const estadosValidos = ["DISPONIBLE", "ASIGNADO", "MANTENIMIENTO", "BAJA"];

    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({
        ok: false,
        mensaje: `estado inválido (${estadosValidos.join("|")})`
      });
    }

    // Inserta vehículo en catálogo
    const { rows } = await pool.query(
      `INSERT INTO vehiculo (codigo_interno, tipo, alias, imagen_veh, estado, capacidad)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id_vehiculo, codigo_interno, tipo, alias, imagen_veh, estado, capacidad`,
      [codigo_interno, tipo, alias, imagen_veh, estado, capacidad]
    );

    // Respuesta con el nuevo vehículo
    return res.json({ ok: true, item: rows[0] });
  } catch (err) {
    // Violación de único por codigo_interno duplicado
    if (err.code === "23505") {
      return res.status(409).json({
        ok: false,
        mensaje: "El código interno ya existe",
        error: err.detail || err.message
      });
    }

    return sendDbError(res, err, "Error creando vehículo");
  }
});


// =========================================================
// PUT /catalog/vehiculos/:id
// Qué hace:
//   Actualiza parcialmente un vehículo del catálogo.
// Característica:
//   Solo actualiza los campos que realmente vienen en body.
// Valida:
//   - id válido
//   - codigo_interno no vacío si viene
//   - capacidad válida si viene
//   - estado válido si viene
// Manejo especial:
//   - si codigo_interno ya existe, responde 409
// =========================================================
router.put("/catalog/vehiculos/:id", requireAuth, async (req, res) => {
  // Convierte id a número
  const id_vehiculo = Number(req.params.id);

  // Valida entero
  if (!isInt(id_vehiculo)) return res.status(400).json({ ok: false, mensaje: "id inválido" });

  try {
    // Lee cada campo solo si fue enviado
    const codigo_interno = req.body?.codigo_interno != null ? String(req.body.codigo_interno).trim() : null;
    const tipo = req.body?.tipo != null ? (String(req.body.tipo).trim() || null) : null;
    const alias = req.body?.alias != null ? (String(req.body.alias).trim() || null) : null;
    const imagen_veh = req.body?.imagen_veh != null ? (String(req.body.imagen_veh).trim() || null) : null;
    const capacidad = req.body?.capacidad != null ? Number(req.body.capacidad) : undefined;
    const estado = req.body?.estado != null ? String(req.body.estado).trim().toUpperCase() : null;

    // Si mandaron codigo_interno pero quedó vacío, error
    if (codigo_interno !== null && !codigo_interno) {
      return res.status(400).json({ ok: false, mensaje: "codigo_interno inválido" });
    }

    // Si mandaron capacidad, debe ser válida
    if (capacidad !== undefined && (!Number.isInteger(capacidad) || capacidad < 0)) {
      return res.status(400).json({ ok: false, mensaje: "capacidad inválida" });
    }

    // Si mandaron estado, valida catálogo
    if (estado !== null) {
      const estadosValidos = ["DISPONIBLE", "ASIGNADO", "MANTENIMIENTO", "BAJA"];
      if (!estadosValidos.includes(estado)) {
        return res.status(400).json({
          ok: false,
          mensaje: `estado inválido (${estadosValidos.join("|")})`
        });
      }
    }

    // Aquí se arma el UPDATE dinámico solo con columnas enviadas
    const sets = [];
    const vals = [];
    let i = 1;

    if (codigo_interno !== null) { sets.push(`codigo_interno = $${i++}`); vals.push(codigo_interno); }
    if (req.body?.tipo !== undefined) { sets.push(`tipo = $${i++}`); vals.push(tipo); }
    if (req.body?.alias !== undefined) { sets.push(`alias = $${i++}`); vals.push(alias); }
    if (req.body?.imagen_veh !== undefined) { sets.push(`imagen_veh = $${i++}`); vals.push(imagen_veh); }
    if (req.body?.capacidad !== undefined) { sets.push(`capacidad = $${i++}`); vals.push(capacidad); }
    if (estado !== null) { sets.push(`estado = $${i++}`); vals.push(estado); }

    // Si no vino nada actualizable, error
    if (sets.length === 0) {
      return res.status(400).json({ ok: false, mensaje: "Nada para actualizar" });
    }

    // Al final agrega el id para el WHERE
    vals.push(id_vehiculo);

    // Ejecuta update dinámico
    const { rows } = await pool.query(
      `UPDATE vehiculo
       SET ${sets.join(", ")}
       WHERE id_vehiculo = $${i}
       RETURNING id_vehiculo, codigo_interno, tipo, alias, imagen_veh, estado, capacidad`,
      vals
    );

    // Si no existe, 404
    if (!rows[0]) return res.status(404).json({ ok: false, mensaje: "Vehículo no existe" });

    // Respuesta final
    return res.json({ ok: true, item: rows[0] });
  } catch (err) {
    // Violación de único por codigo_interno duplicado
    if (err.code === "23505") {
      return res.status(409).json({
        ok: false,
        mensaje: "El código interno ya existe",
        error: err.detail || err.message
      });
    }

    return sendDbError(res, err, "Error editando vehículo");
  }
});


// =========================================================
// DELETE /catalog/vehiculos/:id
// Qué hace:
//   Elimina un vehículo del catálogo.
// Valida:
//   - id válido
// Manejo especial:
//   - si está referenciado en operaciones/grupos, responde 409
// =========================================================
router.delete("/catalog/vehiculos/:id", requireAuth, async (req, res) => {
  // Convierte id a número
  const id_vehiculo = Number(req.params.id);

  // Valida entero
  if (!isInt(id_vehiculo)) return res.status(400).json({ ok: false, mensaje: "id inválido" });

  try {
    // Borra vehículo del catálogo
    await pool.query(`DELETE FROM vehiculo WHERE id_vehiculo = $1`, [id_vehiculo]);

    // Respuesta de borrado correcto
    return res.json({ ok: true, deleted: true, id_vehiculo });
  } catch (err) {
    // Si hay FK activas, el vehículo sigue en uso
    if (err.code === "23503") {
      return res.status(409).json({
        ok: false,
        mensaje: "No se puede borrar porque el vehículo está referenciado en operaciones o grupos.",
        error: err.detail || err.message,
      });
    }

    return sendDbError(res, err, "Error eliminando vehículo");
  }
});

// Exporta el router para montarlo en app/server
export default router;
