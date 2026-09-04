(() => {
  "use strict";

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
      throw new Error(data?.mensaje || `Error ${res.status} en ${path}`);
    }

    return data;
  }

  const TIPOS = ["TELEFONO", "TABLET", "SMARTWATCH", "LORA", "LAPTOP", "RADIO", "GPS", "OTRO"];
  const ESTADOS = ["DISPONIBLE", "ASIGNADO", "MANTENIMIENTO", "BAJA"];
  const DISPOSITIVO_FIELDS = ["numero_telefono", "imei", "numero_serie", "sistema_operativo"];
  const DEVICE_FIELD_RULES = {
    "": {
      visible: [],
      required: [],
      detallesPlaceholder: "Observaciones generales del dispositivo...",
    },
    TELEFONO: {
      visible: ["numero_telefono", "imei", "numero_serie", "sistema_operativo"],
      required: ["numero_telefono", "imei", "sistema_operativo"],
      detallesPlaceholder: "Compania, SIM, cargador, accesorios u observaciones...",
    },
    TABLET: {
      visible: ["imei", "numero_serie", "sistema_operativo"],
      required: ["numero_serie", "sistema_operativo"],
      detallesPlaceholder: "Funda, cargador, SIM de datos si aplica u observaciones...",
    },
    SMARTWATCH: {
      visible: ["imei", "numero_serie", "sistema_operativo"],
      required: ["numero_serie", "sistema_operativo"],
      detallesPlaceholder: "Cargador, color, talla, sensores u observaciones...",
    },
    LORA: {
      visible: ["numero_serie"],
      required: ["numero_serie"],
      detallesPlaceholder: "DevEUI/AppEUI, frecuencia, antena u observaciones...",
    },
    LAPTOP: {
      visible: ["numero_serie", "sistema_operativo"],
      required: ["numero_serie", "sistema_operativo"],
      detallesPlaceholder: "Cargador, RAM, almacenamiento, accesorios u observaciones...",
    },
    RADIO: {
      visible: ["numero_serie"],
      required: ["numero_serie"],
      detallesPlaceholder: "Banda, canal, frecuencia, bateria u observaciones...",
    },
    GPS: {
      visible: ["imei", "numero_serie"],
      required: ["numero_serie"],
      detallesPlaceholder: "ID de tracker, chip interno, accesorios u observaciones...",
    },
    OTRO: {
      visible: ["numero_telefono", "imei", "numero_serie", "sistema_operativo"],
      required: [],
      detallesPlaceholder: "Descripcion, identificadores y observaciones...",
    },
  };
  const DEVICE_FIELD_LABELS = {
    numero_telefono: "Num. telefono",
    imei: "IMEI",
    numero_serie: "Num. serie",
    sistema_operativo: "Sistema operativo",
  };

  function normalize(value) {
    return (value ?? "").toString().trim().toLowerCase();
  }

  function escapeHtml(text) {
    return (text ?? "").toString()
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderDeviceImage(src, alt) {
    const cleanSrc = (src ?? "").toString().trim();
    if (!cleanSrc) return "-";
    return `<img class="thumbImg" src="${escapeHtml(cleanSrc)}" alt="${escapeHtml(alt || "Dispositivo")}">`;
  }

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const btnBack = document.getElementById("btnBack");
  const btnLogout = document.getElementById("btnLogout");
  const controlUserName = document.getElementById("controlUserName");
  const btnAdd = document.getElementById("btnAdd");
  const btnEdit = document.getElementById("btnEdit");
  const btnDelete = document.getElementById("btnDelete");

  const searchInput = document.getElementById("searchInput");
  const btnSearch = document.getElementById("btnSearch");
  const btnClear = document.getElementById("btnClear");
  const filterTipo = document.getElementById("filterTipo");
  const filterEstado = document.getElementById("filterEstado");
  const resultHint = document.getElementById("resultHint");
  const tbody = document.getElementById("tbody");

  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modalTitle");
  const btnCloseModal = document.getElementById("btnCloseModal");
  const btnDeleteModal = document.getElementById("btnDeleteModal");
  const form = document.getElementById("form");

  const fTipo = document.getElementById("fTipo");
  const fMarca = document.getElementById("fMarca");
  const fModelo = document.getElementById("fModelo");
  const dropZoneDisp = document.getElementById("dropZoneDisp");
  const fImagenDisp = document.getElementById("fImagenDisp");
  const previewImgDisp = document.getElementById("previewImgDisp");
  const fNumeroTelefono = document.getElementById("fNumeroTelefono");
  const fImei = document.getElementById("fImei");
  const fNumeroSerie = document.getElementById("fNumeroSerie");
  const fSistemaOperativo = document.getElementById("fSistemaOperativo");
  const fDetalles = document.getElementById("fDetalles");

  if (controlUserName) {
    controlUserName.textContent = localStorage.getItem("nombre") || localStorage.getItem("username") || "Admin";
  }
  const deviceFieldControls = {
    numero_telefono: {
      el: fNumeroTelefono,
      field: fNumeroTelefono?.closest(".field"),
      label: fNumeroTelefono?.closest(".field")?.querySelector("label"),
      labelText: DEVICE_FIELD_LABELS.numero_telefono,
    },
    imei: {
      el: fImei,
      field: fImei?.closest(".field"),
      label: fImei?.closest(".field")?.querySelector("label"),
      labelText: DEVICE_FIELD_LABELS.imei,
    },
    numero_serie: {
      el: fNumeroSerie,
      field: fNumeroSerie?.closest(".field"),
      label: fNumeroSerie?.closest(".field")?.querySelector("label"),
      labelText: DEVICE_FIELD_LABELS.numero_serie,
    },
    sistema_operativo: {
      el: fSistemaOperativo,
      field: fSistemaOperativo?.closest(".field"),
      label: fSistemaOperativo?.closest(".field")?.querySelector("label"),
      labelText: DEVICE_FIELD_LABELS.sistema_operativo,
    },
  };

  const requiredEls = {
    tbody,
    resultHint,
    modal,
    modalTitle,
    form,
    fTipo,
    fMarca,
    fModelo,
  };

  for (const [name, el] of Object.entries(requiredEls)) {
    if (!el) {
      alert(`Falta el elemento del DOM: ${name}`);
      return;
    }
  }

  let dispositivos = [];
  let selectedId = null;
  let mode = "add";
  let imagenBase64 = "";

  function getDeviceRule(tipo) {
    return DEVICE_FIELD_RULES[tipo] || DEVICE_FIELD_RULES[""];
  }

  function fieldApplies(rule, fieldName) {
    return rule.visible.includes(fieldName);
  }

  function fieldIsRequired(rule, fieldName) {
    return rule.required.includes(fieldName);
  }

  function updateFormForType() {
    const tipo = (fTipo?.value || "").trim().toUpperCase();
    const rule = getDeviceRule(tipo);

    DISPOSITIVO_FIELDS.forEach(fieldName => {
      const control = deviceFieldControls[fieldName];
      if (!control?.el || !control.field) return;

      const applies = fieldApplies(rule, fieldName);
      const required = applies && fieldIsRequired(rule, fieldName);

      control.field.style.display = applies ? "" : "none";
      control.el.required = required;
      control.el.setAttribute("aria-required", required ? "true" : "false");
      if (control.label) control.label.textContent = `${control.labelText}${required ? " *" : ""}`;
      if (!applies) control.el.value = "";
    });

    if (fDetalles) {
      fDetalles.placeholder = rule.detallesPlaceholder || "Observaciones generales del dispositivo...";
    }
  }

  function readDeviceField(fieldName, rule) {
    if (!fieldApplies(rule, fieldName)) return null;
    return deviceFieldControls[fieldName]?.el?.value?.trim() || null;
  }

  function setImagePreview(src) {
    if (!previewImgDisp) return;
    if (src) {
      previewImgDisp.src = src;
      previewImgDisp.classList.add("show");
    } else {
      previewImgDisp.src = "";
      previewImgDisp.classList.remove("show");
    }
  }

  async function setImageFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Selecciona un archivo de imagen valido.");
      return;
    }

    imagenBase64 = await fileToBase64(file);
    setImagePreview(imagenBase64);
  }

  function missingRequiredFields(rule, body) {
    return rule.required.filter(fieldName => !body[fieldName]);
  }

  btnBack?.addEventListener("click", () => window.location.href = "menu_inicial.html");

  btnLogout?.addEventListener("click", () => {
    clearSession();
    window.location.href = "login.html";
  });

  async function loadFromApi() {
    const r = await api("/catalog/dispositivos");
    dispositivos = (r.items || []).map(d => ({
      id_dispositivo: d.id_dispositivo,
      imagen_disp: d.imagen_disp ?? "",
      tipo: d.tipo ?? "",
      marca: d.marca ?? "",
      modelo: d.modelo ?? "",
      numero_telefono: d.numero_telefono ?? "",
      imei: d.imei ?? "",
      numero_serie: d.numero_serie ?? "",
      sistema_operativo: d.sistema_operativo ?? "",
      estado: d.estado ?? "DISPONIBLE",
      responsable: d.responsable ?? "",
      detalles: d.detalles ?? "",
      fecha_registro: d.fecha_registro ?? "",
    }));
  }

  function getFiltered() {
    const q = normalize(searchInput?.value);
    const tipo = filterTipo?.value || "";
    const estado = filterEstado?.value || "";

    return dispositivos.filter(d => {
      if (tipo && d.tipo !== tipo) return false;
      if (estado && d.estado !== estado) return false;
      if (!q) return true;

      return (
        normalize(d.tipo).includes(q) ||
        normalize(d.marca).includes(q) ||
        normalize(d.modelo).includes(q) ||
        normalize(d.numero_telefono).includes(q) ||
        normalize(d.imei).includes(q) ||
        normalize(d.numero_serie).includes(q) ||
        normalize(d.sistema_operativo).includes(q) ||
        normalize(d.estado).includes(q) ||
        normalize(d.responsable).includes(q) ||
        normalize(d.detalles).includes(q)
      );
    });
  }

  function updateButtons() {
    const hasSelection = !!selectedId;
    if (btnEdit) btnEdit.disabled = !hasSelection;
    if (btnDelete) btnDelete.disabled = !hasSelection;
  }

  function renderTable() {
    const list = getFiltered();

    if (selectedId && !dispositivos.some(d => d.id_dispositivo === selectedId)) {
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
      list.forEach(d => {
        const tr = document.createElement("tr");
        if (d.id_dispositivo === selectedId) tr.classList.add("selected");

        tr.innerHTML = `
          <td>${renderDeviceImage(d.imagen_disp, `${d.marca} ${d.modelo}`)}</td>
          <td>${escapeHtml(d.tipo || "-")}</td>
          <td>${escapeHtml(d.marca || "-")}</td>
          <td>${escapeHtml(d.modelo || "-")}</td>
          <td>${escapeHtml(d.numero_telefono || "-")}</td>
          <td>${escapeHtml(d.imei || "-")}</td>
          <td>${escapeHtml(d.numero_serie || "-")}</td>
          <td>${escapeHtml(d.estado || "DISPONIBLE")}</td>
          <td>${escapeHtml(d.responsable || "-")}</td>
          <td>${escapeHtml(d.fecha_registro || "-")}</td>
        `;

        tr.addEventListener("click", (e) => {
          e.stopPropagation();
          selectedId = selectedId === d.id_dispositivo ? null : d.id_dispositivo;
          updateButtons();
          renderTable();
        });

        tr.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          selectedId = d.id_dispositivo;
          updateButtons();
          renderTable();
          openModal("edit");
        });

        tbody.appendChild(tr);
      });
    }

    updateButtons();
    resultHint.textContent = `${list.length} resultado(s)`;
  }

  function openModal(newMode) {
    mode = newMode;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    if (btnDeleteModal) btnDeleteModal.style.display = mode === "edit" ? "inline-flex" : "none";

    if (mode === "add") {
      modalTitle.textContent = "Agregar dispositivo";
      form.reset();
      imagenBase64 = "";
      setImagePreview("");
      updateFormForType();
      return;
    }

    modalTitle.textContent = "Modificar dispositivo";
    const d = dispositivos.find(x => x.id_dispositivo === selectedId);
    if (!d) return;

    fTipo.value = d.tipo ?? "";
    fMarca.value = d.marca ?? "";
    fModelo.value = d.modelo ?? "";
    fNumeroTelefono.value = d.numero_telefono ?? "";
    fImei.value = d.imei ?? "";
    fNumeroSerie.value = d.numero_serie ?? "";
    fSistemaOperativo.value = d.sistema_operativo ?? "";
    fDetalles.value = d.detalles ?? "";
    imagenBase64 = d.imagen_disp || "";
    setImagePreview(imagenBase64);
    updateFormForType();
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

  btnAdd?.addEventListener("click", () => openModal("add"));

  btnEdit?.addEventListener("click", () => {
    if (!selectedId) {
      alert("Selecciona un dispositivo.");
      return;
    }
    openModal("edit");
  });

  btnDelete?.addEventListener("click", async () => {
    if (!selectedId) return;

    try {
      await api(`/catalog/dispositivos/${selectedId}`, { method: "DELETE" });
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
    if (filterEstado) filterEstado.value = "";
    selectedId = null;
    renderTable();
  });

  filterTipo?.addEventListener("change", renderTable);
  filterEstado?.addEventListener("change", renderTable);
  fTipo?.addEventListener("change", updateFormForType);

  dropZoneDisp?.addEventListener("click", () => {
    fImagenDisp?.click();
  });

  fImagenDisp?.addEventListener("change", async () => {
    await setImageFile(fImagenDisp.files?.[0]);
  });

  dropZoneDisp?.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZoneDisp.classList.add("dragover");
  });

  dropZoneDisp?.addEventListener("dragleave", () => {
    dropZoneDisp.classList.remove("dragover");
  });

  dropZoneDisp?.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZoneDisp.classList.remove("dragover");
    await setImageFile(e.dataTransfer.files?.[0]);
  });

  fNumeroTelefono?.addEventListener("input", () => {
    fNumeroTelefono.value = fNumeroTelefono.value.replace(/\D/g, "").slice(0, 10);
  });

  document.addEventListener("click", (e) => {
    if (selectedId && !e.target.closest("table") && !e.target.closest("#modal") && !e.target.closest("button")) {
      selectedId = null;
      updateButtons();
      renderTable();
    }
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tipo = fTipo.value.trim().toUpperCase();
    const rule = getDeviceRule(tipo);

    const body = {
      tipo,
      marca: fMarca.value.trim(),
      modelo: fModelo.value.trim(),
      numero_telefono: readDeviceField("numero_telefono", rule),
      imei: readDeviceField("imei", rule),
      numero_serie: readDeviceField("numero_serie", rule),
      sistema_operativo: readDeviceField("sistema_operativo", rule),
      detalles: fDetalles?.value?.trim() || null,
      imagen_disp: imagenBase64 || null,
    };

    if (!body.tipo || !body.marca || !body.modelo) {
      alert("Completa tipo, marca y modelo.");
      return;
    }

    if (!TIPOS.includes(body.tipo)) {
      alert("Tipo inválido.");
      return;
    }

    const missing = missingRequiredFields(rule, body);
    if (missing.length) {
      alert(`Completa ${missing.map(fieldName => DEVICE_FIELD_LABELS[fieldName]).join(", ")} para ${body.tipo}.`);
      return;
    }

    if (body.numero_telefono && !/^\d{7,15}$/.test(body.numero_telefono)) {
      alert("El numero de telefono debe tener solo digitos (7 a 15).");
      return;
    }

    if (mode === "add") {
      body.estado = "DISPONIBLE";
    }

    try {
      if (mode === "add") {
        await api("/catalog/dispositivos", { method: "POST", body });
      } else {
        await api(`/catalog/dispositivos/${selectedId}`, { method: "PUT", body });
      }

      closeModal();
      await loadFromApi();
      renderTable();
    } catch (err) {
      alert(err.message);
    }
  });

  (async function init() {
    try {
      updateFormForType();
      await loadFromApi();
      renderTable();
    } catch (err) {
      alert(`No se pudo cargar dispositivos: ${err.message}\nRevisa API_BASE, token y endpoints.`);
    }
  })();
})();
