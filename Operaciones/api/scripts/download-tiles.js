// Descarga un paquete de mapas para usar SIN internet.
// Uso (una sola vez, en una máquina con internet):
//   node scripts/download-tiles.js --bbox=-103.60,25.40,-103.30,25.65 --zoom=8-16 --layer=satellite
//   node scripts/download-tiles.js --bbox=... --zoom=8-16 --layer=satellite --url="https://.../{z}/{y}/{x}"
//   node scripts/download-tiles.js --bbox=... --layer=reference
// bbox = oeste,sur,este,norte. Los archivos quedan en storage/tiles/<capa>/<z>/<x>/<y>.png
//
// IMPORTANTE: respeta los términos de uso del proveedor. Los servidores públicos de OSM/Esri
// limitan la descarga masiva; por eso hay un tope de teselas (--max) y una pausa entre
// peticiones. Para áreas grandes usa tu propio servidor de teselas o un paquete con licencia
// (MOBAC, QGIS, MBTiles exportado) y copia los archivos a storage/tiles.
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split(/=(.*)/s).slice(0, 2))
);

const DEFAULT_URLS = {
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  reference: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
};

const layer = args.layer || "osm";
// OSM (tile.openstreetmap.org) bloquea la descarga masiva y devuelve una imagen "Access blocked".
// Para la capa osm usa tu propio servidor de teselas con --url.
const template = args.url || DEFAULT_URLS[layer];
const bbox = (args.bbox || "").split(",").map(Number);
const [zMin, zMax] = (args.zoom || "8-15").split("-").map(Number);
const maxTiles = Number(args.max || 20000);
const delayMs = Number(args.delay || 120);

if (!template || bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n)) || !Number.isInteger(zMin) || !Number.isInteger(zMax)) {
  console.error("Uso: node scripts/download-tiles.js --bbox=oeste,sur,este,norte --zoom=8-15 --layer=osm|satellite|reference [--url=...] [--max=20000] [--delay=120]");
  process.exit(1);
}

const [west, south, east, north] = bbox;
const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z);
};

const jobs = [];
for (let z = zMin; z <= zMax; z++) {
  const n = 2 ** z - 1;
  const x0 = Math.max(0, lonToX(west, z)), x1 = Math.min(n, lonToX(east, z));
  const y0 = Math.max(0, latToY(north, z)), y1 = Math.min(n, latToY(south, z));
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push({ z, x, y });
}

console.log(`Capa ${layer}: ${jobs.length} teselas (~${Math.round(jobs.length * 25 / 1024)} MB estimados)`);
if (jobs.length > maxTiles) {
  console.error(`Excede el tope de ${maxTiles}. Reduce el área/zoom o sube --max bajo tu responsabilidad.`);
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "storage", "tiles", layer);
let done = 0, failed = 0;

for (const { z, x, y } of jobs) {
  const base = join(root, String(z), String(x), String(y));
  if (!existsSync(base + ".png") && !existsSync(base + ".jpg")) {
    const url = template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    try {
      const res = await fetch(url, { headers: { "User-Agent": "OperacionesTactico-OfflinePack/1.0" }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file = base + (/jpe?g/i.test(res.headers.get("content-type") || "") ? ".jpg" : ".png");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      failed++;
      console.warn(`  fallo ${z}/${x}/${y}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  if (++done % 200 === 0) console.log(`  ${done}/${jobs.length}`);
}
console.log(`Listo. ${done - failed} ok, ${failed} con error. Carpeta: ${root}`);
