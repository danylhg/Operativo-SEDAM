export async function ensureChatParticipantUsuario(client, idChat, idUsuario) {
  const { rows } = await client.query(
    `
    INSERT INTO participante_chat (id_chat, tipo, id_usuario, id_personal)
    VALUES ($1, 'USUARIO', $2, NULL)
    ON CONFLICT (id_chat, id_usuario) DO UPDATE
      SET id_usuario = EXCLUDED.id_usuario
    RETURNING id_participante
    `,
    [idChat, idUsuario]
  );

  if (rows[0]?.id_participante) return rows[0].id_participante;

  const fallback = await client.query(
    `SELECT id_participante
     FROM participante_chat
     WHERE id_chat = $1 AND id_usuario = $2
     LIMIT 1`,
    [idChat, idUsuario]
  );
  return fallback.rows[0]?.id_participante ?? null;
}

export async function ensureChatParticipantPersonal(client, idChat, idPersonal) {
  const { rows } = await client.query(
    `
    INSERT INTO participante_chat (id_chat, tipo, id_usuario, id_personal)
    VALUES ($1, 'PERSONAL', NULL, $2)
    ON CONFLICT (id_chat, id_personal) DO UPDATE
      SET id_personal = EXCLUDED.id_personal
    RETURNING id_participante
    `,
    [idChat, idPersonal]
  );

  if (rows[0]?.id_participante) return rows[0].id_participante;

  const fallback = await client.query(
    `SELECT id_participante
     FROM participante_chat
     WHERE id_chat = $1 AND id_personal = $2
     LIMIT 1`,
    [idChat, idPersonal]
  );
  return fallback.rows[0]?.id_participante ?? null;
}
