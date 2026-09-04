const httpRequestLoggingEnabled =
  String(process.env.LOG_HTTP_REQUESTS || "").toLowerCase() === "true";

// La bitácora por petición se habilita solo para diagnóstico.
// Los sondeos frecuentes pueden bloquear Node si la salida deja de consumirse.
export function requestLogger(req, res, next) {
  if (httpRequestLoggingEnabled) {
    console.log("HTTP", req.method, req.url);
  }
  next();
}
