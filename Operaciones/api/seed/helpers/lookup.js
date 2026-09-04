export async function getAvailableVehiculos(client, limit = 2) {
  const { rows } = await client.query(
    `
    SELECT id_vehiculo, codigo_interno, tipo, alias, capacidad, estado
    FROM vehiculo
    WHERE estado = 'DISPONIBLE'
    ORDER BY fecha_creacion ASC, id_vehiculo ASC
    LIMIT $1
    `,
    [limit]
  );
  return rows;
}

export async function getAvailableEquipos(client, limit = 4) {
  const { rows } = await client.query(
    `
    SELECT id_equipo, numero_serie, nombre, categoria, estado
    FROM equipo
    WHERE estado = 'DISPONIBLE'
    ORDER BY
      CASE categoria
        WHEN 'COMUNICACION' THEN 1
        WHEN 'TACTICO' THEN 2
        ELSE 3
      END,
      fecha_creacion ASC,
      id_equipo ASC
    LIMIT $1
    `,
    [limit]
  );
  return rows;
}

export async function getVehiculoByCodigo(client, codigoInterno) {
  const { rows, rowCount } = await client.query(
    `
    SELECT id_vehiculo, codigo_interno, tipo, alias, capacidad, estado
    FROM vehiculo
    WHERE codigo_interno = $1
    LIMIT 1
    `,
    [codigoInterno]
  );
  if (rowCount === 0) {
    throw new Error(`No existe el vehículo fijo ${codigoInterno}`);
  }
  return rows[0];
}

export async function getEquipoBySerie(client, numeroSerie) {
  const { rows, rowCount } = await client.query(
    `
    SELECT id_equipo, numero_serie, nombre, categoria, estado
    FROM equipo
    WHERE numero_serie = $1
    LIMIT 1
    `,
    [numeroSerie]
  );
  if (rowCount === 0) {
    throw new Error(`No existe el equipo fijo ${numeroSerie}`);
  }
  return rows[0];
}

export async function getGrupoId(client, idOperacion, nombre) {
  const { rows, rowCount } = await client.query(
    `
    SELECT id_grupo_operacion
    FROM grupo_operacion
    WHERE id_operacion = $1 AND nombre = $2
    LIMIT 1
    `,
    [idOperacion, nombre]
  );
  if (rowCount === 0) return null;
  return rows[0].id_grupo_operacion;
}
