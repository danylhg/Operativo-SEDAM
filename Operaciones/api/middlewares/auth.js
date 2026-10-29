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

// Restringe una ruta a ciertos roles. Va después de requireAuth.
// Ej.: router.post("/catalog/x", requireAuth, requireRole("ADMIN"), handler)
export function requireRole(...roles) {
  const allowed = new Set(roles.map((r) => String(r).toUpperCase()));
  return (req, res, next) => {
    const rol = String(req.user?.rol || "").toUpperCase();
    if (!allowed.has(rol)) {
      return res.status(403).json({ ok: false, mensaje: "No tienes permisos para esta acción." });
    }
    next();
  };
}
