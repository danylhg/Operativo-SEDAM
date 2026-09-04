import {
  panel,
  rightTitle,
  rightHint,
  btnAccion,
  btnBack,
  leftCardTitleEl,
  opInfoFormEl,
  vehiculosLeftEl,
  dashboardWrap,
  btnDashboardGo,
  btnDownloadList
} from "./dom.js";
import { capFirst } from "./utils.js";

export function showOperacionInfo() {
  vehiculosLeftEl?.closest(".leftCard")?.classList.remove("equipmentAssignLeftMode");
  vehiculosLeftEl?.closest(".leftCard")?.classList.remove("vehicleAssignLeftMode");
  if (leftCardTitleEl) leftCardTitleEl.textContent = "Detalles de la operación";
  if (opInfoFormEl) opInfoFormEl.style.display = "flex";
  if (vehiculosLeftEl) {
    vehiculosLeftEl.style.display = "none";
    vehiculosLeftEl.innerHTML = "";
  }
}

export function showVehiculosLeftPanel(title = "Asignación de personal al vehículo") {
  vehiculosLeftEl?.closest(".leftCard")?.classList.remove("equipmentAssignLeftMode");
  vehiculosLeftEl?.closest(".leftCard")?.classList.remove("vehicleAssignLeftMode");
  if (leftCardTitleEl) leftCardTitleEl.textContent = title;
  if (opInfoFormEl) opInfoFormEl.style.display = "none";
  if (vehiculosLeftEl) {
    vehiculosLeftEl.style.display = "flex";
    vehiculosLeftEl.innerHTML = "";
  }
}

export function hideDashboardButton() {
  if (dashboardWrap) {
    dashboardWrap.style.display = "none";
    dashboardWrap.classList.remove("visible");
  }
}

export function showDashboardButton() {
  if (dashboardWrap) {
    dashboardWrap.style.display = "flex";
    dashboardWrap.classList.add("visible");
  }
  if (btnDashboardGo) btnDashboardGo.disabled = false;
  if (btnDownloadList) btnDownloadList.disabled = false;
}

export function renderAssignmentCompleteActions() {
  showDashboardButton();
}

export function setHeader(title, hint) {
  if (rightTitle) rightTitle.textContent = capFirst(title);
  if (rightHint) rightHint.textContent = capFirst(hint);
}

export function setAccion(text, disabled = false) {
  if (btnAccion) {
    btnAccion.textContent = capFirst(text);
    btnAccion.disabled = !!disabled;
  }
}

export function showBack(show) {
  if (btnBack) btnBack.style.visibility = show ? "visible" : "hidden";
}

export function clearPanel() {
  if (panel) {
    const rightCard = panel.closest(".rightCard");
    const cols = panel.closest(".cols");

    if (rightCard) rightCard.scrollTop = 0;
    if (cols) cols.scrollTop = 0;
    const leftCard = cols?.querySelector(".leftCard");
    if (leftCard) leftCard.scrollTop = 0;

    panel.innerHTML = "";
    panel.classList.remove("homePanel");
    panel.classList.remove("personasPanel");
    panel.classList.remove("resourceWidePanel");
    rightCard?.classList.remove("resourceWideMode");
    cols?.classList.remove("resourceWideMode");
    panel.closest(".shell")?.classList.remove("resourceWideMode");
    document.body.classList.remove("resourceWideMode");
  }
}

export function getScrollTopInPanel() {
  const scrollTarget =
    panel?.querySelector(".personasScroll") ||
    panel?.querySelector(".personasListBox") ||
    panel?.querySelector(".leftPeopleList") ||
    panel?.querySelector(".listBox");

  return scrollTarget?.scrollTop ?? 0;
}

export function restoreScrollTop(listBoxEl, scrollTop) {
  if (!listBoxEl) return;
  requestAnimationFrame(() => {
    const scrollTarget =
      listBoxEl.querySelector?.(".personasScroll") ||
      listBoxEl.querySelector?.(".leftPeopleList") ||
      listBoxEl;

    scrollTarget.scrollTop = scrollTop;
    listBoxEl.scrollTop = scrollTop;
  });
}

export function mkOpt(txt, desc = "") {
  const b = document.createElement("button");
  b.className = "optBtn";

  const key = String(txt || "").toLowerCase();
  const icon = document.createElement("span");
  icon.className = "optIcon";
  icon.innerHTML = key.includes("veh")
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17h14l-1.4-5.6A2 2 0 0 0 15.7 10H8.3a2 2 0 0 0-1.9 1.4L5 17Z"/><path d="M7 17v2"/><path d="M17 17v2"/><path d="M8 14h8"/></svg>`
    : key.includes("equipo")
      ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M12 12 4.5 7.8"/><path d="M12 12v8.5"/><path d="m12 12 7.5-4.2"/></svg>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 19v-1.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V19"/><circle cx="10" cy="7" r="3"/><path d="M20 19v-1.3a3 3 0 0 0-2.2-2.9"/><path d="M16.5 4.3a3 3 0 0 1 0 5.4"/></svg>`;
  b.appendChild(icon);

  const title = document.createElement("span");
  title.className = "optBtnTitle";
  title.textContent = capFirst(txt);
  b.appendChild(title);

  if (desc) {
    const subtitle = document.createElement("span");
    subtitle.className = "optBtnDesc";
    subtitle.textContent = desc;
    b.appendChild(subtitle);
  }

  return b;
}
