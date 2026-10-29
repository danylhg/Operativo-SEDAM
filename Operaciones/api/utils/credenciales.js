import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";

// Vigencia del código de acceso que recibe una cuenta nueva o restablecida.
// Dentro de ese plazo la persona debe elegir su propia contraseña.
export const CODIGO_ACCESO_DIAS = 30;
export const PASSWORD_MIN_LENGTH = 8;

// Sin 0/O ni 1/I/L para que el código se pueda dictar o copiar sin errores.
const CODIGO_ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

let credencialesSchemaReady = null;

// Agrega las columnas de credencial temporal a las dos tablas que inician sesión.
// Las cuentas existentes quedan con debe_cambiar_password = FALSE y conservan
// la contraseña que ya tenían.
export function ensureCredencialesSchema() {
  if (!credencialesSchemaReady) {
    credencialesSchemaReady = pool.query(`
      ALTER TABLE personal
        ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS password_temporal_expira TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS password_actualizado TIMESTAMPTZ;

      ALTER TABLE usuario
        ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS password_temporal_expira TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS password_actualizado TIMESTAMPTZ;
    `).catch((err) => {
      credencialesSchemaReady = null;
      throw err;
    });
  }
  return credencialesSchemaReady;
}

// Código de acceso con formato XXXX-XXXX generado con aleatoriedad criptográfica.
export function generarCodigoAcceso() {
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CODIGO_ALFABETO[bytes[i] % CODIGO_ALFABETO.length];
    if (i === 3) code += "-";
  }
  return code;
}

// Devuelve el hash y la fecha de vencimiento de un código de acceso nuevo.
export async function prepararCodigoAcceso() {
  const codigo = generarCodigoAcceso();
  const password_hash = await bcrypt.hash(codigo, 10);
  const expira = new Date(Date.now() + CODIGO_ACCESO_DIAS * 24 * 60 * 60 * 1000);
  return { codigo, password_hash, expira };
}

export function codigoAccesoVencido(row, now = Date.now()) {
  if (!row?.debe_cambiar_password) return false;
  if (!row.password_temporal_expira) return true;
  return new Date(row.password_temporal_expira).getTime() <= now;
}

// Reglas mínimas para la contraseña definitiva elegida por la persona.
export function validarNuevaPassword(password) {
  const value = String(password ?? "");
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (value.length > 72) {
    return "La contraseña es demasiado larga (máximo 72 caracteres).";
  }
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(value) || !/\d/.test(value)) {
    return "La contraseña debe incluir letras y números.";
  }
  return "";
}
