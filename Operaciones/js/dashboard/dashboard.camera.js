// js/dashboard/dashboard.camera.js

import { dom } from "./dashboard.dom.js";
import { escapeHtml, getCurrentOperation } from "./dashboard.storage.js";

const API_BASE = localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`;

const CAMERA_PROTOCOL_WEBRTC = "WEBRTC";
const CAMERA_PROTOCOL_RTMP = "RTMP";
const CAMERA_PROTOCOLS = new Set([CAMERA_PROTOCOL_WEBRTC, CAMERA_PROTOCOL_RTMP]);

let cameraData = [];
let activeOperationId = null;
let streamSocket = null;
let cameraEventsBound = false;
let cameraSocketBound = false;
let cameraDragBound = false;
let cameraResizeBound = false;
let cameraResizeObserver = null;
let cameraLayoutFrame = 0;
let cameraSourceFilter = "all";
let iceServers = null;
let focusedCameraPlaybackKey = "";
let cameraGridPanelSize = null;
const peerConnections = new Map();
const joinedStreams = new Set();
const peerTargets = new Map();
const remoteStreams = new Map();
const playableLiveStreams = new Map();
const reconnectTimers = new Map();
const cameraArchiveMetadata = new Map();
const playbackGroups = new Map();
const cameraAudioEnabled = new Set();
const manuallyPausedPlaybackKeys = new Set();
let activePersonnelCamera = null;
const frozenVideoFrames = new Map();

const RECORDING_SLICE_MS = 1000;
const RECORDING_VIDEO_BITS_PER_SECOND = 700_000;
const RECORDING_AUDIO_BITS_PER_SECOND = 64_000;
const MAX_LOCAL_ARCHIVE_SECONDS = 15 * 60;
const LIVE_EDGE_THRESHOLD_SECONDS = 1.2;
const PLAYABLE_INITIAL_STALE_MS = 15000;
const PLAYABLE_STALE_CHECK_MS = 5000;
const PLAYABLE_STALE_MS = 9000;
const HLS_ATTACH_RETRY_INITIAL_MS = 1500;
const HLS_ATTACH_RETRY_MAX_MS = 15000;
const LIVE_STREAMS_POLL_MS = 5000;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SIDE_RATIO = 0.38;
const VIDEO_BUFFER_DB = "operaciones-video-buffer";
const VIDEO_BUFFER_STORE = "segments";
const SETUP_CLEANUP_MARKER_URL = "/Operaciones/runtime/setup_cleanup.json";
const SETUP_CLEANUP_STORAGE_KEY = "operaciones_video_buffer_setup_cleanup_token";
const playbackArchives = new Map();
let playbackUiTimer = null;
let videoBufferDbPromise = null;
let operationArchiveLoadPromise = null;
let operationArchiveLoadKey = "";
let uploadRetryBound = false;
let hlsScriptPromise = null;
let liveStreamsPollTimer = null;
let lastLiveStreamsSignature = "";
const hlsPlayers = new Map();
const playableUrlWatchers = new Map();
const hlsAttachRetries = new Map();
const playbackControlsHideTimers = new WeakMap();

export function initCameraFeeds(opId = null, socket = null) {
  activeOperationId = opId || activeOperationId || localStorage.getItem("active_operation_id");
  const nextArchiveKey = getOperationStorageKey();
  if (operationArchiveLoadKey !== nextArchiveKey) {
    operationArchiveLoadKey = nextArchiveKey;
    operationArchiveLoadPromise = null;
  }
  if (socket) {
    streamSocket = socket;
    bindStreamSocket();
  }

  if (cameraData.length === 0) {
    loadPlaceholderCameraData();
    renderFeeds();
  }
  bindCameraEvents();
  makePanelDraggable();
  makePanelResizable();
  ensurePlaybackUiTimer();
  ensureLiveStreamsPolling();
  bindUploadRetryEvents();
  const setupCleanup = clearLocalVideoBufferAfterSetupReset();
  void setupCleanup.then(() => openVideoBufferDb());
  void setupCleanup.then(() => retryPendingRecordingUploads());
  const localCleanup = setupCleanup.then(() => (
    shouldClearVideoBufferFromUrl()
      ? clearLocalVideoBufferForOperation({ render: false }).then(clearVideoBufferUrlFlag)
      : Promise.resolve()
  ));
  void localCleanup
    .then(() => pruneDeletedRemoteSegmentsForOperation())
    .then(() => loadPersistedSegmentsForOperation())
    .then(() => {
      renderFeeds();
      attachLiveFeeds();
      renderActivePersonnelCamera();
    });
  loadLiveStreams();
}

function ensureLiveStreamsPolling() {
  if (liveStreamsPollTimer) return;
  liveStreamsPollTimer = window.setInterval(() => {
    void loadLiveStreams();
  }, LIVE_STREAMS_POLL_MS);
}

function bindUploadRetryEvents() {
  if (uploadRetryBound) return;
  uploadRetryBound = true;
  window.addEventListener("online", () => {
    void retryPendingRecordingUploads();
  });
}

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function absoluteUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url) || /^rtmp:\/\//i.test(url)) return url;
  return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

function isHlsUrl(url) {
  return /\.m3u8(?:[?#].*)?$/i.test(String(url || ""));
}

function ensureHlsScript() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsScriptPromise) return hlsScriptPromise;

  const sources = [
    "/Operaciones/vendor/hls.min.js",
    "https://cdn.jsdelivr.net/npm/hls.js@1.6.13/dist/hls.min.js",
  ];

  hlsScriptPromise = new Promise((resolve, reject) => {
    let index = 0;
    const tryNext = () => {
      const src = sources[index++];
      if (!src) {
        reject(new Error("No se pudo cargar hls.js"));
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => window.Hls ? resolve(window.Hls) : tryNext();
      script.onerror = tryNext;
      document.head.appendChild(script);
    };

    tryNext();
  });

  return hlsScriptPromise;
}

function normalizeCameraText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isDroneLikeData(data = {}) {
  const sourceText = normalizeCameraText([
    data.sourceType,
    data.source_type,
    data.kind,
    data.name,
    data.label,
    data.externalDeviceId,
    data.external_device_id,
    data.nombre,
    data.numero_serie,
    data.categoria,
    data.tipo_tactico,
    data.tipo_equipo,
    data.modelo,
    data.marca
  ].filter(Boolean).join(" "));
  return sourceText.includes("drone") || sourceText.includes("dron") || sourceText.includes("uav") || sourceText.includes("vant");
}

function normalizeCameraProtocol(value, data = {}) {
  if (isDroneLikeData(data)) return CAMERA_PROTOCOL_RTMP;
  const protocol = String(value || data.protocol || data.protocolo || CAMERA_PROTOCOL_WEBRTC).trim().toUpperCase();
  if (protocol === CAMERA_PROTOCOL_RTMP) return CAMERA_PROTOCOL_RTMP;
  return CAMERA_PROTOCOL_WEBRTC;
}

function getCameraProtocolFamily(camera = {}) {
  if (camera.protocolFamily) return normalizeCameraProtocol(camera.protocolFamily, camera);
  if (isDroneLikeData(camera)) return CAMERA_PROTOCOL_RTMP;
  if (camera.isPlayableUrl || camera.rtmpPublishUrl || camera.rtmpPlaybackUrl) return CAMERA_PROTOCOL_RTMP;
  return normalizeCameraProtocol(camera.protocol, camera);
}

function getProtocolDisplay(protocol) {
  return normalizeCameraProtocol(protocol) === CAMERA_PROTOCOL_RTMP ? "RTMP" : "WEBRTC";
}

function getWaitingSignalMessage(cameraOrProtocol = CAMERA_PROTOCOL_WEBRTC) {
  const protocol = typeof cameraOrProtocol === "string"
    ? getProtocolDisplay(cameraOrProtocol)
    : getProtocolDisplay(getCameraProtocolFamily(cameraOrProtocol));
  return `Esperando señal ${protocol}`;
}

function getWaitingSignalBadge(cameraOrProtocol = CAMERA_PROTOCOL_WEBRTC) {
  const protocol = typeof cameraOrProtocol === "string"
    ? getProtocolDisplay(cameraOrProtocol)
    : getProtocolDisplay(getCameraProtocolFamily(cameraOrProtocol));
  return `ESPERANDO ${protocol}`;
}

function buildWaitingSignalMarkup(camera = {}) {
  const protocol = getCameraProtocolFamily(camera);
  const protocolLabel = getProtocolDisplay(protocol);
  return `
    <div class="cameraWaitingSignal" data-protocol="${escapeHtml(protocolLabel)}">
      <span>${escapeHtml("Esperando señal")}</span>
      <strong>${escapeHtml(protocolLabel)}</strong>
    </div>
  `;
}

function buildPlaceholderCameraData() {
  const op = getCurrentOperation();
  const personal = Array.isArray(op?.personal) ? op.personal : [];
  const equipos = Array.isArray(op?.equipos) ? op.equipos : [];
  const drones = equipos.filter(isDroneLikeData);
  const placeholders = [];

  if (personal.length > 0) {
    const cameraPersonnel = personal.filter(personHasCameraPlaceholder);
    placeholders.push(...cameraPersonnel.map((person, index) => {
      const name = [person.nombre, person.apellido].filter(Boolean).join(" ").trim();
      const role = person.rol_en_operacion || person.rol || "Personal";

      return {
        id: `placeholder-${person.id_personal || person.id || index}`,
        name: `${name || "Agente"} (${role})`,
        personnelId: person.id_personal != null ? Number(person.id_personal) : person.id != null ? Number(person.id) : null,
        protocol: CAMERA_PROTOCOL_WEBRTC,
        protocolFamily: CAMERA_PROTOCOL_WEBRTC,
        sourceType: "ANDROID",
        status: getWaitingSignalBadge(CAMERA_PROTOCOL_WEBRTC),
        sortIndex: index,
        placeholder: true
      };
    }));
  }

  placeholders.push(...drones.map((equipo, index) => ({
    id: `placeholder-drone-${equipo.id_equipo || equipo.id || equipo.numero_serie || index}`,
    equipoId: equipo.id_equipo != null ? Number(equipo.id_equipo) : equipo.id != null ? Number(equipo.id) : null,
    name: equipo.nombre || equipo.nombre_display || equipo.numero_serie || `Dron ${index + 1}`,
    protocol: CAMERA_PROTOCOL_RTMP,
    protocolFamily: CAMERA_PROTOCOL_RTMP,
    sourceType: "DRONE",
    externalDeviceId: equipo.numero_serie || equipo.external_device_id || "",
    status: getWaitingSignalBadge(CAMERA_PROTOCOL_RTMP),
    sortIndex: personal.length + index,
    placeholder: true
  })));

  return placeholders.length
    ? placeholders
    : [
      {
        id: "placeholder-webrtc",
        name: "Camaras WebRTC",
        protocol: CAMERA_PROTOCOL_WEBRTC,
        protocolFamily: CAMERA_PROTOCOL_WEBRTC,
        sourceType: "ANDROID",
        status: getWaitingSignalBadge(CAMERA_PROTOCOL_WEBRTC),
        sortIndex: 0,
        placeholder: true
      },
      {
        id: "placeholder-rtmp",
        name: "Camaras RTMP",
        protocol: CAMERA_PROTOCOL_RTMP,
        protocolFamily: CAMERA_PROTOCOL_RTMP,
        sourceType: "EXTERNAL",
        status: getWaitingSignalBadge(CAMERA_PROTOCOL_RTMP),
        sortIndex: 1,
        placeholder: true
      }
    ];
}

function personHasCameraPlaceholder(person = {}) {
  const role = String(person.rol_en_operacion || person.rol || "").trim().toUpperCase();
  return role !== "CUT";
}

function loadPlaceholderCameraData() {
  cameraData = buildPlaceholderCameraData();
}

function isSameCameraSlot(current = {}, next = {}) {
  const currentKey = current.playbackKey || getCameraPlaybackKey(current);
  const nextKey = next.playbackKey || getCameraPlaybackKey(next);
  if (currentKey && currentKey !== "unknown" && currentKey === nextKey) return true;

  const currentName = getCameraNameKey(current);
  const nextName = getCameraNameKey(next);
  return Boolean(currentName && nextName && currentName === nextName);
}

function shouldKeepPlaceholderName(previous = {}, next = {}) {
  if (!previous.placeholder || !previous.name) return false;
  const nextName = normalizeCameraNameForKey(next.name || next.label || next.cameraName);
  return !nextName || /^stream\s+\d+$/i.test(nextName) || nextName === "camara";
}

function findCameraDataIndexForCamera(nextCamera = {}) {
  const streamId = Number(nextCamera.streamId || 0);
  if (streamId) {
    const byStream = cameraData.findIndex((camera) => Number(camera.streamId || 0) === streamId);
    if (byStream >= 0) return byStream;
  }
  return cameraData.findIndex((camera) => isSameCameraSlot(camera, nextCamera));
}

function upsertCameraDataEntry(nextCamera = {}) {
  const index = findCameraDataIndexForCamera(nextCamera);
  const normalized = { ...nextCamera, placeholder: false };
  if (index >= 0) {
    const previous = cameraData[index] || {};
    cameraData[index] = {
      ...previous,
      ...normalized,
      name: shouldKeepPlaceholderName(previous, normalized) ? previous.name : normalized.name,
      sortIndex: previous.sortIndex ?? normalized.sortIndex
    };
    return cameraData[index];
  }

  cameraData.unshift(normalized);
  return normalized;
}

function isGenericCameraPlaceholder(camera = {}) {
  return camera.id === "placeholder-webrtc" || camera.id === "placeholder-rtmp";
}

function mergeLiveStreamsWithPlaceholderCameraData(streams = []) {
  const placeholders = buildPlaceholderCameraData();
  const onlyGenericPlaceholders = placeholders.every(isGenericCameraPlaceholder);
  cameraData = onlyGenericPlaceholders ? [] : placeholders;
  streams.forEach((camera) => upsertCameraDataEntry(camera));
}

async function loadLiveStreams() {
  if (!activeOperationId) return;

  try {
    const res = await fetch(`${API_BASE}/ops/${activeOperationId}/streams?status=ACTIVE`, {
      headers: authHeaders()
    });
    if (!res.ok) return;

    const data = await res.json();
    if (!data.ok || !Array.isArray(data.items)) return;

    const streams = data.items.map(streamToCamera);
    const nextSignature = buildLiveStreamsSignature(streams);
    const streamsChanged = nextSignature !== lastLiveStreamsSignature;
    lastLiveStreamsSignature = nextSignature;
    streams.forEach(rememberCameraMetadata);
    if (streams.length > 0) {
      mergeLiveStreamsWithPlaceholderCameraData(streams);
    } else {
      loadPlaceholderCameraData();
    }
    if (streamsChanged) renderFeeds();
    attachLiveFeeds();
    if (!isSameActivePersonnelCameraFeed()) {
      renderActivePersonnelCamera();
    }
  } catch (err) {
    console.warn("[CAMERAS] No se pudieron cargar streams:", err.message);
  }
}

function buildLiveStreamsSignature(streams = []) {
  return JSON.stringify(
    streams
      .map((stream) => ({
        streamId: Number(stream.streamId || 0),
        playbackKey: stream.playbackKey || getCameraPlaybackKey(stream),
        name: stream.name || "",
        protocol: stream.protocol || "",
        status: stream.status || "",
        publisherSocketId: stream.publisherSocketId || "",
        playbackUrl: stream.playbackUrl || ""
      }))
      .sort((a, b) => a.streamId - b.streamId || a.playbackKey.localeCompare(b.playbackKey))
  );
}

function streamToCamera(stream) {
  const protocol = normalizeCameraProtocol(stream.protocol || "WEBRTC", stream);
  const playbackUrl = stream.playback_url || stream.rtmp_playback_url || "";
  const isPlayableUrl = playbackUrl && !/^rtmp:\/\//i.test(playbackUrl);

  return {
    id: `stream-${stream.id_stream}`,
    streamId: Number(stream.id_stream),
    operationId: Number(stream.id_operacion),
    personnelId: stream.id_personal != null ? Number(stream.id_personal) : null,
    equipoId: stream.id_equipo != null ? Number(stream.id_equipo) : null,
    dispositivoId: stream.id_dispositivo != null ? Number(stream.id_dispositivo) : null,
    userId: stream.id_usuario != null ? Number(stream.id_usuario) : null,
    name: stream.label || `Stream ${stream.id_stream}`,
    protocol,
    protocolFamily: protocol,
    kind: stream.kind,
    status: stream.status || "ACTIVE",
    publisherSocketId: stream.publisher_socket_id,
    hasPublisher: Boolean(stream.publisher_socket_id),
    playbackUrl,
    rtmpPublishUrl: stream.rtmp_publish_url || "",
    rtmpPlaybackUrl: stream.rtmp_playback_url || "",
    isWebRtc: protocol === CAMERA_PROTOCOL_WEBRTC,
    isPlayableUrl: protocol === CAMERA_PROTOCOL_RTMP && Boolean(isPlayableUrl),
    sourceType: stream.source_type || "ANDROID",
    externalDeviceId: stream.external_device_id || "",
    streamKey: stream.stream_key || "",
    viewerCount: stream.viewer_count || 0
  };
}

function getCameraBadge(camera) {
  if (camera.localArchiveOnly) return "LOCAL";
  const protocol = getCameraProtocolFamily(camera);
  if (camera.isPlayableUrl) {
    const state = getPlayableUrlStateForPlaybackKey(camera.playbackKey || getCameraPlaybackKey(camera));
    if (state.live) return "EN VIVO";
    return getWaitingSignalBadge(protocol);
  }
  if (camera.placeholder) return camera.status || getWaitingSignalBadge(protocol);
  if (camera.isWebRtc) {
    return remoteStreams.has(Number(camera.streamId)) ? "EN VIVO" : getWaitingSignalBadge(protocol);
  }
  return getWaitingSignalBadge(protocol);
}

function getOperationStorageKey() {
  return String(activeOperationId || localStorage.getItem("active_operation_id") || "default");
}

function buildSegmentKey(streamId, startedAt) {
  return `${getOperationStorageKey()}:${Number(streamId)}:${Math.round(startedAt)}`;
}

function normalizeCameraNameForKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(grabacion local\)/gi, "")
    .replace(/\(grabación local\)/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isStreamPlaybackKey(value) {
  return /^stream:\d+$/i.test(String(value || ""));
}

function getCameraNameKey(data = {}) {
  return normalizeCameraNameForKey(data.name || data.label || data.cameraName);
}

function getCameraPlaybackKey(camera = {}) {
  const personnelId = camera.personnelId ?? camera.id_personal;
  if (personnelId != null && personnelId !== "") return `person:${personnelId}`;

  const equipoId = camera.equipoId ?? camera.id_equipo;
  if (equipoId != null && equipoId !== "") return `equipo:${equipoId}`;

  const dispositivoId = camera.dispositivoId ?? camera.id_dispositivo;
  if (dispositivoId != null && dispositivoId !== "") return `dispositivo:${dispositivoId}`;

  const userId = camera.userId ?? camera.id_usuario;
  if (userId != null && userId !== "") return `user:${userId}`;

  const deviceId = camera.externalDeviceId ?? camera.external_device_id;
  if (deviceId) return `device:${deviceId}`;

  const nameKey = normalizeCameraNameForKey(camera.name || camera.label || camera.cameraName);
  if (nameKey && !/^stream\s+\d+$/i.test(nameKey)) return `name:${nameKey}`;

  const streamId = Number(camera.streamId ?? camera.id_stream);
  return streamId ? `stream:${streamId}` : "unknown";
}

function getStreamPlaybackKey(streamId) {
  const id = Number(streamId);
  const metadata = cameraArchiveMetadata.get(id);
  if (metadata?.playbackKey) return metadata.playbackKey;

  const archive = getPlaybackArchive(id, false);
  if (archive?.playbackKey) return archive.playbackKey;

  return getCameraPlaybackKey({ streamId: id, ...(metadata || {}) });
}

function getCameraAudioKey(camera = {}) {
  return camera.playbackKey || getCameraPlaybackKey(camera);
}

function isCameraAudioEnabled(audioKey) {
  const key = String(audioKey || "");
  return Boolean(key) && cameraAudioEnabled.has(key);
}

function setVideoAudioState(video, enabled) {
  if (!video) return;
  video.muted = !enabled;
  video.volume = enabled ? 1 : 0;
  if (enabled) {
    video.removeAttribute("muted");
  } else {
    video.setAttribute("muted", "");
  }
}

function getLiveTracks(mediaStream, kind = "all") {
  if (!mediaStream) return [];
  const tracks = kind === "audio"
    ? mediaStream.getAudioTracks()
    : kind === "video"
      ? mediaStream.getVideoTracks()
      : mediaStream.getTracks();
  return tracks.filter((track) => track.readyState === "live");
}

function getExpectedMediaKinds(streamId) {
  const id = Number(streamId);
  const camera = findCameraByStreamId(id);
  const metadata = cameraArchiveMetadata.get(id);
  const kind = String(camera?.kind || metadata?.kind || "AUDIO_VIDEO").trim().toUpperCase();
  return {
    audio: kind !== "VIDEO",
    video: kind !== "AUDIO"
  };
}

function getRecordingMediaStream(streamId, mediaStream) {
  const expected = getExpectedMediaKinds(streamId);
  const audioTracks = expected.audio ? getLiveTracks(mediaStream, "audio") : [];
  const videoTracks = expected.video ? getLiveTracks(mediaStream, "video") : [];

  if (expected.video && videoTracks.length === 0) return null;
  if (expected.audio && !expected.video && audioTracks.length === 0) return null;
  if (audioTracks.length === 0 && videoTracks.length === 0) return null;

  return new MediaStream([...videoTracks, ...audioTracks]);
}

function syncCameraAudioControls(audioKey = null) {
  const targetKey = audioKey == null ? null : String(audioKey);
  document.querySelectorAll("[data-audio-key]").forEach((element) => {
    const key = element.dataset.audioKey || "";
    if (targetKey && key !== targetKey) return;

    const enabled = isCameraAudioEnabled(key);
    if (element.tagName === "VIDEO") {
      setVideoAudioState(element, enabled);
    }

    if (element.classList?.contains("cameraAudioBtn")) {
      element.classList.toggle("active", enabled);
      element.innerHTML = getCameraAudioIconMarkup(enabled);
      element.title = enabled ? "Silenciar audio" : "Activar audio";
      element.setAttribute("aria-label", enabled ? "Silenciar audio" : "Activar audio");
      element.setAttribute("aria-pressed", enabled ? "true" : "false");
    }
  });
}

function getCameraAudioIconMarkup(enabled = false) {
  return enabled
    ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 9v6h4l5 4V5L8 9H4Z"></path>
        <path d="M16.5 8.5a5 5 0 0 1 0 7"></path>
        <path d="M19 6a8.5 8.5 0 0 1 0 12"></path>
      </svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 9v6h4l5 4V5L8 9H4Z"></path>
        <path d="M18 9l4 4"></path>
        <path d="M22 9l-4 4"></path>
      </svg>`;
}

function buildCameraAudioButton(camera = {}) {
  if (!camera.isPlayableUrl && !camera.isWebRtc) return "";
  const audioKey = getCameraAudioKey(camera);
  if (!audioKey || audioKey === "unknown") return "";

  const enabled = isCameraAudioEnabled(audioKey);
  return `
    <button
      class="cameraAudioBtn${enabled ? " active" : ""}"
      type="button"
      data-audio-key="${escapeHtml(audioKey)}"
      aria-pressed="${enabled ? "true" : "false"}"
      aria-label="${enabled ? "Silenciar audio" : "Activar audio"}"
      title="${enabled ? "Silenciar audio" : "Activar audio"}">${getCameraAudioIconMarkup(enabled)}</button>
  `;
}

function getPlaybackGroup(playbackKey, create = true) {
  const key = String(playbackKey || "unknown");
  if (!key || key === "unknown") return null;
  if (!playbackGroups.has(key) && create) {
    playbackGroups.set(key, {
      playbackKey: key,
      isPlaybackGroup: true,
      segments: [],
      streamIds: new Set(),
      activeStreamId: null,
      cameraName: "Cámara",
      operationId: activeOperationId || null,
      operationKey: getOperationStorageKey(),
      personnelId: null,
      equipoId: null,
      dispositivoId: null,
      userId: null,
      externalDeviceId: "",
      sourceType: "ANDROID",
      reviewMode: false,
      forcedLocalReview: false,
      localReviewInitialized: false,
      reviewPosition: 0,
      activeSegmentIndex: 0,
      connectionLost: false
    });
  }
  return playbackGroups.get(key) || null;
}

function sameCameraIdentity(group, data = {}) {
  if (!group) return false;

  const personnelId = data.personnelId ?? data.id_personal;
  if (personnelId != null && group.personnelId != null && String(personnelId) === String(group.personnelId)) {
    return true;
  }

  const equipoId = data.equipoId ?? data.id_equipo;
  if (equipoId != null && group.equipoId != null && String(equipoId) === String(group.equipoId)) {
    return true;
  }

  const dispositivoId = data.dispositivoId ?? data.id_dispositivo;
  if (dispositivoId != null && group.dispositivoId != null && String(dispositivoId) === String(group.dispositivoId)) {
    return true;
  }

  const userId = data.userId ?? data.id_usuario;
  if (userId != null && group.userId != null && String(userId) === String(group.userId)) {
    return true;
  }

  const deviceId = data.externalDeviceId ?? data.external_device_id;
  if (deviceId && group.externalDeviceId && String(deviceId) === String(group.externalDeviceId)) {
    return true;
  }

  const groupName = normalizeCameraNameForKey(group.cameraName);
  const dataName = getCameraNameKey(data);
  return Boolean(groupName && dataName && groupName === dataName);
}

function mergePlaybackGroups(sourceKey, targetKey) {
  if (!sourceKey || !targetKey || sourceKey === targetKey) return;
  const source = playbackGroups.get(sourceKey);
  const target = getPlaybackGroup(targetKey);
  if (!source || !target) return;

  const existingSegmentKeys = new Set(target.segments.map((segment) => segment.key));
  source.segments.forEach((segment) => {
    if (!existingSegmentKeys.has(segment.key)) {
      target.segments.push(segment);
      existingSegmentKeys.add(segment.key);
    }
  });
  target.segments.sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0));

  source.streamIds.forEach((streamId) => target.streamIds.add(streamId));
  target.activeStreamId = target.activeStreamId || source.activeStreamId;
  target.operationId = target.operationId || source.operationId;
  target.operationKey = target.operationKey || source.operationKey;
  target.personnelId = target.personnelId ?? source.personnelId;
  target.equipoId = target.equipoId ?? source.equipoId;
  target.dispositivoId = target.dispositivoId ?? source.dispositivoId;
  target.userId = target.userId ?? source.userId;
  target.externalDeviceId = target.externalDeviceId || source.externalDeviceId;
  target.sourceType = target.sourceType || source.sourceType;
  target.cameraName = normalizeCameraNameForKey(target.cameraName) === "camara" ? source.cameraName : target.cameraName;
  target.connectionLost = target.connectionLost || source.connectionLost;

  playbackArchives.forEach((archive) => {
    if (archive.playbackKey === sourceKey) archive.playbackKey = targetKey;
  });
  cameraArchiveMetadata.forEach((metadata) => {
    if (metadata.playbackKey === sourceKey) metadata.playbackKey = targetKey;
  });
  playbackGroups.delete(sourceKey);
}

function mergeSimilarPlaybackGroups(targetKey, data = {}) {
  const target = getPlaybackGroup(targetKey, false);
  if (!target) return;

  [...playbackGroups.entries()].forEach(([sourceKey, group]) => {
    if (sourceKey === targetKey) return;
    if (group.operationKey && target.operationKey && group.operationKey !== target.operationKey) return;
    if (sameCameraIdentity(group, data) || sameCameraIdentity(target, group)) {
      mergePlaybackGroups(sourceKey, targetKey);
    }
  });
}

function rememberGroupMetadata(playbackKey, data = {}) {
  const group = getPlaybackGroup(playbackKey);
  if (!group) return null;

  const streamId = Number(data.streamId ?? data.id_stream);
  if (streamId) group.streamIds.add(streamId);

  group.operationId = Number(data.operationId ?? data.id_operacion ?? group.operationId ?? activeOperationId) || null;
  group.operationKey = data.operationKey || group.operationKey || getOperationStorageKey();
  group.personnelId = data.personnelId ?? data.id_personal ?? group.personnelId ?? null;
  group.equipoId = data.equipoId ?? data.id_equipo ?? group.equipoId ?? null;
  group.dispositivoId = data.dispositivoId ?? data.id_dispositivo ?? group.dispositivoId ?? null;
  group.userId = data.userId ?? data.id_usuario ?? group.userId ?? null;
  group.externalDeviceId = data.externalDeviceId ?? data.external_device_id ?? group.externalDeviceId ?? "";
  group.sourceType = data.sourceType || data.source_type || group.sourceType || "ANDROID";
  group.cameraName = data.name || data.label || data.cameraName || group.cameraName || (streamId ? `Stream ${streamId}` : "Cámara");
  if (streamId && remoteStreams.has(streamId)) group.activeStreamId = streamId;

  return group;
}

function addSegmentToPlaybackGroup(playbackKey, segment, metadata = {}) {
  const group = rememberGroupMetadata(playbackKey, metadata);
  if (!group || !segment?.blob?.size) return false;

  const key = segment.key || `${playbackKey}:${Math.round(segment.startedAt || Date.now())}`;
  if (group.segments.some((item) => item.key === key)) return false;

  group.segments.push({
    key,
    blob: segment.blob,
    url: URL.createObjectURL(segment.blob),
    startedAt: Number(segment.startedAt || 0),
    endedAt: Number(segment.endedAt || 0),
    duration: Number(segment.duration || 0),
    sourceStreamId: Number(metadata.streamId ?? metadata.id_stream ?? segment.sourceStreamId) || null,
    remoteRecordingId: segment.remoteRecordingId || null
  });
  group.segments.sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0));
  return true;
}

function rememberCameraMetadata(camera = {}) {
  const streamId = Number(camera.streamId ?? camera.id_stream);
  if (!streamId) return;

  const previous = cameraArchiveMetadata.get(streamId) || {};
  const next = {
    ...previous,
    streamId,
    operationId: Number(camera.operationId ?? camera.id_operacion ?? previous.operationId ?? activeOperationId) || null,
    personnelId: camera.personnelId ?? camera.id_personal ?? previous.personnelId ?? null,
    equipoId: camera.equipoId ?? camera.id_equipo ?? previous.equipoId ?? null,
    dispositivoId: camera.dispositivoId ?? camera.id_dispositivo ?? previous.dispositivoId ?? null,
    userId: camera.userId ?? camera.id_usuario ?? previous.userId ?? null,
    externalDeviceId: camera.externalDeviceId ?? camera.external_device_id ?? previous.externalDeviceId ?? "",
    name: camera.name || camera.label || previous.name || `Stream ${streamId}`,
    kind: camera.kind || previous.kind || "AUDIO_VIDEO",
    protocol: normalizeCameraProtocol(camera.protocol || previous.protocol || "WEBRTC", camera),
    protocolFamily: getCameraProtocolFamily(camera),
    sourceType: camera.sourceType || camera.source_type || previous.sourceType || "ANDROID"
  };
  next.playbackKey = getCameraPlaybackKey(next);

  cameraArchiveMetadata.set(streamId, next);
  rememberGroupMetadata(next.playbackKey, next);
  mergeSimilarPlaybackGroups(next.playbackKey, next);

  const archive = getPlaybackArchive(streamId, false);
  if (archive) {
    archive.cameraName = next.name;
    archive.operationId = next.operationId;
    archive.personnelId = next.personnelId;
    archive.equipoId = next.equipoId;
    archive.dispositivoId = next.dispositivoId;
    archive.userId = next.userId;
    archive.externalDeviceId = next.externalDeviceId;
    archive.sourceType = next.sourceType;
    archive.playbackKey = next.playbackKey;
  }
}

function rememberArchiveItemMetadata(archive, item = {}) {
  if (!archive) return;

  const streamId = Number(item.streamId ?? archive.streamId);
  archive.cameraName = item.cameraName || archive.cameraName || `Stream ${streamId}`;
  archive.operationId = Number(item.operationId ?? archive.operationId ?? activeOperationId) || null;
  archive.operationKey = item.operationKey || archive.operationKey || getOperationStorageKey();
  archive.personnelId = item.personnelId ?? archive.personnelId ?? null;
  archive.equipoId = item.equipoId ?? archive.equipoId ?? null;
  archive.dispositivoId = item.dispositivoId ?? archive.dispositivoId ?? null;
  archive.userId = item.userId ?? archive.userId ?? null;
  archive.externalDeviceId = item.externalDeviceId ?? archive.externalDeviceId ?? "";
  archive.sourceType = item.sourceType || archive.sourceType || "ANDROID";
  const metadataPlaybackKey = getCameraPlaybackKey({
    streamId,
    personnelId: archive.personnelId,
    equipoId: archive.equipoId,
    dispositivoId: archive.dispositivoId,
    userId: archive.userId,
    externalDeviceId: archive.externalDeviceId,
    cameraName: archive.cameraName
  });
  archive.playbackKey = item.playbackKey && !isStreamPlaybackKey(item.playbackKey)
    ? item.playbackKey
    : archive.playbackKey && !isStreamPlaybackKey(archive.playbackKey)
      ? archive.playbackKey
      : metadataPlaybackKey;

  cameraArchiveMetadata.set(streamId, {
    ...(cameraArchiveMetadata.get(streamId) || {}),
    streamId,
    operationId: archive.operationId,
    personnelId: archive.personnelId,
    equipoId: archive.equipoId,
    dispositivoId: archive.dispositivoId,
    userId: archive.userId,
    externalDeviceId: archive.externalDeviceId,
    name: archive.cameraName,
    sourceType: archive.sourceType,
    protocol: "WEBRTC",
    playbackKey: archive.playbackKey
  });
  rememberGroupMetadata(archive.playbackKey, archive);
  mergeSimilarPlaybackGroups(archive.playbackKey, archive);
}

function openVideoBufferDb() {
  if (!window.indexedDB) return Promise.resolve(null);
  if (videoBufferDbPromise) return videoBufferDbPromise;

  videoBufferDbPromise = new Promise((resolve) => {
    let request = null;
    try {
      request = indexedDB.open(VIDEO_BUFFER_DB, 1);
    } catch (err) {
      console.warn("[CAMERAS] IndexedDB bloqueado para buffer local:", err.message);
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(VIDEO_BUFFER_STORE)
        ? request.transaction.objectStore(VIDEO_BUFFER_STORE)
        : db.createObjectStore(VIDEO_BUFFER_STORE, { keyPath: "key" });

      if (!store.indexNames.contains("operationStream")) {
        store.createIndex("operationStream", ["operationKey", "streamId"], { unique: false });
      }
      if (!store.indexNames.contains("startedAt")) {
        store.createIndex("startedAt", "startedAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn("[CAMERAS] IndexedDB no disponible para buffer local:", request.error?.message || request.error);
      resolve(null);
    };
    request.onblocked = () => resolve(null);
  });

  return videoBufferDbPromise;
}

async function saveSegmentToLocalDb(streamId, segment) {
  const db = await openVideoBufferDb();
  if (!segment?.blob?.size) return;
  if (!db) {
    void uploadSegmentToBackend(streamId, segment);
    return;
  }

  const operationKey = getOperationStorageKey();
  const key = segment.key || buildSegmentKey(streamId, segment.startedAt);
  const archive = getPlaybackArchive(streamId, false);
  const metadata = cameraArchiveMetadata.get(Number(streamId)) || {};
  const playbackKey = metadata.playbackKey || archive?.playbackKey || getStreamPlaybackKey(streamId);
  segment.key = key;

  await new Promise((resolve) => {
    const tx = db.transaction(VIDEO_BUFFER_STORE, "readwrite");
    tx.objectStore(VIDEO_BUFFER_STORE).put({
      key,
      operationKey,
      streamId: Number(streamId),
      operationId: metadata.operationId ?? archive?.operationId ?? activeOperationId ?? null,
      personnelId: metadata.personnelId ?? archive?.personnelId ?? null,
      userId: metadata.userId ?? archive?.userId ?? null,
      externalDeviceId: metadata.externalDeviceId ?? archive?.externalDeviceId ?? "",
      playbackKey,
      cameraName: metadata.name || archive?.cameraName || `Stream ${streamId}`,
      sourceType: metadata.sourceType || archive?.sourceType || "ANDROID",
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      duration: segment.duration,
      mimeType: segment.blob.type || "video/webm",
      blob: segment.blob
    });
    tx.oncomplete = resolve;
    tx.onerror = () => {
      console.warn("[CAMERAS] No se pudo guardar segmento local:", tx.error?.message || tx.error);
      resolve();
    };
  });

  void uploadSegmentToBackend(streamId, segment);
}

async function markLocalSegmentUploaded(key, recording) {
  if (!key || !recording) return;
  const db = await openVideoBufferDb();
  if (!db) return;

  await new Promise((resolve) => {
    const tx = db.transaction(VIDEO_BUFFER_STORE, "readwrite");
    const store = tx.objectStore(VIDEO_BUFFER_STORE);
    const request = store.get(key);
    request.onsuccess = () => {
      const item = request.result;
      if (item) {
        item.remoteRecordingId = recording.id_recording;
        item.remoteDownloadUrl = recording.download_url;
        item.uploadedAt = new Date().toISOString();
        store.put(item);
      }
    };
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

async function uploadSegmentToBackend(streamId, segment) {
  const operationId = activeOperationId || localStorage.getItem("active_operation_id");
  if (!operationId || !streamId || !segment?.blob?.size) return;

  try {
    const durationMs = Math.max(0, Math.round((segment.duration || 0) * 1000));
    const params = new URLSearchParams({ duration_ms: String(durationMs) });
    if (segment.startedAt) params.set("started_at", new Date(segment.startedAt).toISOString());
    if (segment.endedAt) params.set("ended_at", new Date(segment.endedAt).toISOString());
    const response = await fetch(
      `${API_BASE}/ops/${encodeURIComponent(operationId)}/streams/${encodeURIComponent(streamId)}/recordings?${params.toString()}`,
      {
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": segment.blob.type || "video/webm"
        },
        body: segment.blob
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.mensaje || `HTTP ${response.status}`);
    }
    segment.remoteRecordingId = data.recording?.id_recording || null;
    void markLocalSegmentUploaded(segment.key, data.recording);
  } catch (err) {
    console.warn("[CAMERAS] Grabación local pendiente de subir a BD:", err.message);
  }
}

async function retryPendingRecordingUploads() {
  const db = await openVideoBufferDb();
  if (!db) return;

  const operationKey = getOperationStorageKey();
  const items = await new Promise((resolve) => {
    const tx = db.transaction(VIDEO_BUFFER_STORE, "readonly");
    const request = tx.objectStore(VIDEO_BUFFER_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });

  for (const item of items) {
    if (item?.operationKey !== operationKey || item.remoteRecordingId || !item.blob?.size || !item.streamId) continue;
    await uploadSegmentToBackend(item.streamId, {
      key: item.key,
      blob: item.blob,
      duration: Number(item.duration || 0),
      startedAt: Number(item.startedAt || 0),
      endedAt: Number(item.endedAt || 0)
    });
  }
}

function removeSegmentFromMemory(key) {
  if (!key) return;

  const removeFromArchive = (archive) => {
    const nextSegments = [];
    (archive.segments || []).forEach((segment) => {
      if (segment.key === key) {
        if (segment.url) URL.revokeObjectURL(segment.url);
        return;
      }
      nextSegments.push(segment);
    });
    archive.segments = nextSegments;
    archive.activeSegmentIndex = Math.min(archive.activeSegmentIndex || 0, Math.max(0, nextSegments.length - 1));
  };

  playbackArchives.forEach(removeFromArchive);
  playbackGroups.forEach(removeFromArchive);
}

async function getBackendRecordingIdsForOperation() {
  const recordings = await fetchBackendRecordingsForOperation();
  if (!recordings) return null;

  return new Set(
    recordings
      .map((recording) => Number(recording.id_recording))
      .filter((id) => Number.isFinite(id) && id > 0)
  );
}

async function fetchBackendRecordingsForOperation() {
  const operationId = activeOperationId || localStorage.getItem("active_operation_id");
  if (!operationId) return null;
  try {
    const res = await fetch(`${API_BASE}/ops/${encodeURIComponent(operationId)}/streams/recordings`, {
      headers: authHeaders()
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (!data.ok || !Array.isArray(data.items)) return null;

    return data.items;
  } catch (err) {
    console.warn("[CAMERAS] No se pudieron validar grabaciones remotas:", err.message);
    return null;
  }
}

function uniqueBackendRecordings(recordings = []) {
  const seen = new Set();
  return recordings.filter((recording) => {
    const idStream = Number(recording.id_stream);
    const createdBucket = Math.round((Date.parse(recording.created_at) || 0) / 1000);
    const key = [
      idStream,
      Number(recording.size_bytes || 0),
      Number(recording.duration_ms || 0),
      createdBucket
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getRecordingDurationSeconds(recording) {
  const durationMs = Number(recording.duration_ms || 0);
  return Math.max(0.25, durationMs > 0 ? durationMs / 1000 : 1);
}

function buildBackendRecordingTimeline(recordings = []) {
  const groups = new Map();
  uniqueBackendRecordings(recordings)
    .filter((recording) => Number(recording.id_stream) && recording.download_url)
    .forEach((recording) => {
      const streamId = Number(recording.id_stream);
      if (!groups.has(streamId)) groups.set(streamId, []);
      groups.get(streamId).push(recording);
    });

  const items = [];
  groups.forEach((streamRecordings, streamId) => {
    const sorted = streamRecordings.sort((a, b) => {
      const aStart = Date.parse(a.recorded_started_at || "") || Date.parse(a.created_at || "") || Number(a.id_recording || 0);
      const bStart = Date.parse(b.recorded_started_at || "") || Date.parse(b.created_at || "") || Number(b.id_recording || 0);
      if (aStart !== bStart) return aStart - bStart;
      return Number(a.id_recording || 0) - Number(b.id_recording || 0);
    });

    const fallbackTotalMs = sorted.reduce((sum, recording) => sum + getRecordingDurationSeconds(recording) * 1000, 0);
    let fallbackCursor = (Date.parse(sorted[0]?.created_at || "") || Date.now()) - fallbackTotalMs;

    sorted.forEach((recording) => {
      const duration = getRecordingDurationSeconds(recording);
      const explicitStartedAt = Date.parse(recording.recorded_started_at || "");
      const explicitEndedAt = Date.parse(recording.recorded_ended_at || "");
      const startedAt = Number.isFinite(explicitStartedAt)
        ? explicitStartedAt
        : fallbackCursor;
      const endedAt = Number.isFinite(explicitEndedAt)
        ? explicitEndedAt
        : startedAt + duration * 1000;
      fallbackCursor = endedAt;

      items.push({
        recording,
        streamId,
        startedAt,
        endedAt,
        duration
      });
    });
  });

  return items.sort((a, b) => a.startedAt - b.startedAt);
}

function backendRecordingToArchiveItem(recording, blob, timelineItem) {
  const streamId = Number(recording.id_stream);
  const cameraName = recording.stream_label || `Stream ${streamId}`;
  const metadata = {
    key: `remote:${recording.id_recording}`,
    operationKey: getOperationStorageKey(),
    streamId,
    operationId: Number(recording.id_operacion || activeOperationId) || null,
    personnelId: recording.id_personal != null ? Number(recording.id_personal) : null,
    equipoId: recording.id_equipo != null ? Number(recording.id_equipo) : null,
    dispositivoId: recording.id_dispositivo != null ? Number(recording.id_dispositivo) : null,
    userId: recording.id_usuario != null ? Number(recording.id_usuario) : null,
    externalDeviceId: recording.external_device_id || "",
    playbackKey: getCameraPlaybackKey({
      streamId,
      id_personal: recording.id_personal,
      id_equipo: recording.id_equipo,
      id_dispositivo: recording.id_dispositivo,
      id_usuario: recording.id_usuario,
      external_device_id: recording.external_device_id,
      name: cameraName
    }),
    cameraName,
    sourceType: recording.source_type || "REMOTE",
    startedAt: timelineItem.startedAt,
    endedAt: timelineItem.endedAt,
    duration: timelineItem.duration,
    mimeType: blob.type || recording.mime_type || "video/webm",
    blob,
    remoteRecordingId: Number(recording.id_recording) || null,
    remoteDownloadUrl: recording.download_url
  };

  return metadata;
}

async function loadBackendRecordingsForOperation() {
  const recordings = await fetchBackendRecordingsForOperation();
  if (!recordings?.length) return false;

  let addedAny = false;
  for (const timelineItem of buildBackendRecordingTimeline(recordings)) {
    const { recording, streamId } = timelineItem;
    const archive = getPlaybackArchive(streamId);
    const key = `remote:${recording.id_recording}`;
    const remoteRecordingId = Number(recording.id_recording);
    if (archive.segments.some((segment) => segment.key === key || Number(segment.remoteRecordingId) === remoteRecordingId)) {
      continue;
    }

    try {
      const res = await fetch(absoluteUrl(recording.download_url), { headers: authHeaders() });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.size) continue;

      const item = backendRecordingToArchiveItem(recording, blob, timelineItem);
      const existingKeys = new Set(archive.segments.map((segment) => segment.key).filter(Boolean));
      addedAny = addPersistedSegmentToArchive(archive, item, existingKeys) || addedAny;
      archive.segments.sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0));
      archive.persistedLoaded = true;
      updatePlaybackControls(streamId);
      updatePlaybackControls(archive.playbackKey);
    } catch (err) {
      console.warn("[CAMERAS] No se pudo descargar grabacion remota:", err.message);
    }
  }

  return addedAny;
}

async function pruneDeletedRemoteSegmentsForOperation() {
  const remoteRecordingIds = await getBackendRecordingIdsForOperation();
  if (!remoteRecordingIds) return;

  const db = await openVideoBufferDb();
  if (!db) return;

  const operationKey = getOperationStorageKey();
  const items = await new Promise((resolve) => {
    const tx = db.transaction(VIDEO_BUFFER_STORE, "readonly");
    const request = tx.objectStore(VIDEO_BUFFER_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });

  const staleKeys = items
    .filter((item) => item?.operationKey === operationKey)
    .filter((item) => item.remoteRecordingId && !remoteRecordingIds.has(Number(item.remoteRecordingId)))
    .map((item) => item.key)
    .filter(Boolean);

  if (staleKeys.length === 0) return;

  await new Promise((resolve) => {
    const tx = db.transaction(VIDEO_BUFFER_STORE, "readwrite");
    const store = tx.objectStore(VIDEO_BUFFER_STORE);
    staleKeys.forEach((key) => store.delete(key));
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });

  staleKeys.forEach(removeSegmentFromMemory);
}

function shouldClearVideoBufferFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return ["1", "true", "yes"].includes(String(params.get("clearVideoBuffer") || "").toLowerCase());
}

function clearVideoBufferUrlFlag() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("clearVideoBuffer")) return;
  url.searchParams.delete("clearVideoBuffer");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

async function clearLocalVideoBufferForOperation({ render = true } = {}) {
  const db = await openVideoBufferDb();
  if (!db) return 0;

  const operationKey = getOperationStorageKey();
  const items = await new Promise((resolve) => {
    const tx = db.transaction(VIDEO_BUFFER_STORE, "readonly");
    const request = tx.objectStore(VIDEO_BUFFER_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });

  const keys = items
    .filter((item) => item?.operationKey === operationKey)
    .map((item) => item.key)
    .filter(Boolean);

  if (keys.length === 0) return 0;

  await new Promise((resolve) => {
    const tx = db.transaction(VIDEO_BUFFER_STORE, "readwrite");
    const store = tx.objectStore(VIDEO_BUFFER_STORE);
    keys.forEach((key) => store.delete(key));
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });

  keys.forEach(removeSegmentFromMemory);
  if (render) {
    renderFeeds();
    attachLiveFeeds();
    renderActivePersonnelCamera();
  }
  return keys.length;
}

function clearLocalVideoBufferMemory(keys = null) {
  const targetKeys = keys ? new Set(keys.filter(Boolean)) : null;

  const clearArchive = (archive) => {
    const nextSegments = [];
    (archive.segments || []).forEach((segment) => {
      if (!targetKeys || targetKeys.has(segment.key)) {
        if (segment.url) URL.revokeObjectURL(segment.url);
        return;
      }
      nextSegments.push(segment);
    });
    archive.segments = nextSegments;
    archive.activeSegmentIndex = Math.min(archive.activeSegmentIndex || 0, Math.max(0, nextSegments.length - 1));
    archive.reviewMode = false;
    archive.localReviewInitialized = false;
    archive.forcedLocalReview = false;
  };

  playbackArchives.forEach(clearArchive);
  playbackGroups.forEach(clearArchive);
  cameraData = cameraData.filter((camera) => !camera.localArchiveOnly);
  operationArchiveLoadPromise = null;
}

async function clearAllLocalVideoBuffer({ render = true } = {}) {
  const db = await openVideoBufferDb();
  if (!db) return 0;

  const keys = await new Promise((resolve) => {
    const tx = db.transaction(VIDEO_BUFFER_STORE, "readonly");
    const request = tx.objectStore(VIDEO_BUFFER_STORE).getAllKeys();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });

  await new Promise((resolve) => {
    const tx = db.transaction(VIDEO_BUFFER_STORE, "readwrite");
    tx.objectStore(VIDEO_BUFFER_STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });

  clearLocalVideoBufferMemory(keys.map(String));

  if (render) {
    renderFeeds();
    attachLiveFeeds();
    renderActivePersonnelCamera();
  }

  return keys.length;
}

async function clearLocalVideoBufferAfterSetupReset() {
  try {
    const res = await fetch(`${SETUP_CLEANUP_MARKER_URL}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return false;

    const marker = await res.json().catch(() => null);
    const token = String(marker?.token || "").trim();
    if (!token || localStorage.getItem(SETUP_CLEANUP_STORAGE_KEY) === token) return false;

    await clearAllLocalVideoBuffer({ render: false });
    localStorage.setItem(SETUP_CLEANUP_STORAGE_KEY, token);
    return true;
  } catch {
    return false;
  }
}

window.clearOperacionesVideoBuffer = () => clearLocalVideoBufferForOperation();
window.clearOperacionesVideoBufferAll = () => clearAllLocalVideoBuffer();

function addPersistedSegmentToArchive(archive, item, existingKeys = null) {
  if (!archive || !item?.blob?.size) return false;
  if (existingKeys?.has(item.key)) return false;

  const segment = {
    key: item.key,
    blob: item.blob,
    url: URL.createObjectURL(item.blob),
    startedAt: Number(item.startedAt || 0),
    endedAt: Number(item.endedAt || 0),
    duration: Number(item.duration || 0),
    sourceStreamId: Number(item.streamId || archive.streamId) || null,
    remoteRecordingId: item.remoteRecordingId || null
  };
  archive.segments.push(segment);
  rememberArchiveItemMetadata(archive, item);
  addSegmentToPlaybackGroup(archive.playbackKey || item.playbackKey, segment, {
    ...item,
    streamId: Number(item.streamId || archive.streamId) || null,
    name: item.cameraName || archive.cameraName
  });
  existingKeys?.add(item.key);
  return true;
}

async function deleteLocalSegmentByKey(key) {
  if (!key) return;
  const db = await openVideoBufferDb();
  if (!db) return;

  await new Promise((resolve) => {
    const tx = db.transaction(VIDEO_BUFFER_STORE, "readwrite");
    tx.objectStore(VIDEO_BUFFER_STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

async function loadPersistedSegmentsForStream(streamId) {
  const archive = getPlaybackArchive(streamId);
  if (!archive || archive.persistedLoaded) return;
  if (archive.persistedLoading) return archive.persistedLoading;

  archive.persistedLoading = (async () => {
    const db = await openVideoBufferDb();
    if (!db) {
      archive.persistedLoaded = true;
      return;
    }

    const operationKey = getOperationStorageKey();
    const items = await new Promise((resolve) => {
      const tx = db.transaction(VIDEO_BUFFER_STORE, "readonly");
      const index = tx.objectStore(VIDEO_BUFFER_STORE).index("operationStream");
      const request = index.getAll([operationKey, Number(streamId)]);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });

    const existingKeys = new Set(archive.segments.map((segment) => segment.key).filter(Boolean));
    let addedAny = false;
    items
      .sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0))
      .forEach((item) => {
        addedAny = addPersistedSegmentToArchive(archive, item, existingKeys) || addedAny;
      });

    archive.segments.sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0));
    trimArchive(archive);
    archive.persistedLoaded = true;
    updatePlaybackControls(streamId);
    updatePlaybackControls(archive.playbackKey);
    if (addedAny) {
      renderFeeds();
      attachLiveFeeds();
      renderActivePersonnelCamera();
    }
  })().finally(() => {
    archive.persistedLoading = null;
  });

  return archive.persistedLoading;
}

async function loadPersistedSegmentsForOperation() {
  const operationKey = getOperationStorageKey();
  if (operationArchiveLoadPromise && operationArchiveLoadKey === operationKey) {
    return operationArchiveLoadPromise;
  }

  operationArchiveLoadKey = operationKey;
  operationArchiveLoadPromise = (async () => {
    const db = await openVideoBufferDb();
    const items = db
      ? await new Promise((resolve) => {
          const tx = db.transaction(VIDEO_BUFFER_STORE, "readonly");
          const request = tx.objectStore(VIDEO_BUFFER_STORE).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => resolve([]);
        })
      : [];

    let addedAny = false;
    const byStream = new Map();
    items
      .filter((item) => item?.operationKey === operationKey && Number(item.streamId))
      .sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0))
      .forEach((item) => {
        const streamId = Number(item.streamId);
        if (!byStream.has(streamId)) byStream.set(streamId, []);
        byStream.get(streamId).push(item);
      });

    byStream.forEach((streamItems, streamId) => {
      const archive = getPlaybackArchive(streamId);
      const existingKeys = new Set(archive.segments.map((segment) => segment.key).filter(Boolean));
      streamItems.forEach((item) => {
        addedAny = addPersistedSegmentToArchive(archive, item, existingKeys) || addedAny;
      });
      archive.segments.sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0));
      archive.persistedLoaded = true;
      trimArchive(archive);
      updatePlaybackControls(streamId);
      updatePlaybackControls(archive.playbackKey);
    });

    addedAny = await loadBackendRecordingsForOperation() || addedAny;

    if (addedAny) {
      renderFeeds();
    }
  })();

  return operationArchiveLoadPromise;
}

function getSupportedRecorderMimeType(mediaStream = null) {
  if (!window.MediaRecorder) return "";
  const hasVideo = Boolean(mediaStream?.getVideoTracks?.().length);
  const hasAudio = Boolean(mediaStream?.getAudioTracks?.().length);
  const candidates = hasVideo
    ? hasAudio
      ? [
          "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
          "video/mp4",
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm"
        ]
      : [
          "video/mp4;codecs=avc1.42E01E",
          "video/mp4",
          "video/webm;codecs=vp9",
          "video/webm;codecs=vp8",
          "video/webm"
        ]
    : [
        "audio/webm;codecs=opus",
        "audio/webm",
        "video/webm"
      ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function getPlaybackArchive(streamId, create = true) {
  const id = Number(streamId);
  if (!id) return null;
  if (!playbackArchives.has(id) && create) {
    playbackArchives.set(id, {
      streamId: id,
      segments: [],
      recorder: null,
      recorderStream: null,
      recorderSourceType: "",
      mimeType: "",
      currentChunks: [],
      currentStartedAt: 0,
      rollTimer: null,
      resumeAfterStop: false,
      connectionLost: false,
      reviewMode: false,
      forcedLocalReview: false,
      localReviewInitialized: false,
      reviewPosition: 0,
      activeSegmentIndex: 0,
      persistedLoaded: false,
      persistedLoading: null,
      cameraName: cameraArchiveMetadata.get(id)?.name || `Stream ${id}`,
      operationId: cameraArchiveMetadata.get(id)?.operationId || activeOperationId || null,
      operationKey: getOperationStorageKey(),
      personnelId: cameraArchiveMetadata.get(id)?.personnelId ?? null,
      userId: cameraArchiveMetadata.get(id)?.userId ?? null,
      externalDeviceId: cameraArchiveMetadata.get(id)?.externalDeviceId || "",
      sourceType: cameraArchiveMetadata.get(id)?.sourceType || "ANDROID",
      playbackKey: cameraArchiveMetadata.get(id)?.playbackKey || getCameraPlaybackKey({
        streamId: id,
        ...(cameraArchiveMetadata.get(id) || {})
      })
    });
    rememberGroupMetadata(playbackArchives.get(id).playbackKey, playbackArchives.get(id));
  }
  return playbackArchives.get(id) || null;
}

function getArchiveDuration(archive) {
  return (archive?.segments || []).reduce((sum, segment) => sum + segment.duration, 0);
}

function getCurrentRecordingDuration(archive) {
  if (!archive?.recorder || archive.recorder.state === "inactive" || !archive.currentStartedAt) return 0;
  return Math.max(0, (Date.now() - archive.currentStartedAt) / 1000);
}

function getGroupCurrentRecordingDuration(group) {
  if (!group?.isPlaybackGroup) return 0;
  let duration = 0;
  group.streamIds.forEach((streamId) => {
    const archive = getPlaybackArchive(streamId, false);
    duration = Math.max(duration, getCurrentRecordingDuration(archive));
  });
  return duration;
}

function getPlaybackMax(archive) {
  return getArchiveDuration(archive) + (archive?.isPlaybackGroup ? getGroupCurrentRecordingDuration(archive) : getCurrentRecordingDuration(archive));
}

function formatPlaybackTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = Math.floor(safe % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function getSegmentStart(archive, index) {
  let start = 0;
  for (let i = 0; i < index; i += 1) {
    start += archive.segments[i]?.duration || 0;
  }
  return start;
}

function locateSegmentAt(archive, seconds) {
  if (!archive?.segments?.length) return null;
  let cursor = 0;
  const target = Math.max(0, Number(seconds) || 0);

  for (let index = 0; index < archive.segments.length; index += 1) {
    const segment = archive.segments[index];
    const next = cursor + segment.duration;
    if (target <= next || index === archive.segments.length - 1) {
      return {
        index,
        segment,
        offset: Math.max(0, Math.min(segment.duration - 0.1, target - cursor)),
        start: cursor
      };
    }
    cursor = next;
  }

  return null;
}

function trimArchive(archive) {
  while (archive.segments.length > 1 && getArchiveDuration(archive) > MAX_LOCAL_ARCHIVE_SECONDS) {
    const removed = archive.segments.shift();
    if (removed?.url) URL.revokeObjectURL(removed.url);
    if (removed?.key) void deleteLocalSegmentByKey(removed.key);
    archive.activeSegmentIndex = Math.max(0, archive.activeSegmentIndex - 1);
  }
}

function getTimelineArchive(playbackKeyOrStreamId, create = false) {
  if (typeof playbackKeyOrStreamId === "string" && playbackKeyOrStreamId.includes(":")) {
    return getPlaybackGroup(playbackKeyOrStreamId, create);
  }
  const streamId = Number(playbackKeyOrStreamId);
  const playbackKey = getStreamPlaybackKey(streamId);
  return getPlaybackGroup(playbackKey, create) || getPlaybackArchive(streamId, create);
}

function enterLocalReview(playbackKeyOrStreamId, { secondsFromEnd = 5 } = {}) {
  const archive = getTimelineArchive(playbackKeyOrStreamId, false);
  if (!archive?.segments?.length) return false;

  archive.connectionLost = true;
  archive.reviewMode = true;
  archive.forcedLocalReview = true;
  archive.localReviewInitialized = true;
  archive.reviewPosition = Math.max(0, getArchiveDuration(archive) - Math.max(0, Number(secondsFromEnd) || 0));
  attachMediaStateForPlaybackKey(archive.playbackKey || getStreamPlaybackKey(playbackKeyOrStreamId));
  updatePlaybackControls(archive.playbackKey || playbackKeyOrStreamId);
  return true;
}

function finalizeCurrentSegment(streamId) {
  const archive = getPlaybackArchive(streamId, false);
  if (!archive || archive.currentChunks.length === 0 || !archive.currentStartedAt) {
    if (archive) {
      archive.currentChunks = [];
      archive.currentStartedAt = 0;
    }
    return;
  }

  const endedAt = Date.now();
  const duration = Math.max(0.25, (endedAt - archive.currentStartedAt) / 1000);
  const blob = new Blob(archive.currentChunks, {
    type: archive.mimeType || archive.currentChunks[0]?.type || "video/webm"
  });

  archive.currentChunks = [];
  archive.currentStartedAt = 0;

  if (!blob.size) return;

  const segment = {
    key: buildSegmentKey(streamId, endedAt - duration * 1000),
    blob,
    url: URL.createObjectURL(blob),
    startedAt: endedAt - duration * 1000,
    endedAt,
    duration
  };
  archive.segments.push(segment);
  addSegmentToPlaybackGroup(archive.playbackKey, segment, {
    streamId,
    operationId: archive.operationId,
    operationKey: archive.operationKey,
    personnelId: archive.personnelId,
    userId: archive.userId,
    externalDeviceId: archive.externalDeviceId,
    name: archive.cameraName,
    sourceType: archive.sourceType
  });
  trimArchive(archive);
  void saveSegmentToLocalDb(streamId, segment);

  if (archive.connectionLost && !remoteStreams.has(Number(streamId)) && !archive.reviewMode) {
    enterLocalReview(archive.playbackKey, { secondsFromEnd: Math.min(5, segment.duration) });
    renderFeeds();
    renderActivePersonnelCamera();
  }

  updatePlaybackControls(streamId);
  updatePlaybackControls(archive.playbackKey);
}

function stopLocalRecorder(streamId, { resume = false, markLost = false } = {}) {
  const archive = getPlaybackArchive(streamId, false);
  if (!archive) return;

  archive.resumeAfterStop = Boolean(resume);
  if (markLost) archive.connectionLost = true;

  if (archive.rollTimer) {
    window.clearTimeout(archive.rollTimer);
    archive.rollTimer = null;
  }

  const recorder = archive.recorder;
  if (!recorder || recorder.state === "inactive") {
    finalizeCurrentSegment(streamId);
    return;
  }

  try {
    recorder.requestData?.();
    recorder.stop();
  } catch {
    finalizeCurrentSegment(streamId);
  }
}

function startLocalRecorder(streamId, mediaStream, recorderConfig = {}) {
  const id = Number(streamId);
  if (!id || !mediaStream || !window.MediaRecorder) return;

  const archive = getPlaybackArchive(id);
  if (!archive) return;
  if (archive.recorder && archive.recorder.state !== "inactive") return;

  const recordingStream = getRecordingMediaStream(id, mediaStream);
  if (!recordingStream) return;

  const mimeType = getSupportedRecorderMimeType(recordingStream);
  const recorderOptions = {
    ...(mimeType ? { mimeType } : {}),
    ...(recordingStream.getVideoTracks().length
      ? { videoBitsPerSecond: RECORDING_VIDEO_BITS_PER_SECOND }
      : {}),
    ...(recordingStream.getAudioTracks().length
      ? { audioBitsPerSecond: RECORDING_AUDIO_BITS_PER_SECOND }
      : {})
  };

  try {
    const recorder = new MediaRecorder(recordingStream, recorderOptions);
    archive.recorder = recorder;
    archive.recorderStream = mediaStream;
    archive.recorderSourceType = recorderConfig.sourceType || "webrtc";
    archive.mimeType = mimeType || recorder.mimeType || "";
    archive.currentChunks = [];
    archive.currentStartedAt = Date.now();
    archive.connectionLost = false;

    recorder.ondataavailable = (event) => {
      if (event.data?.size) archive.currentChunks.push(event.data);
    };

    recorder.onstop = () => {
      const shouldResume = archive.resumeAfterStop;
      const sourceStream = archive.recorderStream;
      const sourceType = archive.recorderSourceType || "webrtc";
      archive.resumeAfterStop = false;
      archive.recorder = null;
      archive.recorderStream = null;
      archive.recorderSourceType = "";
      finalizeCurrentSegment(id);

      const stillLive = sourceType === "playable-url"
        ? playableLiveStreams.get(id)?.stream === sourceStream
        : remoteStreams.get(id) === sourceStream;

      if (shouldResume && stillLive) {
        startLocalRecorder(id, sourceStream, { sourceType });
      }
    };

    // Mantiene una sola grabacion durante toda la transmision. El intervalo
    // entrega datos progresivamente sin cerrar ni fragmentar el archivo.
    recorder.start(RECORDING_SLICE_MS);
  } catch (err) {
    console.warn("[CAMERAS] No se pudo iniciar buffer local:", err.message);
  }
}

function handleStreamConnectionLost(streamId) {
  const archive = getPlaybackArchive(streamId, false);
  if (!archive) return;
  freezeCurrentVideoFrame(archive.playbackKey);
  archive.connectionLost = true;
  const group = getPlaybackGroup(archive.playbackKey, false);
  if (group) group.connectionLost = true;
  stopLocalRecorder(streamId, { markLost: true });
  enterLocalReview(archive.playbackKey);
  updatePlaybackControls(streamId);
  updatePlaybackControls(archive.playbackKey);
}

function handleStreamConnectionRestored(streamId, mediaStream) {
  const archive = getPlaybackArchive(streamId);
  if (archive) archive.connectionLost = false;
  const group = getPlaybackGroup(archive?.playbackKey || getStreamPlaybackKey(streamId));
  if (group) {
    group.connectionLost = false;
    group.activeStreamId = Number(streamId);
    group.streamIds.add(Number(streamId));
  }
  startLocalRecorder(streamId, mediaStream);
  if (group?.forcedLocalReview || archive?.forcedLocalReview) {
    if (archive) archive.forcedLocalReview = false;
    group.forcedLocalReview = false;
    returnToLive(group.playbackKey);
  }
  updatePlaybackControls(streamId);
  updatePlaybackControls(group?.playbackKey || archive?.playbackKey || getStreamPlaybackKey(streamId));
}

function renderFeeds() {
  if (!dom.cameraFeeds) return;
  destroyHlsPlayersIn(dom.cameraFeeds);
  dom.cameraFeeds.innerHTML = "";
  const renderableCameras = getRenderableCameraDataForCurrentFilter();
  if (!renderableCameras.length) {
    dom.cameraFeeds.appendChild(createCameraEmptyState());
  }
  renderableCameras.forEach((camera) => {
    dom.cameraFeeds.appendChild(createFeedElement(camera));
  });
  syncCameraSourceButtons();
  ensureFocusedCameraInSpeakerLayout();
  syncCameraPanelDensity();
  syncCameraNavigationControls();
  attachPlayableUrlFeeds(dom.cameraFeeds);
  attachKnownMediaStreams();
}

function hasPlayableArchive(archive) {
  return Boolean(archive?.segments?.length);
}

function safeDomId(value) {
  return String(value || "camera").replace(/[^a-z0-9_-]+/gi, "-");
}

function buildLocalArchiveCameraForGroup(group) {
  const streamId = group.activeStreamId || [...group.streamIds][0] || null;
  return {
    id: `archive-${safeDomId(group.playbackKey)}`,
    streamId,
    playbackKey: group.playbackKey,
    operationId: group.operationId || activeOperationId,
    personnelId: group.personnelId ?? null,
    equipoId: group.equipoId ?? null,
    dispositivoId: group.dispositivoId ?? null,
    userId: group.userId ?? null,
    externalDeviceId: group.externalDeviceId || "",
    name: `${group.cameraName || "Cámara"} (grabación local)`,
    protocol: "WEBRTC",
    kind: "archive",
    status: "LOCAL",
    publisherSocketId: "",
    hasPublisher: false,
    playbackUrl: "",
    rtmpPublishUrl: "",
    isWebRtc: true,
    isPlayableUrl: false,
    sourceType: group.sourceType || "LOCAL",
    viewerCount: 0,
    localArchiveOnly: true,
    hasLocalArchive: true
  };
}

function getRenderableCameraData() {
  const slots = new Map();
  const slotNameKeys = new Map();

  const rememberSlotName = (camera, playbackKey) => {
    const nameKey = getCameraNameKey(camera);
    if (nameKey) slotNameKeys.set(nameKey, playbackKey);
  };

  cameraData
    .filter((camera) => camera.placeholder)
    .forEach((camera) => {
      const playbackKey = camera.playbackKey || getCameraPlaybackKey(camera);
      const placeholder = {
        ...camera,
        id: `camera-${safeDomId(playbackKey || camera.id)}`,
        playbackKey,
        hasLocalArchive: false
      };
      slots.set(playbackKey, placeholder);
      rememberSlotName(placeholder, playbackKey);
    });

  cameraData
    .filter((camera) => !camera.placeholder)
    .forEach((camera) => {
      rememberCameraMetadata(camera);
      const basePlaybackKey = camera.playbackKey || getCameraPlaybackKey(camera);
      const nameKey = getCameraNameKey(camera);
      const matchingPlaceholderKey = !slots.has(basePlaybackKey) && nameKey ? slotNameKeys.get(nameKey) : "";
      const playbackKey = matchingPlaceholderKey || basePlaybackKey;
      const group = rememberGroupMetadata(playbackKey, camera);
      if (group) {
        group.streamIds.add(Number(camera.streamId));
        group.activeStreamId = Number(camera.streamId);
      }
      const previousSlot = slots.get(playbackKey);
      const displayName = shouldKeepPlaceholderName(previousSlot, camera) ? previousSlot.name : camera.name;
      const next = {
        ...camera,
        name: displayName,
        id: `camera-${safeDomId(playbackKey)}`,
        playbackKey,
        sortIndex: previousSlot?.sortIndex ?? camera.sortIndex,
        hasLocalArchive: hasPlayableArchive(group),
        placeholder: false
      };

      const current = slots.get(playbackKey);
      const nextHasRemote = remoteStreams.has(Number(next.streamId));
      const currentHasRemote = current ? remoteStreams.has(Number(current.streamId)) : false;
      if (!current || current.placeholder || (nextHasRemote && !currentHasRemote)) {
        slots.set(playbackKey, next);
        rememberSlotName(next, playbackKey);
      }
    });

  playbackGroups.forEach((group, playbackKey) => {
    if (group.operationKey && group.operationKey !== getOperationStorageKey()) return;
    if (!hasPlayableArchive(group)) return;
    if (slots.has(playbackKey)) {
      const currentSlot = slots.get(playbackKey);
      if (currentSlot?.placeholder) {
        slots.set(playbackKey, {
          ...buildLocalArchiveCameraForGroup(group),
          name: currentSlot.name || group.cameraName || "Camara",
          sortIndex: currentSlot.sortIndex,
          playbackKey
        });
      } else if (currentSlot) {
        currentSlot.hasLocalArchive = true;
      }
      return;
    }
    const nameKey = normalizeCameraNameForKey(group.cameraName);
    const matchingSlotKey = nameKey ? slotNameKeys.get(nameKey) : "";
    if (matchingSlotKey) {
      mergePlaybackGroups(playbackKey, matchingSlotKey);
      const slot = slots.get(matchingSlotKey);
      const mergedGroup = getPlaybackGroup(matchingSlotKey, false) || group;
      if (slot?.placeholder) {
        slots.set(matchingSlotKey, {
          ...buildLocalArchiveCameraForGroup(mergedGroup),
          name: slot.name || mergedGroup.cameraName || "Camara",
          sortIndex: slot.sortIndex,
          playbackKey: matchingSlotKey
        });
      } else if (slot) {
        slot.hasLocalArchive = true;
      }
      return;
    }
    slots.set(playbackKey, buildLocalArchiveCameraForGroup(group));
  });

  const groupedCameras = [...slots.values()].sort((a, b) => {
    const aSort = Number.isFinite(Number(a.sortIndex)) ? Number(a.sortIndex) : 9999;
    const bSort = Number.isFinite(Number(b.sortIndex)) ? Number(b.sortIndex) : 9999;
    if (aSort !== bSort) return aSort - bSort;
    return String(a.name).localeCompare(String(b.name), "es");
  });
  if (groupedCameras.length) {
    return groupedCameras;
  }

  return cameraData;
}

function getRenderableCameraDataForCurrentFilter() {
  const cameras = getRenderableCameraData();
  if (CAMERA_PROTOCOLS.has(cameraSourceFilter)) {
    return cameras.filter((camera) => getCameraProtocolFamily(camera) === cameraSourceFilter);
  }
  return cameras;
}

function syncCameraSourceButtons() {
  dom.cameraWebRtcBtn?.classList.toggle("active", cameraSourceFilter === CAMERA_PROTOCOL_WEBRTC);
  dom.cameraRtmpBtn?.classList.toggle("active", cameraSourceFilter === CAMERA_PROTOCOL_RTMP);
  dom.cameraWebRtcBtn?.setAttribute("aria-pressed", cameraSourceFilter === CAMERA_PROTOCOL_WEBRTC ? "true" : "false");
  dom.cameraRtmpBtn?.setAttribute("aria-pressed", cameraSourceFilter === CAMERA_PROTOCOL_RTMP ? "true" : "false");
}

function setCameraProtocolFilter(protocol) {
  const normalized = normalizeCameraProtocol(protocol);
  cameraSourceFilter = cameraSourceFilter === normalized ? "all" : normalized;
  renderFeeds();
}

function createCameraEmptyState() {
  const empty = document.createElement("div");
  empty.className = "cameraEmptyState";
  const protocol = CAMERA_PROTOCOLS.has(cameraSourceFilter) ? cameraSourceFilter : CAMERA_PROTOCOL_WEBRTC;
  empty.innerHTML = buildWaitingSignalMarkup({ protocol, protocolFamily: protocol });
  return empty;
}

function createFeedElement(camera) {
  const feed = document.createElement("div");
  const playbackKey = camera.playbackKey || getCameraPlaybackKey(camera);
  feed.className = "cameraFeed";
  feed.id = camera.id;
  feed.dataset.playbackKey = playbackKey;
  if (camera.localArchiveOnly) feed.classList.add("localArchive");
  if (camera.hasLocalArchive) feed.classList.add("hasLocalArchive");

  const displayProtocol = getCameraBadge(camera);
  const badge = camera.placeholder ? camera.status : displayProtocol;
  const showFeedBadge = !/^ESPERANDO\b/i.test(String(badge || ""));
  const media = buildMediaMarkup(camera);
  const playback = buildPlaybackMarkup(camera);
  const audioButton = buildCameraAudioButton(camera);
  if (playback) feed.classList.add("hasPlayback");
  const urlHint = camera.playbackUrl && !camera.isPlayableUrl
    ? `<div class="cameraFeedHint">RTMP listo para FFmpeg/HLS</div>`
    : "";

  feed.innerHTML = `
    ${showFeedBadge ? `<div class="cameraFeedBadge">${escapeHtml(badge)}</div>` : ""}
    <button class="cameraSelectBtn" type="button" title="Ver esta camara" aria-label="Ver esta camara">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z"></path>
        <path d="M12 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"></path>
      </svg>
    </button>
    ${audioButton}
    ${media}
    <div class="cameraPlaybackFeedback" aria-hidden="true"></div>
    ${urlHint}
    ${playback}
    <div class="cameraFeedName">${escapeHtml(camera.name)}</div>
  `;

  feed.querySelector(".cameraSelectBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    focusCameraFeed(feed);
  });

  bindCameraAudioButton(feed);

  bindPlaybackControls(feed, camera);
  bindCameraSurfaceInteractions(feed, camera);
  return feed;
}

function bindCameraAudioButton(container) {
  container.querySelector(".cameraAudioBtn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const key = event.currentTarget.dataset.audioKey || "";
    if (!key) return;
    if (cameraAudioEnabled.has(key)) {
      cameraAudioEnabled.delete(key);
    } else {
      cameraAudioEnabled.add(key);
    }
    syncCameraAudioControls(key);
    container.querySelectorAll("video[data-audio-key]").forEach((video) => {
      if (video.dataset.audioKey === key) video.play?.().catch(() => {});
    });
  });
}

function buildMediaMarkup(camera) {
  if (camera.isPlayableUrl) {
    const playbackUrl = absoluteUrl(camera.playbackUrl);
    const audioKey = getCameraAudioKey(camera);
    const audioEnabled = isCameraAudioEnabled(audioKey);
    const playbackKey = camera.playbackKey || getCameraPlaybackKey(camera);
    const hlsAttr = isHlsUrl(playbackUrl)
      ? `data-hls-src="${escapeHtml(playbackUrl)}"`
      : `src="${escapeHtml(playbackUrl)}"`;
    const streamAttr = camera.streamId ? ` data-stream-id="${escapeHtml(String(camera.streamId))}"` : "";
    return `
      <video
        ${streamAttr}
        ${hlsAttr}
        data-live-url="${escapeHtml(playbackUrl)}"
        data-playable-url="1"
        data-playback-key="${escapeHtml(playbackKey)}"
        data-audio-key="${escapeHtml(audioKey)}"
        autoplay
        ${audioEnabled ? "" : "muted"}
        playsinline></video>
      <div class="cameraConnectionLostScreen" data-playback-key="${escapeHtml(playbackKey)}" aria-hidden="true">
        <div class="cameraConnectionLostText">${escapeHtml(getWaitingSignalMessage(CAMERA_PROTOCOL_RTMP))}</div>
      </div>
    `;
  }

  if (camera.isWebRtc && (camera.streamId || camera.playbackKey)) {
    const playbackKey = camera.playbackKey || getCameraPlaybackKey(camera);
    const audioKey = getCameraAudioKey(camera);
    const audioEnabled = isCameraAudioEnabled(audioKey);
    const streamAttr = camera.streamId ? ` data-stream-id="${escapeHtml(String(camera.streamId))}"` : "";
    return `
      <video${streamAttr} data-playback-key="${escapeHtml(playbackKey)}" data-audio-key="${escapeHtml(audioKey)}" autoplay ${audioEnabled ? "" : "muted"} playsinline></video>
      <div class="cameraConnectionLostScreen" data-playback-key="${escapeHtml(playbackKey)}" aria-hidden="true">
        <div class="cameraConnectionLostText">${escapeHtml(getWaitingSignalMessage(CAMERA_PROTOCOL_WEBRTC))}</div>
      </div>
    `;
  }

  return buildWaitingSignalMarkup(camera);
}

function buildPlaybackMarkup(camera) {
  if ((!camera.isWebRtc && !camera.isPlayableUrl) || (!camera.streamId && !camera.playbackKey)) return "";
  const playbackKey = camera.playbackKey || getCameraPlaybackKey(camera);

  return `
    <div class="cameraPlayback camScrubberWrap" data-playback-key="${escapeHtml(playbackKey)}" data-stream-id="${escapeHtml(String(camera.streamId || ""))}">
      <button class="cameraPlaybackBtn" data-skip="-10" type="button" title="Retroceder 10 segundos">-10</button>
      <div class="camProgressTrack">
        <div class="camProgressFill" style="width:0%"></div>
        <div class="camScrubHandle" style="left:0%"></div>
        <input class="cameraPlaybackRange" type="range" min="0" max="0" step="0.1" value="0" aria-label="Barra de reproducción">
      </div>
      <div class="camTimeRow">
        <button class="cameraPlaybackToggle" type="button" title="Pausar video" aria-label="Pausar video">
          <span aria-hidden="true">Ⅱ</span>
        </button>
        <span class="cameraPlaybackTime camElapsed">00:00</span>
      </div>
    </div>
  `;
}

function attachKnownMediaStreams() {
  const playbackKeys = new Set(playbackGroups.keys());
  remoteStreams.forEach((_, streamId) => playbackKeys.add(getStreamPlaybackKey(streamId)));
  playbackArchives.forEach((archive, streamId) => playbackKeys.add(archive.playbackKey || getStreamPlaybackKey(streamId)));
  playbackKeys.forEach((playbackKey) => attachMediaStateForPlaybackKey(playbackKey));
}

function attachMediaStateForStream(streamId) {
  attachMediaStateForPlaybackKey(getStreamPlaybackKey(streamId));
}

function queryVideosForPlaybackKey(playbackKey) {
  return [...document.querySelectorAll("video[data-playback-key]")]
    .filter((video) => video.dataset.playbackKey === String(playbackKey));
}

function queryConnectionLostScreens(playbackKey) {
  return [...document.querySelectorAll(".cameraConnectionLostScreen[data-playback-key]")]
    .filter((screen) => screen.dataset.playbackKey === String(playbackKey));
}

function setConnectionLostScreen(playbackKey, visible, message = "") {
  queryConnectionLostScreens(playbackKey).forEach((screen) => {
    if (message) {
      const text = screen.querySelector(".cameraConnectionLostText");
      if (text) text.textContent = message;
    }
    screen.classList.toggle("visible", Boolean(visible));
    screen.setAttribute("aria-hidden", visible ? "false" : "true");
    screen.closest(".cameraFeed")?.classList.toggle("connectionLostFinal", Boolean(visible));
  });
}

function getActiveRemoteStreamForGroup(group) {
  if (!group) return { streamId: null, mediaStream: null };
  if (group.activeStreamId && remoteStreams.has(Number(group.activeStreamId))) {
    const streamId = Number(group.activeStreamId);
    return { streamId, mediaStream: remoteStreams.get(streamId) };
  }
  for (const streamId of group.streamIds) {
    if (remoteStreams.has(Number(streamId))) {
      group.activeStreamId = Number(streamId);
      return { streamId: Number(streamId), mediaStream: remoteStreams.get(Number(streamId)) };
    }
  }
  return { streamId: null, mediaStream: null };
}

function attachMediaStateForPlaybackKey(playbackKey) {
  const archive = getPlaybackGroup(playbackKey, false);
  const { streamId, mediaStream } = getActiveRemoteStreamForGroup(archive);

  queryVideosForPlaybackKey(playbackKey).forEach((video) => {
    if (archive?.reviewMode) {
      setConnectionLostScreen(playbackKey, false);
      attachReviewVideo(video, playbackKey);
      return;
    }

    if (video.dataset.playableUrl === "1") {
      restorePlayableLiveVideo(video);
      const state = getPlayableUrlStateForPlaybackKey(playbackKey);
      setConnectionLostScreen(
        playbackKey,
        !state.live,
        getWaitingSignalMessage(CAMERA_PROTOCOL_RTMP)
      );
      updateCameraBadgeForPlaybackKey(playbackKey);
      return;
    }

    if (mediaStream) {
      setConnectionLostScreen(playbackKey, false);
      setCameraBadgeForPlaybackKey(playbackKey, "EN VIVO");
      video.controls = false;
      if (video.srcObject !== mediaStream) {
        video.pause?.();
        video.removeAttribute("src");
        video.srcObject = mediaStream;
        video.dataset.reviewUrl = "";
        if (streamId) video.dataset.streamId = String(streamId);
      }
      setVideoAudioState(video, isCameraAudioEnabled(video.dataset.audioKey));
      if (manuallyPausedPlaybackKeys.has(String(playbackKey))) {
        video.pause?.();
      } else if (video.paused) {
        video.play?.().catch(() => {});
      }
      return;
    }

    if (archive?.segments?.length) {
      setConnectionLostScreen(playbackKey, false);
      archive.reviewMode = true;
      archive.forcedLocalReview = true;
      if (!archive.localReviewInitialized) {
        archive.reviewPosition = Math.max(0, getArchiveDuration(archive) - 5);
        archive.localReviewInitialized = true;
      }
      attachReviewVideo(video, playbackKey);
      return;
    }

    video.srcObject = null;
    setCameraBadgeForPlaybackKey(playbackKey, getWaitingSignalBadge(CAMERA_PROTOCOL_WEBRTC));
    setConnectionLostScreen(playbackKey, true, getWaitingSignalMessage(CAMERA_PROTOCOL_WEBRTC));
  });
}

function attachReviewVideo(video, playbackKey) {
  const archive = getPlaybackGroup(playbackKey, false);
  if (!archive?.segments?.length) return;
  setConnectionLostScreen(playbackKey, false);
  stopPlayableUrlRecording(video);
  destroyHlsPlayer(video, { stopRecording: false, stopWatcher: false });

  const located = locateSegmentAt(archive, archive.reviewPosition);
  if (!located) return;

  archive.activeSegmentIndex = located.index;
  const { segment, offset } = located;
  video.controls = false;
  if (video.dataset.reviewUrl !== segment.url) {
    video.pause?.();
    video.srcObject = null;
    video.src = segment.url;
    video.dataset.reviewUrl = segment.url;
  }

  if (!video.dataset.reviewEventsBound) {
    video.dataset.reviewEventsBound = "1";
    video.addEventListener("ended", () => {
      advanceReviewPlayback(video.dataset.playbackKey);
    });
    video.addEventListener("timeupdate", () => {
      const currentPlaybackKey = video.dataset.playbackKey;
      const currentArchive = getPlaybackGroup(currentPlaybackKey, false);
      if (!currentArchive?.reviewMode) return;
      const index = currentArchive.activeSegmentIndex || 0;
      currentArchive.reviewPosition = getSegmentStart(currentArchive, index) + (video.currentTime || 0);
      updatePlaybackControls(currentPlaybackKey);
    });
  }

  if (Math.abs((video.currentTime || 0) - offset) > 0.35) {
    try { video.currentTime = offset; } catch {}
  }
  setVideoAudioState(video, isCameraAudioEnabled(video.dataset.audioKey));
  if (manuallyPausedPlaybackKeys.has(String(playbackKey))) {
    video.pause?.();
  } else {
    video.play?.().catch(() => {});
  }
}

function advanceReviewPlayback(playbackKey) {
  const archive = getPlaybackGroup(playbackKey, false);
  if (!archive?.reviewMode) return;
  const nextIndex = (archive.activeSegmentIndex || 0) + 1;

  if (nextIndex < archive.segments.length) {
    archive.activeSegmentIndex = nextIndex;
    archive.reviewPosition = getSegmentStart(archive, nextIndex);
    attachMediaStateForPlaybackKey(playbackKey);
    updatePlaybackControls(playbackKey);
    return;
  }

  if (getActiveRemoteStreamForGroup(archive).mediaStream || hasPlayableLiveForPlaybackKey(playbackKey)) {
    returnToLive(playbackKey);
    return;
  }

  archive.reviewPosition = getArchiveDuration(archive);
  archive.localReviewInitialized = true;
  manuallyPausedPlaybackKeys.add(String(playbackKey));
  queryVideosForPlaybackKey(playbackKey).forEach((video) => video.pause?.());
  updatePlaybackControls(playbackKey);
  setConnectionLostScreen(playbackKey, false);
}

function seekStreamPlayback(playbackKey, seconds) {
  const archive = getPlaybackGroup(playbackKey, false);
  if (!archive?.segments?.length) return;
  setConnectionLostScreen(playbackKey, false);

  const max = getPlaybackMax(archive);
  const finalizedDuration = getArchiveDuration(archive);
  const target = Math.max(0, Math.min(Number(seconds) || 0, max));

  if (
    (
      getActiveRemoteStreamForGroup(archive).mediaStream ||
      hasPlayableLiveForPlaybackKey(playbackKey) ||
      hasPlayableUrlForPlaybackKey(playbackKey)
    ) &&
    target >= Math.max(0, max - LIVE_EDGE_THRESHOLD_SECONDS)
  ) {
    returnToLive(playbackKey);
    return;
  }

  const seekTarget = Math.min(target, Math.max(0, finalizedDuration - 0.1));
  const located = locateSegmentAt(archive, seekTarget);
  if (!located) return;

  archive.reviewMode = true;
  archive.forcedLocalReview = false;
  archive.localReviewInitialized = true;
  archive.activeSegmentIndex = located.index;
  archive.reviewPosition = located.start + located.offset;
  attachMediaStateForPlaybackKey(playbackKey);
  updatePlaybackControls(playbackKey);
}

function skipStreamPlayback(playbackKey, deltaSeconds) {
  const archive = getPlaybackGroup(playbackKey, false);
  if (!archive) return;
  const max = getPlaybackMax(archive);
  const current = archive.reviewMode ? archive.reviewPosition : max;
  seekStreamPlayback(playbackKey, current + Number(deltaSeconds || 0));
}

function returnToLive(playbackKey) {
  const archive = getPlaybackGroup(playbackKey, false);
  setConnectionLostScreen(playbackKey, false);
  if (archive) {
    archive.reviewMode = false;
    archive.activeSegmentIndex = 0;
    archive.reviewPosition = getPlaybackMax(archive);
    archive.localReviewInitialized = false;
  }
  attachMediaStateForPlaybackKey(playbackKey);
  updatePlaybackControls(playbackKey);
}

function queryPlaybackControls(playbackKey) {
  return [...document.querySelectorAll(".cameraPlayback")]
    .filter((control) => control.dataset.playbackKey === String(playbackKey));
}

function updatePlaybackControls(playbackKey = null) {
  const keys = playbackKey == null
    ? [...playbackGroups.keys()]
    : [String(playbackKey).includes(":") ? String(playbackKey) : getStreamPlaybackKey(playbackKey)];

  keys.forEach((key) => {
    const archive = getPlaybackGroup(key, false);
    const max = archive ? getPlaybackMax(archive) : 0;
    const value = archive?.reviewMode ? archive.reviewPosition : max;
    const playableState = getPlayableUrlStateForPlaybackKey(key);
    const hasRemote = Boolean(getActiveRemoteStreamForGroup(archive).mediaStream);
    const hasLiveSignal = hasRemote || playableState.live;
    const canReturnToLive = hasLiveSignal || playableState.hasSource || hasPlayableUrlForPlaybackKey(key);
    const status = archive?.reviewMode
      ? "REV"
      : archive?.segments?.length && !hasLiveSignal
        ? "LOCAL"
        : archive?.segments?.length
          ? "BUFFER"
          : hasLiveSignal
            ? "LIVE"
            : playableState.hasSource
              ? "ESPERANDO"
              : archive
                ? "ESPERANDO"
                : "ESPERANDO";

    queryPlaybackControls(key).forEach((control) => {
      const range = control.querySelector(".cameraPlaybackRange");
      const time = control.querySelector(".cameraPlaybackTime");
      const liveBtn = control.querySelector(".cameraLiveBtn");
      const statusEl = control.querySelector(".cameraPlaybackStatus");
      const toggle = control.querySelector(".cameraPlaybackToggle");
      const fill = control.querySelector(".camProgressFill");
      const handle = control.querySelector(".camScrubHandle");
      const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;

      if (range) {
        range.max = String(Math.max(0, max));
        range.value = String(Math.max(0, value));
        range.disabled = !archive || max <= 0;
      }
      if (fill) fill.style.width = `${pct}%`;
      if (handle) handle.style.left = `${pct}%`;
      if (time) {
        time.textContent = `${formatPlaybackTime(value)} / ${formatPlaybackTime(max)}`;
      }
      if (toggle) {
        const videos = queryVideosForPlaybackKey(key);
        const paused = manuallyPausedPlaybackKeys.has(key)
          || (videos.length > 0 && videos.every((video) => video.paused || video.ended));
        toggle.classList.toggle("is-paused", paused);
        toggle.title = paused ? "Reproducir video" : "Pausar video";
        toggle.setAttribute("aria-label", toggle.title);
        toggle.setAttribute("aria-pressed", paused ? "true" : "false");
        const icon = toggle.querySelector("span");
        if (icon) icon.textContent = paused ? "▶" : "Ⅱ";
      }
      if (liveBtn) {
        liveBtn.classList.toggle("active", !archive?.reviewMode && hasLiveSignal);
        liveBtn.disabled = !canReturnToLive;
      }
      control.querySelectorAll(".cameraPlaybackBtn").forEach((button) => {
        button.disabled = !archive || max <= 0;
      });
      if (statusEl) {
        statusEl.textContent = status;
        statusEl.dataset.status = status.toLowerCase().replace(/\s+/g, "-");
        statusEl.classList.toggle("camLive", status === "LIVE" || status === "BUFFER");
        statusEl.classList.toggle("camBehind", status === "LOCAL" || status === "REV");
      }
    });
    updateCameraBadgeForPlaybackKey(key);
  });
}

function clearFrozenFrame(playbackKey) {
  frozenVideoFrames.delete(String(playbackKey || ""));
  queryVideosForPlaybackKey(playbackKey).forEach((video) => {
    const feed = video.closest(".cameraFeed");
    feed?.querySelector(".cameraFrozenFrame")?.remove();
    feed?.classList.remove("hasFrozenFrame");
  });
}

function detachFrozenFrameOverlay(playbackKey) {
  queryVideosForPlaybackKey(playbackKey).forEach((video) => {
    const feed = video.closest(".cameraFeed");
    feed?.querySelector(".cameraFrozenFrame")?.remove();
    feed?.classList.remove("hasFrozenFrame");
  });
}

function restoreFrozenFrame(playbackKey, root = document) {
  const frameUrl = frozenVideoFrames.get(String(playbackKey || ""));
  if (!frameUrl) return;

  [...root.querySelectorAll("video[data-playback-key]")]
    .filter((video) => video.dataset.playbackKey === String(playbackKey))
    .forEach((video) => {
      const feed = video.closest(".cameraFeed");
      if (!feed) return;
      let frozen = feed.querySelector(".cameraFrozenFrame");
      if (!frozen) {
        frozen = document.createElement("img");
        frozen.className = "cameraFrozenFrame";
        frozen.alt = "";
        frozen.setAttribute("aria-hidden", "true");
        frozen.setAttribute("data-bing-img-search", "none");
        feed.insertBefore(frozen, feed.firstChild);
      }
      frozen.src = frameUrl;
      feed.classList.add("hasFrozenFrame");
    });
}

function hasFrozenFrame(playbackKey) {
  return queryVideosForPlaybackKey(playbackKey).some((video) =>
    video.closest(".cameraFeed")?.classList.contains("hasFrozenFrame")
  );
}

function freezeCurrentVideoFrame(playbackKey) {
  queryVideosForPlaybackKey(playbackKey).forEach((video) => {
    const feed = video.closest(".cameraFeed");
    if (!feed || video.dataset.reviewUrl) return;
    if (!video.videoWidth || !video.videoHeight) return;

    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      let frozen = feed.querySelector(".cameraFrozenFrame");
      if (!frozen) {
        frozen = document.createElement("img");
        frozen.className = "cameraFrozenFrame";
        frozen.alt = "";
        frozen.setAttribute("aria-hidden", "true");
        frozen.setAttribute("data-bing-img-search", "none");
        feed.insertBefore(frozen, feed.firstChild);
      }
      frozen.src = canvas.toDataURL("image/jpeg", 0.82);
      frozenVideoFrames.set(String(playbackKey || ""), frozen.src);
      feed.classList.add("hasFrozenFrame");
      video.pause?.();
    } catch (err) {
      console.warn("[CAMERAS] No se pudo congelar el ultimo frame:", err.message);
    }
  });
}

function ensurePlaybackUiTimer() {
  if (playbackUiTimer) return;
  playbackUiTimer = window.setInterval(() => updatePlaybackControls(), 1000);
}

function bindPlaybackControls(container, camera) {
  if ((!camera?.isWebRtc && !camera?.isPlayableUrl) || (!camera.streamId && !camera.playbackKey)) return;
  const playbackKey = camera.playbackKey || getCameraPlaybackKey(camera);
  const streamId = Number(camera.streamId || 0);
  if (streamId) void loadPersistedSegmentsForStream(streamId);
  container.classList.add("hasPlayback");

  container.querySelectorAll(".cameraPlayback").forEach((controls) => {
    controls.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      showPlaybackControls(container);
    });
  });

  container.querySelectorAll(".cameraPlaybackRange").forEach((range) => {
    range.addEventListener("input", (event) => {
      event.stopPropagation();
      showPlaybackControls(container);
      seekStreamPlayback(playbackKey, Number(event.target.value || 0));
    });
  });

  container.querySelectorAll(".cameraPlaybackToggle").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleCameraPlayback(container);
      showPlaybackControls(container);
      updatePlaybackControls(playbackKey);
    });
  });

  container.querySelectorAll(".cameraPlaybackBtn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      skipStreamPlayback(playbackKey, Number(button.dataset.skip || 0));
    });
  });

  container.querySelectorAll(".cameraLiveBtn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      returnToLive(playbackKey);
    });
  });

  updatePlaybackControls(playbackKey);
}

function getTapSide(feed, clientX) {
  const rect = feed.getBoundingClientRect();
  const x = clientX - rect.left;
  if (x < rect.width * DOUBLE_TAP_SIDE_RATIO) return "left";
  if (x > rect.width * (1 - DOUBLE_TAP_SIDE_RATIO)) return "right";
  return "center";
}

function showPlaybackControls(feed) {
  if (!feed?.classList.contains("hasPlayback")) return;
  feed.classList.add("playback-controls-visible");
  const previousTimer = playbackControlsHideTimers.get(feed);
  if (previousTimer) window.clearTimeout(previousTimer);
  const timer = window.setTimeout(() => {
    if (!feed.matches(":focus-within")) {
      feed.classList.remove("playback-controls-visible");
    }
    playbackControlsHideTimers.delete(feed);
  }, 2800);
  playbackControlsHideTimers.set(feed, timer);
}

function showCameraPlaybackFeedback(feed, paused) {
  const feedback = feed?.querySelector(".cameraPlaybackFeedback");
  if (!feedback) return;
  feedback.innerHTML = paused
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12"></path></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6Z"></path></svg>';
  feedback.classList.remove("visible");
  void feedback.offsetWidth;
  feedback.classList.add("visible");
}

function toggleCameraPlayback(feed) {
  const playbackKey = String(feed?.dataset?.playbackKey || "");
  if (!playbackKey) return;
  const videos = queryVideosForPlaybackKey(playbackKey);
  if (!videos.length) return;

  const shouldPause = videos.some((video) => !video.paused);
  if (shouldPause) {
    manuallyPausedPlaybackKeys.add(playbackKey);
    videos.forEach((video) => video.pause?.());
  } else {
    const isAtEnd = videos.every((video) => video.ended || (
      Number.isFinite(video.duration)
      && video.duration > 0
      && video.currentTime >= video.duration - 0.1
    ));
    if (isAtEnd) {
      manuallyPausedPlaybackKeys.add(playbackKey);
      updatePlaybackControls(playbackKey);
      return;
    }
    manuallyPausedPlaybackKeys.delete(playbackKey);
    videos.forEach((video) => video.play?.().catch(() => {}));
  }
  showCameraPlaybackFeedback(feed, shouldPause);
}

function bindCameraSurfaceInteractions(feed, camera) {
  feed.dataset.activeStreamId = camera?.streamId ? String(camera.streamId) : "";
  feed.dataset.playbackKey = camera?.playbackKey || getCameraPlaybackKey(camera || {});
  if (feed.dataset.cameraSurfaceBound === "1") return;
  feed.dataset.cameraSurfaceBound = "1";

  let lastTapAt = 0;
  let lastTapSide = "";
  let centerTapTimer = null;
  feed.addEventListener("pointerenter", () => showPlaybackControls(feed));

  feed.addEventListener("pointerup", (event) => {
    if (event.target.closest(".cameraPlayback, .cameraAudioBtn, .cameraSelectBtn")) return;
    showPlaybackControls(feed);
    const side = getTapSide(feed, event.clientX);
    const now = Date.now();
    const isDoubleTap = event.pointerType !== "mouse"
      && side !== "center"
      && lastTapSide === side
      && now - lastTapAt <= DOUBLE_TAP_MS;
    lastTapAt = now;
    lastTapSide = side;

    const playbackKey = feed.dataset.playbackKey;
    if (isDoubleTap && playbackKey) {
      event.preventDefault();
      skipStreamPlayback(playbackKey, side === "left" ? -10 : 10);
    }
  });

  feed.addEventListener("click", (event) => {
    if (event.target.closest(".cameraPlayback, .cameraAudioBtn, .cameraSelectBtn")) return;
    if (getTapSide(feed, event.clientX) !== "center" || event.detail > 1) return;
    if (centerTapTimer) window.clearTimeout(centerTapTimer);
    centerTapTimer = window.setTimeout(() => {
      toggleCameraPlayback(feed);
      centerTapTimer = null;
    }, DOUBLE_TAP_MS);
  });

  feed.addEventListener("dblclick", (event) => {
    if (event.target.closest(".cameraPlayback, .cameraAudioBtn, .cameraSelectBtn")) return;
    event.preventDefault();
    if (centerTapTimer) {
      window.clearTimeout(centerTapTimer);
      centerTapTimer = null;
    }
    focusCameraFeed(feed);
  });
}

function attachLiveFeeds() {
  attachPlayableUrlFeeds();
  cameraData.forEach((camera) => {
    if (camera.isWebRtc && camera.streamId) {
      joinWebRtcStream(camera);
    }
  });
  attachKnownMediaStreams();
}

function getVideoCaptureStream(video) {
  if (!video) return null;
  const capture = video.captureStream || video.mozCaptureStream;
  if (typeof capture !== "function") return null;
  try {
    return capture.call(video);
  } catch (err) {
    console.warn("[CAMERAS] No se pudo capturar HLS para grabacion:", err.message);
    return null;
  }
}

function schedulePlayableRecordingRetry(video, delay = 1000) {
  if (!video || video.dataset.playableRecordingRetry === "1") return;
  video.dataset.playableRecordingRetry = "1";
  window.setTimeout(() => {
    video.dataset.playableRecordingRetry = "";
    startPlayableUrlRecording(video);
  }, delay);
}

function startPlayableUrlRecording(video) {
  const streamId = Number(video?.dataset?.streamId || 0);
  if (!streamId || !video?.dataset?.playableUrl) return;
  if (video.dataset.reviewUrl) return;
  if (isHlsUrl(getPlayableVideoUrl(video)) && !isPlayableVideoLive(video)) return;

  const current = playableLiveStreams.get(streamId);
  const captureStream = current?.video === video && current.stream
    ? current.stream
    : getVideoCaptureStream(video);
  if (!captureStream) return;

  const recordingStream = getRecordingMediaStream(streamId, captureStream);
  if (!recordingStream) {
    schedulePlayableRecordingRetry(video);
    return;
  }

  video.dataset.playableStopped = "";
  playableLiveStreams.set(streamId, { stream: captureStream, video });
  const archive = getPlaybackArchive(streamId);
  if (archive) {
    archive.connectionLost = false;
    archive.localReviewInitialized = false;
  }
  const group = getPlaybackGroup(archive?.playbackKey || video.dataset.playbackKey || getStreamPlaybackKey(streamId));
  if (group) {
    group.connectionLost = false;
    group.activeStreamId = streamId;
    group.streamIds.add(streamId);
  }

  startLocalRecorder(streamId, captureStream, { sourceType: "playable-url" });
  updatePlaybackControls(group?.playbackKey || archive?.playbackKey || video.dataset.playbackKey || getStreamPlaybackKey(streamId));
}

function stopPlayableUrlRecording(video, { markLost = false } = {}) {
  const streamId = Number(video?.dataset?.streamId || 0);
  if (!streamId) return;

  const current = playableLiveStreams.get(streamId);
  if (current?.video === video) {
    playableLiveStreams.delete(streamId);
  }
  stopLocalRecorder(streamId, { markLost });
}

function bindPlayableUrlRecording(video) {
  if (!video || video.dataset.playableRecordingBound === "1") return;
  video.dataset.playableRecordingBound = "1";

  ["loadedmetadata", "canplay", "playing"].forEach((eventName) => {
    video.addEventListener(eventName, () => startPlayableUrlRecording(video));
  });
  ["error"].forEach((eventName) => {
    video.addEventListener(eventName, () => markPlayableUrlStopped(video));
  });
  video.addEventListener("ended", () => {
    manuallyPausedPlaybackKeys.add(String(video.dataset.playbackKey || ""));
    markPlayableUrlStopped(video);
    updatePlaybackControls(video.dataset.playbackKey);
  });
}

function getPlayableVideoUrl(video) {
  return video?.dataset?.liveUrl || video?.dataset?.hlsSrc || video?.currentSrc || video?.getAttribute?.("src") || "";
}

function isPlayableVideoLive(video) {
  if (!video || video.dataset.playableUrl !== "1" || video.dataset.reviewUrl) return false;
  const url = getPlayableVideoUrl(video);
  if (isHlsUrl(url)) {
    const watcher = playableUrlWatchers.get(video);
    return Boolean(watcher?.live && !watcher.stopped);
  }

  const streamId = Number(video.dataset.streamId || 0);
  return Boolean(streamId && playableLiveStreams.get(streamId)?.video === video);
}

function getPlayableUrlStateForPlaybackKey(playbackKey) {
  const state = {
    hasSource: false,
    live: false,
    waiting: false,
    stopped: false
  };

  queryVideosForPlaybackKey(playbackKey).forEach((video) => {
    if (video.dataset.playableUrl !== "1") return;
    state.hasSource = true;

    if (isPlayableVideoLive(video)) {
      state.live = true;
      return;
    }

    const watcher = playableUrlWatchers.get(video);
    if (video.dataset.playableStopped === "1" || watcher?.stopped) {
      state.stopped = true;
      return;
    }

    state.waiting = true;
  });

  if (state.live) {
    state.waiting = false;
    state.stopped = false;
  }

  return state;
}

function updateCameraBadgeForPlaybackKey(playbackKey) {
  const state = getPlayableUrlStateForPlaybackKey(playbackKey);
  if (!state.hasSource) return;

  const badgeText = state.live
    ? "EN VIVO"
    : getWaitingSignalBadge(CAMERA_PROTOCOL_RTMP);

  setCameraBadgeForPlaybackKey(playbackKey, badgeText);
}

function setCameraBadgeForPlaybackKey(playbackKey, badgeText) {
  document.querySelectorAll(".cameraFeed[data-playback-key]").forEach((feed) => {
    if (feed.dataset.playbackKey !== String(playbackKey)) return;
    const badge = feed.querySelector(".cameraFeedBadge");
    if (badge) badge.textContent = badgeText;
  });
}

function markPlayableVideoLive(video, watcher = playableUrlWatchers.get(video)) {
  if (!video || !watcher) return;
  watcher.live = true;
  watcher.stopped = false;
  video.dataset.playableStopped = "";
  const playbackKey = video.dataset.playbackKey || "";
  if (playbackKey) {
    const archive = getPlaybackGroup(playbackKey, false);
    if (archive?.reviewMode && video.dataset.reviewUrl) {
      returnToLive(playbackKey);
      return;
    }
    setConnectionLostScreen(playbackKey, false);
    updateCameraBadgeForPlaybackKey(playbackKey);
    updatePlaybackControls(playbackKey);
  }
  startPlayableUrlRecording(video);
}

function hasPlayableLiveForPlaybackKey(playbackKey) {
  return getPlayableUrlStateForPlaybackKey(playbackKey).live;
}

function hasPlayableUrlForPlaybackKey(playbackKey) {
  return queryVideosForPlaybackKey(playbackKey).some((video) =>
    video.dataset.playableUrl === "1" && Boolean(video.dataset.liveUrl || video.dataset.hlsSrc)
  );
}

function restorePlayableLiveVideo(video) {
  if (!video || video.dataset.playableUrl !== "1") return false;
  const liveUrl = video.dataset.liveUrl || video.dataset.hlsSrc || video.currentSrc || "";
  if (!liveUrl) return false;

  const returningFromReview = Boolean(video.dataset.reviewUrl);
  if (returningFromReview) {
    video.pause?.();
    video.srcObject = null;
  }
  video.dataset.reviewUrl = "";

  if (isHlsUrl(liveUrl)) {
    video.removeAttribute("src");
    video.dataset.hlsSrc = liveUrl;
    video.dataset.hlsAttached = "";
    attachPlayableUrlFeeds(video.closest(".cameraFeed") || video.parentElement || document);
  } else if (video.getAttribute("src") !== liveUrl) {
    destroyHlsPlayer(video, { stopRecording: false });
    video.src = liveUrl;
    video.load?.();
  }

  setVideoAudioState(video, isCameraAudioEnabled(video.dataset.audioKey));
  const playbackKey = String(video.dataset.playbackKey || "");
  if (manuallyPausedPlaybackKeys.has(playbackKey)) {
    video.pause?.();
  } else if (video.paused) {
    video.play?.().catch(() => {});
  }
  startPlayableUrlRecording(video);
  return true;
}

function normalizeHlsManifestFingerprint(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#EXT-X-PROGRAM-DATE-TIME"))
    .join("\n");
}

function hlsManifestHasMedia(text) {
  return /#EXTINF\b|#EXT-X-PART\b/i.test(String(text || ""));
}

async function fetchHlsManifest(url) {
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`, {
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = await res.text();
  if (!/^#EXTM3U\b/i.test(text.trim())) throw new Error("Playlist HLS invalida");
  return text;
}

function updatePlayableUrlFingerprint(video, fingerprint) {
  const watcher = playableUrlWatchers.get(video);
  if (!watcher) return;

  const next = String(fingerprint || "").trim();
  if (!next) return;

  const now = Date.now();
  if (watcher.fingerprint !== next) {
    const hadFingerprint = Boolean(watcher.fingerprint);
    watcher.fingerprint = next;
    watcher.lastChangedAt = now;
    watcher.changeCount = (watcher.changeCount || 0) + 1;
    if (hadFingerprint) {
      markPlayableVideoLive(video, watcher);
    }
  }
  watcher.lastSeenAt = now;
}

function ensurePlayableUrlWatcher(video, url) {
  if (!video || !url) return;

  const current = playableUrlWatchers.get(video);
  if (current?.url === url && !current.stopped) return;

  stopPlayableUrlWatcher(video);
  const watcher = {
    url,
    fingerprint: "",
    changeCount: 0,
    live: false,
    lastChangedAt: Date.now(),
    lastSeenAt: Date.now(),
    createdAt: Date.now(),
    checking: false,
    stopped: false,
    timer: window.setInterval(() => {
      void checkPlayableUrlFreshness(video);
    }, PLAYABLE_STALE_CHECK_MS)
  };
  playableUrlWatchers.set(video, watcher);
  video.dataset.playableStopped = "";
}

function stopPlayableUrlWatcher(video) {
  const watcher = playableUrlWatchers.get(video);
  if (!watcher) return;
  if (watcher.timer) window.clearInterval(watcher.timer);
  playableUrlWatchers.delete(video);
}

async function checkPlayableUrlFreshness(video) {
  const watcher = playableUrlWatchers.get(video);
  if (!watcher) return;

  const now = Date.now();
  const elapsed = now - (watcher.live ? watcher.lastChangedAt : watcher.createdAt);
  if (!watcher.stopped && ((watcher.live && elapsed > PLAYABLE_STALE_MS) || (!watcher.live && elapsed > PLAYABLE_INITIAL_STALE_MS))) {
    markPlayableUrlStopped(video);
    return;
  }

  if (!isHlsUrl(watcher.url) || watcher.checking) return;
  watcher.checking = true;
  try {
    const text = await fetchHlsManifest(watcher.url);
    const fingerprint = normalizeHlsManifestFingerprint(text);
    updatePlayableUrlFingerprint(video, fingerprint);
    if (hlsManifestHasMedia(text)) {
      markPlayableVideoLive(video, watcher);
    }
    if (/#EXT-X-ENDLIST\b/i.test(text)) {
      markPlayableUrlStopped(video);
    }
  } catch {
    const staleFrom = watcher.live ? watcher.lastChangedAt : watcher.createdAt;
    const staleLimit = watcher.live ? PLAYABLE_STALE_MS : PLAYABLE_INITIAL_STALE_MS;
    if (Date.now() - staleFrom > staleLimit) {
      markPlayableUrlStopped(video);
    }
  } finally {
    watcher.checking = false;
  }
}

function markPlayableUrlStopped(video) {
  if (!video || video.dataset.reviewUrl) return;
  video.dataset.playableStopped = "1";
  const watcher = playableUrlWatchers.get(video);
  if (watcher) {
    watcher.stopped = true;
    watcher.live = false;
  }

  const streamId = Number(video.dataset.streamId || 0);
  const playbackKey = video.dataset.playbackKey || (streamId ? getStreamPlaybackKey(streamId) : "");
  if (!playbackKey) return;

  freezeCurrentVideoFrame(playbackKey);
  stopPlayableUrlRecording(video, { markLost: true });
  const group = getPlaybackGroup(playbackKey, false);
  if (group) group.connectionLost = true;

  if (enterLocalReview(playbackKey)) {
    attachMediaStateForPlaybackKey(playbackKey);
  } else {
    const liveUrl = getPlayableVideoUrl(video);
    video.pause?.();
    destroyHlsPlayer(video, { stopRecording: false, stopWatcher: false });
    setConnectionLostScreen(playbackKey, true, getWaitingSignalMessage(CAMERA_PROTOCOL_RTMP));
    if (isHlsUrl(liveUrl)) scheduleHlsAttachWhenReady(video, liveUrl, HLS_ATTACH_RETRY_INITIAL_MS);
  }
  updateCameraBadgeForPlaybackKey(playbackKey);
  updatePlaybackControls(playbackKey);
}

function clearHlsAttachRetry(video) {
  const retry = hlsAttachRetries.get(video);
  if (!retry) return;
  if (retry.timer) window.clearTimeout(retry.timer);
  hlsAttachRetries.delete(video);
}

function scheduleHlsAttachWhenReady(video, url, delay = 0) {
  if (!video || !url) return;

  const current = hlsAttachRetries.get(video);
  if (current?.url === url && (current.timer || current.checking)) return;

  clearHlsAttachRetry(video);
  const retry = {
    url,
    delay: HLS_ATTACH_RETRY_INITIAL_MS,
    timer: null,
    checking: false
  };
  hlsAttachRetries.set(video, retry);

  const run = async () => {
    if (!document.contains(video) || video.dataset.hlsSrc !== url || video.dataset.reviewUrl) {
      clearHlsAttachRetry(video);
      return;
    }
    if (video.dataset.hlsAttached === "1") {
      clearHlsAttachRetry(video);
      return;
    }

    retry.timer = null;
    retry.checking = true;

    try {
      const text = await fetchHlsManifest(url);
      if (hlsAttachRetries.get(video) !== retry) return;

      const watcher = playableUrlWatchers.get(video);
      updatePlayableUrlFingerprint(video, normalizeHlsManifestFingerprint(text));
      if (hlsManifestHasMedia(text)) {
        markPlayableVideoLive(video, watcher);
      }
      clearHlsAttachRetry(video);
      attachReadyHlsVideo(video, url);
    } catch {
      if (hlsAttachRetries.get(video) !== retry) return;

      retry.checking = false;
      const playbackKey = video.dataset.playbackKey || "";
      if (playbackKey) {
        setConnectionLostScreen(playbackKey, true, getWaitingSignalMessage(CAMERA_PROTOCOL_RTMP));
        updateCameraBadgeForPlaybackKey(playbackKey);
        updatePlaybackControls(playbackKey);
      }

      retry.timer = window.setTimeout(run, retry.delay);
      retry.delay = Math.min(Math.round(retry.delay * 1.6), HLS_ATTACH_RETRY_MAX_MS);
    }
  };

  retry.timer = window.setTimeout(run, Math.max(0, delay));
}

function attachReadyHlsVideo(video, url) {
  if (!video || !url || video.dataset.hlsAttached === "1") return;
  if (video.dataset.hlsSrc !== url) return;

  clearHlsAttachRetry(video);

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    video.dataset.hlsAttached = "1";
    setVideoAudioState(video, isCameraAudioEnabled(video.dataset.audioKey));
    markPlayableVideoLive(video);
    video.play?.().then(() => startPlayableUrlRecording(video)).catch(() => {});
    return;
  }

  ensureHlsScript()
    .then((Hls) => {
      if (!Hls.isSupported()) return;
      if (!document.contains(video) || video.dataset.hlsSrc !== url || video.dataset.hlsAttached === "1") return;

      destroyHlsPlayer(video, { stopRecording: false, stopWatcher: false });
      const hls = new Hls({
        lowLatencyMode: true,
        liveSyncDuration: 1,
        liveMaxLatencyDuration: 3,
        maxLiveSyncPlaybackRate: 1.5,
        backBufferLength: 0,
        enableWorker: true,
        manifestLoadingMaxRetry: 0,
        levelLoadingMaxRetry: 0,
        fragLoadingMaxRetry: 1,
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hlsPlayers.set(video, hls);
      video.dataset.hlsAttached = "1";
      setVideoAudioState(video, isCameraAudioEnabled(video.dataset.audioKey));
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setVideoAudioState(video, isCameraAudioEnabled(video.dataset.audioKey));
        markPlayableVideoLive(video);
        video.play?.().then(() => startPlayableUrlRecording(video)).catch(() => {});
      });
      if (Hls.Events.LEVEL_UPDATED) {
        hls.on(Hls.Events.LEVEL_UPDATED, (event, data = {}) => {
          const details = data.details || {};
          updatePlayableUrlFingerprint(video, [
            details.url || url,
            details.mediaSequence ?? "",
            details.endSN ?? "",
            details.totalduration ?? ""
          ].join(":"));
          if (details.live === false) markPlayableUrlStopped(video);
        });
      }
      hls.on(Hls.Events.ERROR, (event, data = {}) => {
        if (data.fatal) markPlayableUrlStopped(video);
      });
    })
    .catch((err) => {
      console.warn("[CAMERAS] No se pudo preparar HLS:", err.message);
    });
}

function attachPlayableUrlFeeds(root = document) {
  root.querySelectorAll("video[data-hls-src]").forEach((video) => {
    bindPlayableUrlRecording(video);
    if (video.dataset.hlsAttached === "1") return;
    const url = video.dataset.hlsSrc;
    if (!url) return;

    ensurePlayableUrlWatcher(video, url);
    scheduleHlsAttachWhenReady(video, url);
  });

  root.querySelectorAll("video[data-playable-url='1']:not([data-hls-src])").forEach((video) => {
    bindPlayableUrlRecording(video);
    setVideoAudioState(video, isCameraAudioEnabled(video.dataset.audioKey));
    video.play?.().then(() => startPlayableUrlRecording(video)).catch(() => {});
  });
}

function destroyHlsPlayer(video, { stopRecording = true, stopWatcher = true } = {}) {
  if (stopRecording) stopPlayableUrlRecording(video);
  if (stopWatcher) {
    stopPlayableUrlWatcher(video);
    clearHlsAttachRetry(video);
  }
  const hls = hlsPlayers.get(video);
  if (!hls) {
    if (video?.dataset) video.dataset.hlsAttached = "";
    return;
  }
  try {
    hls.destroy();
  } catch (err) {
    console.warn("[CAMERAS] No se pudo cerrar HLS:", err.message);
  }
  hlsPlayers.delete(video);
  video.dataset.hlsAttached = "";
}

function destroyHlsPlayersIn(root) {
  if (!root) return;
  root.querySelectorAll?.("video[data-hls-src]").forEach((video) => {
    destroyHlsPlayer(video);
  });
}

function findCameraForEquipment(equipmentId) {
  const equipmentKey = String(equipmentId ?? "").trim();
  if (!equipmentKey) return null;
  return getRenderableCameraData().find((camera) =>
    camera.equipoId != null && String(camera.equipoId) === equipmentKey
  ) || null;
}

export function clearEmbeddedCamera(container) {
  if (!container) return;
  destroyHlsPlayersIn(container);
  container.dataset.equipmentCameraId = "";
  container.dataset.playbackKey = "";
  container.innerHTML = "";
}

function renderEquipmentCameraInto(container, equipmentId, displayName = "") {
  if (!container) return;
  const camera = findCameraForEquipment(equipmentId);
  const name = camera?.name || displayName || `Dron ${equipmentId}`;
  const playbackKey = camera ? (camera.playbackKey || getCameraPlaybackKey(camera)) : `equipo:${equipmentId}`;
  const fallbackCamera = {
    protocol: CAMERA_PROTOCOL_RTMP,
    protocolFamily: CAMERA_PROTOCOL_RTMP,
    sourceType: "DRONE",
    name,
    placeholder: true
  };
  const badge = camera ? getCameraBadge(camera) : getWaitingSignalBadge(fallbackCamera);
  const hasVideoSource = Boolean(camera && !camera.placeholder);
  const media = hasVideoSource ? buildMediaMarkup(camera) : buildWaitingSignalMarkup(fallbackCamera);
  const playback = hasVideoSource ? buildPlaybackMarkup(camera) : "";
  const audioButton = hasVideoSource ? buildCameraAudioButton(camera) : "";
  const badgeMarkup = /^ESPERANDO\b/i.test(String(badge || ""))
    ? ""
    : `<div class="cameraFeedBadge">${escapeHtml(badge)}</div>`;

  destroyHlsPlayersIn(container);
  container.dataset.playbackKey = playbackKey;
  container.innerHTML = `
    ${badgeMarkup}
    ${audioButton}
    ${media}
    ${playback}
    <div class="cameraFeedName">${escapeHtml(name)}</div>
  `;

  if (camera) {
    bindCameraAudioButton(container);
    if (camera.isWebRtc && camera.streamId) joinWebRtcStream(camera);
    bindPlaybackControls(container, camera);
  }
  attachPlayableUrlFeeds(container);
  attachKnownMediaStreams();
}

export async function renderEquipmentLiveCamera(container, equipmentId, displayName = "") {
  if (!container || equipmentId == null) return;
  activeOperationId = activeOperationId || localStorage.getItem("active_operation_id");
  const equipmentKey = String(equipmentId);
  container.dataset.equipmentCameraId = equipmentKey;
  renderEquipmentCameraInto(container, equipmentKey, displayName);
  await loadLiveStreams();
  if (container.dataset.equipmentCameraId !== equipmentKey) return;
  renderEquipmentCameraInto(container, equipmentKey, displayName);
}

function renderPersonnelCameraInto(container, personId, displayName = "") {
  if (!container || personId == null) return;

  const camera = findCameraForPerson(personId, displayName);
  const name = camera?.name || displayName || `Agente ${personId}`;
  const playbackKey = camera ? (camera.playbackKey || getCameraPlaybackKey(camera)) : `person:${personId}`;
  const fallbackCamera = {
    protocol: CAMERA_PROTOCOL_WEBRTC,
    protocolFamily: CAMERA_PROTOCOL_WEBRTC,
    name,
    placeholder: true
  };
  const badge = camera ? getCameraBadge(camera) : getWaitingSignalBadge(fallbackCamera);
  const hasFrozen = frozenVideoFrames.has(String(playbackKey));
  const media = camera
    ? buildMediaMarkup(camera)
    : hasFrozen
      ? `
        <video data-playback-key="${escapeHtml(playbackKey)}" autoplay muted playsinline></video>
        <div class="cameraConnectionLostScreen" data-playback-key="${escapeHtml(playbackKey)}" aria-hidden="true"></div>
      `
      : buildWaitingSignalMarkup(fallbackCamera);
  const audioButton = camera ? buildCameraAudioButton(camera) : "";

  destroyHlsPlayersIn(container);
  container.dataset.playbackKey = playbackKey;
  container.innerHTML = `
    <div class="personInfoCameraFeed cameraFeed">
      <div class="cameraFeedBadge">${escapeHtml(badge)}</div>
      ${audioButton}
      ${media}
      <div class="cameraFeedName">${escapeHtml(name)}</div>
    </div>
  `;

  const feed = container.querySelector(".personInfoCameraFeed");
  if (camera && feed) {
    bindCameraAudioButton(feed);
    if (camera.isWebRtc && camera.streamId) joinWebRtcStream(camera);
    bindCameraSurfaceInteractions(feed, camera);
  }
  attachPlayableUrlFeeds(container);
  attachKnownMediaStreams();

  if (!camera && hasFrozen) {
    restoreFrozenFrame(playbackKey, container);
  }
}

export async function renderPersonnelLiveCamera(container, personId, displayName = "") {
  if (!container || personId == null) return;

  activeOperationId = activeOperationId || localStorage.getItem("active_operation_id");
  const personKey = String(personId);
  container.dataset.personCameraPersonId = personKey;

  renderPersonnelCameraInto(container, personKey, displayName);
  await loadLiveStreams();

  if (container.dataset.personCameraPersonId !== personKey) return;
  const currentPlaybackKey = container.dataset.playbackKey || "";
  const camera = findCameraForPerson(personKey, displayName);
  const nextPlaybackKey = camera ? (camera.playbackKey || getCameraPlaybackKey(camera)) : "";

  if (currentPlaybackKey && nextPlaybackKey && currentPlaybackKey === nextPlaybackKey) return;
  renderPersonnelCameraInto(container, personKey, displayName);
}

export async function showPersonnelLiveCamera(personId, displayName = "") {
  if (!dom.personnelDetailCamera || personId == null) return;

  activeOperationId = activeOperationId || localStorage.getItem("active_operation_id");
  activePersonnelCamera = {
    personId: String(personId),
    displayName: String(displayName || "").trim()
  };

  renderActivePersonnelCamera();
  await loadLiveStreams();
}

export function clearPersonnelLiveCamera() {
  activePersonnelCamera = null;
  if (dom.personnelDetailCamera) {
    destroyHlsPlayersIn(dom.personnelDetailCamera);
    dom.personnelDetailCamera.dataset.playbackKey = "";
    dom.personnelDetailCamera.innerHTML = "";
  }
}

function renderActivePersonnelCamera() {
  if (!activePersonnelCamera || !dom.personnelDetailCamera) return;

  const camera = findCameraForPerson(activePersonnelCamera.personId, activePersonnelCamera.displayName);
  const name = camera?.name || activePersonnelCamera.displayName || `Agente ${activePersonnelCamera.personId}`;
  const playbackKey = camera ? (camera.playbackKey || getCameraPlaybackKey(camera)) : `person:${activePersonnelCamera.personId}`;
  const currentPlaybackKey = dom.personnelDetailCamera.dataset.playbackKey || "";

  if (currentPlaybackKey && playbackKey && currentPlaybackKey === playbackKey) {
    if (isActivePersonnelCameraInReviewMode()) {
      attachPlayableUrlFeeds(dom.personnelDetailCamera);
      attachKnownMediaStreams();
      return;
    }

    if (camera && camera.isWebRtc && camera.streamId) {
      joinWebRtcStream(camera);
    }
    attachPlayableUrlFeeds(dom.personnelDetailCamera);
    attachKnownMediaStreams();
    return;
  }

  const fallbackCamera = {
    protocol: CAMERA_PROTOCOL_WEBRTC,
    protocolFamily: CAMERA_PROTOCOL_WEBRTC,
    name,
    placeholder: true
  };
  const badge = camera ? getCameraBadge(camera) : getWaitingSignalBadge(fallbackCamera);
  const hasFrozen = frozenVideoFrames.has(String(playbackKey));
  const media = camera
    ? buildMediaMarkup(camera)
    : hasFrozen
      ? `
        <video data-playback-key="${escapeHtml(playbackKey)}" autoplay muted playsinline></video>
        <div class="cameraConnectionLostScreen" data-playback-key="${escapeHtml(playbackKey)}" aria-hidden="true"></div>
      `
      : buildWaitingSignalMarkup(fallbackCamera);
  const playback = camera ? buildPlaybackMarkup(camera) : "";
  const audioButton = camera ? buildCameraAudioButton(camera) : "";

  destroyHlsPlayersIn(dom.personnelDetailCamera);
  dom.personnelDetailCamera.dataset.playbackKey = playbackKey;
  dom.personnelDetailCamera.innerHTML = `
    <div class="cameraFeedBadge">${escapeHtml(badge)}</div>
    ${audioButton}
    ${media}
    ${playback}
    <div class="cameraFeedName">${escapeHtml(name)}</div>
  `;

  if (camera) bindCameraAudioButton(dom.personnelDetailCamera);
  if (camera) {
    if (camera.isWebRtc && camera.streamId) joinWebRtcStream(camera);
    bindPlaybackControls(dom.personnelDetailCamera, camera);
    bindCameraSurfaceInteractions(dom.personnelDetailCamera, camera);
  }
  attachPlayableUrlFeeds(dom.personnelDetailCamera);
  attachKnownMediaStreams();

  if (!camera && hasFrozen) {
    restoreFrozenFrame(playbackKey, dom.personnelDetailCamera);
  }
}

function findCameraForPerson(personId, displayName = "") {
  const personKey = String(personId || "");
  const cameras = getRenderableCameraData();
  const byId = cameras.find((camera) =>
    !camera.placeholder && camera.personnelId != null && String(camera.personnelId) === personKey
  );
  if (byId) return byId;

  const deviceKeys = getDeviceKeysForPerson(personKey);
  if (deviceKeys.size) {
    const byDevice = cameras.find((camera) => {
      const values = [
        camera.dispositivoId,
        camera.id_dispositivo,
        camera.externalDeviceId,
        camera.external_device_id,
        camera.streamKey,
        camera.stream_key
      ];
      return !camera.placeholder && values.some((value) =>
        value != null && deviceKeys.has(String(value).trim().toLowerCase())
      );
    });
    if (byDevice) return byDevice;
  }

  const nameKey = normalizeName(displayName);
  if (!nameKey) return null;

  return cameras.find((camera) =>
    !camera.placeholder && normalizeName(camera.name).includes(nameKey)
  ) || null;
}

function getDeviceKeysForPerson(personId) {
  const personKey = String(personId || "").trim();
  const keys = new Set();
  if (!personKey) return keys;

  const operation = getCurrentOperation() || {};
  let assignment = {};
  try {
    assignment = JSON.parse(localStorage.getItem("asignacion_actual") || "{}") || {};
  } catch {}

  const devices = [
    ...(Array.isArray(operation.dispositivos) ? operation.dispositivos : []),
    ...(Array.isArray(assignment.dispositivos) ? assignment.dispositivos : [])
  ];
  const assignments = [
    ...(Array.isArray(operation.asignacionDispositivos) ? operation.asignacionDispositivos : []),
    ...(Array.isArray(operation.asignacion_dispositivos) ? operation.asignacion_dispositivos : []),
    ...(Array.isArray(assignment.asignacionDispositivos) ? assignment.asignacionDispositivos : [])
  ];
  const addDeviceKeys = (device = {}) => {
    [
      device.id_dispositivo,
      device.id,
      device.dispositivo_id,
      device.device_id,
      device.imei,
      device.numero_serie,
      device.numeroSerie,
      device.serial,
      device.identificador_app,
      device.external_device_id
    ].forEach((value) => {
      const key = String(value ?? "").trim().toLowerCase();
      if (key) keys.add(key);
    });
  };

  devices
    .filter((device) => String(device.id_personal ?? device.personal_id ?? "") === personKey)
    .forEach(addDeviceKeys);

  assignments
    .filter((item) => String(item.id_personal ?? "") === personKey)
    .forEach((item) => {
      addDeviceKeys(item);
      const deviceId = String(item.id_dispositivo ?? item.id ?? "");
      devices
        .filter((device) => String(device.id_dispositivo ?? device.id ?? "") === deviceId)
        .forEach(addDeviceKeys);
    });

  return keys;
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function getActivePersonnelPlaybackKey() {
  if (!activePersonnelCamera || !dom.personnelDetailCamera) return "";
  return dom.personnelDetailCamera.dataset.playbackKey || "";
}

function isSameActivePersonnelCameraFeed() {
  const currentPlaybackKey = getActivePersonnelPlaybackKey();
  if (!currentPlaybackKey) return false;

  const camera = findCameraForPerson(activePersonnelCamera.personId, activePersonnelCamera.displayName);
  if (!camera) return false;

  const nextPlaybackKey = camera.playbackKey || getCameraPlaybackKey(camera);
  return Boolean(nextPlaybackKey && nextPlaybackKey === currentPlaybackKey);
}

function isActivePersonnelCameraInReviewMode() {
  const playbackKey = getActivePersonnelPlaybackKey();
  if (!playbackKey) return false;
  const group = getPlaybackGroup(playbackKey, false);
  return Boolean(group?.reviewMode && group?.segments?.length);
}

async function fetchIceServers() {
  if (iceServers) return iceServers;
  if (!activeOperationId) return [{ urls: "stun:stun.l.google.com:19302" }];

  try {
    const res = await fetch(`${API_BASE}/ops/${activeOperationId}/streams/webrtc-config`, {
      headers: authHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    iceServers = data?.config?.iceServers || [{ urls: "stun:stun.l.google.com:19302" }];
  } catch {
    iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  }
  return iceServers;
}

async function joinWebRtcStream(camera, options = {}) {
  if (!streamSocket || streamSocket.connected !== true) return;
  if (!window.RTCPeerConnection) return;
  if (joinedStreams.has(camera.streamId) && !options.refresh) {
    attachKnownMediaStreams();
    return;
  }

  joinedStreams.add(camera.streamId);
  ensurePeerConnection(camera.streamId);
  streamSocket.emit("stream_join", {
    id_operacion: camera.operationId || activeOperationId,
    id_stream: camera.streamId,
    role: "viewer",
    refresh: Boolean(options.refresh)
  }, (ack = {}) => {
    if (!ack.ok) {
      joinedStreams.delete(camera.streamId);
      console.warn("[CAMERAS] No se pudo unir al stream:", ack.mensaje || "sin detalle");
      return;
    }
    if (ack.stream) updateCameraFromStream(ack.stream);
  });
}

function addTrackToRemoteStream(streamId, track) {
  if (!track) return null;

  const id = Number(streamId);
  if (!id) return null;

  let mediaStream = remoteStreams.get(id);
  if (!mediaStream) {
    mediaStream = new MediaStream();
    remoteStreams.set(id, mediaStream);
  }

  if (!mediaStream.getTracks().some((current) => current.id === track.id)) {
    mediaStream.addTrack(track);
    track.addEventListener("ended", () => {
      const currentStream = remoteStreams.get(id);
      if (!currentStream) return;
      const hasLiveTracks = currentStream.getTracks().some((current) => current.readyState === "live");
      if (!hasLiveTracks) {
        remoteStreams.delete(id);
        handleStreamConnectionLost(id);
        attachMediaStateForStream(id);
      }
    });
  }

  return mediaStream;
}

async function ensurePeerConnection(streamId) {
  if (peerConnections.has(streamId)) return peerConnections.get(streamId);

  const servers = await fetchIceServers();
  const pc = new RTCPeerConnection({ iceServers: servers });
  peerConnections.set(streamId, pc);

  pc.ontrack = (event) => {
    const id = Number(streamId);
    const incomingTracks = event.streams?.length
      ? event.streams.flatMap((mediaStream) => mediaStream.getTracks())
      : [event.track];

    incomingTracks.forEach((track) => addTrackToRemoteStream(id, track));
    const mediaStream = addTrackToRemoteStream(id, event.track);
    if (!mediaStream) return;

    handleStreamConnectionRestored(id, mediaStream);
    attachKnownMediaStreams();
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      const archive = getPlaybackArchive(streamId, false);
      const hasRemote = remoteStreams.has(Number(streamId));
      if (archive && hasRemote) archive.connectionLost = false;
      if (hasRemote) {
        const timer = reconnectTimers.get(streamId);
        if (timer) {
          window.clearTimeout(timer);
          reconnectTimers.delete(streamId);
        }
      }
      updatePlaybackControls(streamId);
    }
    if (["failed", "closed"].includes(pc.connectionState)) {
      remoteStreams.delete(Number(streamId));
      handleStreamConnectionLost(streamId);
      attachMediaStateForStream(streamId);
      reconnectWebRtcStream(streamId, 1000);
    }
    if (pc.connectionState === "disconnected") {
      remoteStreams.delete(Number(streamId));
      handleStreamConnectionLost(streamId);
      attachMediaStateForStream(streamId);
      reconnectWebRtcStream(streamId, 3500);
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (["failed", "closed"].includes(pc.iceConnectionState)) {
      remoteStreams.delete(Number(streamId));
      handleStreamConnectionLost(streamId);
      attachMediaStateForStream(streamId);
      reconnectWebRtcStream(streamId, 1000);
    }
  };

  pc.onicecandidate = (event) => {
    if (!event.candidate || !streamSocket) return;
    streamSocket.emit("webrtc_ice_candidate", {
      id_operacion: activeOperationId,
      id_stream: streamId,
      to: peerTargets.get(streamId) || getPublisherSocketId(streamId),
      candidate: event.candidate
    });
  };

  return pc;
}

function getPublisherSocketId(streamId) {
  return cameraData.find((camera) => Number(camera.streamId) === Number(streamId))?.publisherSocketId || "";
}

function updateCameraFromStream(stream) {
  const streamId = Number(stream?.id_stream);
  if (!streamId) return null;

  const nextCamera = streamToCamera(stream);
  rememberCameraMetadata(nextCamera);
  return upsertCameraDataEntry(nextCamera);
}

function findCameraByStreamId(streamId) {
  return cameraData.find((camera) => Number(camera.streamId) === Number(streamId)) || null;
}

function reconnectWebRtcStream(streamId, delay = 250) {
  const id = Number(streamId);
  if (!id || reconnectTimers.has(id)) return;

  reconnectTimers.set(id, window.setTimeout(() => {
    reconnectTimers.delete(id);
    const camera = findCameraByStreamId(id);
    if (!camera?.isWebRtc) return;

    closePeer(id);
    joinWebRtcStream(camera, { refresh: true });
  }, delay));
}

function bindStreamSocket() {
  if (!streamSocket || cameraSocketBound) return;
  cameraSocketBound = true;

  streamSocket.on("connect", () => {
    joinedStreams.clear();
    attachLiveFeeds();
  });

  streamSocket.on("media_stream_started", async () => {
    if (!isSameActivePersonnelCameraFeed()) {
      await loadLiveStreams();
    }
  });
  streamSocket.on("media_stream_publisher_ready", (stream) => {
    const camera = updateCameraFromStream(stream);
    if (camera) {
      renderFeeds();
      if (!isSameActivePersonnelCameraFeed()) {
        renderActivePersonnelCamera();
      }
      reconnectWebRtcStream(camera.streamId, 250);
    } else {
      loadLiveStreams();
    }
  });
  streamSocket.on("webrtc_publisher_joined", (payload = {}) => {
    reconnectWebRtcStream(Number(payload.id_stream), 250);
  });
  streamSocket.on("media_stream_publisher_offline", (stream) => {
    const camera = updateCameraFromStream(stream);
    closePeer(Number(stream?.id_stream));
    if (camera) {
      renderFeeds();
      if (!isSameActivePersonnelCameraFeed()) {
        renderActivePersonnelCamera();
      }
    } else {
      loadLiveStreams();
    }
  });
  streamSocket.on("media_stream_stopped", (stream) => {
    closePeer(Number(stream?.id_stream));
    if (isSameActivePersonnelCameraFeed() && isActivePersonnelCameraInReviewMode()) {
      updateCameraFromStream(stream);
      return;
    }
    loadLiveStreams();
  });

  streamSocket.on("webrtc_offer", async (payload) => {
    const streamId = Number(payload?.id_stream);
    const sdp = payload?.sdp;
    if (!streamId || !sdp) return;

    const pc = await ensurePeerConnection(streamId);
    peerTargets.set(streamId, payload.from_socket_id || payload.from || "");
    await pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    streamSocket.emit("webrtc_answer", {
      id_operacion: payload.id_operacion || activeOperationId,
      id_stream: streamId,
      to: payload.from_socket_id || payload.from,
      type: answer.type,
      sdp: answer.sdp
    });
  });

  streamSocket.on("webrtc_ice_candidate", async (payload) => {
    const streamId = Number(payload?.id_stream);
    const candidate = payload?.candidate;
    if (!streamId || !candidate) return;

    const pc = await ensurePeerConnection(streamId);
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn("[CAMERAS] ICE candidate rechazado:", err.message);
    }
  });
}

function closePeer(streamId) {
  const id = Number(streamId);
  remoteStreams.delete(id);
  handleStreamConnectionLost(streamId);

  const timer = reconnectTimers.get(streamId);
  if (timer) {
    window.clearTimeout(timer);
    reconnectTimers.delete(streamId);
  }

  const pc = peerConnections.get(streamId);
  if (pc) {
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.close();
  }
  peerConnections.delete(streamId);
  joinedStreams.delete(streamId);
  peerTargets.delete(streamId);

  const archive = getPlaybackArchive(streamId, false);
  const playbackKey = archive?.playbackKey || getStreamPlaybackKey(streamId);
  queryVideosForPlaybackKey(playbackKey).forEach((video) => {
    if (getPlaybackGroup(playbackKey, false)?.segments?.length) {
      enterLocalReview(playbackKey);
      attachReviewVideo(video, playbackKey);
      return;
    }
    video.srcObject = null;
    setConnectionLostScreen(playbackKey, true);
  });
  updatePlaybackControls(playbackKey);
}

function toggleFocus(feed) {
  const wasFocused = feed.classList.contains("focused");
  if (wasFocused && dom.cameraFeeds?.classList.contains("speaker-layout")) {
    return;
  }
  focusCameraFeed(feed);
}

function getCameraFeedItems() {
  return [...(dom.cameraFeeds?.querySelectorAll(".cameraFeed") || [])];
}

function focusCameraFeed(feed) {
  if (!feed) return;
  setCameraLayout("speaker", feed);
}

function getFocusedCameraIndex(feeds = getCameraFeedItems()) {
  const focused = dom.cameraFeeds?.querySelector(".cameraFeed.focused");
  return focused ? feeds.indexOf(focused) : -1;
}

function focusCameraAtIndex(index) {
  const feeds = getCameraFeedItems();
  if (!feeds.length) return;
  const nextIndex = (index + feeds.length) % feeds.length;
  setCameraLayout("speaker", feeds[nextIndex]);
}

function getCameraScrollStep() {
  const firstFeed = dom.cameraFeeds?.querySelector(".cameraFeed");
  if (!firstFeed) return 240;
  const rect = firstFeed.getBoundingClientRect();
  const styles = window.getComputedStyle(dom.cameraFeeds);
  const gap = Number.parseFloat(styles.columnGap || styles.gap || "12") || 12;
  return Math.max(160, rect.width + gap);
}

function scrollCameraStrip(direction) {
  if (!dom.cameraFeeds) return;
  dom.cameraFeeds.scrollBy({
    left: direction * getCameraScrollStep(),
    behavior: "smooth"
  });
  window.setTimeout(syncCameraNavigationControls, 220);
}

function navigateCameraStrip(direction) {
  const feeds = getCameraFeedItems();
  if (feeds.length <= 1) return;

  if (dom.cameraFeeds?.classList.contains("speaker-layout")) {
    const currentIndex = getFocusedCameraIndex(feeds);
    focusCameraAtIndex((currentIndex < 0 ? 0 : currentIndex) + direction);
    return;
  }

  scrollCameraStrip(direction);
}

function syncCameraNavigationControls() {
  const feeds = getCameraFeedItems();
  const hasMultipleFeeds = feeds.length > 1;
  const speaker = dom.cameraFeeds?.classList.contains("speaker-layout");
  const compactRow = dom.cameraPanel?.classList.contains("camera-compact-row");
  const scrollMax = Math.max(0, (dom.cameraFeeds?.scrollWidth || 0) - (dom.cameraFeeds?.clientWidth || 0));
  const canScroll = scrollMax > 2;
  const scrollLeft = dom.cameraFeeds?.scrollLeft || 0;
  const showNavigation = hasMultipleFeeds && (speaker || (compactRow && canScroll));

  dom.cameraPanel?.classList.toggle("has-camera-nav", showNavigation);
  [dom.cameraPrevBtn, dom.cameraNextBtn].forEach((button) => {
    if (!button) return;
    button.classList.toggle("is-hidden", !showNavigation);
    button.setAttribute("aria-hidden", showNavigation ? "false" : "true");
  });

  if (!showNavigation) {
    if (dom.cameraPrevBtn) dom.cameraPrevBtn.disabled = true;
    if (dom.cameraNextBtn) dom.cameraNextBtn.disabled = true;
    return;
  }

  if (speaker) {
    if (dom.cameraPrevBtn) dom.cameraPrevBtn.disabled = false;
    if (dom.cameraNextBtn) dom.cameraNextBtn.disabled = false;
    return;
  }

  if (dom.cameraPrevBtn) dom.cameraPrevBtn.disabled = scrollLeft <= 2;
  if (dom.cameraNextBtn) dom.cameraNextBtn.disabled = scrollLeft >= scrollMax - 2;
}

export function refreshCameraPanelLayout() {
  if (cameraLayoutFrame) return;
  cameraLayoutFrame = window.requestAnimationFrame(() => {
    cameraLayoutFrame = 0;
    syncCameraPanelDensity();
    syncCameraNavigationControls();
  });
}

function syncCameraPanelDensity() {
  if (!dom.cameraPanel || !dom.cameraFeeds) return;
  const rect = dom.cameraPanel.getBoundingClientRect();
  const feedCount = getCameraFeedItems().length;
  const speaker = dom.cameraFeeds.classList.contains("speaker-layout");
  const compactRow = rect.height > 0 && rect.height < 310 && !dom.cameraFeeds.classList.contains("speaker-layout");
  const compactBox = rect.height > 0 && rect.height < 240 && (feedCount === 1 || speaker);
  setCameraPanelClass("camera-compact-row", compactRow);
  setCameraPanelClass("camera-compact-box", compactBox);
  setCameraPanelClass("camera-single-feed", feedCount === 1);
  setCameraPanelClass("camera-multi-feed", feedCount > 1);
}

function setCameraPanelClass(className, enabled) {
  if (!dom.cameraPanel) return;
  if (dom.cameraPanel.classList.contains(className) === enabled) return;
  dom.cameraPanel.classList.toggle(className, enabled);
}

function observeCameraPanelResize() {
  if (!dom.cameraPanel || cameraResizeObserver) return;
  if (typeof ResizeObserver === "undefined") return;

  cameraResizeObserver = new ResizeObserver(refreshCameraPanelLayout);
  cameraResizeObserver.observe(dom.cameraPanel);
}

function ensureFocusedCameraInSpeakerLayout() {
  if (!dom.cameraFeeds?.classList.contains("speaker-layout")) {
    dom.cameraPanel?.classList.remove("is-focused");
    syncCameraPanelDensity();
    syncCameraNavigationControls();
    return;
  }

  dom.cameraPanel?.classList.add("is-focused");
  if (!dom.cameraFeeds.querySelector(".cameraFeed.focused")) {
    const rememberedFeed = focusedCameraPlaybackKey
      ? getCameraFeedItems().find((feed) => feed.dataset.playbackKey === focusedCameraPlaybackKey)
      : null;
    (rememberedFeed || dom.cameraFeeds.querySelector(".cameraFeed"))?.classList.add("focused");
  }

  const focused = dom.cameraFeeds.querySelector(".cameraFeed.focused");
  focusedCameraPlaybackKey = focused?.dataset.playbackKey || focusedCameraPlaybackKey;
  syncCameraNavigationControls();
}

function setCameraLayout(layout, focusFeed = null) {
  if (!dom.cameraFeeds) return;

  const wasSpeaker = dom.cameraFeeds.classList.contains("speaker-layout");
  const speaker = layout === "speaker";
  if (speaker && !wasSpeaker && dom.cameraPanel) {
    const rect = dom.cameraPanel.getBoundingClientRect();
    cameraGridPanelSize = { width: rect.width, height: rect.height };
  }
  dom.cameraFeeds.classList.toggle("speaker-layout", speaker);
  dom.cameraFeeds.classList.toggle("grid-layout", !speaker);
  dom.cameraPanel?.classList.toggle("is-focused", speaker);
  if (speaker) dom.cameraPanel?.classList.remove("camera-compact-row");
  dom.cameraLayoutSpeaker?.classList.toggle("active", speaker);
  dom.cameraLayoutSpeaker?.setAttribute("aria-pressed", speaker ? "true" : "false");
  dom.cameraLayoutGrid?.classList.toggle("active", !speaker);
  dom.cameraLayoutGrid?.setAttribute("aria-pressed", speaker ? "false" : "true");

  getCameraFeedItems().forEach((item) => item.classList.remove("focused"));
  if (speaker) {
    const selectedFeed = focusFeed && dom.cameraFeeds.contains(focusFeed)
      ? focusFeed
      : focusedCameraPlaybackKey
        ? getCameraFeedItems().find((feed) => feed.dataset.playbackKey === focusedCameraPlaybackKey)
        : null;
    const focused = selectedFeed || dom.cameraFeeds.querySelector(".cameraFeed");
    focused?.classList.add("focused");
    focusedCameraPlaybackKey = focused?.dataset.playbackKey || focusedCameraPlaybackKey;
    if (!wasSpeaker) applyCompactSpeakerPanelSize();
    focused?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }
  syncCameraPanelDensity();
  syncCameraNavigationControls();
}

function applyCompactSpeakerPanelSize() {
  const panel = dom.cameraPanel;
  if (!panel) return;

  const width = Math.max(260, Math.min(360, window.innerWidth - 32));
  const height = Math.max(178, Math.min(220, window.innerHeight - 80));
  const rect = panel.getBoundingClientRect();

  panel.style.width = `${width}px`;
  panel.style.height = `${height}px`;

  const nextLeft = Math.min(Math.max(rect.left, 12), Math.max(12, window.innerWidth - width - 12));
  const nextTop = Math.min(Math.max(rect.top, 12), Math.max(12, window.innerHeight - height - 12));
  panel.style.left = `${nextLeft}px`;
  panel.style.top = `${nextTop}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  panel.style.margin = "0";
  panel.style.transform = "none";
}

function returnToCameraGrid() {
  setCameraLayout("grid");
  if (dom.cameraPanel && cameraGridPanelSize) {
    const width = Math.min(cameraGridPanelSize.width, window.innerWidth - 24);
    const height = Math.min(cameraGridPanelSize.height, window.innerHeight - 24);
    dom.cameraPanel.style.width = `${Math.max(280, width)}px`;
    dom.cameraPanel.style.height = `${Math.max(176, height)}px`;
    window.requestAnimationFrame(() => {
      keepCameraPanelInViewport();
      refreshCameraPanelLayout();
    });
  }
}

function bindCameraEvents() {
  if (cameraEventsBound) return;
  cameraEventsBound = true;

  dom.cameraLayoutGrid?.addEventListener("click", returnToCameraGrid);
  dom.cameraLayoutSpeaker?.addEventListener("click", () => {
    setCameraLayout("speaker", dom.cameraFeeds?.querySelector(".cameraFeed.focused"));
  });
  dom.cameraPrevBtn?.addEventListener("click", () => navigateCameraStrip(-1));
  dom.cameraNextBtn?.addEventListener("click", () => navigateCameraStrip(1));
  dom.cameraFeeds?.addEventListener("scroll", syncCameraNavigationControls, { passive: true });
  window.addEventListener("resize", refreshCameraPanelLayout);
  window.addEventListener("resize", keepCameraPanelInViewport);
  window.addEventListener("orientationchange", () => {
    window.setTimeout(keepCameraPanelInViewport, 120);
  });
  window.visualViewport?.addEventListener("resize", keepCameraPanelInViewport);
  observeCameraPanelResize();

  dom.cameraWebRtcBtn?.addEventListener("click", () => setCameraProtocolFilter(CAMERA_PROTOCOL_WEBRTC));
  dom.cameraRtmpBtn?.addEventListener("click", () => setCameraProtocolFilter(CAMERA_PROTOCOL_RTMP));

}

function makePanelDraggable() {
  const panel = dom.cameraPanel;
  if (!panel || cameraDragBound) return;
  cameraDragBound = true;

  let previousX = 0;
  let previousY = 0;
  let activePointerId = null;

  panel.addEventListener("pointerdown", startDragging);

  function startDragging(event) {
    if (!event.isPrimary || event.button !== 0) return;

    const target = event.target;
    const fromDragHandle = Boolean(target.closest(".cameraDragHandle"));
    if (!fromDragHandle) {
      if (target.closest("button, input, select, textarea, a")) return;
      if (target.closest(".cameraFeed, video, iframe, .cameraPlayback, .camScrubberWrap, .cameraAudioBtn")) return;
      if (target.closest(".cameraBottomControls")) return;
    }

    const rect = panel.getBoundingClientRect();
    const inResizeCorner = event.clientX > rect.right - 26 && event.clientY > rect.bottom - 26;
    if (inResizeCorner) return;

    event.preventDefault();

    previousX = event.clientX;
    previousY = event.clientY;
    activePointerId = event.pointerId;

    panel.style.top = `${rect.top}px`;
    panel.style.left = `${rect.left}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.margin = "0";
    panel.style.transform = "none";
    panel.style.zIndex = "3100";
    panel.classList.add("is-dragging");

    panel.setPointerCapture?.(event.pointerId);
    document.addEventListener("pointerup", stopDragging);
    document.addEventListener("pointercancel", stopDragging);
    document.addEventListener("pointermove", dragPanel);
  }

  function dragPanel(event) {
    if (activePointerId !== event.pointerId) return;
    event.preventDefault();

    const deltaX = event.clientX - previousX;
    const deltaY = event.clientY - previousY;
    previousX = event.clientX;
    previousY = event.clientY;

    const rect = panel.getBoundingClientRect();
    const visibleEdge = 56;
    const minLeft = Math.min(12, window.innerWidth - rect.width - visibleEdge);
    const maxLeft = Math.max(12, window.innerWidth - visibleEdge);
    const minTop = 12;
    const maxTop = Math.max(12, window.innerHeight - visibleEdge);
    const nextLeft = Math.min(Math.max(rect.left + deltaX, minLeft), maxLeft);
    const nextTop = Math.min(Math.max(rect.top + deltaY, minTop), maxTop);

    panel.style.top = `${nextTop}px`;
    panel.style.left = `${nextLeft}px`;
  }

  function stopDragging(event) {
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    document.removeEventListener("pointerup", stopDragging);
    document.removeEventListener("pointercancel", stopDragging);
    document.removeEventListener("pointermove", dragPanel);
    if (panel.hasPointerCapture?.(activePointerId)) {
      panel.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
    panel.style.zIndex = "3000";
    panel.classList.remove("is-dragging");
  }
}

function keepCameraPanelInViewport() {
  const panel = dom.cameraPanel;
  if (!panel || window.innerWidth <= 820) return;

  const margin = 12;
  const viewportWidth = window.visualViewport?.width || window.innerWidth;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  let rect = panel.getBoundingClientRect();

  if (rect.width > viewportWidth - margin * 2) {
    panel.style.width = `${Math.max(220, viewportWidth - margin * 2)}px`;
    rect = panel.getBoundingClientRect();
  }
  if (rect.height > viewportHeight - margin * 2) {
    panel.style.height = `${Math.max(158, viewportHeight - margin * 2)}px`;
    rect = panel.getBoundingClientRect();
  }

  const left = Math.min(
    Math.max(rect.left, margin),
    Math.max(margin, viewportWidth - rect.width - margin)
  );
  const top = Math.min(
    Math.max(rect.top, margin),
    Math.max(margin, viewportHeight - rect.height - margin)
  );

  if (Math.abs(left - rect.left) > 1 || Math.abs(top - rect.top) > 1) {
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }
}

function makePanelResizable() {
  const panel = dom.cameraPanel;
  const handle = document.getElementById("cameraResizeHandle");
  if (!panel || !handle || cameraResizeBound) return;
  cameraResizeBound = true;

  handle.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();

    const pointerId = event.pointerId;
    const startRect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    handle.setPointerCapture?.(pointerId);
    panel.classList.add("is-resizing");

    const resize = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const maxWidth = Math.max(220, window.innerWidth - startRect.left - 12);
      const maxHeight = Math.max(158, window.innerHeight - startRect.top - 12);
      const width = Math.min(maxWidth, Math.max(220, startRect.width + moveEvent.clientX - startX));
      const height = Math.min(maxHeight, Math.max(158, startRect.height + moveEvent.clientY - startY));
      panel.style.width = `${Math.round(width)}px`;
      panel.style.height = `${Math.round(height)}px`;
      refreshCameraPanelLayout();
    };

    const finish = (upEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      handle.removeEventListener("pointermove", resize);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      panel.classList.remove("is-resizing");
      handle.releasePointerCapture?.(pointerId);
      refreshCameraPanelLayout();
    };

    handle.addEventListener("pointermove", resize);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });
}
