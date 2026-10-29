
(function() {
  const token = localStorage.getItem("token");
  const rol = (localStorage.getItem("rol") || "").toUpperCase();
  const ALLOWED_ROLES = ["ADMIN", "CUT"];
  // El sistema de control (personal, vehículos, equipos, dispositivos) es
  // exclusivo del rol Administrador.
  const CONTROL_PAGES = [
    "control_personal.html",
    "control_vehiculos.html",
    "control_equipos.html",
    "control_dispositivos.html",
  ];
  const page = window.location.pathname.split("/").pop().toLowerCase();

  if (!token) {
    window.location.href = "login.html";
    return;
  }

  if (!ALLOWED_ROLES.includes(rol)) {
    alert("Acceso denegado: No tienes permisos para acceder a esta sección.");
    window.location.href = "login.html";
    return;
  }

  if (CONTROL_PAGES.includes(page) && rol !== "ADMIN") {
    alert("Acceso denegado: El sistema de control es solo para administradores.");
    window.location.href = "menu_inicial.html";
  }
})();
