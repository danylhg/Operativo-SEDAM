import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resuelve el archivo .env ubicado en la raiz de Operaciones/api,
// sin depender del directorio desde donde se arranque Node.
const configDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(configDir, "..");
const envPath = resolve(apiRoot, ".env");

// Carga las variables de entorno antes de exportar la configuracion.
config({ path: envPath });

// Lee una variable obligatoria y falla temprano si no existe o esta vacia.
function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Falta configurar la variable de entorno ${name}`);
  }

  return value;
}

// Clave usada para firmar y verificar tokens JWT.
export const JWT_SECRET = requireEnv("JWT_SECRET");

// Puerto HTTP del API. Si no se define PORT, usa 3001 para desarrollo local.
export const PORT = Number(process.env.PORT || 3001);

// Intervalo del revisor que activa automaticamente operaciones planificadas.
const parsedAutoActivationInterval = Number(process.env.OPERATION_AUTO_ACTIVATION_INTERVAL_MS);
export const OPERATION_AUTO_ACTIVATION_INTERVAL_MS =
  Number.isFinite(parsedAutoActivationInterval) && parsedAutoActivationInterval > 0
    ? parsedAutoActivationInterval
    : 15000;

// Configuracion compartida de PostgreSQL.
export const PGHOST = requireEnv("PGHOST");
export const PGPORT = Number(process.env.PGPORT || 5432);
export const PGUSER = requireEnv("PGUSER");
export const PGPASSWORD = requireEnv("PGPASSWORD");
export const PGDATABASE = requireEnv("PGDATABASE");

export const DB_CONFIG = {
  host: PGHOST,
  port: PGPORT,
  user: PGUSER,
  password: PGPASSWORD,
  database: PGDATABASE,
};

// Token de Cesium usado por los clientes que consumen mapas/visualizacion.
export const CESIUM_TOKEN = requireEnv("CESIUM_TOKEN");

export const WEBRTC_ICE_SERVERS = (() => {
  const raw = process.env.WEBRTC_ICE_SERVERS?.trim();
  if (!raw) return [{ urls: "stun:stun.l.google.com:19302" }];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [{ urls: raw }];
  } catch {
    return raw
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean)
      .map((url) => ({ urls: url }));
  }
})();

const configuredMediaStreamProtocol = String(process.env.MEDIA_STREAM_DEFAULT_PROTOCOL || "WEBRTC")
  .trim()
  .toUpperCase();
export const MEDIA_STREAM_DEFAULT_PROTOCOL = ["WEBRTC", "RTMP", "HYBRID"].includes(configuredMediaStreamProtocol)
  ? configuredMediaStreamProtocol
  : "WEBRTC";

export const RTMP_PUBLISH_BASE_URL = process.env.RTMP_PUBLISH_BASE_URL?.trim() || "rtmp://localhost/live";
export const RTMP_PLAYBACK_BASE_URL = process.env.RTMP_PLAYBACK_BASE_URL?.trim() || "";
