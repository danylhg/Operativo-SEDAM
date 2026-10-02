(function () {
  const STORAGE_KEY = "API_BASE";
  const EXPLICIT_STORAGE_KEY = "API_BASE_EXPLICIT";
  const BACKEND_PORT = "3001";
  const FRONTEND_PORT = "3000";

  function cleanBase(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function getQueryOverride() {
    const params = new URLSearchParams(window.location.search);
    return cleanBase(params.get("apiBase") || params.get("api"));
  }

  function isLocalNetworkHost(hostname) {
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    );
  }

  function inferTunnelBackend() {
    if (window.location.protocol !== "https:") return "";

    const host = window.location.hostname;
    if (new RegExp(`(^|[-_.])${BACKEND_PORT}([-_.]|$)`).test(host)) {
      return window.location.origin;
    }

    const tunnelHost = host.replace(
      new RegExp(`(^|[-_.])${FRONTEND_PORT}([-_.]|$)`),
      `$1${BACKEND_PORT}$2`
    );

    return tunnelHost !== host ? `${window.location.protocol}//${tunnelHost}` : "";
  }

  function inferDefaultBackend() {
    const { hostname, port, origin, protocol } = window.location;

    // En la instalacion de SEDAM el frontend web se sirve desde .199:8989,
    // mientras que el mismo backend usado por Android esta en .112:3001.
    if (hostname === "192.168.202.199") {
      return "http://192.168.202.112:3001";
    }

    if (port === BACKEND_PORT) return origin;

    if (isLocalNetworkHost(hostname)) {
      return `http://${hostname}:${BACKEND_PORT}`;
    }

    // Fuera de la red local la API sirve tambien los archivos web (app.js).
    // Un proxy/tunel publico normalmente publica un solo origen HTTPS; agregar
    // :3001 hace que el navegador llegue a otra instancia o que no llegue a la
    // API. Para una instalacion con frontend y API separados se puede indicar
    // ?apiBase=https://api.ejemplo.com o guardar API_BASE explicitamente.
    const tunnelBackend = inferTunnelBackend();
    if (tunnelBackend) return tunnelBackend;

    return origin;
  }

  const override = getQueryOverride();
  const stored = cleanBase(localStorage.getItem(STORAGE_KEY));
  const inferred = inferDefaultBackend();
  const legacyDefault = `${window.location.protocol}//${window.location.hostname}:${BACKEND_PORT}`;
  const isPublicSingleOrigin = !isLocalNetworkHost(window.location.hostname)
    && !inferTunnelBackend()
    && window.location.port !== BACKEND_PORT;
  // Antes el valor predeterminado de una URL publica era <dominio>:3001.
  // Se migra una sola vez, salvo que el administrador lo haya configurado
  // expresamente con el parametro apiBase.
  const staleLocalBase = stored === `http://${window.location.hostname}:${BACKEND_PORT}` && stored !== inferred;
  const stalePublicBase = isPublicSingleOrigin
    && stored === legacyDefault
    && localStorage.getItem(EXPLICIT_STORAGE_KEY) !== "1";
  const apiBase = override || (stored && !staleLocalBase && !stalePublicBase ? stored : inferred);

  if (override) {
    localStorage.setItem(STORAGE_KEY, apiBase);
    localStorage.setItem(EXPLICIT_STORAGE_KEY, "1");
  } else if (!stored || staleLocalBase || stalePublicBase) {
    localStorage.setItem(STORAGE_KEY, apiBase);
    localStorage.removeItem(EXPLICIT_STORAGE_KEY);
  }

  window.OPERACIONES_API_BASE = apiBase;
})();
