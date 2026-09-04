import "dotenv/config";
import { createClient } from "./db/client.js";
import { seedUsers } from "./seeds/seedUsers.js";
import { seedDispositivos } from "./seeds/seedDispositivos.js";
import { seedOperation1 } from "./seeds/seedOperation1.js";
import { seedOperation2 } from "./seeds/seedOperation2.js";
import { seedOperation3 } from "./seeds/seedOperation3.js";
import { seedOperation4 } from "./seeds/seedOperation4.js";

async function main() {
  const client = await createClient();

  try {
    await client.query("BEGIN");

    const usersResult = await seedUsers(client);
    const op1Result = await seedOperation1(client);
    const op2Result = await seedOperation2(client);
    const op3Result = await seedOperation3(client);
    const op4Result = await seedOperation4(client);
    const dispositivosResult = await seedDispositivos(client);

    await client.query("COMMIT");

    console.log("Seed OK");
    console.log(`Operacion 1 creada/actualizada: ${op1Result.codigo} - ${op1Result.estado} (id=${op1Result.idOp}) CUT=cramirez grid=${op1Result.cuadricula}`);
    console.log(`Operacion 2 creada/actualizada: ${op2Result.codigo} - ${op2Result.estado} (id=${op2Result.idOp}) CUT=atorres grid=${op2Result.cuadricula}`);
    console.log(`Operacion 3 creada/actualizada: ${op3Result.codigo} - ${op3Result.estado} (id=${op3Result.idOp}) CUT=cramirez grid=${op3Result.cuadricula}`);
    console.log(`Operacion 4 creada/actualizada: ${op4Result.codigo} - ${op4Result.estado} (id=${op4Result.idOp}) CUT=atorres grid=${op4Result.cuadricula}`);
    console.log(`Dispositivos seed: ${dispositivosResult.insertados} creados, ${dispositivosResult.actualizados} actualizados, ${dispositivosResult.asignados} asignados, ${dispositivosResult.liberados} liberados (${dispositivosResult.total} definidos)`);
    console.log(`Password para usuarios seed: ${usersResult.defaultPassword}`);
    console.log(`Personal OP1: ${op1Result.personalAsignado}`);
    console.log(`Personal OP2: ${op2Result.personalAsignado}`);
    console.log(`Personal OP3: ${op3Result.personalAsignado}`);
    console.log(`Personal OP4: ${op4Result.personalAsignado}`);
    console.log(`Vehiculos fijos OP1: ${op1Result.vehiculosFijos}`);
    console.log(`Equipos fijos OP1:   ${op1Result.equiposFijos}`);
    console.log(`Vehiculos fijos OP2: ${op2Result.vehiculosFijos}`);
    console.log(`Equipos fijos OP2:   ${op2Result.equiposFijos}`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Seed fallo (detalle):", e);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
