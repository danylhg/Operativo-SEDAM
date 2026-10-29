import fs from "fs";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import { connectSedamSocket } from "./sedamSocket.service.js";

/**
 * Bridge SEDAM: recibe las tramas de texto del sistema de enlace de datos (SEDAM) por TCP
 * o por el socket de SEDAM Móvil, las interpreta y las reparte por Socket.IO a la app móvil y al dashboard.
 * Esta API solo escucha: nunca escribe tramas en la red SEDAM.
 *
 * Trama:  SESION[:]TIPO,campo1,campo2,...[:]TIPO,...
 *   OWNPOS,id,lat,lon,alt,rumbo,velocidad
 *   RADIOPOS,id,lat,lon,rumbo,velocidad,proveedor,fecha
 *   TRACKPOS,id_origen,serie,sidc,nombre,lat,lon,alt,rumbo,velocidad   (lat=0,lon=0 → borrar)
 *   WAYPOINTPOS,id_waypoint,id_dueño,sidc,nombre,lat,lon,alt   (sidc=REMOVE → borrar)
 *   ID_ALIAS,id,alias
 *   MSGTXT,de,para,texto   (para=ALL → general)
 *   MSGGEOCHAT,de,lat,lon,texto
 *   MSGPANIC,id,ON|OFF
 *   SESSION_OUT,id
 *
 * Modos (variables de entorno, todos opcionales y combinables):
 *   SEDAM_BRIDGE_PORT  escucha en ese puerto: el cliente Bridge SEDAM se conecta a esta API (5908 en sedam movil).
 *   SEDAM_BRIDGE_HOST + SEDAM_BRIDGE_REMOTE_PORT  esta API se conecta a ese puerto y reintenta si se cae.
 *     No usarlo contra el 5908 de un servidor SEDAM Móvil: ese puerto espera al Bridge, nos registra
 *     como tal y deja de reenviar entre celulares lo que transmiten.
 *   SEDAM_SOCKET_URL + SEDAM_SOCKET_SERIAL  esta API entra al Socket.IO cifrado de SEDAM Móvil (puerto 3000)
 *     como un dispositivo más y recibe lo mismo que los celulares, sin depender de que el Bridge apunte aquí.
 *     El servidor la anuncia con SESSION_IN de esa serie: usar una serie propia, no la de un celular.
 *     SEDAM_SOCKET_CA  certificado del servidor (por defecto data/sedam_ca.pem);
 *     SEDAM_SOCKET_INSECURE=1 acepta cualquier certificado.
 *   SEDAM_BRIDGE_SESSION  si se define, solo se aceptan tramas de esa sesión.
 *   SEDAM_UNITS_FILE  catálogo id → { sidc, name } (por defecto data/sedam_units.json).
 *   SEDAM_STATE_FILE  último estado recibido (por defecto storage/sedam/estado.json; vacío = no guardar).
 *     SEDAM no repite los waypoints: sin este archivo, al reiniciar la API se perderían hasta que
 *     su dueño los vuelva a mandar.
 */

export const SEDAM_BRIDGE_EVENT = "sedam_bridge_event";
export const SEDAM_BRIDGE_SNAPSHOT = "sedam_bridge_snapshot";
export const SEDAM_BRIDGE_SUBSCRIBE = "sedam_bridge_subscribe";
export const SEDAM_BRIDGE_STATUS = "sedam_bridge_status";
// El operador borra de su mapa un blanco/waypoint de otro equipo: se ignora aunque lo sigan mandando.
export const SEDAM_BRIDGE_HIDE = "sedam_bridge_hide";

const MAX_TOKEN_BYTES = 64 * 1024;
const RECONNECT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 5_000;
const SESSION_OUT_GRACE_MS = 10_000;
const PARTIAL_FLUSH_MS = 300;
const STATE_SAVE_MS = 10_000;
const MAX_MESSAGES = 200;
const MAX_HIDDEN = 2_000;
const MAX_SESSION_LENGTH = 80;
const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Tipos de la red SEDAM (los que se interpretan y los que solo sirven para separar tramas pegadas).
const MESSAGE_TYPES = [
  "OWNPOS", "RADIOPOS", "TRACKPOS", "WAYPOINTPOS", "ID_ALIAS", "MSGTXT", "MSGGEOCHAT", "MSGPANIC",
  "SESSION_IN", "SESSION_OUT", "MSGAUDIO", "MSGIMAGE", "MSGMEDEVAC", "DRAWING", "OPGRID", "NAVROUTE",
];
const MESSAGE_TYPE_SET = new Set(MESSAGE_TYPES);
const TYPE_BOUNDARY = new RegExp(`(?=(?:${MESSAGE_TYPES.join("|")}),)`);

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
      if (lat === 0 && lon === 0) return { type: "gone", session, id: key, owner: unit };
      return {
        type: "unit", session, id: key, owner: unit, sidc: fields[3]?.trim() || null, name: fields[4]?.trim() || null,
        lat, lon, course: num(fields[8]), speed: num(fields[9]),
      };
    }
    case "WAYPOINTPOS": {
      // Igual que la app y la web de SEDAM: primero el id del waypoint y después el del dueño.
      const waypoint = fields[1]?.trim();
      const owner = fields[2]?.trim();
      if (!waypoint || !owner) return null;
      const key = `W${owner}-${waypoint}`;
      if (fields[3]?.trim().toUpperCase() === "REMOVE") return { type: "gone", session, id: key, owner };
      const lat = num(fields[5]);
      const lon = num(fields[6]);
      if (lat === null || lon === null) return null;
      if (lat === 0 && lon === 0) return { type: "gone", session, id: key, owner };
      return { type: "unit", session, id: key, owner, sidc: fields[3]?.trim() || null, name: fields[4]?.trim() || null, lat, lon, course: null, speed: null };
    }
    case "ID_ALIAS": {
      const id = fields[1]?.trim();
      const alias = fields[2]?.trim();
      return id && alias ? { type: "alias", session, id, alias } : null;
    }
    case "MSGTXT": {
      const from = fields[1]?.trim();
      const to = fields[2]?.trim();
      const text = fields.slice(3).join(",").trim();
      return from && text ? { type: "message", session, from, to: to || "ALL", text } : null;
    }
    case "MSGGEOCHAT": {
      const from = fields[1]?.trim();
      const lat = num(fields[2]);
      const lon = num(fields[3]);
      // El emisor cambia las comas del texto por ";" para no romper la trama.
      const text = fields.slice(4).join(",").replace(/;/g, ",").trim();
      if (!from || lat === null || lon === null || !text) return null;
      return { type: "geochat", session, from, lat, lon, text };
    }
    case "MSGPANIC": {
      const id = fields[1]?.trim();
      const state = fields[2]?.trim().toUpperCase();
      if (!id || (state !== "ON" && state !== "OFF")) return null;
      return { type: "panic", session, id, active: state === "ON" };
    }
    case "SESSION_OUT": {
      const id = fields[1]?.trim();
      return id ? { type: "gone", session, id, grace: true } : null;
    }
    default:
      return null;
  }
}

/**
 * Lector de tramas por conexión. El Bridge manda una trama por línea ("SESION[:]MSG[:]MSG"), pero el
 * 5908 del servidor SEDAM Móvil reenvía las de los dispositivos pegadas y sin salto de línea
 * ("[:]SESION[:]OWNPOS,...[:]SESION[:]TRACKPOS,..."). Se corta en saltos de línea, en "[:]" y antes
 * de cada tipo conocido; lo que no es un mensaje se toma como la sesión de los que siguen.
 */
export function createFrameReader(onEvent) {
  let pending = "";
  let session = "";

  const handleToken = (raw) => {
    for (const piece of raw.split(TYPE_BOUNDARY)) {
      let token = piece.trim();
      // SEDAM manda algunas tramas sin el "[:]" inicial ("SESION[:]SESSION_OUT,id"): la sesión
      // queda pegada al final del mensaje anterior y se le quita.
      if (session && token.length > session.length && token.endsWith(session)) {
        token = token.slice(0, -session.length).trim();
      }
      if (!token) continue;
      if (MESSAGE_TYPE_SET.has(token.split(",")[0])) {
        const event = parseBridgeMessage(session, token);
        if (event) onEvent(event);
      } else if (token.length <= MAX_SESSION_LENGTH && !token.includes(",")) {
        session = token;
      }
    }
  };

  return {
    /** Procesa lo recibido; el último fragmento se guarda por si viene incompleto. */
    push(chunk) {
      const tokens = (pending + chunk).split(/\[:\]|\r\n|\r|\n/);
      pending = tokens.pop() ?? "";
      // Un fragmento enorme (audio o imagen en base64) no interesa: se descarta.
      if (Buffer.byteLength(pending) > MAX_TOKEN_BYTES) pending = "";
      tokens.forEach(handleToken);
      return pending.length > 0;
    },
    /** Procesa lo pendiente cuando ya no llega más (tramas sin terminador). */
    flush() {
      const token = pending;
      pending = "";
      handleToken(token);
    },
  };
}

/** Atajo para una línea completa. */
export function parseBridgeLine(line) {
  const events = [];
  const reader = createFrameReader((event) => events.push(event));
  reader.push(line);
  reader.flush();
  return events;
}

/**
 * Copia de lo que llega de SEDAM, para revisar después las tramas reales (la red del KU no tiene
 * internet y ahí no se puede depurar). Se deja de escribir al llegar al límite; borrar el archivo
 * para volver a capturar.
 */
function createCapture(file, maxBytes, log) {
  if (!file || !maxBytes) return () => {};
  let size = 0;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  } catch (err) {
    log.warn(`[BRIDGE SEDAM] Sin captura (${file}): ${err.message}`);
    return () => {};
  }
  return (origin, text) => {
    if (size >= maxBytes) return;
    const line = `${new Date().toISOString()} ${origin} ${String(text).slice(0, 2000).replace(/\r?\n/g, "\\n")}\n`;
    size += Buffer.byteLength(line);
    fs.appendFile(file, line, () => {});
  };
}

/** Catálogo id → { sidc, name } de las unidades de la red (el mismo que usa la app). */
function loadUnitCatalog(file, log) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    log.warn(`[BRIDGE SEDAM] Sin catálogo de unidades (${file}): ${err.message}`);
    return {};
  }
}

export function startSedamBridge({ io, env = process.env, log = console }) {
  const listenPort = Number(env.SEDAM_BRIDGE_PORT) || 0;
  const remoteHost = (env.SEDAM_BRIDGE_HOST || "").trim();
  const remotePort = Number(env.SEDAM_BRIDGE_REMOTE_PORT) || listenPort;
  const onlySession = (env.SEDAM_BRIDGE_SESSION || "").trim();
  const socketUrl = (env.SEDAM_SOCKET_URL || "").trim().replace(/\/+$/, "");
  // Igual que la app y el sistema web: la serie se envía en mayúsculas.
  const socketSerial = (env.SEDAM_SOCKET_SERIAL || "").trim().toUpperCase();

  if (!listenPort && !remoteHost && !(socketUrl && socketSerial)) {
    log.log("[BRIDGE SEDAM] Deshabilitado (define SEDAM_BRIDGE_PORT, SEDAM_BRIDGE_HOST o SEDAM_SOCKET_URL + SEDAM_SOCKET_SERIAL).");
    return null;
  }

  const catalog = loadUnitCatalog(path.resolve(API_DIR, env.SEDAM_UNITS_FILE || "data/sedam_units.json"), log);
  const capture = createCapture(
    path.resolve(API_DIR, env.SEDAM_CAPTURE_FILE ?? "storage/sedam/captura.log"),
    Number(env.SEDAM_CAPTURE_MAX_MB ?? 20) * 1024 * 1024,
    log,
  );

  // Último estado por id, para entregarlo completo a quien se suscribe después.
  const units = new Map();
  const aliases = new Map();
  const panics = new Set();
  const messages = [];
  const goneTimers = new Map();
  const hidden = new Set(); // ids de blancos/waypoints ajenos que el operador borró

  const stateSetting = env.SEDAM_STATE_FILE ?? "storage/sedam/estado.json";
  const stateFile = stateSetting ? path.resolve(API_DIR, stateSetting) : null;
  let stateDirty = false;
  if (stateFile) {
    try {
      const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      (saved.units || []).forEach((unit) => units.set(unit.id, unit));
      Object.entries(saved.aliases || {}).forEach(([id, alias]) => aliases.set(id, alias));
      (saved.messages || []).slice(-MAX_MESSAGES).forEach((msg) => messages.push(msg));
      (saved.hidden || []).forEach((id) => hidden.add(id));
      hidden.forEach((id) => units.delete(id));
      log.log(`[BRIDGE SEDAM] Estado anterior cargado: ${units.size} unidades/objetos, ${aliases.size} alias.`);
    } catch (err) {
      if (err.code !== "ENOENT") log.warn(`[BRIDGE SEDAM] No se pudo leer ${stateFile}: ${err.message}`);
    }
  }
  const saveState = () => {
    if (!stateFile || !stateDirty) return;
    stateDirty = false;
    const data = JSON.stringify({ units: [...units.values()], aliases: Object.fromEntries(aliases), messages, hidden: [...hidden] });
    fs.mkdir(path.dirname(stateFile), { recursive: true }, () => {
      fs.writeFile(`${stateFile}.tmp`, data, (err) => {
        if (err) return log.warn(`[BRIDGE SEDAM] No se pudo guardar el estado: ${err.message}`);
        fs.rename(`${stateFile}.tmp`, stateFile, () => {});
      });
    });
  };
  const saveTimer = stateFile ? setInterval(saveState, STATE_SAVE_MS) : null;

  // Estado de las conexiones, para que el dashboard muestre por qué no llegan unidades.
  const status = {
    remote: remoteHost ? { target: `${remoteHost}:${remotePort}`, connected: false, error: null } : null,
    socket: socketUrl && socketSerial ? { target: socketUrl, serial: socketSerial, connected: false, online: false, error: null } : null,
    listenPort: listenPort || null,
    bridgeClients: 0,
    lastFrameAt: null,
  };
  const emitStatus = () => io.emit(SEDAM_BRIDGE_STATUS, status);

  const forget = (id) => {
    clearTimeout(goneTimers.get(id));
    goneTimers.delete(id);
    units.delete(id);
    stateDirty = true;
  };

  const publish = (event) => {
    if (onlySession && event.session !== onlySession) return;
    // Con el Bridge conectado, SEDAM nos regresa nuestros propios waypoints y blancos: ya están en el mapa.
    if (event.owner && event.owner === sedamSocket?.identity()?.id) return;
    if (hidden.has(event.id)) return;
    status.lastFrameAt = Date.now();
    if (event.type !== "gone") stateDirty = true;
    if (event.type === "unit") {
      const entry = catalog[event.id];
      if (entry) {
        event.sidc = event.sidc || entry.sidc;
        event.name = event.name || entry.name;
      }
      clearTimeout(goneTimers.get(event.id));
      goneTimers.delete(event.id);
      units.set(event.id, { ...units.get(event.id), ...event, receivedAt: Date.now() });
    } else if (event.type === "alias") {
      aliases.set(event.id, event.alias);
    } else if (event.type === "panic") {
      if (event.active) panics.add(event.id);
      else panics.delete(event.id);
    } else if (event.type === "message" || event.type === "geochat") {
      event.ts = Date.now();
      messages.push(event);
      if (messages.length > MAX_MESSAGES) messages.shift();
    } else if (event.type === "gone") {
      if (event.grace) {
        // SESSION_OUT: se da un margen antes de olvidar la unidad, como hace el dashboard.
        clearTimeout(goneTimers.get(event.id));
        goneTimers.set(event.id, setTimeout(() => forget(event.id), SESSION_OUT_GRACE_MS));
      } else {
        forget(event.id);
      }
    }
    io.emit(SEDAM_BRIDGE_EVENT, event);
  };

  const attach = (socket, label) => {
    socket.setEncoding("utf8");
    const reader = createFrameReader(publish);
    let flushTimer = null;
    socket.on("data", (chunk) => {
      capture(`tcp:${label}`, chunk);
      clearTimeout(flushTimer);
      try {
        if (reader.push(chunk)) flushTimer = setTimeout(() => reader.flush(), PARTIAL_FLUSH_MS);
      } catch (err) {
        log.error("[BRIDGE SEDAM] Trama inválida:", err.message);
      }
    });
    socket.on("close", () => {
      clearTimeout(flushTimer);
      // Un intento que nunca conectó no tiene dirección remota: no se anuncia en cada reintento.
      if (socket.remoteAddress) log.log(`[BRIDGE SEDAM] ${label} desconectado`);
    });
  };

  io.on("connection", (client) => {
    client.on(SEDAM_BRIDGE_SUBSCRIBE, () => {
      client.emit(SEDAM_BRIDGE_SNAPSHOT, {
        units: [...units.values()],
        aliases: Object.fromEntries(aliases),
        panics: [...panics],
        messages,
        status,
      });
    });
    client.on(SEDAM_BRIDGE_HIDE, (payload) => {
      const id = String(payload?.id || "");
      // Solo blancos (T...) y waypoints (W...); las unidades se van solas con SESSION_OUT.
      if (!/^[TW]/.test(id)) return;
      hidden.add(id);
      if (hidden.size > MAX_HIDDEN) hidden.delete(hidden.values().next().value);
      forget(id);
      io.emit(SEDAM_BRIDGE_EVENT, { type: "gone", id });
    });
  });

  let server = null;
  if (listenPort) {
    server = net.createServer((socket) => {
      log.log(`[BRIDGE SEDAM] Cliente conectado desde ${socket.remoteAddress}`);
      status.bridgeClients += 1;
      emitStatus();
      socket.on("error", (err) => log.error(`[BRIDGE SEDAM] ${socket.remoteAddress}: ${err.message}`));
      socket.on("close", () => {
        status.bridgeClients = Math.max(0, status.bridgeClients - 1);
        emitStatus();
      });
      attach(socket, socket.remoteAddress);
    });
    server.on("error", (err) => log.error("[BRIDGE SEDAM] Error del servidor TCP:", err.message));
    server.listen(listenPort, "0.0.0.0", () => log.log(`[BRIDGE SEDAM] Escuchando en *:${listenPort}`));
  }

  let stopped = false;
  let outbound = null;
  let lastError = "";
  const connectOut = () => {
    if (stopped) return;
    const target = `${remoteHost}:${remotePort}`;
    // Sin respuesta en este tiempo se aborta: si no, Windows deja el intento colgado ~20 s.
    outbound = net.connect({ host: remoteHost, port: remotePort, timeout: CONNECT_TIMEOUT_MS }, () => {
      outbound.setTimeout(0);
      lastError = "";
      status.remote = { target, connected: true, error: null };
      emitStatus();
      log.log(`[BRIDGE SEDAM] Conectado a ${target}`);
    });
    outbound.on("timeout", () => outbound.destroy(new Error("sin respuesta (host apagado, IP equivocada o puerto bloqueado)")));
    // Fuera de la red SEDAM el host no responde: se avisa una vez y se sigue reintentando en silencio.
    outbound.on("error", (err) => {
      if (err.message !== lastError) log.warn(`[BRIDGE SEDAM] Sin conexión con ${target} (${err.message}); reintentando cada ${RECONNECT_MS / 1000}s`);
      lastError = err.message;
      status.remote = { target, connected: false, error: err.message };
      emitStatus();
    });
    attach(outbound, target);
    outbound.on("close", () => {
      if (status.remote?.connected) {
        status.remote = { target, connected: false, error: "conexión cerrada por SEDAM" };
        emitStatus();
      }
      if (!stopped) setTimeout(connectOut, RECONNECT_MS);
    });
  };
  if (remoteHost) connectOut();

  let sedamSocket = null;
  if (status.socket) {
    const reader = createFrameReader(publish);
    let lastError = "";
    log.log(`[SOCKET SEDAM] Conectando a ${socketUrl} con la serie ${socketSerial}`);
    sedamSocket = connectSedamSocket({
      url: socketUrl,
      serial: socketSerial,
      caFile: path.resolve(API_DIR, env.SEDAM_SOCKET_CA || "data/sedam_ca.pem"),
      insecure: env.SEDAM_SOCKET_INSECURE === "1",
      log,
      onText: (text) => {
        capture("socket", text);
        reader.push(text);
        reader.flush();
      },
      onStatus: ({ connected, online, error }) => {
        // Fuera de la red SEDAM falla cada reintento: se avisa una vez por cada error distinto.
        if (error && error !== lastError) {
          log.warn(`[SOCKET SEDAM] ${socketUrl}: ${error}`);
          capture("estado", error);
        }
        if (online && !status.socket.online) capture("estado", "en línea");
        if (online && !status.socket.online) log.log(`[SOCKET SEDAM] Cifrado listo con ${socketUrl}`);
        lastError = error || "";
        status.socket = { ...status.socket, connected, online, error };
        emitStatus();
      },
    });
  }

  return {
    /** Socket de SEDAM Móvil para transmitir (null si no está configurado). */
    sedam: sedamSocket,
    stop() {
      stopped = true;
      goneTimers.forEach(clearTimeout);
      clearInterval(saveTimer);
      saveState();
      server?.close();
      outbound?.destroy();
      sedamSocket?.stop();
    },
  };
}
