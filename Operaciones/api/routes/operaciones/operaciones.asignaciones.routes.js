// Importa el Router de Express para definir rutas modulares
import { Router } from "express";

// Pool de conexiones a PostgreSQL
import { pool } from "../../db.js";

// Middleware que exige sesión/JWT válido antes de entrar a la ruta
import { requireAuth } from "../../middlewares/auth.js";

// Helper para responder errores de BD de forma consistente
import { sendDbError } from "../../utils/dbErrors.js";

// Validador simple para enteros
import { isInt } from "../../utils/validators.js";

// Crea una instancia de router para exportar este módulo
const router = Router();

async function resolveAsignadoPor(req, requestedId = null, db = pool) {
  const candidateId = Number(requestedId || req.user?.sub);

  if (req.user?.tabla !== "personal" && isInt(candidateId)) {
    const { rows: candidateRows } = await db.query(
      `SELECT id_usuario FROM usuario
       WHERE id_usuario = $1 AND activo = TRUE
       LIMIT 1`,
      [candidateId]
    );
    if (candidateRows[0]?.id_usuario) return candidateRows[0].id_usuario;
  }

  const { rows } = await db.query(
    `SELECT id_usuario FROM usuario
     WHERE rol = 'ADMIN' AND activo = TRUE
     ORDER BY id_usuario ASC LIMIT 1`
  );
  return rows[0]?.id_usuario ?? null;
}


// =========================================================
// POST /ops/:id/personal
// Qué hace:
//   Guarda o actualiza la asignación de personal dentro de una operación.
//   Inserta registros en asignacion_operacion_personal.
//   Si una persona ya estaba ligada a esa operación, la actualiza.
// Flujo:
//   1. Valida id de operación
//   2. Valida body.items
//   3. Verifica que la operación exista y no esté cerrada/cancelada
//   4. Inserta/actualiza cada elemento del arreglo items
// =========================================================
router.post("/ops/:id/personal", requireAuth, async (req, res) => {
  // Convierte el parámetro :id a número
  const id_operacion = Number(req.params.id);

  // Si no es entero válido, corta con 400
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id inválido" });
  }

  try {
    // Extrae del body el usuario que asigna y la lista de items
    const { asignado_por, items } = req.body ?? {};

    // Si no viene asignado_por, usa el usuario autenticado del token
    const who = await resolveAsignadoPor(req, asignado_por);
    if (!who) return res.status(409).json({ ok: false, mensaje: "No hay un administrador activo para registrar la asignacion." });

    // Debe venir un arreglo no vacío
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, mensaje: "items vacío" });
    }

    // Abre conexión manual porque aquí se usa transacción
    const client = await pool.connect();
    try {
      // Inicia transacción
      await client.query("BEGIN");

      // Consulta el estado actual de la operación
      const opStatP = await client.query(
        `SELECT estado FROM operacion WHERE id_operacion=$1`,
        [id_operacion]
      );

      // Si no existe la operación, rollback y 404
      if (opStatP.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, mensaje: "Operación no encontrada" });
      }

      // Si la operación ya no es modificable, bloquea cambios
      if (opStatP.rows[0].estado === "CANCELADA" || opStatP.rows[0].estado === "CERRADA") {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          mensaje: `Operación ${opStatP.rows[0].estado}. No se puede modificar.`
        });
      }

      // Recorre cada persona enviada en items
      for (const it of items) {
        // Convierte id_personal a número
        const id_personal = Number(it.id_personal);

        // Si el id no es entero, lo ignora y sigue con el siguiente
        if (!isInt(id_personal)) continue;

        // Inserta la asignación del personal a la operación
        // Si ya existe (misma operación + mismo personal), actualiza:
        // - rol_en_operacion
        // - estado_asignacion
        // - asignado_por
        // - fecha_asignacion
        await client.query(
          `INSERT INTO asignacion_operacion_personal
            (id_operacion, id_personal, rol_en_operacion, estado_asignacion, asignado_por)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (id_operacion, id_personal)
           DO UPDATE SET
             rol_en_operacion = EXCLUDED.rol_en_operacion,
             estado_asignacion = EXCLUDED.estado_asignacion,
             asignado_por = EXCLUDED.asignado_por,
             fecha_asignacion = NOW()`,
          [
            id_operacion,
            id_personal,
            it.rol_en_operacion ?? null,                // Rol descriptivo dentro de la operación
            (it.estado_asignacion || "ASIGNADO"),      // Estado default si no viene
            who                                        // Quién hizo la asignación
          ]
        );
      }

      // Si todo salió bien, confirma transacción
      await client.query("COMMIT");

      // Respuesta exitosa
      return res.json({ ok: true });
    } catch (e) {
      // Ante cualquier error dentro de la transacción, deshace cambios
      await client.query("ROLLBACK");
      throw e;
    } finally {
      // Libera la conexión al pool
      client.release();
    }
  } catch (err) {
    // Manejo centralizado de error de BD / backend
    return sendDbError(res, err, "Error guardando personal");
  }
});


// =========================================================
// POST /ops/:id/mando
// Qué hace:
//   Reemplaza completamente la estructura de mando de una operación.
//   Guarda pares CET -> CELL en la tabla mando_operacion.
// Flujo:
//   1. Valida id de operación
//   2. Valida body.items
//   3. Borra todo el mando actual de esa operación
//   4. Inserta de nuevo cada relación CET/CELL enviada
// Nota:
//   Esta ruta no hace merge; hace reset total del mando.
// =========================================================
router.post("/ops/:id/mando", requireAuth, async (req, res) => {
  // Convierte el parámetro :id a número
  const id_operacion = Number(req.params.id);

  // Valida que sea entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id inválido" });
  }

  try {
    // Extrae datos del body
    const { asignado_por, items } = req.body ?? {};

    // Usa el asignador explícito o el usuario autenticado
    const who = await resolveAsignadoPor(req, asignado_por);
    if (!who) return res.status(409).json({ ok: false, mensaje: "No hay un administrador activo para registrar la asignacion." });

    // Aquí solo exige que items sea arreglo; puede venir vacío
    if (!Array.isArray(items)) {
      return res.status(400).json({ ok: false, mensaje: "items inválido" });
    }

    // Abre conexión para transacción
    const client = await pool.connect();
    try {
      // Inicia transacción
      await client.query("BEGIN");

      // Elimina todas las relaciones CET->CELL previas de la operación
      await client.query(
        `DELETE FROM mando_operacion WHERE id_operacion = $1`,
        [id_operacion]
      );

      // Inserta nuevamente cada relación enviada
      for (const it of items) {
        const id_cet = Number(it.id_cet);
        const id_cell = Number(it.id_cell);

        // Si alguno no es entero, lo ignora
        if (!isInt(id_cet) || !isInt(id_cell)) continue;

        await client.query(
          `INSERT INTO mando_operacion (id_operacion, id_cet, id_cell, asignado_por)
           VALUES ($1,$2,$3,$4)`,
          [id_operacion, id_cet, id_cell, who]
        );
      }

      // Confirma cambios
      await client.query("COMMIT");
      return res.json({ ok: true });
    } catch (e) {
      // Revierte si algo falla
      await client.query("ROLLBACK");
      throw e;
    } finally {
      // Suelta conexión
      client.release();
    }
  } catch (err) {
    // Respuesta uniforme de error
    return sendDbError(res, err, "Error guardando mando");
  }
});


// =========================================================
// POST /ops/:id/grupos
// Qué hace:
//   Reconstruye por completo la jerarquía de grupos de una operación.
//   También asigna:
//     - CET a flotillas/subgrupos
//     - integrantes a subgrupos
//     - relaciones de mando CET -> CELL
//     - vehículos a subgrupos
// Flujo general:
//   1. Valida operación y body.grupos
//   2. Verifica que la operación exista y sea modificable
//   3. Limpia estructura anterior:
//      - grupo_vehiculo
//      - grupo_personal
//      - mando_operacion
//      - grupo_operacion
//   4. Crea grupo raíz "Mando Operativo"
//   5. Crea flotillas (grupo padre intermedio)
//   6. Crea células/subgrupos
//   7. Asigna personal y vehículos a cada grupo
//   8. Guarda mando directo adicional desde "directos"
//   9. Regresa mapeo nombre -> id de flotillas y células
// Nota:
//   Esta ruta es destructiva respecto a la jerarquía previa.
// =========================================================
router.post("/ops/:id/grupos", requireAuth, async (req, res) => {
  // Toma el id de la operación desde la URL
  const id_operacion = Number(req.params.id);

  // Valida que sea entero
  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id inválido" });
  }

  // Extrae los grupos, mando directo extra y el usuario que asigna
  const { grupos, directos, asignado_por } = req.body ?? {};

  console.log("[POST /grupos] payload recibido →", {
    id_operacion,
    grupos,
    directos,
    asignado_por
  });
  console.log("[POST /grupos] payload recibido JSON →", JSON.stringify({
    id_operacion,
    grupos,
    directos,
    asignado_por
  }, null, 2));

  // grupos debe venir como arreglo
  if (!Array.isArray(grupos)) {
    return res.status(400).json({ ok: false, mensaje: "grupos inválido" });
  }

  // Usuario que ejecuta la asignación
  const who = await resolveAsignadoPor(req, asignado_por);
  if (!who) return res.status(409).json({ ok: false, mensaje: "No hay un administrador activo para registrar la asignacion." });

  // Conexión para transacción grande
  const client = await pool.connect();
  try {
    // Inicia transacción
    await client.query("BEGIN");

    // Obtiene estado de la operación
    const opStat = await client.query(
      `SELECT estado FROM operacion WHERE id_operacion=$1`,
      [id_operacion]
    );

    // Si no existe, corta
    if (opStat.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, mensaje: "Operación no encontrada" });
    }

    // Si está cerrada o cancelada, no deja modificar grupos
    if (opStat.rows[0].estado === "CANCELADA" || opStat.rows[0].estado === "CERRADA") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        mensaje: `Operación ${opStat.rows[0].estado}. No se puede modificar.`
      });
    }

    // El rebuild de grupos rehace por completo la jerarquía y su contexto.
    // Limpiamos primero todos los recursos dependientes de grupos de esta operación
    // para evitar referencias colgantes a grupos previos.
    await client.query(
      `DELETE FROM grupo_vehiculo WHERE id_operacion = $1`,
      [id_operacion]
    );

    await client.query(
      `DELETE FROM grupo_equipo WHERE id_operacion = $1`,
      [id_operacion]
    );

    await client.query(
      `DELETE FROM uso_equipo_operacion WHERE id_operacion = $1`,
      [id_operacion]
    );

    await client.query(
      `DELETE FROM vehiculo_operacion WHERE id_operacion = $1`,
      [id_operacion]
    );

    // Recupera ids de grupos previos para limpiar grupo_personal
    const prevGroups = await client.query(
      `SELECT id_grupo_operacion FROM grupo_operacion WHERE id_operacion = $1`,
      [id_operacion]
    );

    // Si había grupos, borra personal ligado a esos grupos
    if (prevGroups.rows.length > 0) {
      const ids = prevGroups.rows.map(r => r.id_grupo_operacion);

      await client.query(
        `DELETE FROM grupo_personal WHERE id_grupo_operacion = ANY($1::int[])`,
        [ids]
      );
    }

    // Borra toda la estructura de mando previa
    await client.query(
      `DELETE FROM mando_operacion WHERE id_operacion = $1`,
      [id_operacion]
    );

    // Borra todos los grupos previos de la operación
    await client.query(
      `DELETE FROM grupo_operacion WHERE id_operacion = $1`,
      [id_operacion]
    );

    // Crea el grupo raíz principal
    const resRoot = await client.query(
      `INSERT INTO grupo_operacion (id_operacion, nombre, apodo, descripcion, creado_por)
       VALUES ($1, 'Mando Operativo', 'Mando', 'Grupo raíz de la operación', $2)
       RETURNING id_grupo_operacion`,
      [id_operacion, who]
    );

    // Guarda el id del grupo raíz
    const id_padre_raiz = resRoot.rows[0].id_grupo_operacion;

    // Map para guardar qué flotilla ya fue creada: nombre -> id
    const flotillaGroupIds = new Map();
    const flotillaGroupIdByCet = new Map();

    // Map para guardar qué célula/subgrupo fue creada: nombre -> id
    const celulaGroupIds = new Map();

    // Valida que todos los grupos traigan nombre de flotilla
    const gruposSinFlotilla = grupos.filter(g => !g.flotilla || !g.flotilla.trim());
    if (gruposSinFlotilla.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        mensaje: "El nombre de la flotilla es obligatorio para todos los grupos."
      });
    }

    const flotillasPorCet = new Map();

    for (const grupo of grupos) {
      const flotillaNormalizada = String(grupo.flotilla || "").trim().toLowerCase();
      if (!flotillaNormalizada) continue;

      const cetKey = String(grupo.id_cet || grupo.cet_nombre || "").trim().toLowerCase();
      const uniqueKey = cetKey ? `${cetKey}::${flotillaNormalizada}` : flotillaNormalizada;

      if (!flotillasPorCet.has(uniqueKey)) {
        flotillasPorCet.set(uniqueKey, flotillaNormalizada);
      }
    }

    const flotillasNormalizadas = Array.from(flotillasPorCet.values());
    const hayFlotillasDuplicadas = flotillasNormalizadas.some(
      (nombre, index) => flotillasNormalizadas.indexOf(nombre) !== index
    );

    if (hayFlotillasDuplicadas) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        mensaje: "No puede haber dos flotillas con el mismo nombre."
      });
    }

    const nombresReservadosOperacion = new Set(["mando operativo"]);
    const flotillaReservada = flotillasNormalizadas.find(nombre => nombresReservadosOperacion.has(nombre));

    if (flotillaReservada) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        mensaje: `La flotilla "${flotillaReservada}" usa un nombre reservado de la operacion.`
      });
    }

    const flotillasSet = new Set(flotillasNormalizadas);
    const gruposNormalizados = grupos
      .map(g => String(g.nombre || "").trim().toLowerCase())
      .filter(Boolean);

    const grupoDuplicado = gruposNormalizados.find(
      (nombre, index) => gruposNormalizados.indexOf(nombre) !== index
    );

    if (grupoDuplicado) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        mensaje: "No puede haber dos grupos con el mismo nombre."
      });
    }

    const grupoReservado = gruposNormalizados.find(nombre => nombresReservadosOperacion.has(nombre));

    if (grupoReservado) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        mensaje: `El grupo "${grupoReservado}" usa un nombre reservado de la operacion.`
      });
    }

    const grupoConNombreDeFlotilla = gruposNormalizados.find(nombre => flotillasSet.has(nombre));

    if (grupoConNombreDeFlotilla) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        mensaje: `El grupo "${grupoConNombreDeFlotilla}" no puede llamarse igual que una flotilla.`
      });
    }

    // Recorre cada definición de grupo enviada por frontend
    for (const g of grupos) {
      const { nombre, id_cet, cet_nombre, integrantes, flotilla } = g;

      const nombreFlotilla = flotilla.trim();

      // Por default el padre inmediato sería el grupo raíz
      let id_padre_flotilla = id_padre_raiz;

      // Si esa flotilla aún no existe, la crea una sola vez
      if (!flotillaGroupIds.has(nombreFlotilla)) {
        const resFlotilla = await client.query(
          `INSERT INTO grupo_operacion (id_operacion, nombre, apodo, descripcion, creado_por, id_grupo_padre)
           VALUES ($1, $2, 'FLOTILLA', $3, $4, $5)
           RETURNING id_grupo_operacion`,
          [
            id_operacion,
            nombreFlotilla,
            `A cargo del CET: ${cet_nombre || ""}`,
            who,
            id_padre_raiz
          ]
        );

        // Guarda id de la flotilla creada
        flotillaGroupIds.set(nombreFlotilla, resFlotilla.rows[0].id_grupo_operacion);
      }

      // Recupera el id de la flotilla actual
      id_padre_flotilla = flotillaGroupIds.get(nombreFlotilla);
      if (isInt(id_cet)) {
        flotillaGroupIdByCet.set(id_cet, id_padre_flotilla);
      }

      // Si hay CET válido, lo mete como miembro de la flotilla
      if (isInt(id_cet)) {
        await client.query(
          `INSERT INTO grupo_personal (id_grupo_operacion, id_personal, asignado_por)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [id_padre_flotilla, id_cet, who]
        );
      }

      // Si no hay nombre de célula/subgrupo, se omite la creación del subgrupo
      if (!nombre) continue;

      // Crea el subgrupo/célula debajo de la flotilla
      const insRes = await client.query(
        `INSERT INTO grupo_operacion (id_operacion, nombre, apodo, descripcion, creado_por, id_grupo_padre)
         VALUES ($1,$2,'CELULA',$3,$4,$5)
         RETURNING id_grupo_operacion`,
        [id_operacion, nombre, "", who, id_padre_flotilla]
      );

      // Id del subgrupo recién creado
      const id_grupo = insRes.rows[0].id_grupo_operacion;

      // Guarda referencia nombre -> id
      celulaGroupIds.set(nombre, id_grupo);

      // El CET también debe pertenecer al subgrupo cuando ese grupo tendrá
      // relaciones de mando/vehículos que lo referencian como custodio.
      if (isInt(id_cet)) {
        await client.query(
          `INSERT INTO grupo_personal (id_grupo_operacion, id_personal, asignado_por)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [id_grupo, id_cet, who]
        );
      }

      // Si vienen integrantes, los asigna a este subgrupo
      if (Array.isArray(integrantes)) {
        for (const id_p of integrantes) {
          if (isInt(id_p)) {
            // Verifica que esa persona no esté ya metida en otro grupo de la misma operación
            const cellExists = await client.query(
              `SELECT 1
               FROM grupo_personal gp
               JOIN grupo_operacion g ON g.id_grupo_operacion = gp.id_grupo_operacion
               WHERE g.id_operacion = $1
               AND gp.id_personal = $2`,
              [id_operacion, id_p]
            );

            // Si ya está en otro grupo, cancela todo
            if (cellExists.rowCount > 0) {
              await client.query("ROLLBACK");
              return res.status(400).json({
                ok: false,
                mensaje: `El personal ${id_p} ya está asignado a otro grupo`
              });
            }

            // Inserta la relación grupo -> personal
            await client.query(
              `INSERT INTO grupo_personal (id_grupo_operacion, id_personal, asignado_por)
               VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
              [id_grupo, id_p, who]
            );

            // Si hay CET válido, también registra el mando CET -> CELL
            if (isInt(id_cet)) {
              await client.query(
                `INSERT INTO mando_operacion (id_operacion, id_cet, id_cell, asignado_por)
                 VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
                [id_operacion, id_cet, id_p, who]
              );
            }
          }
        }
      }

      // Si el grupo trae vehículos, los liga al subgrupo con su custodio humano.
      // Cada entrada debe ser { id_vehiculo, id_personal } para respetar el
      // nuevo modelo donde el vehículo siempre cuelga de una persona.
      if (Array.isArray(g.vehiculos)) {
        for (const veh of g.vehiculos) {
          const id_v = Number(veh.id_vehiculo ?? veh);
          const id_p = Number(veh.id_personal ?? id_cet); // fallback al CET del grupo

          if (!isInt(id_v) || !isInt(id_p)) continue;

          // Asegura que el par (vehículo, custodio) exista en vehiculo_operacion
          await client.query(
            `INSERT INTO vehiculo_operacion
               (id_operacion, id_vehiculo, id_personal, id_grupo_operacion,
                nivel_asignacion, estado_asignacion, asignado_por)
             VALUES ($1,$2,$3,$4,'GRUPO','ASIGNADO',$5)
             ON CONFLICT (id_operacion, id_vehiculo, id_personal) DO UPDATE SET
               id_grupo_operacion = EXCLUDED.id_grupo_operacion,
               nivel_asignacion   = EXCLUDED.nivel_asignacion,
               estado_asignacion  = 'ASIGNADO',
               asignado_por       = EXCLUDED.asignado_por,
               fecha_asignacion   = NOW()`,
            [id_operacion, id_v, id_p, id_grupo, who]
          );

          // Registra también en grupo_vehiculo para el árbol visual
          await client.query(
            `INSERT INTO grupo_vehiculo
               (id_grupo_operacion, id_vehiculo, id_personal, id_operacion, asignado_por)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT DO NOTHING`,
            [id_grupo, id_v, id_p, id_operacion, who]
          );
        }
      }
    }

    // "directos" permite guardar mando CET -> CELL fuera de los grupos formales
    if (directos && typeof directos === "object") {
      for (const [cetIdStr, arrCells] of Object.entries(directos)) {
        const id_cet = Number(cetIdStr);
        const id_flotilla = flotillaGroupIdByCet.get(id_cet);

        if (isInt(id_cet) && Array.isArray(arrCells)) {
          for (const cellId of arrCells) {
            const id_cell = Number(cellId);

            if (isInt(id_cell)) {
              if (isInt(id_flotilla)) {
                await client.query(
                  `INSERT INTO grupo_personal (id_grupo_operacion, id_personal, asignado_por)
                   VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                  [id_flotilla, id_cell, who]
                );
              }

              await client.query(
                `INSERT INTO mando_operacion (id_operacion, id_cet, id_cell, asignado_por)
                 VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
                [id_operacion, id_cet, id_cell, who]
              );
            }
          }
        }
      }
    }

    // Guarda definitivamente todos los cambios
    await client.query("COMMIT");

    // Convierte los Map a objetos planos para responder JSON
    const flotillasOut = {};
    flotillaGroupIds.forEach((id, nombre) => {
      flotillasOut[nombre] = id;
    });

    const celulasOut = {};
    celulaGroupIds.forEach((id, nombre) => {
      celulasOut[nombre] = id;
    });

    // Respuesta final con ids generados
    return res.json({
      ok: true,
      flotillas: flotillasOut,
      celulas: celulasOut
    });
  } catch (err) {
    // Si algo falla, revierte todo
    await client.query("ROLLBACK");
    console.error("[POST /grupos] PG error:", err.code, err.message, err.detail, err.hint);
    return sendDbError(res, err, "Error guardando grupos");
  } finally {
    // Libera conexión
    client.release();
  }
});


// =========================================================
// POST /ops/:id/vehiculos
// Qué hace:
//   Reemplaza las asignaciones de vehículos de una operación.
//   Cada item vincula un vehículo a un custodio humano obligatorio,
//   con contexto de grupo opcional. Un mismo vehículo puede tener
//   N custodios (uno por nivel jerárquico: flotilla, grupo, etc.).
// Body esperado:
//   { items: [{ id_vehiculo, id_personal, id_grupo_operacion?, nivel_asignacion? }] }
// Validaciones:
//   - operación existe y es modificable
//   - id_personal es obligatorio en cada item
//   - si viene id_grupo_operacion, debe pertenecer a la operación
//   - un vehículo no puede estar activo en otra operación abierta
// =========================================================
router.post("/ops/:id/vehiculos", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);

  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id inválido" });
  }

  try {
    const { asignado_por, items } = req.body ?? {};
    const who = await resolveAsignadoPor(req, asignado_por);
    if (!who) return res.status(409).json({ ok: false, mensaje: "No hay un administrador activo para registrar la asignacion." });

    if (!Array.isArray(items)) {
      return res.status(400).json({ ok: false, mensaje: "items inválido" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const opStat = await client.query(
        `SELECT estado FROM operacion WHERE id_operacion=$1`,
        [id_operacion]
      );

      if (opStat.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, mensaje: "Operación no encontrada" });
      }

      if (opStat.rows[0].estado === "CANCELADA" || opStat.rows[0].estado === "CERRADA") {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          mensaje: `Operación ${opStat.rows[0].estado}. No se puede modificar.`
        });
      }

      // Borra todas las asignaciones previas de esta operación
      await client.query(
        `DELETE FROM vehiculo_operacion WHERE id_operacion = $1`,
        [id_operacion]
      );

      // Verifica una sola vez por vehículo único si está en otra operación activa
      const vehiculosUnicos = [
        ...new Set(
          items.map(it => Number(it.id_vehiculo)).filter(v => isInt(v))
        )
      ];

      for (const id_vehiculo of vehiculosUnicos) {
        const enOtraOp = await client.query(
          `SELECT o.nombre FROM vehiculo_operacion vo
           JOIN operacion o ON o.id_operacion = vo.id_operacion
           WHERE vo.id_vehiculo = $1
             AND vo.estado_asignacion = 'ASIGNADO'
             AND vo.id_operacion != $2
             AND o.estado NOT IN ('CERRADA', 'CANCELADA')
           LIMIT 1`,
          [id_vehiculo, id_operacion]
        );

        if (enOtraOp.rowCount > 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            ok: false,
            mensaje: `El vehículo ${id_vehiculo} ya está activo en la operación "${enOtraOp.rows[0].nombre}"`
          });
        }
      }

      // Inserta cada par (vehículo, custodio)
      for (const it of items) {
        const id_vehiculo     = Number(it.id_vehiculo);
        const id_personal     = Number(it.id_personal);
        const id_grupo_op_raw = Number(it.id_grupo_operacion);
        const id_grupo_operacion = isInt(id_grupo_op_raw) ? id_grupo_op_raw : null;
        const nivel_asignacion   = it.nivel_asignacion ?? null;

        // Ambos ids son obligatorios
        if (!isInt(id_vehiculo) || !isInt(id_personal)) continue;

        // Si viene contexto de grupo, valida que pertenezca a esta operación
        if (id_grupo_operacion) {
          const grupoExiste = await client.query(
            `SELECT 1 FROM grupo_operacion
             WHERE id_grupo_operacion=$1 AND id_operacion=$2`,
            [id_grupo_operacion, id_operacion]
          );

          if (grupoExiste.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              ok: false,
              mensaje: `Grupo ${id_grupo_operacion} no pertenece a esta operación`
            });
          }
        }

        // Inserta el par vehículo+custodio; si ya existe, actualiza contexto
        await client.query(
          `INSERT INTO vehiculo_operacion
             (id_operacion, id_vehiculo, id_personal, id_grupo_operacion,
              nivel_asignacion, estado_asignacion, asignado_por)
           VALUES ($1, $2, $3, $4, $5, 'ASIGNADO', $6)
           ON CONFLICT (id_operacion, id_vehiculo, id_personal) DO UPDATE SET
             id_grupo_operacion = EXCLUDED.id_grupo_operacion,
             nivel_asignacion   = EXCLUDED.nivel_asignacion,
             estado_asignacion  = 'ASIGNADO',
             asignado_por       = EXCLUDED.asignado_por,
             fecha_asignacion   = NOW()`,
          [id_operacion, id_vehiculo, id_personal, id_grupo_operacion, nivel_asignacion, who]
        );
      }

      await client.query("COMMIT");
      return res.json({ ok: true });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[POST /vehiculos] PG error:", err.code, err.message, err.detail, err.hint);
    return sendDbError(res, err, "Error guardando vehículos");
  }
});


// =========================================================
// POST /ops/:id/dispositivos
// Que hace:
//   Reemplaza las asignaciones de dispositivos de una operacion.
// Body esperado:
//   { items: [{ id_dispositivo, id_personal }] }
// Validaciones:
//   - operacion existe y es modificable
//   - el custodio debe pertenecer a la operacion
//   - un dispositivo no puede estar activo en otra operacion abierta
// =========================================================
router.post("/ops/:id/dispositivos", requireAuth, async (req, res) => {
  const id_operacion = Number(req.params.id);

  if (!isInt(id_operacion)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  const { asignado_por, items } = req.body ?? {};
  const who = await resolveAsignadoPor(req, asignado_por);
  if (!who) return res.status(409).json({ ok: false, mensaje: "No hay un administrador activo para registrar la asignacion." });

  if (!Array.isArray(items)) {
    return res.status(400).json({ ok: false, mensaje: "items invalido" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const opStat = await client.query(
      `SELECT estado FROM operacion WHERE id_operacion = $1`,
      [id_operacion]
    );

    if (opStat.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, mensaje: "Operacion no encontrada" });
    }

    if (opStat.rows[0].estado === "CANCELADA" || opStat.rows[0].estado === "CERRADA") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        mensaje: `Operacion ${opStat.rows[0].estado}. No se puede modificar.`
      });
    }

    const vistos = new Set();
    const dispositivosUnicos = [];

    for (const it of items) {
      const id_dispositivo = Number(it.id_dispositivo);
      const id_personal = Number(it.id_personal);

      if (!isInt(id_dispositivo) || !isInt(id_personal)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          mensaje: "Cada dispositivo necesita id_dispositivo e id_personal validos"
        });
      }

      if (vistos.has(id_dispositivo)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          mensaje: `El dispositivo ${id_dispositivo} esta repetido en la asignacion`
        });
      }

      vistos.add(id_dispositivo);
      dispositivosUnicos.push(id_dispositivo);
    }

    for (const id_dispositivo of dispositivosUnicos) {
      const enOtraOp = await client.query(
        `SELECT o.nombre
         FROM operacion_dispositivo od
         JOIN operacion o ON o.id_operacion = od.id_operacion
         WHERE od.id_dispositivo = $1
           AND od.id_operacion != $2
           AND od.estado_asignacion = 'ASIGNADO'
           AND od.fecha_devolucion IS NULL
           AND o.estado NOT IN ('CERRADA', 'CANCELADA')
         LIMIT 1`,
        [id_dispositivo, id_operacion]
      );

      if (enOtraOp.rowCount > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          mensaje: `El dispositivo ${id_dispositivo} ya esta activo en la operacion "${enOtraOp.rows[0].nombre}"`
        });
      }
    }

    await client.query(
      `DELETE FROM operacion_dispositivo WHERE id_operacion = $1`,
      [id_operacion]
    );

    for (const it of items) {
      const id_dispositivo = Number(it.id_dispositivo);
      const id_personal = Number(it.id_personal);

      const personaAsignada = await client.query(
        `SELECT 1
         FROM asignacion_operacion_personal
         WHERE id_operacion = $1
           AND id_personal = $2
           AND estado_asignacion NOT IN ('LIBERADO')`,
        [id_operacion, id_personal]
      );

      if (personaAsignada.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          mensaje: `El personal ${id_personal} no esta asignado a esta operacion`
        });
      }

      await client.query(
        `INSERT INTO operacion_dispositivo
           (id_operacion, id_dispositivo, id_personal, estado_asignacion, asignado_por)
         VALUES ($1, $2, $3, 'ASIGNADO', $4)
         ON CONFLICT (id_operacion, id_dispositivo) DO UPDATE SET
           id_personal = EXCLUDED.id_personal,
           estado_asignacion = 'ASIGNADO',
           fecha_devolucion = NULL,
           asignado_por = EXCLUDED.asignado_por,
           fecha_asignacion = NOW()`,
        [id_operacion, id_dispositivo, id_personal, who]
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[POST /dispositivos] PG error:", err.code, err.message, err.detail, err.hint);
    return sendDbError(res, err, "Error guardando dispositivos");
  } finally {
    client.release();
  }
});


// Exporta el router para montarlo en operaciones.routes.js o donde corresponda
export default router;
