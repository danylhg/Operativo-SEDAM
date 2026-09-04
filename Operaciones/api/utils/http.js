// Respuesta JSON uniforme para errores HTTP controlados.
export function sendError(res, status, mensaje, extra = {}) {
  return res.status(status).json({ ok: false, mensaje, ...extra });
}
