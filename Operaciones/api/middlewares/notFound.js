// Middleware final para rutas no encontradas.
// Debe ir despues de todas las rutas registradas en Express.
export function notFound(req, res) {
  // Registra la ruta fallida y responde en JSON para mantener formato de API.
  console.log("❌ 404:", req.method, req.url);
  res.status(404).json({ ok: false, mensaje: "Ruta no existe", path: req.url });
}
