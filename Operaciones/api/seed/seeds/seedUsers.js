import bcrypt from "bcryptjs";
import { BCRYPT_ROUNDS, DEFAULT_PASSWORD } from "../config.js";
import { cleanApodo, generateUniqueApodo, getAdminId } from "../helpers/personal.js";
import { users } from "../data/users.js";

export async function seedUsers(client) {
  const adminUsers = users.filter((u) => u.rol === "ADMIN");
  const personalUsers = users.filter((u) => ["CUT", "CET", "CELL"].includes(u.rol));

  // =========================================================
  // 1) ADMIN -> tabla usuario
  // =========================================================
  for (const u of adminUsers) {
    const hash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);

    await client.query(
      `
      INSERT INTO usuario (rol, nombre, apellido, puesto, username, password_hash, activo)
      VALUES ($1,$2,$3,$4,$5,$6, TRUE)
      ON CONFLICT (username) DO UPDATE
        SET rol = EXCLUDED.rol,
            nombre = EXCLUDED.nombre,
            apellido = EXCLUDED.apellido,
            puesto = EXCLUDED.puesto,
            password_hash = EXCLUDED.password_hash,
            activo = TRUE
      `,
      [u.rol, u.nombre, u.apellido, u.puesto, u.username, hash]
    );
  }

  const creadoPor = await getAdminId(client);

  // =========================================================
  // 2) Personal -> tabla personal
  // =========================================================
  for (const p of personalUsers) {
    const hash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);

    const wantedApodo =
      cleanApodo(p.apodo) ||
      cleanApodo(p.apellido) ||
      cleanApodo(p.nombre) ||
      cleanApodo(p.username);

    const apodoFinal = await generateUniqueApodo(client, wantedApodo);

    await client.query(
      `
      INSERT INTO personal (rol, apodo, nombre, apellido, puesto, username, password_hash, activo, creado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7, TRUE, $8)
      ON CONFLICT (username) DO UPDATE
        SET rol           = EXCLUDED.rol,
            apodo         = EXCLUDED.apodo,
            nombre        = EXCLUDED.nombre,
            apellido      = EXCLUDED.apellido,
            puesto        = EXCLUDED.puesto,
            password_hash = EXCLUDED.password_hash,
            activo        = TRUE,
            creado_por    = EXCLUDED.creado_por
      `,
      [p.rol, apodoFinal, p.nombre, p.apellido, p.puesto, p.username, hash, creadoPor]
    );
  }

  return { defaultPassword: DEFAULT_PASSWORD };
}
