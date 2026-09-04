(function() {
  const session = localStorage.getItem("session");
  const token = localStorage.getItem("token");
  const opId = localStorage.getItem("active_operation_id");

  // Validar si el valor es realmente útil (no 'null', 'undefined' o vacío)
  function isValid(val) {
    return val && val !== "null" && val !== "undefined" && val !== "";
  }

  // 1. Validar sesión global (Usuario logeado)
  if (session !== "ok" || !isValid(token)) {
    console.warn("Acceso denegado: No hay sesión activa. Redirigiendo al login...");
    window.location.href = "login.html";
    return;
  }

  // 2. Validar operación activa (Solo para dashboard)
  if (!isValid(opId)) {
    console.warn("Acceso denegado: No hay operación seleccionada. Redirigiendo al menú...");
    window.location.href = "menu_inicial.html";
  }
})();
