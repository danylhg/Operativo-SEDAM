import { sendError } from "../utils/http.js";
import { sendDbError } from "../utils/dbErrors.js";

// Maneja el error que genera express.json cuando el body supera el limite.
// Debe registrarse despues del parser JSON para recibir este tipo de error.
export function payloadTooLarge(err, _req, res, next) {
  if (err.type === "entity.too.large") {
    return sendError(res, 413, "El cuerpo de la petición supera el límite permitido (10 MB).");
  }
  // Si no es este caso, deja que el siguiente middleware de error lo procese.
  next(err);
}

// Maneja JSON mal formado antes de que llegue a los controladores.
export function malformedJson(err, _req, res, next) {
  if (err.type === "entity.parse.failed") {
    return sendError(res, 400, "JSON inválido. Revisa la sintaxis del cuerpo enviado.", {
      detalle: err.message,
    });
  }
  // Otros errores se delegan para no ocultar informacion util de diagnostico.
  next(err);
}

// Ultimo middleware de errores: captura cualquier excepcion no manejada.
export function unhandledError(err, _req, res, _next) {
  // Se conserva el log en servidor y se responde con formato uniforme.
  console.error("[UNHANDLED ERROR]", err);
  return sendDbError(res, err, "Error interno no controlado");
}
