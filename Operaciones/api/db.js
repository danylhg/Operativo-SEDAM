import pg from "pg";
import { DB_CONFIG } from "./config/env.js";

const { Pool } = pg;

export const pool = new Pool(DB_CONFIG);

console.log("DB CONFIG TEST:", {
  host: DB_CONFIG.host,
  port: DB_CONFIG.port,
  user: DB_CONFIG.user,
  database: DB_CONFIG.database,
});

pool
  .query("SELECT current_user, current_database()")
  .then((r) => console.log("DB OK:", r.rows[0]))
  .catch((e) => console.error("DB TEST ERROR:", e));
