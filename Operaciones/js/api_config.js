(function () {
  const STORAGE_KEY = "API_BASE";
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

    if (port === BACKEND_PORT) return origin;

    const tunnelBackend = inferTunnelBackend();
    if (tunnelBackend) return tunnelBackend;

    if (isLocalNetworkHost(hostname)) {
      return `http://${hostname}:${BACKEND_PORT}`;
    }

    return `${protocol}//${hostname}:${BACKEND_PORT}`;
  }

  const override = getQueryOverride();
  const stored = cleanBase(localStorage.getItem(STORAGE_KEY));
  const apiBase = override || stored || inferDefaultBackend();

  if (override || !stored) {
    localStorage.setItem(STORAGE_KEY, apiBase);
  }

  window.OPERACIONES_API_BASE = apiBase;
})();
