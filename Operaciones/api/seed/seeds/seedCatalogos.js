const VEHICULOS = [
  ["VH-001", "Camioneta", "Águila 1", 5],
  ["VH-003", "Camioneta", "Águila 2", 5],
  ["VH-004", "Camioneta", "Norte 1", 5],
  ["VH-005", "Camioneta", "Norte 2", 5],
  ["VH-009", "Camioneta", "Cóndor 1", 5],
  ["VH-012", "Camioneta", "Cóndor 2", 5],
  ["VH-015", "Camioneta", "Mando móvil", 5],
];

const EQUIPOS = [
  ["HFC-001", "Radio HFC 001", "COMUNICACION"],
  ["HFC-002", "Radio HFC 002", "COMUNICACION"],
  ["HFC-003", "Radio HFC 003", "COMUNICACION"],
  ["HFC-004", "Radio HFC 004", "COMUNICACION"],
  ["HFC-005", "Radio HFC 005", "COMUNICACION"],
  ["1581F7K3C25CD00DYNZD", "DJI Matrice 4T", "TACTICO"],
  ["DRN-001", "Dron táctico 001", "TACTICO"],
  ["DRN-002", "Dron táctico 002", "TACTICO"],
  ["DRN-003", "Dron táctico 003", "TACTICO"],
  ["DRN-004", "Dron táctico 004", "TACTICO"],
  ["DRN-005", "Dron táctico 005", "TACTICO"],
];

// Crea el inventario mínimo que usan las operaciones de demostración.
// Es idempotente para que el seed completo se pueda ejecutar más de una vez.
export async function seedCatalogos(client) {
  for (const [codigo, tipo, alias, capacidad] of VEHICULOS) {
    await client.query(
      `INSERT INTO vehiculo (codigo_interno, tipo, alias, estado, capacidad)
       VALUES ($1, $2, $3, 'DISPONIBLE', $4)
       ON CONFLICT (codigo_interno) DO UPDATE SET
         tipo = EXCLUDED.tipo,
         alias = EXCLUDED.alias,
         capacidad = EXCLUDED.capacidad`,
      [codigo, tipo, alias, capacidad]
    );
  }

  for (const [serie, nombre, categoria] of EQUIPOS) {
    const { rows } = await client.query(
      `INSERT INTO equipo (numero_serie, nombre, categoria, estado)
       VALUES ($1, $2, $3, 'DISPONIBLE')
       ON CONFLICT (numero_serie) DO UPDATE SET
         nombre = EXCLUDED.nombre,
         categoria = EXCLUDED.categoria
       RETURNING id_equipo`,
      [serie, nombre, categoria]
    );

    const idEquipo = rows[0].id_equipo;
    if (categoria === "COMUNICACION") {
      await client.query(
        `INSERT INTO equipo_comunicacion (id_equipo, notas)
         VALUES ($1, 'Inventario de demostración')
         ON CONFLICT (id_equipo) DO NOTHING`,
        [idEquipo]
      );
    } else {
      await client.query(
        `INSERT INTO equipo_tactico (id_equipo, tipo_tactico, notas)
         VALUES ($1, 'GENERAL', 'Inventario de demostración')
         ON CONFLICT (id_equipo) DO NOTHING`,
        [idEquipo]
      );
    }
  }

  return { vehiculos: VEHICULOS.length, equipos: EQUIPOS.length };
}
