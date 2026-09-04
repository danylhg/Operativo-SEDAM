const API = (window.OPERACIONES_API_BASE || localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`).replace(/\/$/, "");

function getToken() {
  return localStorage.getItem("token");
}

function apiFetch(path, options = {}) {
  const token = getToken();
  return fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
}

const btnCreate = document.getElementById("btnCreate");
const btnSelect = document.getElementById("btnSelect");
const btnPersonal = document.getElementById("btnPersonal");
const btnLogout = document.getElementById("btnLogout");
const btnUserMenu = document.getElementById("btnUserMenu");
const userName = document.getElementById("userName");
const userDropdown = document.getElementById("userDropdown");
const opsList = document.getElementById("opsList");
const opsUl = document.getElementById("opsUl");
const submenuControl = document.getElementById("submenuControl");
const btnControlPersonal = document.getElementById("btnControlPersonal");
const btnControlVehiculos = document.getElementById("btnControlVehiculos");
const btnControlEquipos = document.getElementById("btnControlEquipos");
const btnControlDispositivos = document.getElementById("btnControlDispositivos");
const searchOpName = document.getElementById("searchOpName");
const searchOpDate = document.getElementById("searchOpDate");
const searchOpState = document.getElementById("searchOpState");
const searchOpAssignment = document.getElementById("searchOpAssignment");

let allOps = [];

async function init() {
  const token = getToken();
  if (!token) {
    window.location.href = "login.html";
    return;
  }

  let usuario;
  try {
    const res = await apiFetch("/me");
    if (!res.ok) throw new Error("no autorizado");
    usuario = await res.json();
  } catch {
    localStorage.removeItem("token");
    window.location.href = "login.html";
    return;
  }

  const displayName = usuario.nombre ?? usuario.username;
  userName.textContent = displayName;
}

btnLogout.addEventListener("click", () => {
  localStorage.removeItem("token");
  window.location.href = "login.html";
});

btnUserMenu?.addEventListener("click", () => {
  const isOpen = !userDropdown.classList.contains("hidden");
  userDropdown.classList.toggle("hidden", isOpen);
  btnUserMenu.setAttribute("aria-expanded", String(!isOpen));
});

document.addEventListener("click", (event) => {
  if (!btnUserMenu || !userDropdown) return;
  if (btnUserMenu.contains(event.target) || userDropdown.contains(event.target)) return;

  userDropdown.classList.add("hidden");
  btnUserMenu.setAttribute("aria-expanded", "false");
});

btnCreate.addEventListener("click", () => {
  localStorage.removeItem("active_operation_id");
  localStorage.removeItem("operacion_actual");
  localStorage.removeItem("asignacion_actual");
  sessionStorage.setItem("asignacion_entry", "create");
  window.location.href = "asignacion.html";
});



btnSelect.addEventListener("click", async () => {
  if (!opsList.classList.contains("hidden")) {
    opsList.classList.add("hidden");
    btnSelect.classList.remove("active");
    return;
  }

  submenuControl.classList.add("hidden");
  btnPersonal.classList.remove("active");
  btnSelect.classList.add("active");
  opsUl.innerHTML = "<li>Cargando...</li>";
  opsList.classList.remove("hidden");

  try {
    const res = await apiFetch("/ops");
    if (!res.ok) throw new Error("error al cargar operaciones");
    const data = await res.json();
    allOps = data.items ?? [];
  } catch {
    opsUl.innerHTML = "<li>Error al cargar operaciones</li>";
    return;
  }

  renderOps(allOps);
});

function normalizeOperationState(estado) {
  let pClass = String(estado ?? "PLANIFICADA").trim().toLowerCase();
  if (pClass === "terminada" || pClass === "pasada") pClass = "cerrada";
  return pClass;
}

function handleFilters() {
  const text = (searchOpName?.value || "").toLowerCase();
  const date = searchOpDate?.value || "";
  const state = searchOpState?.value || "todas";
  const assignment = searchOpAssignment?.value || "todas";

  const filtered = allOps.filter(op => {
    const pClass = normalizeOperationState(op.estado);
    const matchName = String(op.nombre || "").toLowerCase().includes(text);
    const matchDate = date ? String(op.fecha_inicio || "").startsWith(date) : true;
    const matchState = state === "todas" ? true : pClass === state;
    const matchAssignment = assignment === "todas" || op.asignada_al_usuario === true;

    return matchName && matchDate && matchState && matchAssignment;
  });

  renderOps(filtered);
}

searchOpName?.addEventListener("input", handleFilters);
searchOpDate?.addEventListener("change", handleFilters);
searchOpState?.addEventListener("change", handleFilters);
searchOpAssignment?.addEventListener("change", handleFilters);

function renderOps(ops) {
  if (!opsUl) return;

  opsUl.innerHTML = "";

  if (!ops.length) {
    const li = document.createElement("li");
    li.className = "opsEmpty";
    li.textContent = "No hay operaciones que coincidan";
    opsUl.appendChild(li);
    return;
  }

  ops.forEach(op => {
    const pClass = normalizeOperationState(op.estado);
    const li = document.createElement("li");
    li.className = `opItem opState-${pClass}`;
    if (pClass === "cancelada") {
      li.classList.add("opCancelled");
      li.title = "No se puede entrar a una operación cancelada";
    }

    const name = document.createElement("span");
    name.className = "opName";
    name.textContent = op.nombre || "Operacion sin nombre";
    li.appendChild(name);

    const tag = document.createElement("span");
    tag.className = `tag tag-${pClass}`;
    tag.textContent = pClass.charAt(0).toUpperCase() + pClass.slice(1);

    const rightSide = document.createElement("div");
    rightSide.className = "opActions";
    rightSide.appendChild(tag);

    if (pClass === "cerrada" || pClass === "cancelada" || pClass === "planificada") {
      const btnDel = document.createElement("button");
      btnDel.className = "btnDeleteOp";
      btnDel.type = "button";
      btnDel.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3 6h18"></path>
          <path d="M8 6V4h8v2"></path>
          <path d="M6.5 6l1 14h9l1-14"></path>
          <path d="M10 11v5"></path>
          <path d="M14 11v5"></path>
        </svg>
      `;
      btnDel.title = "Eliminar operación permanentemente";
      btnDel.setAttribute("aria-label", `Eliminar operacion ${op.nombre || ""}`.trim());

      btnDel.addEventListener("click", async (e) => {
        e.stopPropagation();

        const confirmMsg = `¿Seguro que quieres eliminar permanentemente la operación "${op.nombre}"?\n\nEsta acción no se puede deshacer y borrará TODO el historial relacionado.`;
        if (!confirm(confirmMsg)) return;

        try {
          const res = await apiFetch(`/ops/${op.id_operacion}/remove`, { method: "DELETE" });
          if (res.ok) {
            allOps = allOps.filter(x => x.id_operacion !== op.id_operacion);
            handleFilters();
          } else {
            const data = await res.json().catch(() => ({}));
            alert(`Error al eliminar: ${data.mensaje || res.statusText}`);
          }
        } catch (err) {
          console.error(err);
          alert("Error de conexión al intentar eliminar la operación.");
        }
      });

      rightSide.appendChild(btnDel);
    }

    li.appendChild(rightSide);

    li.addEventListener("click", async () => {
      if (pClass === "cancelada") {
        alert(`La operación "${op.nombre}" está cancelada y no se puede abrir.`);
        return;
      }

      try {
        const res = await apiFetch(`/ops/${op.id_operacion}`);
        if (!res.ok) throw new Error("error al cargar operación");
        const opData = await res.json();
        localStorage.setItem("active_operation_id", opData.id_operacion);
        localStorage.setItem("operacion_actual", JSON.stringify(opData));
      } catch {
        localStorage.setItem("active_operation_id", op.id_operacion);
      }

      if (pClass === "activa") {
        localStorage.setItem("force_open_chat", "true");
        window.location.href = "dashboard.html?v=20260629-restore-tactical-fix";
      } else if (pClass === "planificada") {
        window.location.href = "dashboard.html?v=20260629-restore-tactical-fix";
      } else if (pClass === "cerrada") {
        window.location.href = `historial.html?id=${op.id_operacion}`;
      }
    });

    opsUl.appendChild(li);
  });
}

btnPersonal.addEventListener("click", () => {
  opsList.classList.add("hidden");
  btnSelect.classList.remove("active");
  submenuControl.classList.toggle("hidden");
  btnPersonal.classList.toggle("active", !submenuControl.classList.contains("hidden"));
});

btnControlPersonal.addEventListener("click", () => {
  window.location.href = "control_personal.html";
});

btnControlVehiculos.addEventListener("click", () => {
  window.location.href = "control_vehiculos.html";
});

btnControlEquipos.addEventListener("click", () => {
  window.location.href = "control_equipos.html";
});

btnControlDispositivos?.addEventListener("click", () => {
  window.location.href = "control_dispositivos.html";
});

init();
