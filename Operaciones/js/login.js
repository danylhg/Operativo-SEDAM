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
  msg.classList.remove("loading");

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
