// control_vehiculos.js (backend + actualización UI, solo alias)
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

  const btnAdd = document.getElementById("btnAdd");
  const btnEdit = document.getElementById("btnEdit");
  const btnDelete = document.getElementById("btnDelete");

  const searchInput = document.getElementById("searchInput");
  const btnSearch = document.getElementById("btnSearch");
  const btnClear = document.getElementById("btnClear");

  const filterTipo = document.getElementById("filterTipo");
  const resultHint = document.getElementById("resultHint");
  const tbody = document.getElementById("tbody");

  // Modal
  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modalTitle");
  const btnCloseModal = document.getElementById("btnCloseModal");
  const btnDeleteModal = document.getElementById("btnDeleteModal");
  const form = document.getElementById("form");

  const dropZone = document.getElementById("dropZone");
  const previewImg = document.getElementById("previewImg");
  const fImagenVeh = document.getElementById("fImagenVeh");

  const fCodigoPrefijo = document.getElementById("fCodigoPrefijo");
  const fCodigoOtro = document.getElementById("fCodigoOtro");
  const fCodigoNumero = document.getElementById("fCodigoNumero");

  const fCodigoInterno = document.getElementById("fCodigoInterno");
  const fTipo = document.getElementById("fTipo");
  const fAlias = document.getElementById("fAlias");
  const fEstado = document.getElementById("fEstado");
  const fCapacidad = document.getElementById("fCapacidad");

  // DOM crítico obligatorio
  const requiredEls = {
    tbody,
    resultHint,
    modal,
    modalTitle,
    form,
    fTipo,
    fAlias,
    fEstado,
    fCapacidad,
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
  let vehiculos = [];
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
     Helpers extra
  ========================= */
  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function updateButtons() {
    const has = !!selectedId;
    if (btnEdit) btnEdit.disabled = !has;
    if (btnDelete) btnDelete.disabled = !has;
  }

  function setPreview(src) {
    if (!previewImg) return;
    if (src) {
      previewImg.src = src;
      previewImg.classList.add("show");
    } else {
      previewImg.src = "";
      previewImg.classList.remove("show");
    }
  }

  function getCodigoInternoArmado() {
    if (fCodigoPrefijo && fCodigoNumero) {
      const prefijoSel = fCodigoPrefijo.value;
      const numero = (fCodigoNumero.value || "").trim();

      let prefijo = prefijoSel;

      if (prefijoSel === "OTRO") {
        prefijo = (fCodigoOtro?.value || "").trim().toUpperCase();
        if (!prefijo) return "";
        if (!prefijo.endsWith("-")) prefijo += "-";
      }

      if (!numero) return "";
      return `${prefijo}${numero}`;
    }

    return fCodigoInterno?.value?.trim() || "";
  }

  function separarCodigoInterno(codigo) {
    const match = String(codigo || "").match(/^([A-Za-z]+-)(\d+)$/);

    if (!match) {
      return {
        prefijo: "OTRO",
        otro: "",
        numero: ""
      };
    }

    const prefijo = match[1].toUpperCase();
    const numero = match[2];

    if (prefijo === "VT-" || prefijo === "AM-" || prefijo === "AV-") {
      return {
        prefijo,
        otro: "",
        numero
      };
    }

    return {
      prefijo: "OTRO",
      otro: prefijo,
      numero
    };
  }

  function toggleCodigoOtro() {
    if (!fCodigoPrefijo || !fCodigoOtro) return;

    if (fCodigoPrefijo.value === "OTRO") {
      fCodigoOtro.style.display = "block";
    } else {
      fCodigoOtro.style.display = "none";
      fCodigoOtro.value = "";
    }
  }

  /* =========================
     Init catálogos UI
  ========================= */
  function initCatalogs() {
    if (fEstado) fillSelect(fEstado, ESTADOS, false);
  }

  /* =========================
     Cargar desde backend
  ========================= */
  async function loadFromApi() {
    const r = await api("/catalog/vehiculos");
    vehiculos = (r.items || []).map(v => ({
      id_vehiculo: v.id_vehiculo,
      imagen_veh: v.imagen_veh ?? "",
      codigo_interno: v.codigo_interno ?? "",
      tipo: v.tipo ?? "",
      alias: v.alias ?? "",
      estado: v.estado ?? "DISPONIBLE",
      capacidad: v.capacidad ?? "",
      fecha_registro: v.fecha_registro ?? "",
    }));
  }

  /* =========================
     Filtros + render
  ========================= */
  function getFiltered() {
    const q = normalize(searchInput?.value);
    const tipo = filterTipo?.value || "";

    return vehiculos.filter(v => {
      if (tipo && normalize(v.tipo) !== normalize(tipo)) return false;

      if (!q) return true;

      return (
        normalize(v.codigo_interno).includes(q) ||
        normalize(v.tipo).includes(q) ||
        normalize(v.alias).includes(q) ||
        normalize(v.estado).includes(q)
      );
    });
  }

  function renderTable() {
    const list = getFiltered();

    if (selectedId && !list.some(v => v.id_vehiculo === selectedId)) selectedId = null;

    tbody.innerHTML = "";

    if (!list.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="7" style="color: rgba(11,18,32,.65); padding: 16px;">
        No hay registros con los filtros actuales.
      </td>`;
      tbody.appendChild(tr);
    } else {
      list.forEach(v => {
        const tr = document.createElement("tr");
        if (v.id_vehiculo === selectedId) tr.classList.add("selected");

        tr.innerHTML = `
          <td>${v.imagen_veh ? `<img src="${v.imagen_veh}" alt="Vehículo" style="width:60px; height:60px; object-fit:cover; border-radius:8px;">` : "-"}</td>
          <td>${escapeHtml(v.codigo_interno)}</td>
          <td>${escapeHtml(v.tipo || "-")}</td>
          <td>${escapeHtml(v.alias || "-")}</td>
          <td>${escapeHtml(v.estado || "DISPONIBLE")}</td>
          <td>${escapeHtml(v.capacidad || "-")}</td>
          <td>${escapeHtml(v.fecha_registro || "-")}</td>
        `;

        tr.addEventListener("click", (e) => {
          e.stopPropagation();
          if (selectedId == v.id_vehiculo) {
            selectedId = null;
          } else {
            selectedId = v.id_vehiculo;
          }
          updateButtons();
          renderTable();
        });

        tr.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          selectedId = v.id_vehiculo;
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
      modalTitle.textContent = "Agregar vehículo";
      form.reset();
      imagenBase64 = "";
      setPreview("");

      if (fEstado) fEstado.value = "DISPONIBLE";

      if (fCodigoPrefijo && fCodigoNumero) {
        fCodigoPrefijo.value = "VT-";
        fCodigoOtro.value = "";
        fCodigoNumero.value = "";
        toggleCodigoOtro();
      }

      if (fCodigoInterno) fCodigoInterno.disabled = false;
    } else {
      modalTitle.textContent = "Modificar vehículo";
      const v = vehiculos.find(x => x.id_vehiculo === selectedId);
      if (!v) return;

      imagenBase64 = v.imagen_veh || "";
      setPreview(imagenBase64);

      if (fCodigoPrefijo && fCodigoNumero) {
        const codigoInfo = separarCodigoInterno(v.codigo_interno ?? "");
        fCodigoPrefijo.value = codigoInfo.prefijo;
        fCodigoOtro.value = codigoInfo.otro;
        fCodigoNumero.value = codigoInfo.numero;
        toggleCodigoOtro();
      } else if (fCodigoInterno) {
        fCodigoInterno.value = v.codigo_interno ?? "";
      }

      fTipo.value = v.tipo ?? "";
      fAlias.value = v.alias ?? "";
      fEstado.value = v.estado ?? "DISPONIBLE";
      fCapacidad.value = v.capacidad ?? "";

      if (fCodigoInterno) fCodigoInterno.disabled = true;
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
     Imagen / Dropzone
  ========================= */
  dropZone?.addEventListener("click", () => {
    fImagenVeh?.click();
  });

  fImagenVeh?.addEventListener("change", async () => {
    const file = fImagenVeh.files?.[0];
    if (!file) return;

    imagenBase64 = await fileToBase64(file);
    setPreview(imagenBase64);
  });

  dropZone?.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  dropZone?.addEventListener("drop", async (e) => {
    e.preventDefault();

    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;

    imagenBase64 = await fileToBase64(file);
    setPreview(imagenBase64);
  });

  /* =========================
     Acciones
  ========================= */
  btnAdd?.addEventListener("click", () => openModal("add"));
  btnEdit?.addEventListener("click", () => selectedId && openModal("edit"));

  btnDelete?.addEventListener("click", async () => {
    if (!selectedId) return;

    const v = vehiculos.find(x => x.id_vehiculo === selectedId);
    const name = v ? `${v.codigo_interno}` : "este registro";

    try {
      await api(`/catalog/vehiculos/${selectedId}`, { method: "DELETE" });
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
    if (filterTipo) filterTipo.value = "";
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

  filterTipo?.addEventListener("change", renderTable);
  fCodigoPrefijo?.addEventListener("change", toggleCodigoOtro);

  /* =========================
     Guardar (POST/PUT)
  ========================= */
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    try {
      if (fImagenVeh?.files?.length > 0) {
        imagenBase64 = await fileToBase64(fImagenVeh.files[0]);
      }

      const codigoInterno = getCodigoInternoArmado();
      const capacidadNum = fCapacidad.value.trim() === "" ? null : Number(fCapacidad.value);

      const body = {
        imagen_veh: imagenBase64 || null,
        codigo_interno: codigoInterno,
        tipo: fTipo.value.trim() || null,
        alias: fAlias.value.trim() || null,
        estado: fEstado.value.trim(),
        capacidad: Number.isNaN(capacidadNum) ? null : capacidadNum,
      };

      if (!body.codigo_interno || !body.estado) {
        alert("Completa los campos obligatorios.");
        return;
      }

      if (!body.tipo) {
        alert("Selecciona el tipo de vehículo.");
        return;
      }

      if (!ESTADOS.includes(body.estado)) {
        alert("Estado inválido.");
        return;
      }

      if (body.capacidad !== null && (!Number.isInteger(body.capacidad) || body.capacidad < 0)) {
        alert("Capacidad inválida.");
        return;
      }

      if (mode === "add") {
        await api("/catalog/vehiculos", { method: "POST", body });
      } else {
        await api(`/catalog/vehiculos/${selectedId}`, { method: "PUT", body });
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
    toggleCodigoOtro();

    try {
      await loadFromApi();
      renderTable();
    } catch (err) {
      alert(`No se pudo cargar vehículos: ${err.message}\nRevisa API_BASE, token y endpoints.`);
    }
  })();
})();
