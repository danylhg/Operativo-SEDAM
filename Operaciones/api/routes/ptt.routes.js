import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middlewares/auth.js";
import { sendDbError } from "../utils/dbErrors.js";

const router = Router();

const MAC_ADDRESS = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

async function ensurePttAssignmentsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ptt_assignment (
      id_ptt_assignment BIGSERIAL PRIMARY KEY,
      owner_table VARCHAR(20) NOT NULL CHECK (owner_table IN ('usuario', 'personal')),
      owner_id INTEGER NOT NULL,
      bluetooth_address VARCHAR(17) NOT NULL UNIQUE,
      advertised_name VARCHAR(100),
      alias VARCHAR(100) NOT NULL DEFAULT 'PTT',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (owner_table, owner_id)
    )
  `);
}

router.post("/ptt/assignments", requireAuth, async (req, res) => {
  const bluetoothAddress = String(req.body?.bluetooth_address || "").trim().toUpperCase();
  const advertisedName = String(req.body?.advertised_name || "PTT").trim().slice(0, 100) || "PTT";
  const ownerTable = req.user?.tabla === "personal" ? "personal" : "usuario";
  const ownerId = Number(req.user?.sub);

  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    return res.status(401).json({ ok: false, mensaje: "Usuario no valido" });
  }
  if (!MAC_ADDRESS.test(bluetoothAddress)) {
    return res.status(400).json({ ok: false, mensaje: "Direccion Bluetooth no valida" });
  }

  try {
    await ensurePttAssignmentsSchema();
    const alias = advertisedName.toUpperCase().startsWith("PTT") ? advertisedName : "PTT";
    const { rows } = await pool.query(
      `INSERT INTO ptt_assignment
         (owner_table, owner_id, bluetooth_address, advertised_name, alias)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (owner_table, owner_id) DO UPDATE SET
         bluetooth_address = EXCLUDED.bluetooth_address,
         advertised_name = EXCLUDED.advertised_name,
         alias = EXCLUDED.alias,
         updated_at = NOW()
       RETURNING id_ptt_assignment, owner_table, owner_id,
                 bluetooth_address, advertised_name, alias, updated_at`,
      [ownerTable, ownerId, bluetoothAddress, advertisedName, alias]
    );
    return res.json({ ok: true, item: rows[0] });
  } catch (error) {
    if (error?.code === "23505") {
      return res.status(409).json({ ok: false, mensaje: "Ese PTT ya esta asignado a otro usuario" });
    }
    return sendDbError(res, error, "No se pudo asignar el PTT");
  }
});

export default router;
