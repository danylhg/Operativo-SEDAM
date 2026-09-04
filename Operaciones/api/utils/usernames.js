// Convierte un texto libre en una base segura para username:
// minusculas, sin acentos, separadores con punto y longitud acotada.
export function slug(s = "") {
  return s
    .toString()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 30);
}

// Comprueba el username en las dos tablas que pueden iniciar sesión.
// La comparación ignora mayúsculas porque el login también las ignora.
export async function usernameExists(username, client, ignorePersonalId = null) {
  const normalized = String(username || "").trim().toLowerCase();
  if (!normalized) return false;

  const { rowCount } = await client.query(
    `SELECT 1
       FROM (
         SELECT username, NULL::int AS id_personal FROM usuario
         UNION ALL
         SELECT username, id_personal FROM personal
       ) cuentas
      WHERE LOWER(username) = $1
        AND ($2::int IS NULL OR id_personal IS NULL OR id_personal <> $2)
      LIMIT 1`,
    [normalized, ignorePersonalId]
  );
  return rowCount > 0;
}

// Genera un username unico en todas las cuentas con acceso al sistema.
// Si existe, agrega un contador incremental al final de la base.
export async function generateUniqueUsername(base, client, ignoreId = null) {
  const normalizedBase = String(base || "").trim().toLowerCase();
  let username = normalizedBase;
  let counter = 1;

  while (true) {
    if (!(await usernameExists(username, client, ignoreId))) break;

    username = `${normalizedBase}${counter}`;
    counter++;
  }

  return username;
}

// Genera un apodo unico para personal.
// Intenta variantes cortas y, como ultimo recurso, usa timestamp.
export async function generateUniqueApodo(baseApodo, client, excludeId = null) {
  let attempt = 0;
  // Mantiene el apodo dentro del limite esperado por la interfaz/base.
  const cleanBase = (baseApodo || "").toString().trim().slice(0, 40) || "SinApodo";

  while (attempt < 20) {
    // Primer intento: apodo limpio. Siguientes: agrega un numero corto.
    const suffix = attempt === 0 ? "" : ` ${Math.floor(10 + Math.random() * 90)}`;
    const apodo = `${cleanBase}${suffix}`.slice(0, 40);

    const query = excludeId
      ? `SELECT 1 FROM personal WHERE apodo = $1 AND id_personal != $2 LIMIT 1`
      : `SELECT 1 FROM personal WHERE apodo = $1 LIMIT 1`;
    const params = excludeId ? [apodo, excludeId] : [apodo];

    const { rows } = await client.query(query, params);

    if (rows.length === 0) return apodo;
    attempt++;
  }

  return `${cleanBase}-${Date.now()}`.slice(0, 40);
}
