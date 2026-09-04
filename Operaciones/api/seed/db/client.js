// seed/db/client.js
import pkg from "pg";
import { requireEnv } from "../helpers/env.js";

// El paquete pg expone Client dentro del default export cuando se usa ESM.
const { Client } = pkg;

// Crea una conexion dedicada para el proceso de seed.
// El caller es responsable de cerrarla con client.end().
export async function createClient() {
  // Lee la configuracion de PostgreSQL desde variables de entorno obligatorias.
  const client = new Client({
    host: requireEnv("PGHOST"),
    port: Number(process.env.PGPORT || 5432),
    user: requireEnv("PGUSER"),
    password: requireEnv("PGPASSWORD"),
    database: requireEnv("PGDATABASE"),
  });

  // Abre la conexion antes de devolver el cliente listo para ejecutar queries.
  await client.connect();
  return client;
}
