const logAlert = (message) => {
  if (message) console.warn(message);
};

export function generateUUID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function normalizeText(value) {
  return String(value ?? "").trim();
}

export function capFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function formatPuesto(str) {
  if (!str) return "";
  const low = str.toLowerCase();
  if (low.includes("teniente")) return "Tte.";
  if (low.includes("capit")) return "Cap.";
  if (low.includes("sargento")) return "Sgto.";
  if (low.includes("cabo") || low === "cb") return "Cb.";
  if (low.includes("soldado")) return "Sold.";
  if (low.includes("general")) return "Gral.";
  if (low.includes("coronel")) return "Cnel.";
  if (low.includes("comandante")) return "Cmdt.";
  if (low.includes("mayor")) return "Myr.";
  return str;
}

export function normalizeEquipoCategoria(categoria) {
  const c = (categoria ?? "").toString().trim().toLowerCase();

  if (c.includes("táct")) return "tactico";
  if (c.includes("tactic")) return "tactico";
  if (c.includes("comunic")) return "comunicacion";

  return "";
}

export function validateDateTime(opInicioEl, opHoraInicioEl) {
  if (!opInicioEl || !opHoraInicioEl || !opInicioEl.value) return;

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;

  if (opInicioEl.value < todayStr) {
    opInicioEl.value = todayStr;
    logAlert("No puedes planificar una operación en una fecha pasada.");
  }

  if (opInicioEl.value === todayStr && opHoraInicioEl.value) {
    const [hStr, mStr] = opHoraInicioEl.value.split(":");
    if (hStr) {
      const selectedMins = (parseInt(hStr, 10) * 60) + parseInt(mStr || 0, 10);
      const currentMins = (today.getHours() * 60) + today.getMinutes();
      if (selectedMins < currentMins) {
        opHoraInicioEl.value =
          String(today.getHours()).padStart(2, "0") +
          ":" +
          String(today.getMinutes()).padStart(2, "0");
        logAlert("La hora de inicio no puede ser menor a la hora actual.");
      }
    }
  }
}
