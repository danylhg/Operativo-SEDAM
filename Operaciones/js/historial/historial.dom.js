export const dom = {};

export function readHistoryDom() {
  dom.backBtn = byId("backBtn", "btnBack");
  dom.title = byId("historyTitle", "opName");
  dom.statusBadge = byId("historyStatusBadge", "opMeta");
  dom.who = document.getElementById("historyWho");
  dom.map = byId("historyMap", "map");
  dom.stage = document.querySelector(".playbackStage");
  dom.sidePanel = document.getElementById("sidePanel");
  dom.panelToggle = document.getElementById("btnTogglePanel");
  dom.infoContent = byId("historyInfoContent", "opInfoDetails");
  dom.chatMessages = byId("historyChatMessages", "chatMessages");
  dom.eventLog = document.getElementById("eventLog");
  dom.prevEvent = document.getElementById("historyPrevEvent");
  dom.rewind = byId("historyRewind", "btnRewind");
  dom.playPause = byId("historyPlayPause", "btnPlayPause");
  dom.forward = byId("historyForward", "btnForward");
  dom.nextEvent = document.getElementById("historyNextEvent");
  dom.reset = document.getElementById("btnReset");
  dom.speed = byId("historySpeed", "playbackSpeed");
  dom.range = byId("historyTimeRange", "timelineSlider");
  dom.currentTime = byId("historyCurrentTime", "currentTimeLabel");
  dom.totalTime = byId("historyTotalTime", "totalTimeLabel");
  dom.elapsedTime = document.getElementById("historyElapsedTime");
  dom.durationTime = document.getElementById("historyDurationTime");
  dom.eventCounter = document.getElementById("historyEventCounter");
  dom.currentDate = document.getElementById("currentDateDisplay");
  dom.legacyPlaybackLayout = Boolean(document.getElementById("timelineSlider"));
}

function byId(...ids) {
  return ids.map(id => document.getElementById(id)).find(Boolean) || null;
}
