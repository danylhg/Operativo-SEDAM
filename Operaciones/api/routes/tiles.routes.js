import { Router } from "express";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const router = Router();

// Paquete de mapas sin internet: storage/tiles/<capa>/<z>/<x>/<y>.(png|jpg)
// Capas: satellite (imagen), reference (etiquetas) y osm (calles, opcional).
const TILES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "storage", "tiles");
const LAYER_RE = /^[a-z0-9_-]{1,32}$/i;

// Cuántos niveles se puede ampliar una tesela del nivel inferior (4 = hasta 16x).
const MAX_OVERZOOM = 4;
const TILE_SIZE = 256;

// Caché automático: si el servidor SÍ tiene internet, las teselas que se miran y no están en el
// paquete se piden al proveedor, se guardan en disco y desde entonces funcionan sin internet.
// Sin internet no se intenta (interruptor de 60 s tras un fallo) para no hacer lento el mapa.
// Desactivar con TILE_PROXY=0 en el .env. Solo hasta zoom 17 (más arriba suele haber teselas vacías).
const TILE_PROXY = process.env.TILE_PROXY !== "0";
const PROXY_MAX_ZOOM = 17;
const PROXY_TIMEOUT_MS = 3000;
const PROXY_PAUSE_MS = 60_000;
const UPSTREAM = {
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  reference: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
};
let proxyPausedUntil = 0;
const proxyInflight = new Map();

async function fetchAndStore(layer, z, x, y) {
  const template = UPSTREAM[layer];
  if (!TILE_PROXY || !template || z > PROXY_MAX_ZOOM || Date.now() < proxyPausedUntil) return null;

  const key = `${layer}/${z}/${x}/${y}`;
  if (proxyInflight.has(key)) return proxyInflight.get(key);

  const job = (async () => {
    try {
      const url = template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
      const res = await fetch(url, {
        headers: { "User-Agent": "OperacionesTactico-TileCache/1.0" },
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get("content-type") || "";
      if (!type.startsWith("image/")) throw new Error(`tipo inesperado ${type}`);
      const body = Buffer.from(await res.arrayBuffer());
      const ext = /jpe?g/i.test(type) ? "jpg" : "png";
      const dir = join(TILES_ROOT, layer, String(z), String(x));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${y}.${ext}`), body);
      return { body, type: ext === "jpg" ? "image/jpeg" : "image/png" };
    } catch (err) {
      // Sin internet o proveedor caído: no insistir durante un minuto.
      proxyPausedUntil = Date.now() + PROXY_PAUSE_MS;
      return null;
    } finally {
      proxyInflight.delete(key);
    }
  })();
  proxyInflight.set(key, job);
  return job;
}

// Caché en memoria de teselas ampliadas (no se escriben a disco para no mezclarlas con las reales).
const OVERZOOM_CACHE_MAX = 600;
const overzoomCache = new Map();

function findTile(layer, z, x, y) {
  for (const ext of ["png", "jpg"]) {
    const file = join(TILES_ROOT, layer, String(z), String(x), `${y}.${ext}`);
    if (existsSync(file)) return { file, ext };
  }
  return null;
}

// Genera la tesela (z,x,y) recortando y ampliando la del ancestro más cercano que exista.
async function overzoomTile(layer, z, x, y) {
  for (let k = 1; k <= MAX_OVERZOOM && z - k >= 0; k++) {
    const ancestor = findTile(layer, z - k, x >> k, y >> k);
    if (!ancestor) continue;

    const span = TILE_SIZE >> k; // lado, en píxeles del ancestro, que cubre la tesela pedida
    const left = (x - ((x >> k) << k)) * span;
    const top = (y - ((y >> k) << k)) * span;
    const base = sharp(ancestor.file).extract({ left, top, width: span, height: span })
      .resize(TILE_SIZE, TILE_SIZE, { kernel: "cubic" });
    const jpeg = ancestor.ext === "jpg";
    const body = await (jpeg ? base.jpeg({ quality: 88 }) : base.png()).toBuffer();
    return { body, type: jpeg ? "image/jpeg" : "image/png" };
  }
  return null;
}

// Indica qué capas y niveles de zoom hay instalados.
router.get("/tiles/info", (_req, res) => {
  const layers = {};
  if (existsSync(TILES_ROOT)) {
    for (const layer of readdirSync(TILES_ROOT, { withFileTypes: true })) {
      if (!layer.isDirectory() || !LAYER_RE.test(layer.name)) continue;
      const zooms = readdirSync(join(TILES_ROOT, layer.name))
        .map(Number)
        .filter(Number.isInteger)
        .sort((a, b) => a - b);
      if (zooms.length) layers[layer.name] = { minZoom: zooms[0], maxZoom: zooms[zooms.length - 1] };
    }
  }
  res.json({ ok: true, layers });
});

router.get("/tiles/:layer/:z/:x/:y.:ext", async (req, res) => {
  const { layer, ext } = req.params;
  const [z, x, y] = [req.params.z, req.params.x, req.params.y].map(Number);
  if (!LAYER_RE.test(layer) || ![req.params.z, req.params.x, req.params.y].every((v) => /^\d{1,8}$/.test(v)) || !["png", "jpg"].includes(ext)) {
    return res.status(400).end();
  }

  // Acepta png o jpg en disco sin importar la extensión pedida.
  const real = findTile(layer, z, x, y);
  if (real) {
    res.set("Cache-Control", "public, max-age=604800");
    return res.sendFile(real.file);
  }

  // No está en el paquete: si hay internet se descarga y se guarda para la próxima vez.
  const fetched = await fetchAndStore(layer, z, x, y);
  if (fetched) {
    res.set("Cache-Control", "public, max-age=604800");
    return res.type(fetched.type).send(fetched.body);
  }

  // Sin internet: se amplía la del nivel inferior para que nunca queden huecos al acercarse.
  const key = `${layer}/${z}/${x}/${y}`;
  try {
    let hit = overzoomCache.get(key);
    if (!hit) {
      hit = await overzoomTile(layer, z, x, y);
      if (hit) {
        overzoomCache.set(key, hit);
        if (overzoomCache.size > OVERZOOM_CACHE_MAX) overzoomCache.delete(overzoomCache.keys().next().value);
      }
    }
    if (hit) {
      res.set("Cache-Control", "public, max-age=3600");
      return res.type(hit.type).send(hit.body);
    }
  } catch (err) {
    console.warn("[TILES] No se pudo ampliar", key, err.message);
  }

  // Fuera de la cobertura: 404, y el visor deja ver el mapa mundial local de debajo.
  res.set("Cache-Control", "public, max-age=60");
  return res.status(404).end();
});

export default router;
