import crypto from "crypto";
import fs from "fs";
import https from "https";
import { io as connectSocketIO } from "socket.io-client";

/**
 * Cliente del socket cifrado de SEDAM Móvil (puerto 3000), igual que la app Android y el sistema web:
 * 1. conecta con auth { serial_number } (la serie debe estar en serial_numbers.json del servidor).
 * 2. el servidor manda `crypto:publicKey` (RSA-2048 PEM).
 * 3. se genera una AES-256 nueva, se envuelve con RSA-OAEP(SHA-256) y se manda en `crypto:aesKey`.
 * 4. `crypto:ready` confirma; desde ahí cada `data` llega como AES-GCM { iv: hex, data: b64, tag: b64 }.
 *
 * Por este socket llega lo mismo que ve un celular de la sesión: lo que reenvía el Bridge SEDAM
 * y lo que los demás dispositivos transmiten directo. Para enviar (waypoints y blancos públicos del
 * dashboard) se usa send(), que cifra igual que los celulares; esta API no transmite su posición.
 * Ojo: el servidor anuncia la conexión como SESSION_IN de la serie usada, y rechaza ("Id repetido")
 * a quien llegue después con la misma serie: usar una serie propia, no la de un celular.
 */

const SERVER_CLOSED_RETRY_MS = 30_000;
// Audio e imágenes en base64 no interesan al mapa: no se descifran ni se parsean.
const IGNORED_TYPES = /^(?:[^,]*\[:\])*(?:MSGAUDIO|MSGIMAGE),/;

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { iv: iv.toString("hex"), data: data.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function decrypt(payload, key) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "hex"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.data, "base64")), decipher.final()]).toString("utf8");
}

/**
 * El servidor usa un certificado autofirmado emitido para otra IP: se confía en ese
 * certificado (como res/raw/sedam_ca.pem en Android) y no se exige que coincida el nombre.
 * Si el servidor presenta otro, connect_error cambia a no verificar (ver abajo).
 */
function buildAgent(caFile, insecure, log) {
  if (insecure) return new https.Agent({ rejectUnauthorized: false });
  try {
    const ca = fs.readFileSync(caFile);
    return new https.Agent({ ca, checkServerIdentity: () => undefined });
  } catch (err) {
    log.warn(`[SOCKET SEDAM] Sin certificado de SEDAM (${caFile}): ${err.message}`);
    return undefined;
  }
}

export function connectSedamSocket({ url, serial, caFile, insecure = false, onText, onStatus, log = console }) {
  let aesKey = null;
  let workSession = "";
  let myId = null;
  let ready = false;
  let retryTimer = null;
  let stopped = false;
  let usingInsecure = insecure;

  const agent = url.startsWith("https") ? buildAgent(caFile, insecure, log) : undefined;
  const socket = connectSocketIO(url, {
    transports: ["websocket", "polling"],
    auth: { serial_number: serial },
    agent,
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    timeout: 8_000,
  });

  const status = (connected, online, error) => onStatus({ connected, online, error });

  socket.on("connect", () => status(true, false, null));
  socket.on("connect_error", (err) => {
    // socket.io solo dice "timeout" o "websocket error"; la causa real viene en description.
    const cause = err.description?.error ?? err.description;
    const detail = [cause?.code, cause?.message].filter(Boolean).join(" ") || err.message;
    let message = detail;
    if (/self.signed|certificate|unable to verify|CERT_|SELF_SIGNED/i.test(detail)) {
      // En la red del KU no hay a quién pedir el certificado nuevo: se acepta el que presente
      // el servidor (la IP es fija y la red está aislada) y se deja el aviso en el log.
      if (!usingInsecure) {
        usingInsecure = true;
        socket.io.opts.agent = new https.Agent({ rejectUnauthorized: false });
        log.warn(`[SOCKET SEDAM] El certificado de ${url} no coincide con data/sedam_ca.pem (${detail}); se acepta el del servidor.`);
      }
      message = `certificado distinto, reintentando sin verificarlo (${detail})`;
    } else if (/timeout|websocket error|xhr poll error|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNREFUSED/i.test(detail)) {
      message = `el servidor no responde (¿conectada a la red del KU?) [${detail}]`;
    }
    status(false, false, message);
  });
  socket.on("disconnect", (reason) => {
    aesKey = null;
    ready = false;
    if (stopped) return;
    // El servidor cierra así cuando la serie no está registrada o ya hay alguien con ella.
    if (reason === "io server disconnect") {
      status(false, false, `SEDAM cerró la sesión: la serie ${serial} no está registrada o ya está en uso`);
      retryTimer = setTimeout(() => socket.connect(), SERVER_CLOSED_RETRY_MS);
    } else {
      status(false, false, `desconectado (${reason})`);
    }
  });

  socket.on("crypto:publicKey", (pem) => {
    try {
      const key = crypto.randomBytes(32);
      const wrapped = crypto.publicEncrypt(
        { key: String(pem), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
        key,
      );
      aesKey = key;
      socket.emit("crypto:aesKey", wrapped.toString("base64"));
    } catch (err) {
      status(true, false, `error de cifrado: ${err.message}`);
    }
  });
  socket.on("crypto:ready", (ok) => {
    ready = ok === true;
    if (ready) status(true, true, null);
    else status(true, false, "SEDAM rechazó la clave AES");
  });

  socket.on("data", (raw) => {
    try {
      let text;
      if (raw && typeof raw === "object") {
        if (!(raw.iv && raw.data && raw.tag)) return;
        if (!aesKey) return;
        text = decrypt(raw, aesKey);
      } else if (typeof raw === "string") {
        text = raw;
      } else {
        return;
      }
      text = text.trim();
      // Primer mensaje: los datos de la serie ({ id, work_session, ... }).
      if (text.startsWith("{")) {
        const info = JSON.parse(text);
        if (info.work_session) {
          workSession = String(info.work_session).trim();
          myId = info.id == null ? null : String(info.id);
          log.log(`[SOCKET SEDAM] En línea como id ${info.id} (sesión ${workSession})`);
        }
        return;
      }
      if (IGNORED_TYPES.test(text.slice(0, 200))) return;
      // Lo que reenvía el Bridge llega sin sesión; los broadcast de los celulares sí la traen.
      onText(text.includes("[:]") || !workSession ? text : `${workSession}[:]${text}`);
    } catch (err) {
      log.warn(`[SOCKET SEDAM] Mensaje ilegible: ${err.message}`);
    }
  });

  return {
    /** Id y sesión que asignó SEDAM; null mientras no se pueda transmitir. */
    identity() {
      return ready && aesKey && myId && workSession ? { id: myId, session: workSession } : null;
    },
    /** Envía una trama cifrada en el evento indicado (TRACKPOS, WAYPOINTPOS...). */
    send(event, plaintext) {
      if (!ready || !aesKey) return false;
      socket.emit(event, encrypt(plaintext, aesKey));
      return true;
    },
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      socket.close();
    },
  };
}
