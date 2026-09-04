(function() {
  const token = localStorage.getItem("token");
  const rol = (localStorage.getItem("rol") || "").toUpperCase();
  const ALLOWED_ROLES = ["ADMIN", "CUT"];

  if (!token) {
    window.location.href = "login.html";
    return;
  }

  if (!ALLOWED_ROLES.includes(rol)) {
    alert("Acceso denegado: No tienes permisos para acceder a esta sección.");
    window.location.href = "login.html";
  }
})();
