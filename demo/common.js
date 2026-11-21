// Utilidades compartidas: sesion (sessionStorage) y cliente del Worker.
(function () {
  const KEY = "sr_tt_session";
  const STATE_KEY = "sr_tt_state";

  const Session = {
    get() {
      try {
        const s = JSON.parse(sessionStorage.getItem(KEY) || "null");
        if (!s || !s.access_token) return null;
        if (s.expires_at && Date.now() > s.expires_at) { this.clear(); return null; }
        return s;
      } catch { return null; }
    },
    set(s) { sessionStorage.setItem(KEY, JSON.stringify(s)); },
    clear() { sessionStorage.removeItem(KEY); },
  };

  class ApiError extends Error {
    constructor(status, err) {
      super((err && err.message) || "Error de API");
      this.status = status;
      this.code = (err && err.code) || "unknown_error";
      this.log_id = err && (err.log_id || err.logid);
      this.stage = err && err.stage;
      this.publish_id = err && err.publish_id;
    }
  }

  function workerUrl() {
    const u = (window.WORKER_URL || "").replace(/\/+$/, "");
    if (!u || u.includes("<subdomain>")) throw new ApiError(0, { code: "worker_not_configured", message: "Configura WORKER_URL en demo/config.js" });
    return u;
  }

  async function api(path, { method = "GET", body, auth = true } = {}) {
    const headers = {};
    if (auth) {
      const s = Session.get();
      if (!s) throw new ApiError(401, { code: "access_token_invalid", message: "Sesion no iniciada o expirada" });
      headers.Authorization = "Bearer " + s.access_token;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(workerUrl() + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(0, { code: "network_error", message: "No se pudo contactar con el Worker (red o CORS)" });
    }
    let data = null;
    try { data = await res.json(); } catch { /* sin cuerpo */ }
    if (!res.ok || (data && data.error && data.error.code && data.error.code !== "ok")) {
      if (res.status === 401 && data && data.error && data.error.code === "access_token_invalid") Session.clear();
      throw new ApiError(res.status, data && data.error);
    }
    return data;
  }

  function randomState() {
    const a = new Uint8Array(24);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function describeError(e) {
    const parts = [e.message || String(e)];
    const meta = [];
    if (e.code) meta.push("error.code: " + e.code);
    if (e.log_id) meta.push("log_id: " + e.log_id);
    if (e.status) meta.push("HTTP " + e.status);
    return { text: parts[0], meta: meta.join(" | ") };
  }

  window.SR = { Session, ApiError, api, randomState, describeError, STATE_KEY };
})();
