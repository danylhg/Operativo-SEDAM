import { pool } from "../db.js";
import { advancedPoiPosition, isTargetPoi } from "../utils/poiMotion.js";

/**
 * Transmite a la red SEDAM los waypoints y blancos PÚBLICOS de las operaciones activas, con las
 * mismas tramas que la app y la web de SEDAM Móvil:
 *   TRACKPOS,id_api,id_poi,sidc,nombre,lat,lon,0,rumbo,velocidad   (blanco; 0,0 → quitar)
 *   WAYPOINTPOS,id_poi,id_api,sidc,nombre,lat,lon,0                (waypoint; REMOVE → quitar)
 * Se lee la base de datos cada TICK_MS, así no importa desde dónde se publicó (web o Android):
 *  - blancos: se reenvían en cada vuelta con su posición actual (los que se mueven avanzan igual
 *    que en el dashboard, y quien entre después a SEDAM los ve de inmediato).
 *  - waypoints: al cambiar y cada WAYPOINT_REFRESH_MS, para quien se conecte después.
 *  - al pasar a privado, borrarse o cerrar la operación se manda la señal de quitar, igual que
 *    los celulares, y se repite un rato (REMOVE_REPEAT_*) por si alguien estaba desconectado.
 *  - al (re)conectar se manda quitar todo lo de los últimos días que ya no es público: así se
 *    limpia también lo que se borró con la API apagada o sin conexión, sin depender de memoria.
 */

const TICK_MS = 2_000;
const WAYPOINT_REFRESH_MS = 30_000;
const REMOVE_REPEAT_MS = 30_000;
const REMOVE_REPEAT_FOR_MS = 10 * 60_000;
const SWEEP_DAYS = 30;
const DEFAULT_TARGET_SIDC = "SUGP-----------";
const DEFAULT_WAYPOINT_SIDC = "GFGPGPRW------X";

const clean = (text) => String(text ?? "").replace(/\[:\]/g, "").replace(/,/g, ";").trim();
const coord = (value) => Number(value).toFixed(6);

// SEDAM usa SIDC de 15 caracteres; los waypoints del dashboard vienen cortos ("GFGPGPRW---X").
function sedamSidc(raw, target) {
  const sidc = String(raw || "").trim().toUpperCase();
  if (!sidc) return target ? DEFAULT_TARGET_SIDC : DEFAULT_WAYPOINT_SIDC;
  if (sidc.length >= 15) return sidc.slice(0, 15);
  if (!target && sidc.endsWith("X")) return `${sidc.slice(0, -1).padEnd(14, "-")}X`;
  return sidc.padEnd(15, "-");
}

function describe(poi) {
  const target = isTargetPoi(poi);
  return {
    target,
    sidc: sedamSidc(poi.sidc || poi.icono_src, target),
    name: clean(poi.nombre) || (target ? "BLANCO" : "WAYPOINT"),
  };
}

async function fetchPublicPois() {
  const { rows } = await pool.query(
    `SELECT poi.id_poi, poi.nombre, poi.tipo_poi, poi.sidc, poi.icono_src, poi.latitud, poi.longitud,
            poi.visibilidad, poi.velocidad_kmh, poi.rumbo_grados, poi.movimiento_desde, poi.fecha_creacion
       FROM puntos_interes poi
       JOIN operacion o ON o.id_operacion = poi.id_operacion
      WHERE poi.activo = TRUE AND poi.visibilidad = 'PUBLICO' AND o.estado = 'ACTIVA'`
  );
  return rows;
}

// Todo lo reciente que pudo haberse transmitido alguna vez (público o no, borrado o no).
async function fetchRecentPois() {
  const { rows } = await pool.query(
    `SELECT id_poi, nombre, tipo_poi, sidc, icono_src
       FROM puntos_interes
      WHERE fecha_creacion > NOW() - make_interval(days => $1) AND tipo_poi <> 'RADAR'`,
    [SWEEP_DAYS]
  );
  return rows;
}

export function startSedamPublisher({ sedam, log = console }) {
  if (!sedam) return null;

  const sent = new Map();       // id_poi → lo último enviado: { target, sidc, name, signature, at }
  const tombstones = new Map(); // id_poi → { target, sidc, name, until, at } (quitar repetido)
  let wasOnline = false;
  let lastError = "";
  let running = false;

  const send = (identity, body) => {
    const event = body.slice(0, body.indexOf(","));
    sedam.send(event, `[:]${identity.session}[:]${body}`);
  };

  const sendRemove = (identity, idPoi, info, now) => {
    send(identity, info.target
      ? `TRACKPOS,${identity.id},${idPoi},${info.sidc},${info.name},0,0,0,0,0`
      : `WAYPOINTPOS,${idPoi},${identity.id},REMOVE,${info.name},0,0,0`);
    const previous = tombstones.get(idPoi);
    tombstones.set(idPoi, { ...info, at: now, until: previous?.until ?? now + REMOVE_REPEAT_FOR_MS });
  };

  const tick = async () => {
    const identity = sedam.identity();
    if (!identity) {
      wasOnline = false;
      return;
    }
    // Al (re)conectar se manda todo de nuevo: SEDAM no guarda nada.
    const justConnected = !wasOnline;

    let pois;
    let recent = [];
    try {
      pois = await fetchPublicPois();
      if (justConnected) recent = await fetchRecentPois();
      lastError = "";
    } catch (err) {
      if (err.message !== lastError) log.warn(`[SEDAM PUBLICAR] No se pudieron leer los puntos: ${err.message}`);
      lastError = err.message;
      return;
    }
    wasOnline = true;

    const now = Date.now();
    const current = new Set();
    for (const poi of pois) {
      const pos = advancedPoiPosition(poi, now);
      if (!pos) continue;
      const idPoi = String(poi.id_poi);
      const { target, sidc, name } = describe(poi);
      const previous = sent.get(idPoi);
      current.add(idPoi);
      // Si cambió de tipo, se sigue repitiendo el quitar del tipo anterior.
      if (tombstones.get(idPoi)?.target === target) tombstones.delete(idPoi);

      // Cambió de blanco a waypoint (o al revés): se quita el anterior antes de mandar el nuevo.
      if (previous && previous.target !== target) sendRemove(identity, idPoi, previous, now);

      if (target) {
        const speed = Math.max(0.1, Number(poi.velocidad_kmh) || 0);
        const heading = Number(poi.rumbo_grados) || 0;
        send(identity, `TRACKPOS,${identity.id},${idPoi},${sidc},${name},${coord(pos.lat)},${coord(pos.lon)},0,${heading.toFixed(1)},${speed.toFixed(1)}`);
        sent.set(idPoi, { target, sidc, name, at: now });
      } else {
        const signature = `${sidc}|${name}|${coord(pos.lat)}|${coord(pos.lon)}`;
        const stale = justConnected || !previous || previous.target !== target
          || previous.signature !== signature || now - previous.at >= WAYPOINT_REFRESH_MS;
        if (stale) {
          send(identity, `WAYPOINTPOS,${idPoi},${identity.id},${sidc},${name},${coord(pos.lat)},${coord(pos.lon)},0`);
          sent.set(idPoi, { target, sidc, name, signature, at: now });
        }
      }
    }

    // Dejó de ser público, se borró o se cerró la operación.
    for (const [idPoi, previous] of sent) {
      if (current.has(idPoi)) continue;
      sendRemove(identity, idPoi, previous, now);
      sent.delete(idPoi);
    }

    // Recién conectados: quitar lo que se borró o se hizo privado mientras no había conexión.
    for (const poi of recent) {
      const idPoi = String(poi.id_poi);
      if (!current.has(idPoi) && !tombstones.has(idPoi)) sendRemove(identity, idPoi, describe(poi), now);
    }

    for (const [idPoi, info] of tombstones) {
      if (now >= info.until) tombstones.delete(idPoi);
      else if (now - info.at >= REMOVE_REPEAT_MS) sendRemove(identity, idPoi, info, now);
    }
  };

  const timer = setInterval(() => {
    if (running) return;
    running = true;
    tick().finally(() => { running = false; });
  }, TICK_MS);
  log.log("[SEDAM PUBLICAR] Waypoints y blancos públicos se transmitirán a SEDAM.");

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
