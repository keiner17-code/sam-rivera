(function () {
  const $ = (id) => document.getElementById(id);
  const MUSIC_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
  const BRANDED_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";
  const PRIVACY_LABELS = {
    PUBLIC_TO_EVERYONE: "Everyone (público)",
    MUTUAL_FOLLOW_FRIENDS: "Friends (amigos / seguidores mutuos)",
    FOLLOWER_OF_CREATOR: "Followers (seguidores)",
    SELF_ONLY: "Only me (solo yo)",
  };
  const CANNOT_POST = ["spam_risk_too_many_posts", "spam_risk_user_banned_from_posting", "reached_active_user_cap"];

  let creator = null;       // data de creator_info
  let creatorBlocked = false;
  let videoDuration = null;
  let publishing = false;
  let pollTimer = null;

  // ---------- errores ----------
  function showGlobalError(e) {
    const d = SR.describeError(e);
    const box = $("globalErr");
    box.textContent = d.text + (d.meta ? "  [" + d.meta + "]" : "");
    box.classList.remove("hidden");
  }
  function clearGlobalError() { $("globalErr").classList.add("hidden"); }

  // ---------- conexion ----------
  async function connect() {
    clearGlobalError();
    const state = SR.randomState();
    sessionStorage.setItem(SR.STATE_KEY, state);
    $("btnConnect").disabled = true;
    try {
      const data = await SR.api("/auth/start?state=" + encodeURIComponent(state), { auth: false });
      location.href = data.url;
    } catch (e) {
      $("btnConnect").disabled = false;
      showGlobalError(e);
    }
  }

  async function disconnect() {
    clearGlobalError();
    const s = SR.Session.get();
    try {
      if (s) await SR.api("/auth/revoke", { method: "POST" });
    } catch (e) {
      showGlobalError(e); // se limpia la sesion local igualmente
    }
    SR.Session.clear();
    sessionStorage.removeItem(SR.STATE_KEY);
    clearInterval(pollTimer);
    showView(false);
  }

  function showView(connected) {
    $("viewOut").classList.toggle("hidden", connected);
    $("viewIn").classList.toggle("hidden", !connected);
  }

  function setAvatar(img, url) {
    if (url && /^https:\/\//.test(url)) { img.src = url; img.hidden = false; } else { img.hidden = true; }
  }

  async function loadUser() {
    try {
      const d = await SR.api("/user/info");
      const u = (d.data && d.data.user) || {};
      $("uName").textContent = u.display_name || "(sin nombre)";
      setAvatar($("uAvatar"), u.avatar_url);
    } catch (e) {
      if (!SR.Session.get()) { showView(false); }
      showGlobalError(e);
    }
  }

  // ---------- creator info (se consulta cada vez que se muestra el panel) ----------
  async function loadCreator() {
    creator = null; creatorBlocked = false;
    $("cName").textContent = "Consultando creator info…";
    $("creatorBlock").classList.add("hidden");
    try {
      const d = await SR.api("/creator-info", { method: "POST" });
      creator = d.data || {};
      $("cName").textContent = (creator.creator_nickname || "?") + (creator.creator_username ? "  (@" + creator.creator_username + ")" : "");
      setAvatar($("cAvatar"), creator.creator_avatar_url);
      fillPrivacy();
      applyInteractionLimits();
    } catch (e) {
      creatorBlocked = true;
      $("cName").textContent = "No disponible";
      const d = SR.describeError(e);
      const cant = CANNOT_POST.includes(e.code);
      const box = $("creatorBlock");
      box.textContent = (cant
        ? "Esta cuenta no puede publicar en este momento. Inténtalo de nuevo más tarde. "
        : "No se pudo obtener la información del creador. Inténtalo de nuevo más tarde. ") + d.text + (d.meta ? "  [" + d.meta + "]" : "");
      box.classList.remove("hidden");
    }
    checkDuration();
    refresh();
  }

  function fillPrivacy() {
    const sel = $("privacy");
    sel.length = 1; // conserva el placeholder (sin valor por defecto)
    sel.selectedIndex = 0;
    (creator.privacy_level_options || []).forEach((v) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = PRIVACY_LABELS[v] || v;
      sel.appendChild(o);
    });
    sel.disabled = false;
  }

  function applyInteractionLimits() {
    const map = [["comment_disabled", "allowComment", "optComment"], ["duet_disabled", "allowDuet", "optDuet"], ["stitch_disabled", "allowStitch", "optStitch"]];
    map.forEach(([flag, id, wrap]) => {
      const cb = $(id), off = creator[flag] === true;
      cb.checked = false;
      cb.disabled = off;
      $(wrap).classList.toggle("disabled", off);
      $(wrap).title = off ? "Desactivado en los ajustes de tu cuenta de TikTok" : "";
    });
  }

  // ---------- duracion ----------
  function checkDuration() {
    const box = $("durErr");
    box.classList.add("hidden");
    if (videoDuration == null) return;
    $("vDur").textContent = "Duración: " + videoDuration.toFixed(1) + " s";
    const max = creator && creator.max_video_post_duration_sec;
    if (max && videoDuration > max) {
      box.textContent = "El video dura " + videoDuration.toFixed(1) + " s y supera el máximo permitido para esta cuenta (" + max + " s). No se puede publicar.";
      box.classList.remove("hidden");
    }
  }
  function durationTooLong() {
    const max = creator && creator.max_video_post_duration_sec;
    return !!(max && videoDuration != null && videoDuration > max);
  }

  // ---------- reglas de UI ----------
  function state() {
    return {
      privacy: $("privacy").value,
      disclose: $("discloseToggle").checked,
      organic: $("discloseToggle").checked && $("brandOrganic").checked,
      branded: $("discloseToggle").checked && $("brandedContent").checked,
    };
  }

  function refresh() {
    const s = state();
    $("discloseBox").classList.toggle("hidden", !s.disclose);

    // Branded content no puede ser privado.
    const selfOnlyOpt = Array.from($("privacy").options).find((o) => o.value === "SELF_ONLY");
    if (selfOnlyOpt) {
      selfOnlyOpt.disabled = s.branded;
      selfOnlyOpt.title = s.branded ? "Branded content visibility cannot be set to private." : "";
    }
    const privateSelected = s.privacy === "SELF_ONLY";
    const brandedCb = $("brandedContent");
    brandedCb.disabled = privateSelected;
    $("optBranded").classList.toggle("disabled", privateSelected);
    $("optBranded").title = privateSelected ? "Branded content visibility cannot be set to private." : "";
    $("privacyNote").textContent = privateSelected && s.disclose
      ? "Branded content visibility cannot be set to private. Elige otra visibilidad para usar «Branded content»."
      : (s.branded ? "Con Branded content, la visibilidad «Only me» no está disponible." : "");

    // Etiquetas de divulgacion
    const lab = $("discloseLabel");
    if (s.branded) lab.textContent = "Your photo/video will be labeled as 'Paid partnership'";
    else if (s.organic) lab.textContent = "Your photo/video will be labeled as 'Promotional content'";
    else lab.textContent = "Indica qué promociona tu contenido: Your brand, Branded content o ambos.";
    $("discloseNeed").classList.toggle("hidden", !(s.disclose && !s.organic && !s.branded));

    // Consentimiento
    const c = $("consent");
    c.textContent = "";
    const a = (href, text) => { const el = document.createElement("a"); el.href = href; el.target = "_blank"; el.rel = "noopener"; el.textContent = text; return el; };
    c.append("By posting, you agree to TikTok's ");
    if (s.branded) { c.append(a(BRANDED_URL, "Branded Content Policy"), " and ", a(MUSIC_URL, "Music Usage Confirmation"), "."); }
    else if (s.organic) { c.append(a(MUSIC_URL, "Music Usage Confirmation"), "."); }
    else { c.append(a(MUSIC_URL, "Music Usage Confirmation")); }

    // Boton publicar
    let hint = "";
    if (creatorBlocked || !creator) hint = "Esperando información del creador.";
    else if (durationTooLong()) hint = "El video supera la duración máxima permitida.";
    else if (!s.privacy) hint = "Elige quién puede ver el video para habilitar «Publicar».";
    else if (s.disclose && !s.organic && !s.branded) hint = "Selecciona «Your brand» y/o «Branded content».";
    else if (s.branded && s.privacy === "SELF_ONLY") hint = "Branded content no puede ser privado.";
    else if (publishing) hint = "Publicando…";
    $("btnPublish").disabled = !!hint;
    $("publishHint").textContent = hint;
    $("capCount").textContent = [...$("caption").value].length;
  }

  // ---------- publicar ----------
  const STEPS = [
    ["creator", "Información del creador verificada"],
    ["upload", "Enviando el video a TikTok (init + subida)"],
    ["processing", "Procesando en TikTok (PROCESSING_UPLOAD)"],
    ["done", "Publicación completada (PUBLISH_COMPLETE)"],
  ];
  function renderTimeline(current, failedAt, extra) {
    const ul = $("timeline");
    ul.textContent = "";
    const idx = STEPS.findIndex((x) => x[0] === current);
    STEPS.forEach(([key, label], i) => {
      const li = document.createElement("li");
      const dot = document.createElement("span"); dot.className = "dot";
      const txt = document.createElement("span");
      txt.textContent = label;
      if (failedAt === key) { li.className = "failed"; txt.textContent = label + " — FALLÓ"; }
      else if (i < idx || current === "done" && i <= idx) li.className = "done";
      else if (i === idx) li.className = "active";
      li.append(dot, txt);
      ul.appendChild(li);
    });
    $("statusMeta").textContent = extra || "";
  }
  function setResult(kind, text) {
    const r = $("statusResult");
    r.className = "notice " + kind;
    r.textContent = text;
  }

  async function publish() {
    const s = state();
    if ($("btnPublish").disabled) return;
    publishing = true; refresh();
    clearGlobalError();
    $("statusCard").classList.remove("hidden");
    $("statusResult").className = "hidden";
    renderTimeline("upload", null, "Al pulsar «Publicar» aceptas enviar este video a TikTok.");
    try {
      const r = await SR.api("/post", {
        method: "POST",
        body: {
          title: $("caption").value,
          privacy_level: s.privacy,
          disable_comment: !$("allowComment").checked,
          disable_duet: !$("allowDuet").checked,
          disable_stitch: !$("allowStitch").checked,
          brand_content_toggle: s.branded,
          brand_organic_toggle: s.organic,
        },
      });
      renderTimeline("processing", null, "publish_id: " + r.publish_id + " · puede tardar unos minutos.");
      poll(r.publish_id, 0, 0);
    } catch (e) {
      const d = SR.describeError(e);
      renderTimeline("upload", "upload", "");
      let extra = "";
      if (e.code === "unaudited_client_can_only_post_to_private_accounts") extra = " (La app aún no está auditada: solo puede publicar en cuentas privadas / «Only me».)";
      setResult("err", d.text + extra + (d.meta ? "  [" + d.meta + "]" : ""));
      publishing = false; refresh();
    }
  }

  function poll(publishId, n, errs) {
    clearInterval(pollTimer);
    pollTimer = setTimeout(async () => {
      try {
        const r = await SR.api("/status", { method: "POST", body: { publish_id: publishId } });
        const d = r.data || {};
        const st = d.status;
        const bytes = d.uploaded_bytes != null ? " · uploaded_bytes: " + d.uploaded_bytes : "";
        if (st === "PUBLISH_COMPLETE") {
          renderTimeline("done", null, "status: PUBLISH_COMPLETE · publish_id: " + publishId);
          const ids = d.publicaly_available_post_id;
          setResult("ok", "¡Publicado! El video ya está en TikTok" + (ids && ids.length ? " (post id: " + ids.join(", ") + ")" : " (si es privado, solo tú lo ves en tu perfil)") + ".");
          publishing = false; refresh(); return;
        }
        if (st === "FAILED") {
          renderTimeline("processing", "processing", "status: FAILED · publish_id: " + publishId);
          setResult("err", "La publicación falló. fail_reason: " + (d.fail_reason || "desconocido"));
          publishing = false; refresh(); return;
        }
        renderTimeline("processing", null, "status: " + (st || "?") + bytes + " · publish_id: " + publishId + " · consultando cada 5 s (" + (n + 1) + ")");
        if (n >= 120) { setResult("warn", "Sigue procesándose. Revisa tu perfil de TikTok en unos minutos."); publishing = false; refresh(); return; }
        poll(publishId, n + 1, 0);
      } catch (e) {
        if (errs >= 2 || e.code === "access_token_invalid") {
          const d = SR.describeError(e);
          renderTimeline("processing", "processing", "publish_id: " + publishId);
          setResult("err", "No se pudo consultar el estado: " + d.text + (d.meta ? "  [" + d.meta + "]" : ""));
          publishing = false; refresh();
          if (!SR.Session.get()) showView(false);
          return;
        }
        poll(publishId, n + 1, errs + 1);
      }
    }, 5000);
  }

  // ---------- init ----------
  function bind() {
    $("btnConnect").addEventListener("click", connect);
    $("btnDisconnect").addEventListener("click", disconnect);
    $("btnPublish").addEventListener("click", publish);
    ["privacy", "discloseToggle", "brandOrganic", "brandedContent", "allowComment", "allowDuet", "allowStitch"].forEach((id) => $(id).addEventListener("change", refresh));
    $("caption").addEventListener("input", refresh);
    $("preview").addEventListener("loadedmetadata", () => { videoDuration = $("preview").duration; checkDuration(); refresh(); });
  }

  async function init() {
    bind();
    refresh();
    if (SR.Session.get()) {
      showView(true);
      loadUser();
      loadCreator();
    } else {
      showView(false);
    }
  }
  init();
})();
