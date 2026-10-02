import { createClient } from "./db/client.js";
import { seedUsers } from "./seeds/seedUsers.js";

async function main() {
  const client = await createClient();
  try {
    await client.query("BEGIN");
    const result = await seedUsers(client);
    await client.query("COMMIT");
    console.log(`Usuarios de demostracion listos. Password: ${result.defaultPassword}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("No se pudieron preparar los usuarios de demostracion:", error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
