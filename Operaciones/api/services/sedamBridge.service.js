import net from "net";

/**
 * Bridge SEDAM: recibe las tramas de texto del sistema de enlace de datos (SEDAM) por TCP,
 * las interpreta y las reparte por Socket.IO a la app móvil y al dashboard.
 *
 * Trama (una por línea):  SESION[:]TIPO,campo1,campo2,...[:]TIPO,...
 *   OWNPOS,id,lat,lon,alt,rumbo,velocidad
 *   RADIOPOS,id,lat,lon,rumbo,velocidad,proveedor,fecha
 *   TRACKPOS,id_origen,serie,sidc,nombre,lat,lon,alt,rumbo,velocidad   (lat=0,lon=0 → borrar)
 *   ID_ALIAS,id,alias
 *   SESSION_OUT,id
 *
 * Modos (variables de entorno, ambos opcionales y combinables):
 *   SEDAM_BRIDGE_PORT  escucha en ese puerto: el cliente Bridge SEDAM se conecta a esta API (5908 en sedam movil).
 *   SEDAM_BRIDGE_HOST + SEDAM_BRIDGE_REMOTE_PORT  esta API se conecta al bridge y reintenta si se cae.
 *   SEDAM_BRIDGE_SESSION  si se define, solo se aceptan tramas de esa sesión.
 */

export const SEDAM_BRIDGE_EVENT = "sedam_bridge_event";
export const SEDAM_BRIDGE_SNAPSHOT = "sedam_bridge_snapshot";
export const SEDAM_BRIDGE_SUBSCRIBE = "sedam_bridge_subscribe";

const MAX_LINE_BYTES = 64 * 1024;
const RECONNECT_MS = 10_000;
const SESSION_OUT_GRACE_MS = 10_000;

const num = (value) => {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
};

/** Convierte un mensaje útil (sin sesión) en un evento normalizado, o null si no interesa. */
export function parseBridgeMessage(session, message) {
  const fields = String(message).trim().split(",");
  switch (fields[0]?.trim()) {
    case "OWNPOS": {
      const id = fields[1]?.trim();
      const lat = num(fields[2]);
      const lon = num(fields[3]);
      if (!id || lat === null || lon === null) return null;
      return { type: "unit", session, id, lat, lon, course: num(fields[5]), speed: num(fields[6]) };
    }
    case "RADIOPOS": {
      const id = fields[1]?.trim();
      const lat = num(fields[2]);
      const lon = num(fields[3]);
      if (!id || lat === null || lon === null) return null;
      return { type: "unit", session, id: `R${id}`, name: `Radio ${id}`, lat, lon, course: num(fields[4]), speed: num(fields[5]) };
    }
    case "TRACKPOS": {
      const unit = fields[1]?.trim();
      const serial = fields[2]?.trim();
      if (!unit || !serial) return null;
      const key = `T${unit}-${serial}`;
      const lat = num(fields[5]) ?? 0;
      const lon = num(fields[6]) ?? 0;
      if (lat === 0 && lon === 0) return { type: "gone", session, id: key };
      return {
        type: "unit", session, id: key, sidc: fields[3]?.trim() || null, name: fields[4]?.trim() || null,
        lat, lon, course: num(fields[8]), speed: num(fields[9]),
      };
    }
    case "ID_ALIAS": {
      const id = fields[1]?.trim();
      const alias = fields[2]?.trim();
      return id && alias ? { type: "alias", session, id, alias } : null;
    }
    case "SESSION_OUT": {
      const id = fields[1]?.trim();
      return id ? { type: "gone", session, id } : null;
    }
    default:
      return null;
  }
}

/** Una línea del bridge puede traer varios mensajes: "SESION[:]MSG[:]MSG...". */
export function parseBridgeLine(line) {
  if (!line.includes("[:]")) return [];
  const [session, ...messages] = line.split("[:]");
  return messages
    .filter((m) => m.length > 0)
    .map((m) => parseBridgeMessage(session.trim(), m))
    .filter(Boolean);
}

export function startSedamBridge({ io, env = process.env, log = console }) {
  const listenPort = Number(env.SEDAM_BRIDGE_PORT) || 0;
  const remoteHost = (env.SEDAM_BRIDGE_HOST || "").trim();
  const remotePort = Number(env.SEDAM_BRIDGE_REMOTE_PORT) || listenPort;
  const onlySession = (env.SEDAM_BRIDGE_SESSION || "").trim();

  if (!listenPort && !remoteHost) {
    log.log("[BRIDGE SEDAM] Deshabilitado (define SEDAM_BRIDGE_PORT o SEDAM_BRIDGE_HOST).");
    return null;
  }

  // Último estado por id, para entregarlo completo a quien se suscribe después.
  const units = new Map();
  const aliases = new Map();
  const goneTimers = new Map();

  const publish = (event) => {
    if (onlySession && event.session !== onlySession) return;
    if (event.type === "unit") {
      units.set(event.id, { ...units.get(event.id), ...event, receivedAt: Date.now() });
    } else if (event.type === "alias") {
      aliases.set(event.id, event.alias);
    } else if (event.type === "gone") {
      // SESSION_OUT: se da un margen antes de olvidar la unidad, como hace el dashboard.
      clearTimeout(goneTimers.get(event.id));
      goneTimers.set(event.id, setTimeout(() => {
        units.delete(event.id);
        goneTimers.delete(event.id);
      }, SESSION_OUT_GRACE_MS));
    }
    io.emit(SEDAM_BRIDGE_EVENT, event);
  };

  const attach = (socket, label) => {
    socket.setEncoding("utf8");
    let pending = "";
    socket.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r\n|\r|\n/);
      pending = lines.pop() ?? ""; // la última línea puede venir incompleta
      if (Buffer.byteLength(pending) > MAX_LINE_BYTES) pending = "";
      for (const line of lines) {
        if (line.length > MAX_LINE_BYTES) continue;
        try {
          parseBridgeLine(line).forEach(publish);
        } catch (err) {
          log.error("[BRIDGE SEDAM] Trama inválida:", err.message);
        }
      }
    });
    socket.on("error", (err) => log.error(`[BRIDGE SEDAM] ${label}: ${err.message}`));
    socket.on("close", () => log.log(`[BRIDGE SEDAM] ${label} desconectado`));
  };

  io.on("connection", (client) => {
    client.on(SEDAM_BRIDGE_SUBSCRIBE, () => {
      client.emit(SEDAM_BRIDGE_SNAPSHOT, {
        units: [...units.values()],
        aliases: Object.fromEntries(aliases),
      });
    });
  });

  let server = null;
  if (listenPort) {
    server = net.createServer((socket) => {
      log.log(`[BRIDGE SEDAM] Cliente conectado desde ${socket.remoteAddress}`);
      attach(socket, socket.remoteAddress);
    });
    server.on("error", (err) => log.error("[BRIDGE SEDAM] Error del servidor TCP:", err.message));
    server.listen(listenPort, "0.0.0.0", () => log.log(`[BRIDGE SEDAM] Escuchando en *:${listenPort}`));
  }

  let stopped = false;
  let outbound = null;
  const connectOut = () => {
    if (stopped) return;
    outbound = net.connect({ host: remoteHost, port: remotePort }, () => log.log(`[BRIDGE SEDAM] Conectado a ${remoteHost}:${remotePort}`));
    attach(outbound, `${remoteHost}:${remotePort}`);
    outbound.on("close", () => { if (!stopped) setTimeout(connectOut, RECONNECT_MS); });
  };
  if (remoteHost) connectOut();

  return {
    stop() {
      stopped = true;
      goneTimers.forEach(clearTimeout);
      server?.close();
      outbound?.destroy();
    },
  };
}
