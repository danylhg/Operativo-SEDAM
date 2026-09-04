// Valida ids numericos positivos usados en parametros de rutas y queries.
export function isInt(n) {
  return Number.isInteger(n) && n > 0;
}
