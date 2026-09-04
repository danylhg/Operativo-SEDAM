export function cleanApodo(s) {
  return (s ?? "").toString().trim().replace(/\s+/g, " ").slice(0, 40);
}

export async function generateUniqueApodo(client, wanted) {
  let base = cleanApodo(wanted);
  if (!base) base = "SinApodo";

  for (let n = 0; n < 200; n++) {
    const apodo = (n === 0 ? base : `${base} ${n + 1}`).slice(0, 40);

    const { rows } = await client.query(
      `SELECT 1 FROM personal WHERE apodo = $1 LIMIT 1`,
      [apodo]
    );
    if (rows.length === 0) return apodo;
  }

  return `${base}-${Date.now()}`.slice(0, 40);
}

export async function getAdminId(client) {
  const { rows, rowCount } = await client.query(
    `SELECT id_usuario FROM usuario WHERE username = 'admin' LIMIT 1`
  );
  if (rowCount === 0) throw new Error(`No existe el usuario admin`);
  return rows[0].id_usuario;
}

export async function getPersonalByUsername(client, username) {
  const { rows, rowCount } = await client.query(
    `SELECT id_personal, username, rol, apodo, nombre, apellido
     FROM personal
     WHERE username = $1
     LIMIT 1`,
    [username]
  );
  if (rowCount === 0) return null;
  return rows[0];
}

export async function getPersonalIdStrict(client, username) {
  const persona = await getPersonalByUsername(client, username);
  if (!persona) {
    throw new Error(`No se encontró personal con username=${username}`);
  }
  return persona.id_personal;
}
