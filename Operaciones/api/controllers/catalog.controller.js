import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { sendDbError } from "../utils/dbErrors.js";
import { isInt } from "../utils/validators.js";
import {
  slug,
  generateUniqueUsername,
  usernameExists,
  generateUniqueApodo,
} from "../utils/usernames.js";

const TIPOS_DISPOSITIVO = ["TELEFONO", "TABLET", "SMARTWATCH", "LORA", "LAPTOP", "RADIO", "GPS", "OTRO"];
const ESTADOS_DISPOSITIVO = ["DISPONIBLE", "ASIGNADO", "MANTENIMIENTO", "BAJA"];
const DISPOSITIVO_DATA_FIELDS = ["numero_telefono", "imei", "numero_serie", "sistema_operativo", "identificador_app"];
const DISPOSITIVO_FIELD_RULES = {
  TELEFONO: {
    allowed: ["numero_telefono", "imei", "numero_serie", "sistema_operativo", "identificador_app"],
    required: ["numero_telefono", "imei", "sistema_operativo"],
  },
  TABLET: {
    allowed: ["imei", "numero_serie", "sistema_operativo", "identificador_app"],
    required: ["numero_serie", "sistema_operativo"],
  },
  SMARTWATCH: {
    allowed: ["imei", "numero_serie", "sistema_operativo", "identificador_app"],
    required: ["numero_serie", "sistema_operativo"],
  },
  LORA: {
    allowed: ["numero_serie"],
    required: ["numero_serie"],
  },
  LAPTOP: {
    allowed: ["numero_serie", "sistema_operativo"],
    required: ["numero_serie", "sistema_operativo"],
  },
  RADIO: {
    allowed: ["numero_serie"],
    required: ["numero_serie"],
  },
  GPS: {
    allowed: ["imei", "numero_serie", "identificador_app"],
    required: ["numero_serie"],
  },
  OTRO: {
    allowed: ["numero_telefono", "imei", "numero_serie", "sistema_operativo", "identificador_app"],
    required: [],
  },
};
const DISPOSITIVO_FIELD_LABELS = {
  numero_telefono: "numero_telefono",
  imei: "IMEI",
  numero_serie: "numero_serie",
  sistema_operativo: "sistema_operativo",
  identificador_app: "identificador_app",
};

let dispositivoSchemaReady = false;

function cleanText(value) {
  return (value ?? "").toString().trim();
}

function cleanOptionalText(value) {
  const cleaned = cleanText(value);
  return cleaned || null;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj ?? {}, key);
}

async function ensureDispositivoSchema() {
  if (dispositivoSchemaReady) return;
  await pool.query(`
    ALTER TABLE dispositivo
      ADD COLUMN IF NOT EXISTS imagen_disp TEXT,
      ADD COLUMN IF NOT EXISTS identificador_app TEXT;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_dispositivo_identificador_app
      ON dispositivo(identificador_app)
      WHERE identificador_app IS NOT NULL AND btrim(identificador_app) <> '';
  `);
  dispositivoSchemaReady = true;
}

function validateAndNormalizeDispositivo(values) {
  const rule = DISPOSITIVO_FIELD_RULES[values.tipo] || DISPOSITIVO_FIELD_RULES.OTRO;
  const normalized = { ...values };

  for (const fieldName of DISPOSITIVO_DATA_FIELDS) {
    if (!rule.allowed.includes(fieldName)) {
      normalized[fieldName] = null;
    }
  }

  const missing = rule.required.filter(fieldName => !normalized[fieldName]);
  if (missing.length) {
    return {
      ok: false,
      mensaje: `Falta ${missing.map(fieldName => DISPOSITIVO_FIELD_LABELS[fieldName]).join(", ")} para tipo ${values.tipo}`,
    };
  }

  if (normalized.numero_telefono && !/^\d{7,15}$/.test(normalized.numero_telefono)) {
    return {
      ok: false,
      mensaje: "numero_telefono invalido: usa solo digitos (7 a 15).",
    };
  }

  return { ok: true, values: normalized };
}

// Lista personal filtrado por rol y marca si ya esta ocupado en otra operacion.
export async function listPersonal(req, res) {
  try {
    // El catalogo se consulta por rol operativo: CUT, CET o CELL.
    const rol = (req.query.rol || "").toString().toUpperCase();

    if (!["CUT", "CET", "CELL"].includes(rol)) {
      return res.status(400).json({ ok: false, mensaje: "rol inválido (CUT|CET|CELL)" });
    }

    // Operación a excluir del chequeo de ocupación (modo edición)
    const excludeOp = req.query.exclude_op ? Number(req.query.exclude_op) : null;

    // LEFT JOIN LATERAL calcula, por cada persona, si esta en otra
    // operacion ACTIVA o PLANIFICADA distinta de excludeOp.
    const { rows } = await pool.query(
      `SELECT
         p.id_personal, p.rol, p.apodo, p.nombre, p.apellido,
         p.puesto, p.username, p.activo, p.ultimo_acceso,
         -- Indica si ya está asignado a otra operación activa/planificada
         CASE WHEN opa.id_operacion IS NOT NULL THEN TRUE ELSE FALSE END AS en_operacion,
         opa.nombre AS nombre_operacion
       FROM personal p
       LEFT JOIN LATERAL (
         SELECT a.id_personal, o.id_operacion, o.nombre
         FROM asignacion_operacion_personal a
         JOIN operacion o ON o.id_operacion = a.id_operacion
         WHERE a.id_personal = p.id_personal
           AND o.estado IN ('ACTIVA', 'PLANIFICADA')
           AND a.estado_asignacion NOT IN ('LIBERADO')
           AND ($2::int IS NULL OR o.id_operacion != $2::int)
         ORDER BY CASE o.estado WHEN 'ACTIVA' THEN 1 WHEN 'PLANIFICADA' THEN 2 ELSE 3 END
         LIMIT 1
       ) opa ON TRUE
       WHERE p.rol = $1
       ORDER BY p.apellido, p.nombre`,
      [rol, excludeOp]
    );

    return res.json({ ok: true, items: rows });
  } catch (err) {
    return sendDbError(res, err, "Error catálogo personal");
  }
}

// Devuelve todos los vehiculos del inventario para catalogos y asignaciones.
export async function listVehiculos(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT
        id_vehiculo,
        imagen_veh,
        codigo_interno,
        tipo,
        alias,
        estado,
        capacidad,
        fecha_creacion AS fecha_registro
      FROM vehiculo
      ORDER BY codigo_interno ASC
    `);

    return res.json({ ok: true, items: rows });
  } catch (err) {
    console.error("GET /catalog/vehiculos:", err);
    return sendDbError(res, err, "Error obteniendo vehículos");
  }
}

// Crea personal operativo con username/apodo unicos y password inicial.
export async function createPersonal(req, res) {
  try {
    // Normaliza campos de entrada antes de validarlos.
    const rol = (req.body?.rol || "").toString().toUpperCase();
    const nombre = (req.body?.nombre || "").toString().trim();
    const apellido = (req.body?.apellido || "").toString().trim();
    const puesto = (req.body?.puesto || "").toString().trim() || null;
    const apodoIn = (req.body?.apodo || "").toString().trim();

    if (!["CUT", "CET", "CELL"].includes(rol)) {
      return res.status(400).json({ ok: false, mensaje: "rol inválido (CUT|CET|CELL)" });
    }
    if (!nombre) {
      return res.status(400).json({ ok: false, mensaje: "Falta nombre" });
    }
    if (!apellido) {
      return res.status(400).json({ ok: false, mensaje: "Falta apellido" });
    }

    // El usuario autenticado queda como responsable de la creacion.
    const creado_por = Number(req.user.sub);
    if (!isInt(creado_por)) {
      return res.status(401).json({ ok: false, mensaje: "Usuario inválido" });
    }

    // La transaccion mantiene atomica la creacion y las validaciones de unicidad.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Base sugerida para username: inicial del nombre + apellido normalizado.
      const nombreSlug = slug(nombre);
      const apellidoSlug = slug(apellido);
      const base = `${(nombreSlug[0] || "")}${apellidoSlug}`.slice(0, 35);

      // Si no se envia apodo, se deriva del nombre completo.
      const apodoBase = apodoIn || `${nombre} ${apellido}`;
      const apodo = await generateUniqueApodo(apodoBase, client);

      // Username opcional propuesto por el cliente.
      const usernameIn = (req.body?.username || "").toString().trim();
      if (usernameIn && !/^[a-zA-Z0-9._-]+$/.test(usernameIn)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          mensaje: "username inválido: solo letras, números, punto, guion y guion bajo.",
        });
      }

      // Serializa registros concurrentes del mismo username y rechaza duplicados
      // explícitos. No se cambia silenciosamente "mcruz" por "mcruz1".
      const requestedUsername = (usernameIn || base).toLowerCase();
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [requestedUsername]);
      if (usernameIn && await usernameExists(requestedUsername, client)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          mensaje: `El usuario "${usernameIn}" ya está registrado. Escribe uno diferente.`,
        });
      }
      const finalUsername = usernameIn
        ? requestedUsername
        : await generateUniqueUsername(requestedUsername, client);

      // Si no se envia password, se genera una temporal para entregar al usuario.
      const passwordIn = (req.body?.password || "").toString();
      const tempPassword = passwordIn || `Temp-${Math.floor(100000 + Math.random() * 900000)}`;
      const password_hash = await bcrypt.hash(tempPassword, 10);

      const { rows } = await client.query(
        `INSERT INTO personal (rol, apodo, nombre, apellido, puesto, username, password_hash, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id_personal, rol, apodo, nombre, apellido, puesto, activo, fecha_creacion, username, ultimo_acceso`,
        [rol, apodo, nombre, apellido, puesto, finalUsername, password_hash, creado_por]
      );

      await client.query("COMMIT");

      return res.json({ ok: true, item: rows[0], tempPassword });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    return sendDbError(res, err, "Error creando personal");
  }
}

// Actualiza datos editables de personal y recalcula username si aplica.
export async function updatePersonal(req, res) {
  // El id llega por parametro de ruta y debe ser entero.
  const id_personal = Number(req.params.id);
  if (!isInt(id_personal)) {
    return res.status(400).json({ ok: false, mensaje: "id inválido" });
  }

  // La transaccion protege la lectura actual, validaciones y UPDATE final.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Carga el estado actual para combinarlo con campos parciales del body.
    const { rows: currentRows } = await client.query(
      `SELECT * FROM personal WHERE id_personal = $1`,
      [id_personal]
    );

    if (!currentRows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, mensaje: "Personal no existe" });
    }

    const current = currentRows[0];

    // null significa "no actualizar"; valores presentes se validan abajo.
    const apodo = req.body?.apodo != null ? String(req.body.apodo).trim() : null;
    const nombre = req.body?.nombre != null ? String(req.body.nombre).trim() : null;
    const apellido = req.body?.apellido != null ? String(req.body.apellido).trim() : null;
    const puesto = req.body?.puesto != null ? (String(req.body.puesto).trim() || null) : null;
    const activo = req.body?.activo != null ? !!req.body.activo : null;
    const usernameIn = req.body?.username != null ? String(req.body.username).trim() : null;
    const passwordIn = req.body?.password != null ? String(req.body.password) : null;

    if (usernameIn !== null) {
      if (!usernameIn) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, mensaje: "username no puede estar vacío" });
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(usernameIn)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, mensaje: "username inválido: solo letras, números, punto, guion y guion bajo." });
      }
    }

    if (apodo !== null && !apodo) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, mensaje: "apodo inválido" });
    }
    if (nombre !== null && !nombre) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, mensaje: "nombre inválido" });
    }
    if (apellido !== null && !apellido) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, mensaje: "apellido inválido" });
    }

    const finalNombre = nombre ?? current.nombre;
    const finalApellido = apellido ?? current.apellido;

    // Construye dinamicamente el SET para modificar solo campos enviados.
    const sets = [];
    const vals = [];
    let i = 1;

    if (apodo !== null) {
      const apodoUnique = await generateUniqueApodo(apodo, client, id_personal);
      sets.push(`apodo = $${i++}`);
      vals.push(apodoUnique);
    }

    if (nombre !== null) {
      sets.push(`nombre = $${i++}`);
      vals.push(nombre);
    }

    if (apellido !== null) {
      sets.push(`apellido = $${i++}`);
      vals.push(apellido);
    }

    if (req.body?.puesto !== undefined) {
      sets.push(`puesto = $${i++}`);
      vals.push(puesto);
    }

    if (req.body?.activo !== undefined) {
      sets.push(`activo = $${i++}`);
      vals.push(activo);
    }

    if (usernameIn !== null) {
      const normalizedUsername = usernameIn.toLowerCase();
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [normalizedUsername]);
      if (await usernameExists(normalizedUsername, client, id_personal)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          mensaje: `El usuario "${usernameIn}" ya está registrado. Escribe uno diferente.`,
        });
      }
      sets.push(`username = $${i++}`);
      vals.push(normalizedUsername);
    } else if (nombre !== null || apellido !== null) {
      // Si cambia nombre/apellido y no hay username explicito, se recalcula.
      const nombreSlug = slug(finalNombre);
      const apellidoSlug = slug(finalApellido);
      const base = `${(nombreSlug[0] || "")}${apellidoSlug}`.slice(0, 35);
      const username = await generateUniqueUsername(base, client, id_personal);
      sets.push(`username = $${i++}`);
      vals.push(username);
    }

    if (passwordIn) {
      // Solo actualiza password cuando llega uno nuevo en el body.
      const newHash = await bcrypt.hash(passwordIn, 10);
      sets.push(`password_hash = $${i++}`);
      vals.push(newHash);
    }

    if (sets.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, mensaje: "Nada para actualizar" });
    }

    vals.push(id_personal);

    const { rows } = await client.query(
      `UPDATE personal
       SET ${sets.join(", ")}
       WHERE id_personal = $${i}
       RETURNING id_personal, rol, apodo, nombre, apellido, puesto, activo, username, ultimo_acceso`,
      vals
    );

    await client.query("COMMIT");

    return res.json({ ok: true, item: rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    return sendDbError(res, err, "Error editando personal");
  } finally {
    client.release();
  }
}

// Elimina personal: por default desactiva; con ?hard=1 intenta borrado fisico.
export async function deletePersonal(req, res) {
  const id_personal = Number(req.params.id);
  if (!isInt(id_personal)) {
    return res.status(400).json({ ok: false, mensaje: "id inválido" });
  }

  const hard = String(req.query.hard || "").trim() === "1";

  try {
    // Borrado fisico solo para casos controlados; puede fallar por referencias.
    if (hard) {
      await pool.query(`DELETE FROM personal WHERE id_personal = $1`, [id_personal]);
      return res.json({ ok: true, deleted: true, hard: true, id_personal });
    }

    // Borrado logico: conserva historial y relaciones, pero desactiva acceso.
    const { rows } = await pool.query(
      `UPDATE personal
       SET activo = FALSE
       WHERE id_personal = $1
       RETURNING id_personal, activo`,
      [id_personal]
    );

    if (!rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Personal no existe" });
    }

    return res.json({ ok: true, item: rows[0], hard: false });
  } catch (err) {
    // 23503 indica FK: el personal esta referenciado por otras tablas.
    if (err.code === "23503") {
      return res.status(409).json({
        ok: false,
        mensaje: "No se puede borrar porque está referenciado (asignaciones/operaciones). Desactívalo o borra referencias primero.",
        error: err.detail || err.message,
      });
    }
    return sendDbError(res, err, "Error eliminando personal");
  }
}

// Devuelve todos los dispositivos, marcando responsable si estan asignados
// en una operacion activa o planificada.
export async function listDispositivos(req, res) {
  try {
    await ensureDispositivoSchema();

    const { rows } = await pool.query(`
      SELECT
        d.id_dispositivo,
        d.imagen_disp,
        d.tipo,
        d.marca,
        d.modelo,
        d.numero_telefono,
        d.imei,
        d.numero_serie,
        d.sistema_operativo,
        d.identificador_app,
        CASE
          WHEN od.id_operacion IS NOT NULL THEN 'ASIGNADO'
          ELSE d.estado::text
        END AS estado,
        COALESCE(
          NULLIF(TRIM(CONCAT_WS(' ', p.puesto, p.nombre, p.apellido)), ''),
          p.apodo,
          ''
        ) AS responsable,
        od.id_operacion AS id_operacion_responsable,
        o.nombre AS operacion_responsable,
        d.detalles,
        d.fecha_creacion AS fecha_registro
      FROM dispositivo d
      LEFT JOIN LATERAL (
        SELECT od2.*
        FROM operacion_dispositivo od2
        JOIN operacion o2 ON o2.id_operacion = od2.id_operacion
        WHERE od2.id_dispositivo = d.id_dispositivo
          AND od2.estado_asignacion = 'ASIGNADO'
          AND od2.fecha_devolucion IS NULL
          AND o2.estado IN ('ACTIVA', 'PLANIFICADA')
        ORDER BY
          CASE o2.estado WHEN 'ACTIVA' THEN 1 WHEN 'PLANIFICADA' THEN 2 ELSE 3 END,
          od2.fecha_asignacion DESC
        LIMIT 1
      ) od ON TRUE
      LEFT JOIN personal p ON p.id_personal = od.id_personal
      LEFT JOIN operacion o ON o.id_operacion = od.id_operacion
      ORDER BY d.tipo, d.marca, d.modelo, d.numero_serie NULLS LAST
    `);

    return res.json({ ok: true, items: rows });
  } catch (err) {
    return sendDbError(res, err, "Error obteniendo dispositivos");
  }
}

export async function createDispositivo(req, res) {
  try {
    await ensureDispositivoSchema();

    const tipo = cleanText(req.body?.tipo).toUpperCase();
    const imagen_disp = cleanOptionalText(req.body?.imagen_disp);
    const marca = cleanText(req.body?.marca);
    const modelo = cleanText(req.body?.modelo);
    const numero_telefono = cleanOptionalText(req.body?.numero_telefono);
    const imei = cleanOptionalText(req.body?.imei);
    const numero_serie = cleanOptionalText(req.body?.numero_serie);
    const sistema_operativo = cleanOptionalText(req.body?.sistema_operativo);
    const identificador_app = cleanOptionalText(req.body?.identificador_app);
    const estado = cleanText(req.body?.estado || "DISPONIBLE").toUpperCase();
    const detalles = cleanOptionalText(req.body?.detalles);

    if (!tipo || !marca || !modelo) {
      return res.status(400).json({ ok: false, mensaje: "Faltan tipo, marca o modelo" });
    }

    if (!TIPOS_DISPOSITIVO.includes(tipo)) {
      return res.status(400).json({
        ok: false,
        mensaje: `tipo invalido (${TIPOS_DISPOSITIVO.join("|")})`,
      });
    }

    if (!ESTADOS_DISPOSITIVO.includes(estado)) {
      return res.status(400).json({
        ok: false,
        mensaje: `estado invalido (${ESTADOS_DISPOSITIVO.join("|")})`,
      });
    }

    const normalized = validateAndNormalizeDispositivo({
      tipo,
      imagen_disp,
      marca,
      modelo,
      numero_telefono,
      imei,
      numero_serie,
      sistema_operativo,
      identificador_app,
      estado,
      detalles,
    });

    if (!normalized.ok) {
      return res.status(400).json({ ok: false, mensaje: normalized.mensaje });
    }

    const item = normalized.values;

    const { rows } = await pool.query(
      `INSERT INTO dispositivo
         (imagen_disp, tipo, marca, modelo, numero_telefono, imei, numero_serie,
          sistema_operativo, identificador_app, estado, detalles)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id_dispositivo, imagen_disp, tipo, marca, modelo, numero_telefono, imei,
                 numero_serie, sistema_operativo, identificador_app, estado, detalles,
                 fecha_creacion AS fecha_registro`,
      [
        item.imagen_disp,
        item.tipo,
        item.marca,
        item.modelo,
        item.numero_telefono,
        item.imei,
        item.numero_serie,
        item.sistema_operativo,
        item.identificador_app,
        item.estado,
        item.detalles,
      ]
    );

    return res.json({ ok: true, item: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        ok: false,
        mensaje: "Ya existe un dispositivo con ese telefono, IMEI o numero de serie",
        error: err.detail || err.message,
      });
    }

    return sendDbError(res, err, "Error creando dispositivo");
  }
}

export async function updateDispositivo(req, res) {
  const id_dispositivo = Number(req.params.id);

  if (!isInt(id_dispositivo)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  try {
    await ensureDispositivoSchema();

    const body = req.body ?? {};
    const hasUpdates = [
      "tipo",
      "imagen_disp",
      "marca",
      "modelo",
      "numero_telefono",
      "imei",
      "numero_serie",
      "sistema_operativo",
      "identificador_app",
      "estado",
      "detalles",
    ].some(fieldName => hasOwn(body, fieldName));

    if (!hasUpdates) {
      return res.status(400).json({ ok: false, mensaje: "Nada para actualizar" });
    }

    const tipo = hasOwn(body, "tipo") ? cleanText(body.tipo).toUpperCase() : null;
    const imagen_disp = hasOwn(body, "imagen_disp") ? cleanOptionalText(body.imagen_disp) : undefined;
    const marca = hasOwn(body, "marca") ? cleanText(body.marca) : null;
    const modelo = hasOwn(body, "modelo") ? cleanText(body.modelo) : null;
    const numero_telefono = hasOwn(body, "numero_telefono") ? cleanOptionalText(body.numero_telefono) : undefined;
    const imei = hasOwn(body, "imei") ? cleanOptionalText(body.imei) : undefined;
    const numero_serie = hasOwn(body, "numero_serie") ? cleanOptionalText(body.numero_serie) : undefined;
    const sistema_operativo = hasOwn(body, "sistema_operativo") ? cleanOptionalText(body.sistema_operativo) : undefined;
    const identificador_app = hasOwn(body, "identificador_app") ? cleanOptionalText(body.identificador_app) : undefined;
    const estado = hasOwn(body, "estado") ? cleanText(body.estado).toUpperCase() : null;
    const detalles = hasOwn(body, "detalles") ? cleanOptionalText(body.detalles) : undefined;

    if (tipo !== null && (!tipo || !TIPOS_DISPOSITIVO.includes(tipo))) {
      return res.status(400).json({
        ok: false,
        mensaje: `tipo invalido (${TIPOS_DISPOSITIVO.join("|")})`,
      });
    }

    if (marca !== null && !marca) {
      return res.status(400).json({ ok: false, mensaje: "marca invalida" });
    }

    if (modelo !== null && !modelo) {
      return res.status(400).json({ ok: false, mensaje: "modelo invalido" });
    }

    if (estado !== null && !ESTADOS_DISPOSITIVO.includes(estado)) {
      return res.status(400).json({
        ok: false,
        mensaje: `estado invalido (${ESTADOS_DISPOSITIVO.join("|")})`,
      });
    }

    const { rows: currentRows } = await pool.query(
      `SELECT tipo, marca, modelo, numero_telefono, imei, numero_serie,
              sistema_operativo, identificador_app, estado, detalles, imagen_disp
       FROM dispositivo
       WHERE id_dispositivo = $1`,
      [id_dispositivo]
    );

    if (!currentRows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Dispositivo no existe" });
    }

    const current = currentRows[0];
    const normalized = validateAndNormalizeDispositivo({
      tipo: tipo !== null ? tipo : current.tipo,
      imagen_disp: imagen_disp !== undefined ? imagen_disp : current.imagen_disp,
      marca: marca !== null ? marca : current.marca,
      modelo: modelo !== null ? modelo : current.modelo,
      numero_telefono: numero_telefono !== undefined ? numero_telefono : current.numero_telefono,
      imei: imei !== undefined ? imei : current.imei,
      numero_serie: numero_serie !== undefined ? numero_serie : current.numero_serie,
      sistema_operativo: sistema_operativo !== undefined ? sistema_operativo : current.sistema_operativo,
      identificador_app: identificador_app !== undefined ? identificador_app : current.identificador_app,
      estado: estado !== null ? estado : current.estado,
      detalles: detalles !== undefined ? detalles : current.detalles,
    });

    if (!normalized.ok) {
      return res.status(400).json({ ok: false, mensaje: normalized.mensaje });
    }

    const item = normalized.values;

    const { rows } = await pool.query(
      `UPDATE dispositivo
       SET imagen_disp = $1,
           tipo = $2,
           marca = $3,
           modelo = $4,
           numero_telefono = $5,
           imei = $6,
           numero_serie = $7,
           sistema_operativo = $8,
           identificador_app = $9,
           estado = $10,
           detalles = $11
       WHERE id_dispositivo = $12
       RETURNING id_dispositivo, imagen_disp, tipo, marca, modelo, numero_telefono, imei,
                 numero_serie, sistema_operativo, identificador_app, estado, detalles,
                 fecha_creacion AS fecha_registro`,
      [
        item.imagen_disp,
        item.tipo,
        item.marca,
        item.modelo,
        item.numero_telefono,
        item.imei,
        item.numero_serie,
        item.sistema_operativo,
        item.identificador_app,
        item.estado,
        item.detalles,
        id_dispositivo,
      ]
    );

    if (!rows[0]) {
      return res.status(404).json({ ok: false, mensaje: "Dispositivo no existe" });
    }

    return res.json({ ok: true, item: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        ok: false,
        mensaje: "Ya existe un dispositivo con ese telefono, IMEI o numero de serie",
        error: err.detail || err.message,
      });
    }

    return sendDbError(res, err, "Error editando dispositivo");
  }
}

export async function deleteDispositivo(req, res) {
  const id_dispositivo = Number(req.params.id);

  if (!isInt(id_dispositivo)) {
    return res.status(400).json({ ok: false, mensaje: "id invalido" });
  }

  try {
    await pool.query(`DELETE FROM dispositivo WHERE id_dispositivo = $1`, [id_dispositivo]);
    return res.json({ ok: true, deleted: true, id_dispositivo });
  } catch (err) {
    if (err.code === "23503") {
      return res.status(409).json({
        ok: false,
        mensaje: "No se puede borrar porque el dispositivo esta referenciado en operaciones.",
        error: err.detail || err.message,
      });
    }

    return sendDbError(res, err, "Error eliminando dispositivo");
  }
}
