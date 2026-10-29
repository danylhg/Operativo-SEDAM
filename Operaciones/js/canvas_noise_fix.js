// Algunos navegadores (Firefox con protección contra rastreo, Brave, LibreWolf; comunes en Linux)
// alteran a propósito unos cuantos valores de color al leer un canvas con getImageData. Cesium
// lee así cada letra para formar TODAS las etiquetas del mapa (cuadrícula, rosa de viento, nombres
// de unidades SEDAM, rutas...), y ese ruido sale como puntitos alrededor del texto.
// Los valores casi en 0 o casi en 255 se regresan a 0 / 255. Se aplica siempre, aunque la prueba
// no detecte ruido (hay navegadores que solo lo meten en algunos canvas): en un navegador normal
// solo cambia bordes de menos del 3 % de opacidad, que no se notan.
(function () {
  const SNAP = 6;

  function readsWithNoise() {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 16, 32); // mitad blanca opaca, mitad transparente
      const data = ctx.getImageData(0, 0, 32, 32).data;
      for (let i = 0; i < data.length; i += 4) {
        const x = (i / 4) % 32;
        const expected = x < 16 ? 255 : 0;
        if (data[i] !== expected || data[i + 1] !== expected || data[i + 2] !== expected || data[i + 3] !== expected) {
          return true;
        }
      }
    } catch (err) {
      // Sin canvas no hay nada que corregir.
    }
    return false;
  }

  if (!window.CanvasRenderingContext2D) return;
  const noisy = readsWithNoise();

  const original = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (...args) {
    const image = original.apply(this, args);
    const data = image.data;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v <= SNAP) data[i] = 0;
      else if (v >= 255 - SNAP) data[i] = 255;
    }
    return image;
  };
  window.CANVAS_NOISE_FIXED = true;
  console.info(noisy
    ? "[MAPA] El navegador altera la lectura de canvas; se corrige para las etiquetas."
    : "[MAPA] Lectura de canvas limpia; corrección de etiquetas activa por si acaso.");
})();
