// control_personal.js (alineado con backend real)

(() => {
  "use strict";

  /* =========================
     Sesión / seguridad
  ========================= */
  function clearSession() {
    localStorage.removeItem("session");
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    localStorage.removeItem("rol");
    localStorage.removeItem("nombre");
    localStorage.removeItem("active_operation_id");
  }

  function redirectToLogin(message = "") {
    clearSession();
    if (message) alert(message);
    window.location.href = "login.html";
  }

  const currentRole = (localStorage.getItem("rol") || "").toUpperCase();

  // Role validation is now handled globally by js/auth_check.js

  const API_BASE =
    localStorage.getItem("API_BASE") ||
    `http://${window.location.hostname}:3001`;

  async function api(path, { method = "GET", body } = {}) {
    const liveToken = localStorage.getItem("token");

    if (!liveToken) {
      redirectToLogin("Tu sesión expiró. Inicia sesión nuevamente.");
      throw new Error("Sesión no disponible.");
    }

    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${liveToken}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error("No se pudo conectar con el servidor.");
    }

    const data = await res.json().catch(() => null);

    if (res.status === 401 || res.status === 403) {
      redirectToLogin("Tu sesión expiró o ya no es válida.");
      throw new Error("Sesión expirada.");
    }

    if (!res.ok) {
      const msg = data?.mensaje || `Error ${res.status} en ${path}`;
      throw new Error(msg);
    }

    return data;
  }

  /* =========================
     Catálogos (UI)
  ========================= */
  const ROLES_UI = [
    "Comandante de Unidad de Trabajo",
    "Comandante de Equipo de trabajo",
    "Celulas",
  ];

  const PUESTOS = [
    "Soldado / Marinero",
    "Cabo",
    "Sargento Segundo",
    "Sargento Primero",
    "Subteniente",
    "Teniente",
    "Capitán",
    "Mayor",
    "Teniente Coronel",
    "Coronel",
    "General Brigadier",
    "General de Brigada",
    "General de División",
    "Contraalmirante",
    "Vicealmirante",
    "Almirante",
  ];

  const VALID_API_ROLES = ["CUT", "CET", "CELL"];

  function uiRolToApi(uiRol) {
    const r = (uiRol || "").toString().trim().toLowerCase();

    if (r === "comandante de unidad de trabajo") return "CUT";
    if (r === "comandante de equipo de trabajo") return "CET";
    if (r === "celulas") return "CELL";

    return "";
  }

  function apiRolToUi(apiRol) {
    const r = (apiRol || "").toString().trim().toUpperCase();

    if (r === "CUT") return "Comandante de Unidad de Trabajo";
    if (r === "CET") return "Comandante de Equipo de trabajo";
    if (r === "CELL") return "Celulas";

    return "Celulas";
  }

  function normalize(s) {
    return (s ?? "").toString().trim().toLowerCase();
  }

  function escapeHtml(text) {
    return (text ?? "")
      .toString()
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fillSelect(selectEl, options, includeAll = false) {
    if (!selectEl) return;

    const base = includeAll
      ? `<option value="">Todos</option>`
      : `<option value="" disabled selected>Selecciona...</option>`;

    selectEl.innerHTML =
      base +
      options
        .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
        .join("");
  }

  function isValidBooleanString(v) {
    return v === "true" || v === "false";
  }

  /* =========================
     Validadores
  ========================= */
  function soloLetrasYEspacios(value) {
    return /^[A-Za-zÁÉÍÓÚáéíóúÜüÑñ\s]+$/.test((value || "").trim());
  }

  function apodoValido(value) {
    return /^[A-Za-zÁÉÍÓÚáéíóúÜüÑñ0-9\s._-]+$/.test((value || "").trim());
  }

  function validarNombreCampo(value, fieldName, { min = 2, max = 80 } = {}) {
    const clean = (value || "").trim();

    if (!clean) return `${fieldName} es obligatorio.`;
    if (clean.length < min) return `${fieldName} es demasiado corto.`;
    if (clean.length > max) return `${fieldName} es demasiado largo.`;
    if (!soloLetrasYEspacios(clean)) {
      return `${fieldName} no debe contener números ni símbolos.`;
    }

    return "";
  }

  function validarApodo(value) {
    const clean = (value || "").trim();

    if (!clean) return "Apodo es obligatorio.";
    if (clean.length < 2) return "Apodo es demasiado corto.";
    if (clean.length > 50) return "Apodo es demasiado largo.";
    if (!apodoValido(clean)) {
      return "Apodo contiene caracteres no permitidos.";
    }

    return "";
  }

  function validarUsername(value) {
    const clean = (value || "").trim();
    if (!clean) return "Username es obligatorio.";
    if (!/^[a-zA-Z0-9._-]+$/.test(clean)) return "Username solo puede tener letras, números, punto, guion y guion bajo.";
    if (clean.length > 60) return "Username demasiado largo.";
    return "";
  }

  function validarPassword(value, requerida = true) {
    const clean = (value || "");
    if (requerida && !clean) return "Contraseña es obligatoria.";
    if (clean && clean.length < 6) return "Contraseña demasiado corta (mínimo 6 caracteres).";
    return "";
  }

  function validarPuesto(value) {
    const clean = (value || "").trim();

    if (!clean) return "Puesto es obligatorio.";
    if (!PUESTOS.includes(clean)) return "Puesto inválido.";

    return "";
  }

  /* =========================
     Generación visual alineada al backend
  ========================= */
  function slugify(text) {
    return (text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function generarUsernameVisual(nombre, apellido) {
    const n = slugify(nombre);
    const a = slugify(apellido);

    if (!n && !a) return "";

    return `${n.charAt(0)}${a}`;
  }

  function generarPasswordVisual() {
    return "Temp-123456";
  }

  function getFieldWrapper(el) {
    if (!el) return null;
    return (
      el.closest("[data-field-wrap]") ||
      el.closest(".field") ||
      el.closest(".form-group") ||
      el.closest(".input-group") ||
      el.parentElement
    );
  }

  function setFieldVisible(el, visible) {
    if (!el) return;
    const wrap = getFieldWrapper(el);

    if (wrap && wrap !== document.body) {
      wrap.style.display = visible ? "" : "none";
    } else {
      el.style.display = visible ? "" : "none";
    }
  }

  /* =========================
     DOM
  ========================= */
  const btnBack = document.getElementById("btnBack");
  const btnLogout = document.getElementById("btnLogout");
  const controlUserName = document.getElementById("controlUserName");

  const btnAdd = document.getElementById("btnAdd");
  const btnEdit = document.getElementById("btnEdit");
  const btnDelete = document.getElementById("btnDelete");

  const searchInput = document.getElementById("searchInput");
  const btnClear = document.getElementById("btnClear");

  const filterRol = document.getElementById("filterRol");
  const filterPuesto = document.getElementById("filterPuesto");
  const filterActivo = document.getElementById("filterActivo");

  const resultHint = document.getElementById("resultHint");
  const tbody = document.getElementById("tbody");

  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modalTitle");
  const btnCloseModal = document.getElementById("btnCloseModal");
  const btnDeleteModal = document.getElementById("btnDeleteModal");
  const form = document.getElementById("form");

  const errorDeleteModal = document.getElementById("errorDeleteModal");
  const errorDeleteTitle = document.getElementById("errorDeleteTitle");
  const errorDeleteMsg = document.getElementById("errorDeleteMsg");
  const btnCloseErrorModal = document.getElementById("btnCloseErrorModal");
  const btnCloseErrorBtn = document.getElementById("btnCloseErrorBtn");

  const fApodo = document.getElementById("fApodo");
  const fRol = document.getElementById("fRol");
  const fNombre = document.getElementById("fNombre");
  const fApellido = document.getElementById("fApellido");
  const fPuesto = document.getElementById("fPuesto");
  const fUsername = document.getElementById("fUsername");
  const fPassword = document.getElementById("fPassword");
  const fActivo = document.getElementById("fActivo");
  const fLastAccess = document.getElementById("fLastAccess");

  if (controlUserName) {
    controlUserName.textContent = localStorage.getItem("nombre") || localStorage.getItem("username") || "Admin";
  }

  const requiredEls = {
    tbody,
    resultHint,
    modal,
    modalTitle,
    form,
    fApodo,
    fRol,
    fNombre,
    fApellido,
    fPuesto,
    fUsername,
    fPassword,
    fActivo,
    searchInput,
    filterRol,
    filterPuesto,
    filterActivo,
    btnEdit,
    btnDelete,
  };

  for (const [name, el] of Object.entries(requiredEls)) {
    if (!el) {
      alert(`Falta el elemento del DOM: ${name}`);
      return;
    }
  }

  /* =========================
     Estado
  ========================= */
  let personal = [];
  let selectedId = null;
  let mode = "add";

  let isLoading = false;
  let isSaving = false;
  let isDeleting = false;

  const PASSWORD_CACHE_STORAGE_KEY = "control_personal_password_cache";

  function readPasswordCache() {
    try {
      const raw = sessionStorage.getItem(PASSWORD_CACHE_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writePasswordCache(cache) {
    try {
      sessionStorage.setItem(PASSWORD_CACHE_STORAGE_KEY, JSON.stringify(cache || {}));
    } catch {
      // Si el navegador bloquea storage, la contraseña guardada solo vive en memoria del formulario.
    }
  }

  function rememberPasswordForPersonal(idPersonal, password) {
    if (!idPersonal || !password || password === "********") return;
    const cache = readPasswordCache();
    cache[String(idPersonal)] = password;
    writePasswordCache(cache);
  }

  function getRememberedPasswordForPersonal(idPersonal) {
    if (!idPersonal) return "";
    const cache = readPasswordCache();
    return cache[String(idPersonal)] || "";
  }

  /* =========================
     Username / Password visual auto
  ========================= */
  function actualizarCredencialesVisuales() {
    if (mode !== "add") return;

    // Solo auto-rellenar username si el campo está vacío (el usuario no ha escrito nada manual)
    if (fUsername && !fUsername.dataset.editadoManual) {
      const usernameSugerido = generarUsernameVisual(
        fNombre?.value || "",
        fApellido?.value || ""
      );
      fUsername.value = usernameSugerido;
    }

    if (fPassword && !fPassword.dataset.editadoManual) {
      fPassword.value = generarPasswordVisual();
    }
  }

  fRol?.addEventListener("change", actualizarCredencialesVisuales);
  fNombre?.addEventListener("input", actualizarCredencialesVisuales);
  fApellido?.addEventListener("input", actualizarCredencialesVisuales);

  // Marcar como editado manual para no sobreescribir
  fUsername?.addEventListener("input", () => {
    if (mode === "add") fUsername.dataset.editadoManual = "1";
  });
  fPassword?.addEventListener("input", () => {
    if (mode === "add") fPassword.dataset.editadoManual = "1";
  });
  fPassword?.addEventListener("focus", () => {
    if (fPassword.value === "********") {
      fPassword.value = "";
    }
  });
  fPassword?.addEventListener("blur", () => {
    if (fPassword.value === "" && mode === "edit") {
      fPassword.value = "********";
    }
  });

  const btnTogglePassword = document.getElementById("btnTogglePassword");
  function setPasswordToggleState(visible) {
    if (!fPassword) return;
    fPassword.type = visible ? "text" : "password";

    const eyeIcon = document.getElementById("eyeIcon");
    if (eyeIcon) {
      eyeIcon.innerHTML = visible
        ? `
          <path d="M17.6 17.6A10.8 10.8 0 0 1 12 19c-7 0-11-7-11-7a19 19 0 0 1 4-4.8"></path>
          <path d="M2.5 2.5l19 19"></path>
          <path d="M9.9 4.2A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a18.6 18.6 0 0 1-2.9 3.8"></path>
          <path d="M8.5 8.5A3 3 0 1 0 12.5 12.5"></path>
        `
        : `
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        `;
    }

    if (btnTogglePassword) {
      const label = visible ? "Ocultar contrasena" : "Mostrar contrasena";
      btnTogglePassword.title = label;
      btnTogglePassword.setAttribute("aria-label", label);
    }
  }

  btnTogglePassword?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    setPasswordToggleState(fPassword?.type === "password");
  }, true);

  btnTogglePassword?.addEventListener("click", () => {
    if (!fPassword) return;
    const isPass = fPassword.type === "password";
    fPassword.type = isPass ? "text" : "password";

    const eyeIcon = document.getElementById("eyeIcon");
    if (eyeIcon) {
      if (isPass) {
        eyeIcon.innerHTML = `
          <path d="M17.6 17.6A10.8 10.8 0 0 1 12 19c-7 0-11-7-11-7a19 19 0 0 1 4-4.8"></path>
          <path d="M2.5 2.5l19 19"></path>
          <path d="M9.9 4.2A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a18.6 18.6 0 0 1-2.9 3.8"></path>
          <path d="M8.5 8.5A3 3 0 1 0 12.5 12.5"></path>
        `;
        btnTogglePassword.title = "Ocultar contraseña";
        btnTogglePassword.setAttribute("aria-label", "Ocultar contraseña");
      } else {
        eyeIcon.innerHTML = `
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        `;
        btnTogglePassword.title = "Mostrar contraseña";
        btnTogglePassword.setAttribute("aria-label", "Mostrar contraseña");
      }
    }
  });

  /* =========================
     Nav / Logout
  ========================= */
  btnBack?.addEventListener("click", () => {
    window.location.href = "menu_inicial.html";
  });

  btnLogout?.addEventListener("click", () => {
    clearSession();
    window.location.href = "login.html";
  });

  /* =========================
     Init catálogos UI
  ========================= */
  function initCatalogs() {
    fillSelect(filterRol, ROLES_UI, true);
    fillSelect(filterPuesto, PUESTOS, true);

    fillSelect(fRol, ROLES_UI, false);
    fillSelect(fPuesto, PUESTOS, false);
  }

  /* =========================
     Cargar desde backend
  ========================= */
  async function loadFromApi() {
    if (isLoading) return;
    isLoading = true;
    updateButtons();

    try {
      const [cut, cet, cell] = await Promise.all([
        api("/catalog/personal?rol=CUT"),
        api("/catalog/personal?rol=CET"),
        api("/catalog/personal?rol=CELL"),
      ]);

      const cutItems = Array.isArray(cut?.items) ? cut.items : [];
      const cetItems = Array.isArray(cet?.items) ? cet.items : [];
      const cellItems = Array.isArray(cell?.items) ? cell.items : [];

      const all = [...cutItems, ...cetItems, ...cellItems];

      const byId = new Map();
      all.forEach((p) => {
        if (p && p.id_personal != null) {
          byId.set(p.id_personal, p);
        }
      });

      const unique = [...byId.values()];

      personal = unique.map((p) => {
        const rolApi = (p?.rol || "").toString().trim().toUpperCase();
        const safeRolApi = VALID_API_ROLES.includes(rolApi) ? rolApi : "CELL";

        return {
          id_personal: p?.id_personal ?? null,
          apodo: p?.apodo ?? "",
          nombre: p?.nombre ?? "",
          apellido: p?.apellido ?? "",
          rol_api: safeRolApi,
          rol_ui: apiRolToUi(safeRolApi),
          puesto: p?.puesto ?? "",
          nombre_operacion: p?.nombre_operacion ?? "",
          en_operacion: p?.en_operacion === true,
          username: p?.username ?? "",
          activo: p?.activo !== false,
          ultimo_acceso: p?.ultimo_acceso ?? "",
        };
      });
    } finally {
      isLoading = false;
      updateButtons();
    }
  }

  /* =========================
     Filtros
  ========================= */
  function getFiltered() {
    const q = normalize(searchInput?.value);
    const rol = filterRol?.value || "";
    const puesto = filterPuesto?.value || "";
    const act = filterActivo?.value || "";

    return personal.filter((p) => {
      if (rol && normalize(p.rol_ui) !== normalize(rol)) return false;
      if (puesto && normalize(p.puesto) !== normalize(puesto)) return false;
      if (act !== "" && String(!!p.activo) !== act) return false;

      if (!q) return true;

      return (
        normalize(p.apodo).includes(q) ||
        normalize(p.nombre).includes(q) ||
        normalize(p.apellido).includes(q) ||
        normalize(p.rol_ui).includes(q) ||
        normalize(p.puesto).includes(q) ||
        normalize(p.nombre_operacion).includes(q) ||
        normalize(p.username).includes(q)
      );
    });
  }

  function updateButtons() {
    const has = !!selectedId;

    if (btnEdit) btnEdit.disabled = !has || isLoading || isSaving || isDeleting;
    if (btnDelete) btnDelete.disabled = !has || isLoading || isSaving || isDeleting;
    if (btnAdd) btnAdd.disabled = isLoading || isSaving || isDeleting;
  }

  function renderTable() {
    if (!tbody) return;

    const list = getFiltered();

    if (selectedId && !list.some((p) => p.id_personal === selectedId)) {
      selectedId = null;
    }

    tbody.innerHTML = "";

    if (!list.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="10" style="color: rgba(11,18,32,.65); padding: 16px;">
        No hay registros con los filtros actuales.
      </td>`;
      tbody.appendChild(tr);
    } else {
      list.forEach((p) => {
        const tr = document.createElement("tr");
        if (p.id_personal === selectedId) tr.classList.add("selected");

        tr.innerHTML = `
          <td>${escapeHtml(p.apodo)}</td>
          <td>${escapeHtml(p.nombre)}</td>
          <td>${escapeHtml(p.apellido)}</td>
          <td>${escapeHtml(p.rol_ui)}</td>
          <td>${escapeHtml(p.puesto)}</td>
          <td class="assignmentCell">${
            p.nombre_operacion
              ? `<span class="assignmentName" title="${escapeHtml(p.nombre_operacion)}">${escapeHtml(p.nombre_operacion)}</span>`
              : `<span class="assignmentEmpty">Sin asignar</span>`
          }</td>
          <td>${escapeHtml(p.username)}</td>
          <td style="color: rgba(11,18,32,.45);">—</td>
          <td>${p.activo ? `<span class="badge ok">Sí</span>` : `<span class="badge no">No</span>`}</td>
          <td>${escapeHtml(p.ultimo_acceso || "Sin acceso")}</td>
        `;

        if (p.id_personal != null) {
          tr.addEventListener("click", (e) => {
            e.stopPropagation();
            if (selectedId == p.id_personal) {
              selectedId = null;
            } else {
              selectedId = p.id_personal;
            }
            updateButtons();
            renderTable();
          });

          tr.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            selectedId = p.id_personal;
            updateButtons();
            renderTable();
            openModal("edit");
          });
        } else {
          tr.style.opacity = "0.6";
          tr.style.pointerEvents = "none";
        }

        tbody.appendChild(tr);
      });
    }

    updateButtons();
    if (resultHint) resultHint.textContent = `${list.length} resultado(s)`;
  }

  /* =========================
     Modal
  ========================= */
  function openModal(newMode) {
    if (newMode !== "add" && newMode !== "edit") {
      alert("Modo de formulario inválido.");
      return;
    }

    mode = newMode;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    if (btnDeleteModal) btnDeleteModal.style.display = mode === "edit" ? "inline-flex" : "none";

    if (fPassword) {
      fPassword.type = "password";
      const eyeIcon = document.getElementById("eyeIcon");
      if (eyeIcon) {
        eyeIcon.innerHTML = `
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        `;
      }
      const btnTogglePasswordBtn = document.getElementById("btnTogglePassword");
      if (btnTogglePasswordBtn) {
        btnTogglePasswordBtn.title = "Mostrar contraseña";
        btnTogglePasswordBtn.setAttribute("aria-label", "Mostrar contraseña");
      }
    }

    if (mode === "add") {
      modalTitle.textContent = "Agregar personal";
      form.reset();

      fRol.selectedIndex = 0;
      fPuesto.selectedIndex = 0;
      fRol.disabled = false;

      setFieldVisible(fApodo, true);
      setFieldVisible(fRol, true);
      setFieldVisible(fNombre, true);
      setFieldVisible(fApellido, true);
      setFieldVisible(fPuesto, true);

      if (fUsername) {
        fUsername.value = "";
        fUsername.disabled = false;
        delete fUsername.dataset.editadoManual;
        setFieldVisible(fUsername, true);
      }

      if (fPassword) {
        fPassword.value = "";
        fPassword.disabled = false;
        fPassword.placeholder = "";
        delete fPassword.dataset.editadoManual;
        setFieldVisible(fPassword, true);
      }

      if (fActivo) {
        fActivo.value = "true";
        setFieldVisible(fActivo, false);
      }

      if (fLastAccess) {
        fLastAccess.value = "";
        fLastAccess.disabled = true;
        setFieldVisible(fLastAccess, false);
      }

      actualizarCredencialesVisuales();
      fApodo.focus();
      return;
    }

    if (!selectedId) {
      alert("No hay personal seleccionado.");
      closeModal();
      return;
    }

    modalTitle.textContent = "Modificar personal";

    const p = personal.find((x) => x.id_personal === selectedId);
    if (!p) {
      alert("No se encontró el registro seleccionado.");
      closeModal();
      return;
    }

    fApodo.value = p.apodo ?? "";
    fRol.value = p.rol_ui ?? "";
    fNombre.value = p.nombre ?? "";
    fApellido.value = p.apellido ?? "";
    fPuesto.value = p.puesto ?? "";

    setFieldVisible(fApodo, true);
    setFieldVisible(fRol, true);
    setFieldVisible(fNombre, true);
    setFieldVisible(fApellido, true);
    setFieldVisible(fPuesto, true);

    if (fUsername) {
      fUsername.value = p.username ?? "";
      fUsername.disabled = false;
      setFieldVisible(fUsername, true);
    }

    if (fPassword) {
      fPassword.value = "********";
      fPassword.disabled = false;
      fPassword.placeholder = "";
      setFieldVisible(fPassword, true);
    }

    if (fActivo) {
      fActivo.value = String(!!p.activo);
      setFieldVisible(fActivo, true);
    }

    if (fLastAccess) {
      fLastAccess.value = p.ultimo_acceso ?? "";
      fLastAccess.disabled = true;
      setFieldVisible(fLastAccess, false);
    }

    fRol.disabled = true;
    fApodo.focus();
  }

  function closeModal() {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }

  function closeErrorModal() {
    errorDeleteModal.classList.add("hidden");
    errorDeleteModal.setAttribute("aria-hidden", "true");
  }

  function showErrorDeleteModal(message) {
    errorDeleteMsg.textContent = message;
    errorDeleteModal.classList.remove("hidden");
    errorDeleteModal.setAttribute("aria-hidden", "false");
  }

  btnCloseModal?.addEventListener("click", closeModal);
  btnCloseErrorModal?.addEventListener("click", closeErrorModal);
  btnCloseErrorBtn?.addEventListener("click", closeErrorModal);
  btnDeleteModal?.addEventListener("click", () => btnDelete?.click());

  modal?.addEventListener("click", (e) => {
    if (e.target?.dataset?.close === "true") closeModal();
  });

  errorDeleteModal?.addEventListener("click", (e) => {
    if (e.target?.dataset?.close === "true") closeErrorModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      closeModal();
    }
  });

  /* =========================
     Acciones
  ========================= */
  btnAdd?.addEventListener("click", () => openModal("add"));

  btnEdit?.addEventListener("click", () => {
    if (!selectedId) {
      alert("Selecciona un registro para modificar.");
      return;
    }
    openModal("edit");
  });

  btnDelete?.addEventListener("click", async () => {
    if (isDeleting) return;

    if (!selectedId) {
      alert("Selecciona un registro para eliminar.");
      return;
    }

    const p = personal.find((x) => x.id_personal === selectedId);
    if (!p) {
      alert("No se encontró el registro seleccionado.");
      selectedId = null;
      renderTable();
      return;
    }

    const name = `${p.nombre || ""} ${p.apellido || ""}`.trim() || "este registro";

    isDeleting = true;
    updateButtons();

    try {
      await api(`/catalog/personal/${selectedId}?hard=1`, { method: "DELETE" });
      await loadFromApi();
      selectedId = null;
      renderTable();
      closeModal();
      alert("Registro eliminado.");
    } catch (e) {
      // Si el error dice que está referenciado por operaciones, mostrar modal especial
      if (e.message && e.message.includes("referenciado")) {
        closeModal();
        showErrorDeleteModal(`No se puede eliminar a ${name} porque está asignado a una o más operaciones activas o planificadas. Desasigna la persona de esas operaciones primero.`);
      } else {
        alert(e.message);
      }
    } finally {
      isDeleting = false;
      updateButtons();
    }
  });

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      renderTable();
    }
  });

  btnClear?.addEventListener("click", () => {
    searchInput.value = "";
    filterRol.value = "";
    filterPuesto.value = "";
    filterActivo.value = "";
    selectedId = null;
    renderTable();
  });

  document.addEventListener("click", (e) => {
    if (selectedId && !e.target.closest("table") && !e.target.closest("#modal") && !e.target.closest("button") && !e.target.closest(".controls")) {
      selectedId = null;
      updateButtons();
      renderTable();
    }
  });

  filterRol?.addEventListener("change", renderTable);
  filterPuesto?.addEventListener("change", renderTable);
  filterActivo?.addEventListener("change", renderTable);

  /* =========================
     Guardar
  ========================= */
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (isSaving) return;
    isSaving = true;
    updateButtons();

    try {
      const apodo = (fApodo.value || "").trim();
      const nombre = (fNombre.value || "").trim();
      const apellido = (fApellido.value || "").trim();
      const puesto = (fPuesto.value || "").trim();
      const username = (fUsername?.value || "").trim();
      const password = (fPassword?.value || "");
      const isDummy = password === "********";

      const errApodo = validarApodo(apodo);
      const errNombre = validarNombreCampo(nombre, "Nombre", { min: 2, max: 80 });
      const errApellido = validarNombreCampo(apellido, "Apellido", { min: 2, max: 80 });
      const errPuesto = validarPuesto(puesto);
      const errUsername = validarUsername(username);
      // password requerida en add, opcional en edit (y si es dummy, no se valida porque no se enviará)
      const errPassword = isDummy ? "" : validarPassword(password, mode === "add");

      if (errApodo) { alert(errApodo); fApodo.focus(); return; }
      if (errNombre) { alert(errNombre); fNombre.focus(); return; }
      if (errApellido) { alert(errApellido); fApellido.focus(); return; }
      if (errPuesto) { alert(errPuesto); fPuesto.focus(); return; }
      if (errUsername) { alert(errUsername); fUsername?.focus(); return; }
      if (errPassword) { alert(errPassword); fPassword?.focus(); return; }

      const duplicatedUsername = personal.some((person) =>
        person.id_personal !== selectedId &&
        String(person.username || "").trim().toLowerCase() === username.toLowerCase()
      );
      if (duplicatedUsername) {
        alert(`El usuario "${username}" ya está registrado. Escribe uno diferente.`);
        fUsername?.focus();
        return;
      }

      if (mode === "add") {
        const rolUi = (fRol.value || "").trim();
        const rol = uiRolToApi(rolUi);

        if (!rolUi) {
          alert("Rol es obligatorio.");
          fRol.focus();
          return;
        }

        if (!ROLES_UI.includes(rolUi) || !rol) {
          alert("Rol inválido.");
          fRol.focus();
          return;
        }

        const body = {
          rol,
          apodo,
          nombre,
          apellido,
          puesto,
          username,
          password,
        };

        await api("/catalog/personal", { method: "POST", body });
      } else if (mode === "edit") {
        if (!selectedId) {
          alert("No hay personal seleccionado.");
          return;
        }

        if (!isValidBooleanString(fActivo.value)) {
          alert("Estado activo inválido.");
          fActivo.focus();
          return;
        }

        const exists = personal.some((x) => x.id_personal === selectedId);
        if (!exists) {
          alert("El registro seleccionado ya no existe.");
          selectedId = null;
          renderTable();
          closeModal();
          return;
        }

        const body = {
          apodo,
          nombre,
          apellido,
          puesto,
          activo: fActivo.value === "true",
          username,
          // solo mandar password si el usuario escribió algo y no es el dummy
          ...((password && !isDummy) ? { password } : {}),
        };

        await api(`/catalog/personal/${selectedId}`, { method: "PUT", body });
      } else {
        alert("Modo de formulario inválido.");
        return;
      }

      closeModal();
      await loadFromApi();

      if (mode === "add") {
        selectedId = null;
      } else {
        const stillExists = personal.some((x) => x.id_personal === selectedId);
        if (!stillExists) selectedId = null;
      }

      renderTable();
    } catch (e2) {
      alert(e2.message || "Ocurrió un error al guardar.");
    } finally {
      isSaving = false;
      updateButtons();
    }
  });

  /* =========================
     Init
  ========================= */
  (async function init() {
    initCatalogs();

    try {
      await loadFromApi();
      renderTable();
    } catch (e) {
      alert(`No se pudo cargar personal: ${e.message}\nRevisa API_BASE y token.`);
    }
  })();
})();
