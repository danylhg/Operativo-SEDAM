export const dom = {};

export function readHistoryDom() {
  dom.backBtn = byId("backBtn");
  dom.title = byId("historyTitle");
  dom.code = byId("historyCode");
  dom.statusBadge = byId("historyStatusBadge");
  dom.who = byId("historyWho");
  dom.map = byId("historyMap");
  dom.infoContent = byId("historyInfoContent");
  dom.chatMessages = byId("historyChatMessages");
  dom.eventLog = byId("eventLog");
  dom.layers = byId("historyLayers");
  dom.layersToggle = byId("historyLayersToggle");
  dom.layerList = byId("historyLayerList");
  dom.prevEvent = byId("historyPrevEvent");
  dom.playPause = byId("historyPlayPause");
  dom.nextEvent = byId("historyNextEvent");
  dom.speed = byId("historySpeed");
  dom.range = byId("historyTimeRange");
  dom.markers = byId("historyMarkers");
  dom.currentTime = byId("historyCurrentTime");
  dom.totalTime = byId("historyTotalTime");
  dom.currentDate = byId("historyTimeDate");
  dom.elapsedTime = byId("historyElapsedTime");
  dom.durationTime = byId("historyDurationTime");
  dom.eventCounter = byId("historyEventCounter");
}

function byId(id) {
  return document.getElementById(id);
}
