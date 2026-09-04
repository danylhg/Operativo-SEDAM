// Traducciones de codigos PostgreSQL comunes a mensajes entendibles para API.
const PG_ERROR_MSGS = {
  "23505": "Registro duplicado: ya existe un dato con ese valor único.",
  "23503": "No se puede completar: el registro está referenciado por otro dato.",
  "23502": "Falta un dato obligatorio en la base de datos.",
  "22P02": "Formato de dato inválido.",
  "22001": "El texto enviado es demasiado largo para el campo.",
  "22003": "El número está fuera del rango permitido.",
  "23514": "El valor no cumple con una regla de validación de la base de datos.",
};

// Responde errores de base de datos con formato JSON uniforme.
export function sendDbError(res, err, fallbackMsg = "Error interno en base de datos") {
  // Si el codigo PostgreSQL es conocido, devuelve una respuesta especifica.
  const msg = PG_ERROR_MSGS[err.code];
  if (msg) {
    // Violaciones de FK suelen ser conflicto; otras reglas se tratan como 422.
    const status = err.code === "23503" ? 409 : 422;
    return res.status(status).json({
      ok: false,
      mensaje: msg,
      detalle: err.detail || err.message,
      pg_code: err.code,
    });
  }

  // Errores no catalogados se registran en servidor para diagnostico.
  console.error("[DB ERROR]", err);

  // Respuesta generica para no filtrar detalles internos innecesarios.
  return res.status(500).json({
    ok: false,
    mensaje: fallbackMsg,
    error: err.message,
  });
}
