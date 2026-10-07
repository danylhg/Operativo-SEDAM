import { dom } from "./historial.dom.js";
import { replayState } from "./historial.state.js";
import { renderPlaybackState, renderTimelineTime, updateChatToTime, updateEventLogToTime } from "./historial.ui.js";
import { updateMapToTime } from "./historial.map.js";
import { describeEvent, isRelevantEvent } from "./historial.meta.js";

const TICK_MS = 250;

export function initTimeline() {
  dom.playPause?.addEventListener("click", togglePlayback);
  dom.prevEvent?.addEventListener("click", goToPreviousEvent);
  dom.nextEvent?.addEventListener("click", goToNextEvent);

  dom.speed?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-speed]");
    if (!button) return;
    replayState.speed = Number(button.dataset.speed) || 1;
    dom.speed.querySelectorAll("[data-speed]").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
  });

  dom.range?.addEventListener("input", () => {
    pausePlayback();
    const offsetSeconds = Number(dom.range.value) || 0;
    setCurrentTime(replayState.startMs + offsetSeconds * 1000);
  });

  // Atajos: espacio reproduce/pausa, flechas saltan 10 s (ignora campos de texto).
  document.addEventListener("keydown", (event) => {
    if (event.target.closest?.("input, select, textarea, button")) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    } else if (event.code === "ArrowLeft") {
      seekRelative(-10000);
    } else if (event.code === "ArrowRight") {
      seekRelative(10000);
    }
  });
}

// Salta a un instante concreto (usado por la lista de actividad).
export function seekTo(ms) {
  if (!Number.isFinite(ms)) return;
  pausePlayback();
  setCurrentTime(ms);
}

// Marcas de eventos relevantes sobre la barra, agrupadas en cubetas de ~0.4%
// para que miles de eventos no saturen el DOM.
function renderTimelineMarkers() {
  if (!dom.markers) return;
  const duration = Math.max(1, replayState.endMs - replayState.startMs);
  const buckets = new Map();

  for (const event of replayState.events) {
    if (!isRelevantEvent(event)) continue;
    const ms = Date.parse(event.occurred_at);
    if (!Number.isFinite(ms)) continue;
    const percent = Math.min(100, Math.max(0, ((ms - replayState.startMs) / duration) * 100));
    const bucket = Math.round(percent / 0.4);
    if (!buckets.has(bucket)) {
      buckets.set(bucket, { percent, ms, color: describeEvent(event).color, count: 0 });
    }
    buckets.get(bucket).count += 1;
  }

  dom.markers.innerHTML = [...buckets.values()].map(marker =>
    `<i style="left:${marker.percent.toFixed(2)}%;--c:${marker.color}" data-ms="${marker.ms}"></i>`
  ).join("");
}

export function setReplayData(replay) {
  const events = normalizeTimelineEvents(replay?.timeline?.eventos || []);
  const eventTimes = events.map(event => toTimestamp(event.occurred_at)).filter(Number.isFinite);
  const snapshotTimes = collectSnapshotTimes(replay);

  const explicitStart = toTimestamp(replay?.timeline?.inicio);
  const explicitEnd = toTimestamp(replay?.timeline?.fin);
  const activationStart = toTimestamp(replay?.operacion?.fecha_inicio);
  const operationStart = firstFiniteTimestamp([
    replay?.operacion?.fecha_inicio,
    replay?.operacion?.fecha_creacion,
  ]);
  const operationEnd = firstFiniteTimestamp([
    replay?.operacion?.fecha_fin,
    replay?.operacion?.fecha_actualizacion,
  ]);

  replayState.replay = replay;
  replayState.events = events;
  replayState.startMs = Number.isFinite(activationStart)
    ? activationStart
    : firstFiniteNumber([
      explicitStart,
      operationStart,
      minFinite(eventTimes),
      minFinite(snapshotTimes),
      Date.now(),
    ]);
  replayState.endMs = firstFiniteNumber([
    explicitEnd,
    operationEnd,
    maxFinite(eventTimes),
    maxFinite(snapshotTimes),
    replayState.startMs,
  ]);

  if (replayState.endMs <= replayState.startMs) {
    replayState.endMs = replayState.startMs + 1000;
  }

  if (replay) {
    replay.timeline = {
      ...(replay.timeline || {}),
      inicio: new Date(replayState.startMs).toISOString(),
      fin: new Date(replayState.endMs).toISOString(),
      eventos: events,
    };
  }

  const durationSeconds = Math.max(1, Math.ceil((replayState.endMs - replayState.startMs) / 1000));

  if (dom.range) {
    dom.range.min = "0";
    dom.range.max = String(durationSeconds);
    dom.range.value = "0";
  }

  renderTimelineMarkers();
  setCurrentTime(replayState.startMs);
}

function normalizeTimelineEvents(events) {
  return events
    .map((event) => {
      const ms = eventTimestamp(event);
      if (!Number.isFinite(ms)) return null;
      return {
        ...event,
        occurred_at: new Date(ms).toISOString(),
      };
    })
    .filter(Boolean)
    .sort((left, right) => toTimestamp(left.occurred_at) - toTimestamp(right.occurred_at));
}

function eventTimestamp(event) {
  const payload = event?.payload || {};
  return firstFiniteTimestamp([
    event?.occurred_at,
    payload.occurred_at,
    payload.fecha_envio,
    payload.fecha_registro,
    payload.fecha_creacion,
    payload.fecha_actualizacion,
    payload.timestamp,
  ]);
}

function collectSnapshotTimes(replay) {
  const snapshots = replay?.snapshots || {};
  const groups = [
    snapshots.waypoints,
    snapshots.blancos,
    snapshots.geo_mensajes,
    snapshots.areas,
    snapshots.estructuras,
    snapshots.rutas_tacticas,
    snapshots.rutas_navegacion,
    snapshots.dibujos,
    snapshots.zonas,
  ];

  return groups
    .flatMap(items => Array.isArray(items) ? items : [])
    .flatMap(item => [
      item?.fecha_creacion,
      item?.fecha_actualizacion,
      item?.fecha_eliminacion,
      item?.timestamp,
    ])
    .map(toTimestamp)
    .filter(Number.isFinite);
}

function firstFiniteTimestamp(values) {
  return firstFiniteNumber(values.map(toTimestamp));
}

function firstFiniteNumber(values) {
  return values.find(Number.isFinite) ?? Date.now();
}

function minFinite(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.min(...finite) : NaN;
}

function maxFinite(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : NaN;
}

function toTimestamp(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : NaN;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : NaN;
  }
  if (!value) return NaN;

  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}

function togglePlayback() {
  if (replayState.isPlaying) {
    pausePlayback();
  } else {
    startPlayback();
  }
}

function startPlayback() {
  if (replayState.isPlaying) return;

  if (replayState.currentTimeMs >= replayState.endMs) {
    setCurrentTime(replayState.startMs);
  }

  replayState.isPlaying = true;
  renderPlaybackState(true);

  replayState.timerId = window.setInterval(() => {
    const nextTime = replayState.currentTimeMs + TICK_MS * replayState.speed;
    setCurrentTime(nextTime);

    if (nextTime >= replayState.endMs) {
      pausePlayback();
    }
  }, TICK_MS);
}

function pausePlayback() {
  if (replayState.timerId) {
    window.clearInterval(replayState.timerId);
  }

  replayState.timerId = null;
  replayState.isPlaying = false;
  renderPlaybackState(false);
}

function setCurrentTime(value) {
  const clampedTime = Math.min(Math.max(value, replayState.startMs), replayState.endMs);
  replayState.currentTimeMs = clampedTime;

  if (dom.range) {
    dom.range.value = String(Math.round((clampedTime - replayState.startMs) / 1000));
    const duration = Math.max(1, replayState.endMs - replayState.startMs);
    const percent = ((clampedTime - replayState.startMs) / duration) * 100;
    dom.range.style.setProperty("--progress", `${Math.min(100, Math.max(0, percent))}%`);
  }

  renderTimelineTime(clampedTime, replayState.endMs, replayState.events, replayState.startMs);
  updateMapToTime(clampedTime);
  updateChatToTime(clampedTime);
  updateEventLogToTime(clampedTime);
}

function seekRelative(deltaMs) {
  pausePlayback();
  setCurrentTime(replayState.currentTimeMs + deltaMs);
}

function goToPreviousEvent() {
  pausePlayback();
  const events = navigableEvents();
  let currentIndex = -1;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (Date.parse(events[index].occurred_at) < replayState.currentTimeMs) {
      currentIndex = index;
      break;
    }
  }

  if (currentIndex >= 0) {
    setCurrentTime(Date.parse(events[currentIndex].occurred_at));
  }
}

function goToNextEvent() {
  pausePlayback();
  const nextEvent = navigableEvents().find((event) => {
    return Date.parse(event.occurred_at) > replayState.currentTimeMs;
  });

  if (nextEvent) {
    setCurrentTime(Date.parse(nextEvent.occurred_at));
  }
}

function navigableEvents() {
  return replayState.events.filter(isRelevantEvent);
}
