const API = (window.OPERACIONES_API_BASE || localStorage.getItem("API_BASE") || `http://${window.location.hostname}:3001`).replace(/\/$/, "");

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("btnLogin");
const msg = document.getElementById("msg");
let loginInProgress = false;

function dismissKeyboard() {
  const active = document.activeElement;
  if (active && typeof active.blur === "function") {
    active.blur();
  }

  if (!document.body.hasAttribute("tabindex")) {
    document.body.setAttribute("tabindex", "-1");
  }
  document.body.focus({ preventScroll: true });
}

async function attemptLogin() {
  if (loginInProgress) return;
  dismissKeyboard();

  const u = usernameInput.value.trim();
  const p = passwordInput.value;
  msg.textContent = "";
  msg.classList.remove("loading", "ok");

  if (!u || !p) {
    msg.textContent = "Ingresa usuario y contraseña.";
    return;
  }

  loginInProgress = true;
  loginButton.disabled = true;
  loginButton.setAttribute("aria-busy", "true");
  msg.classList.add("loading");
  msg.textContent = "Cargando...";

  try {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
    });

    const data = await res.json();

    if (data?.codigo === "CAMBIO_PASSWORD_REQUERIDO") {
      msg.classList.remove("loading");
      msg.textContent = "";
      showPasswordPanel({ required: true, username: u, actual: p, expira: data.expira });
      return;
    }

    if (!res.ok || !data.ok) {
      msg.classList.remove("loading");
      msg.textContent = data.mensaje ?? "Usuario o contraseña incorrectos.";
      return;
    }

    localStorage.setItem("token", data.token);
    localStorage.setItem("userData", JSON.stringify(data.usuario));
    localStorage.setItem("rol", data.usuario.rol);
    localStorage.setItem("username", data.usuario.username);
    localStorage.setItem("tabla", data.usuario.tabla || "");
    localStorage.setItem("nombre", data.usuario.nombre || data.usuario.username || "");
    localStorage.setItem("apellido", data.usuario.apellido || "");
    localStorage.removeItem("id_personal");
    localStorage.removeItem("id_usuario");
    if (data.usuario.id_personal != null) localStorage.setItem("id_personal", data.usuario.id_personal);
    if (data.usuario.id_usuario != null) localStorage.setItem("id_usuario", data.usuario.id_usuario);

    window.location.href = "menu_inicial.html";
  } catch {
    msg.classList.remove("loading");
    msg.textContent = "No se pudo conectar con el servidor.";
  } finally {
    loginInProgress = false;
    loginButton.disabled = false;
    loginButton.removeAttribute("aria-busy");
  }
}

usernameInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  passwordInput.focus();
});

passwordInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  attemptLogin();
});

loginButton.addEventListener("pointerdown", dismissKeyboard);
loginButton.addEventListener("click", attemptLogin);

/* =========================
   Elegir / cambiar contraseña
========================= */
const loginPanel = document.getElementById("loginPanel");
const passwordPanel = document.getElementById("passwordPanel");
const pwSubtitle = document.getElementById("pwSubtitle");
const pwInfo = document.getElementById("pwInfo");
const pwUsername = document.getElementById("pwUsername");
const pwActual = document.getElementById("pwActual");
const pwActualLabel = document.getElementById("pwActualLabel");
const pwNueva = document.getElementById("pwNueva");
const pwConfirmar = document.getElementById("pwConfirmar");
const pwMsg = document.getElementById("pwMsg");
const btnSavePassword = document.getElementById("btnSavePassword");
let passwordChangeRequired = false;
let passwordSaving = false;

function formatFecha(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" });
}

// required = la cuenta entró con su código de acceso y debe elegir contraseña.
function showPasswordPanel({ required = false, username = "", actual = "", expira = null } = {}) {
  passwordChangeRequired = required;
  loginPanel.hidden = true;
  passwordPanel.hidden = false;

  pwSubtitle.textContent = required ? "Elige tu contraseña" : "Cambia tu contraseña";
  pwActualLabel.textContent = required ? "Código de acceso" : "Contraseña actual";

  const vence = formatFecha(expira);
  pwInfo.hidden = !required;
  pwInfo.textContent = required
    ? (vence ? `Tienes hasta el ${vence} para cambiar tu contraseña.` : "Cambia tu código de acceso por una contraseña propia.")
    : "";

  pwUsername.value = username;
  pwActual.value = actual;
  pwNueva.value = "";
  pwConfirmar.value = "";
  pwMsg.textContent = "";
  pwMsg.classList.remove("ok", "loading");

  (required ? pwNueva : (username ? pwActual : pwUsername)).focus();
}

function showLoginPanel(message = "", ok = false) {
  passwordPanel.hidden = true;
  loginPanel.hidden = false;
  msg.textContent = message;
  msg.classList.toggle("ok", ok);
}

async function savePassword() {
  if (passwordSaving) return;
  dismissKeyboard();

  const username = pwUsername.value.trim();
  const actual = pwActual.value;
  const nueva = pwNueva.value;
  const confirmar = pwConfirmar.value;
  pwMsg.classList.remove("ok", "loading");

  if (!username || !actual || !nueva) {
    pwMsg.textContent = "Completa todos los campos.";
    return;
  }
  if (nueva.length < 8 || !/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(nueva) || !/\d/.test(nueva)) {
    pwMsg.textContent = "La contraseña debe tener al menos 8 caracteres, con letras y números.";
    return;
  }
  if (nueva !== confirmar) {
    pwMsg.textContent = "Las contraseñas no coinciden.";
    return;
  }

  passwordSaving = true;
  btnSavePassword.disabled = true;
  pwMsg.classList.add("loading");
  pwMsg.textContent = "Guardando...";

  try {
    const res = await fetch(`${API}/auth/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password_actual: actual, nueva_password: nueva }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      pwMsg.classList.remove("loading");
      pwMsg.textContent = data.mensaje ?? "No se pudo cambiar la contraseña.";
      return;
    }

    usernameInput.value = username;
    if (passwordChangeRequired) {
      // Entra directamente con la contraseña recién elegida.
      passwordInput.value = nueva;
      showLoginPanel();
      attemptLogin();
    } else {
      passwordInput.value = "";
      showLoginPanel("Contraseña actualizada. Inicia sesión con tu nueva contraseña.", true);
      passwordInput.focus();
    }
  } catch {
    pwMsg.classList.remove("loading");
    pwMsg.textContent = "No se pudo conectar con el servidor.";
  } finally {
    passwordSaving = false;
    btnSavePassword.disabled = false;
  }
}

document.getElementById("btnShowChangePassword").addEventListener("click", () => {
  showPasswordPanel({ username: usernameInput.value.trim() });
});
document.getElementById("btnBackToLogin").addEventListener("click", () => {
  passwordInput.value = "";
  showLoginPanel();
});
btnSavePassword.addEventListener("click", savePassword);
pwConfirmar.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  savePassword();
});
