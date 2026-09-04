// js/dashboard/dashboard.tracking.clustering.js

import { dashboardState } from "./dashboard.state.js";

const CLUSTER_DISTANCE_METERS = 30;
const MOVING_SPEED_KMH = 1.0;
const TRACKING_RECENT_MS = 20000;
const TRACKING_SYNC_MS = 15000;
const MIN_SPEED_MATCH_TOLERANCE_KMH = 2.0;
const SPEED_MATCH_RATIO = 0.35;

export function processTrackingUpdate(key, lat, lng, extra = {}) {
  const now = Date.now();
  const historyMap = dashboardState.trackingHistory;
  const previous = historyMap.get(key) || {};

  historyMap.set(key, {
    ...previous,
    ...extra,
    prevLat: previous.lat,
    prevLng: previous.lng,
    prevTime: previous.time,
    lat,
    lng,
    time: now
  });

  reevaluateClusters();
}

function reevaluateClusters() {
  const historyMap = dashboardState.trackingHistory;
  const clusters = dashboardState.trackingClusters;

  clusters.clear();

  const vehicles = [];
  const persons = [];

  for (const [key, value] of historyMap.entries()) {
    if (key.startsWith("V:")) vehicles.push({ id: key, ...value });
    if (key.startsWith("P:")) persons.push({ id: key, ...value });
  }

  vehicles.forEach((vehicle) => {
    vehicle.cartesian = Cesium.Cartesian3.fromDegrees(vehicle.lng, vehicle.lat);
  });

  persons.forEach((person) => {
    const personCartesian = Cesium.Cartesian3.fromDegrees(person.lng, person.lat);
    let minDistance = Infinity;
    let closestVehicle = null;

    vehicles.forEach((vehicle) => {
      const distance = Cesium.Cartesian3.distance(personCartesian, vehicle.cartesian);
      if (distance < minDistance) {
        minDistance = distance;
        closestVehicle = vehicle;
      }
    });

    if (
      closestVehicle &&
      minDistance <= CLUSTER_DISTANCE_METERS &&
      isTravelingWithVehicle(person, closestVehicle)
    ) {
      if (!clusters.has(closestVehicle.id)) {
        clusters.set(closestVehicle.id, new Set());
      }
      clusters.get(closestVehicle.id).add(person.id);
    }
  });

  updateTrackingEntitiesVisibility();
}

function updateTrackingEntitiesVisibility() {
  const entities = dashboardState.trackingEntities;
  const headings = dashboardState.trackingHeadingEntities;

  entities.forEach((entity, key) => {
    if (!key.startsWith("P:")) return;

    const shouldShow = shouldShowPersonEntity(key);

    if (entity.show !== shouldShow) {
      entity.show = shouldShow;
    }

    const headingEntity = headings.get(key);
    if (headingEntity && headingEntity.show !== shouldShow) {
      headingEntity.show = shouldShow;
    }
  });
}

export function getPersonVehicleKey(personKey) {
  for (const [vehicleKey, occupants] of dashboardState.trackingClusters.entries()) {
    if (occupants.has(personKey)) {
      return vehicleKey;
    }
  }
  return null;
}

export function isVehicleMoving(vehicleKey) {
  const history = dashboardState.trackingHistory.get(vehicleKey);
  if (!history) return false;
  return getTrackingSpeedKmh(history) > MOVING_SPEED_KMH;
}

export function shouldShowPersonEntity(personKey) {
  return !getPersonVehicleKey(personKey);
}

export function getVehicleOccupants(vehicleKey) {
  const clusters = dashboardState.trackingClusters;
  if (clusters.has(vehicleKey)) {
    return Array.from(clusters.get(vehicleKey));
  }
  return [];
}

export function getClusteredPersonKeys() {
  const clustered = new Set();
  dashboardState.trackingClusters.forEach((occupants) => {
    occupants.forEach((personKey) => clustered.add(personKey));
  });
  return clustered;
}

function parseNumber(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(String(value).replace(/[^\d.+-]/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function getLiveSpeedValue(record = {}) {
  const live = record.liveData || {};
  return parseNumber(
    live.velocidad_kmh ??
    live.velocidad ??
    live.speed_kmh ??
    live.speed ??
    record.velocidad_kmh ??
    record.velocidad ??
    record.speed_kmh ??
    record.speed
  );
}

function getDerivedSpeedKmh(record = {}) {
  if (
    record.prevLat == null ||
    record.prevLng == null ||
    record.prevTime == null ||
    record.lat == null ||
    record.lng == null ||
    record.time == null ||
    record.time <= record.prevTime
  ) {
    return null;
  }

  const from = Cesium.Cartesian3.fromDegrees(record.prevLng, record.prevLat);
  const to = Cesium.Cartesian3.fromDegrees(record.lng, record.lat);
  const meters = Cesium.Cartesian3.distance(from, to);
  const hours = (record.time - record.prevTime) / 3600000;
  if (!Number.isFinite(meters) || !Number.isFinite(hours) || hours <= 0) return null;
  return meters / 1000 / hours;
}

function getTrackingSpeedKmh(record = {}) {
  const liveSpeed = getLiveSpeedValue(record);
  if (liveSpeed !== null) return Math.max(0, liveSpeed);

  const derivedSpeed = getDerivedSpeedKmh(record);
  if (derivedSpeed !== null) return Math.max(0, derivedSpeed);

  return 0;
}

function isRecent(record = {}) {
  return Boolean(record.time) && Date.now() - record.time <= TRACKING_RECENT_MS;
}

function isSynced(person = {}, vehicle = {}) {
  return Boolean(person.time) &&
    Boolean(vehicle.time) &&
    Math.abs(person.time - vehicle.time) <= TRACKING_SYNC_MS;
}

function speedsMatch(person = {}, vehicle = {}) {
  const vehicleSpeed = getTrackingSpeedKmh(vehicle);
  const personSpeed = getTrackingSpeedKmh(person);

  if (vehicleSpeed <= MOVING_SPEED_KMH) return false;
  if (personSpeed <= MOVING_SPEED_KMH) return false;

  const diff = Math.abs(vehicleSpeed - personSpeed);
  const tolerance = Math.max(MIN_SPEED_MATCH_TOLERANCE_KMH, vehicleSpeed * SPEED_MATCH_RATIO);
  return diff <= tolerance;
}

function isTravelingWithVehicle(person = {}, vehicle = {}) {
  return isRecent(person) &&
    isRecent(vehicle) &&
    isSynced(person, vehicle) &&
    speedsMatch(person, vehicle);
}
