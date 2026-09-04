const DEFAULT_TTL_MS = 45000;
const asignacionPresence = new Map();

function keyFor(idOperacion) {
  return String(Number(idOperacion));
}

function cleanupExpired(now = Date.now()) {
  for (const [key, value] of asignacionPresence.entries()) {
    if (!value?.expiresAt || value.expiresAt <= now) {
      asignacionPresence.delete(key);
    }
  }
}

export function markOperacionEnAsignacion(idOperacion, actor = null, ttlMs = DEFAULT_TTL_MS) {
  const id = Number(idOperacion);
  if (!Number.isInteger(id) || id <= 0) return false;

  const now = Date.now();
  cleanupExpired(now);

  asignacionPresence.set(keyFor(id), {
    id_operacion: id,
    actor: actor || null,
    touchedAt: now,
    expiresAt: now + ttlMs
  });

  return true;
}

export function releaseOperacionEnAsignacion(idOperacion) {
  const id = Number(idOperacion);
  if (!Number.isInteger(id) || id <= 0) return false;
  return asignacionPresence.delete(keyFor(id));
}

export function isOperacionEnAsignacion(idOperacion) {
  const id = Number(idOperacion);
  if (!Number.isInteger(id) || id <= 0) return false;

  const now = Date.now();
  cleanupExpired(now);

  const presence = asignacionPresence.get(keyFor(id));
  return !!presence && presence.expiresAt > now;
}
