import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env.js";

// Middleware de proteccion para rutas privadas.
// Espera un header Authorization con formato: Bearer <token>.
export function requireAuth(req, res, next) {
  // Extrae el token del header; si no viene como Bearer, se trata como ausente.
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : null;

  if (!tok) {
    return res.status(401).json({ ok: false, mensaje: "Falta token" });
  }

  try {
    // Verifica la firma y expiracion del JWT usando la clave del entorno.
    const payload = jwt.verify(tok, JWT_SECRET);
    // Guarda el payload para que controladores y otros middlewares sepan
    // quien hace la peticion: { sub, username, rol, tabla }.
    req.user = payload; // { sub, username, rol }
    next();
  } catch {
    // Si el token esta vencido, mal firmado o corrupto, se rechaza la peticion.
    return res.status(401).json({ ok: false, mensaje: "Token inválido" });
  }
}
