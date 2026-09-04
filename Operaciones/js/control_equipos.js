// control_equipos.js (backend + actualización UI)
// Validaciones incluidas:
// - sesión, token y rol permitidos
// - manejo de sesión vencida
// - control de errores de red
// - DOM crítico obligatorio

(() => {
  "use strict";

  /* =========================
     Sesión / seguridad
  ========================= */
  function clearSession() {
    localStorage.removeItem("token");
    localStorage.removeItem("rol");
    localStorage.removeItem("userData");
    localStorage.removeItem("username");
    localStorage.removeItem("session");
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
          "Authorization": `Bearer ${liveToken}`,
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
  const CATEGORIAS = [
    "COMUNICACION",
    "TACTICO",
  ];

  const ESTADOS = [
    "DISPONIBLE",
    "ASIGNADO",
    "MANTENIMIENTO",
    "BAJA",
  ];

  function normalize(s) {
    return (s ?? "").toString().trim().toLowerCase();
  }

  function escapeHtml(text) {
    return (text ?? "").toString()
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
      base + options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
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
  const btnSearch = document.getElementById("btnSearch");
  const btnClear = document.getElementById("btnClear");

  const filterCategoria = document.getElementById("filterCategoria");
  const filterEstado = document.getElementById("filterEstado");

  const resultHint = document.getElementById("resultHint");
  const tbody = document.getElementById("tbody");

  // Modal
  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modalTitle");
  const btnCloseModal = document.getElementById("btnCloseModal");
  const btnDeleteModal = document.getElementById("btnDeleteModal");
  const form = document.getElementById("form");

  const dropZoneEq = document.getElementById("dropZoneEq");
  const fSerie = document.getElementById("fSerie");
  const fNombre = document.getElementById("fNombre");
  const fCategoria = document.getElementById("fCategoria");
  const fEstado = document.getElementById("fEstado");
  const fDetalles = document.getElementById("fDetalles");

  if (controlUserName) {
    controlUserName.textContent = localStorage.getItem("nombre") || localStorage.getItem("username") || "Admin";
  }

  // DOM crítico obligatorio
  const requiredEls = {
    tbody,
    resultHint,
    modal,
    modalTitle,
    form,
    fSerie,
    fNombre,
    fCategoria,
    fEstado
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
  let equipos = [];
  let selectedId = null;
  let mode = "add";
  let imagenBase64 = "";

  /* =========================
     Nav / Logout
  ========================= */
  btnBack?.addEventListener("click", () => window.location.href = "menu_inicial.html");

  btnLogout?.addEventListener("click", () => {
    clearSession();
    window.location.href = "login.html";
  });

  /* =========================
     Init catálogos UI
  ========================= */
  function initCatalogs() {
    if (filterCategoria) fillSelect(filterCategoria, CATEGORIAS, true);
    if (filterEstado) fillSelect(filterEstado, ESTADOS, true);

    if (fCategoria) fillSelect(fCategoria, CATEGORIAS, false);
    if (fEstado) fillSelect(fEstado, ESTADOS, false);
  }

  /* =========================
     Helpers imagen / dropzone
  ========================= */
  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function setDropZoneContent(src = "") {
    if (!dropZoneEq) return;

    if (src) {
      dropZoneEq.innerHTML = `
        <img src="${src}" alt="preview" style="max-width:100%; max-height:180px; border-radius:8px; display:block; margin:auto;">
        <input id="fImagenEq" type="file" accept="image/*" />
      `;
    } else {
      dropZoneEq.innerHTML = `
        Arrastra la imagen aquí o selecciona un archivo
        <input id="fImagenEq" type="file" accept="image/*" />
      `;
    }

    const nuevoInput = dropZoneEq.querySelector("#fImagenEq");
    if (!nuevoInput) return;

    nuevoInput.style.display = "none";

    nuevoInput.addEventListener("change", async () => {
      if (nuevoInput.files && nuevoInput.files.length > 0) {
        imagenBase64 = await fileToBase64(nuevoInput.files[0]);
        setDropZoneContent(imagenBase64);
      }
    });
  }

  function bindDropZoneEvents() {
    if (!dropZoneEq) return;

    dropZoneEq.addEventListener("click", () => {
      const input = dropZoneEq.querySelector("#fImagenEq");
      if (input) input.click();
    });

    dropZoneEq.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZoneEq.classList.add("dragover");
    });

    dropZoneEq.addEventListener("dragleave", () => {
      dropZoneEq.classList.remove("dragover");
    });

    dropZoneEq.addEventListener("drop", async (e) => {
      e.preventDefault();
      dropZoneEq.classList.remove("dragover");

      if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (!file.type.startsWith("image/")) return;
        imagenBase64 = await fileToBase64(file);
        setDropZoneContent(imagenBase64);
      }
    });
  }

  /* =========================
     Cargar desde backend
  ========================= */
  async function loadFromApi() {
    const r = await api("/catalog/equipos");
    equipos = (r.items || []).map(e => ({
      id_equipo: e.id_equipo,
      imagen_eq: e.imagen_eq ?? "",
      numero_serie: e.numero_serie ?? "",
      nombre: e.nombre ?? "",
      categoria: e.categoria ?? "",
      estado: e.estado ?? "DISPONIBLE",
      detalles: e.detalles ?? "",
      fecha_registro: e.fecha_registro ?? "",
    }));
  }

  /* =========================
     Filtros + render
  ========================= */
  function getFiltered() {
    const q = normalize(searchInput?.value);
    const categoria = filterCategoria?.value || "";
    const estado = filterEstado?.value || "";

    return equipos.filter(e => {
      if (categoria && e.categoria !== categoria) return false;
      if (estado && e.estado !== estado) return false;

      if (!q) return true;

      return (
        normalize(e.numero_serie).includes(q) ||
        normalize(e.nombre).includes(q) ||
        normalize(e.categoria).includes(q) ||
        normalize(e.estado).includes(q) ||
        normalize(e.detalles).includes(q)
      );
    });
  }

  function updateButtons() {
    const has = !!selectedId;
    if (btnEdit) btnEdit.disabled = !has;
    if (btnDelete) btnDelete.disabled = !has;
  }

  function renderTable() {
    const list = getFiltered();

    if (selectedId && !equipos.some(e => e.id_equipo === selectedId)) {
      selectedId = null;
    }

    tbody.innerHTML = "";

    if (!list.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="7" style="color: rgba(11,18,32,.65); padding: 16px;">
        No hay registros con los filtros actuales.
      </td>`;
      tbody.appendChild(tr);
    } else {
      list.forEach(e => {
        const tr = document.createElement("tr");
        if (e.id_equipo === selectedId) tr.classList.add("selected");

        tr.innerHTML = `
          <td>${e.imagen_eq ? `<img src="${e.imagen_eq}" style="width:60px; height:60px; object-fit:cover; border-radius:8px;">` : "-"}</td>
          <td>${escapeHtml(e.numero_serie)}</td>
          <td>${escapeHtml(e.nombre)}</td>
          <td>${escapeHtml(e.categoria)}</td>
          <td>${escapeHtml(e.estado)}</td>
          <td>${escapeHtml(e.detalles || "-")}</td>
          <td>${escapeHtml(e.fecha_registro || "-")}</td>
        `;

        tr.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (selectedId == e.id_equipo) {
            selectedId = null;
          } else {
            selectedId = e.id_equipo;
          }
          updateButtons();
          renderTable();
        });

        tr.addEventListener("dblclick", (ev) => {
          ev.stopPropagation();
          selectedId = e.id_equipo;
          updateButtons();
          renderTable();
          openModal("edit");
        });

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
    mode = newMode;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    if (btnDeleteModal) btnDeleteModal.style.display = mode === "edit" ? "inline-flex" : "none";

    if (mode === "add") {
      modalTitle.textContent = "Agregar equipo";
      form.reset();
      imagenBase64 = "";
      setDropZoneContent("");

      if (fCategoria) fCategoria.selectedIndex = 0;
      if (fEstado) fEstado.value = "DISPONIBLE";
      if (fSerie) fSerie.disabled = false;
    } else {
      modalTitle.textContent = "Modificar equipo";
      const e = equipos.find(x => x.id_equipo === selectedId);
      if (!e) return;

      imagenBase64 = e.imagen_eq || "";
      fSerie.value = e.numero_serie ?? "";
      fNombre.value = e.nombre ?? "";
      fCategoria.value = e.categoria ?? "";
      fEstado.value = e.estado ?? "DISPONIBLE";
      if (fDetalles) fDetalles.value = e.detalles ?? "";

      setDropZoneContent(imagenBase64);
      fSerie.disabled = true;
    }
  }

  function closeModal() {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }

  btnCloseModal?.addEventListener("click", closeModal);
  btnDeleteModal?.addEventListener("click", () => btnDelete?.click());

  modal?.addEventListener("click", (e) => {
    if (e.target?.dataset?.close === "true") closeModal();
  });

  /* =========================
     Acciones
  ========================= */
  btnAdd?.addEventListener("click", () => openModal("add"));

  btnEdit?.addEventListener("click", () => {
    if (!selectedId) {
      alert("Selecciona un equipo.");
      return;
    }
    openModal("edit");
  });

  btnDelete?.addEventListener("click", async () => {
    if (!selectedId) return;

    const e = equipos.find(x => x.id_equipo === selectedId);
    const name = e ? `${e.nombre} (${e.numero_serie})` : "este registro";

    try {
      await api(`/catalog/equipos/${selectedId}`, { method: "DELETE" });
      await loadFromApi();
      selectedId = null;
      renderTable();
      closeModal();
    } catch (err) {
      alert(err.message);
    }
  });

  btnSearch?.addEventListener("click", renderTable);

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      renderTable();
    }
  });

  btnClear?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    if (filterCategoria) filterCategoria.value = "";
    if (filterEstado) filterEstado.value = "";
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

  filterCategoria?.addEventListener("change", renderTable);
  filterEstado?.addEventListener("change", renderTable);

  /* =========================
     Guardar (POST/PUT)
  ========================= */
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    try {
      const body = {
        imagen_eq: imagenBase64 || null,
        numero_serie: fSerie.value.trim(),
        nombre: fNombre.value.trim(),
        categoria: fCategoria.value.trim(),
        estado: fEstado.value.trim(),
        detalles: fDetalles?.value?.trim() || null,
      };

      if (!body.numero_serie || !body.nombre || !body.categoria || !body.estado) {
        alert("Completa todos los campos obligatorios.");
        return;
      }

      if (!CATEGORIAS.includes(body.categoria)) {
        alert("Categoría inválida.");
        return;
      }

      if (!ESTADOS.includes(body.estado)) {
        alert("Estado inválido.");
        return;
      }

      if (mode === "add") {
        await api("/catalog/equipos", { method: "POST", body });
      } else {
        await api(`/catalog/equipos/${selectedId}`, { method: "PUT", body });
      }

      closeModal();
      await loadFromApi();
      renderTable();
    } catch (err) {
      alert(err.message);
    }
  });

  /* =========================
     Init
  ========================= */
  (async function init() {
    initCatalogs();
    setDropZoneContent("");
    bindDropZoneEvents();

    try {
      await loadFromApi();
      renderTable();
    } catch (err) {
      alert(`No se pudo cargar equipos: ${err.message}\nRevisa API_BASE, token y endpoints.`);
    }
  })();
})();
