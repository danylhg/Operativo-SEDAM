import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "1234",
  database: process.env.PGDATABASE || "ops_db"
});

async function main() {
  try {
    const resOps = await pool.query("SELECT id_operacion, nombre, estado, fecha_creacion FROM operacion ORDER BY fecha_creacion DESC");
    console.log("=== OPERACIONES ===");
    console.log(resOps.rows);

    for (const op of resOps.rows) {
      const opId = op.id_operacion;
      console.log(`\n=== DETALLES DE OPERACION: ${op.nombre} (${opId}) ===`);

      const resDrawings = await pool.query("SELECT id_dibujo, color FROM dibujo_libre_operacion WHERE id_operacion = $1", [opId]);
      console.log(`Dibujos (${resDrawings.rowCount}):`, resDrawings.rows);

      const resAreas = await pool.query("SELECT id_area, nombre FROM area_interes WHERE id_operacion = $1", [opId]);
      console.log(`Áreas (${resAreas.rowCount}):`, resAreas.rows);

      const resPois = await pool.query("SELECT id_poi, nombre FROM puntos_interes WHERE id_operacion = $1", [opId]);
      console.log(`POIs (${resPois.rowCount}):`, resPois.rows);

      const resStructures = await pool.query("SELECT id_estructura, nombre FROM marca_edificio WHERE id_operacion = $1", [opId]);
      console.log(`Estructuras (${resStructures.rowCount}):`, resStructures.rows);
    }
  } catch (err) {
    console.error("Error executing query:", err);
  } finally {
    await pool.end();
  }
}

main();
