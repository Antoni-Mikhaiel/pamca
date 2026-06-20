// Profile page: edit saved delivery details and review orders, split across a
// "Personal Details" and an "Orders" tab. Auth uses the shared localStorage-backed
// client (auth.js); order rendering reuses helpers from shared-scripts.js.
(() => {
  const AUTH_CACHE_KEY = "pamca_auth";

  function authHeader() {
    try {
      const s = window.getSession && window.getSession();
      return s && s.access_token ? { Authorization: "Bearer " + s.access_token } : null;
    } catch (_) { return null; }
  }

  function cachedLoggedIn() {
    try {
      const s = JSON.parse(localStorage.getItem(AUTH_CACHE_KEY) || "null");
      return !!(s && s.loggedIn);
    } catch (_) { return false; }
  }

  function setVal(id, value) { const el = document.getElementById(id); if (el) el.value = value == null ? "" : value; }
  function getVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ""; }

  function setMessage(text, kind) {
    const box = document.getElementById("profile-message");
    if (!box) return;
    box.textContent = text || "";
    box.className = "auth-message" + (text ? " " + (kind || "error") : "");
  }

  // Exactly one of the four page states is visible at a time. Keeping this in one
  // place avoids the bug where a half-updated set of toggles left the page showing
  // the wrong panel (e.g. the sign-in gate while actually signed in).
  function setState(state) {
    const ids = { skeleton: "profile-skeleton", gate: "profile-gate", error: "profile-error", content: "profile-content" };
    Object.keys(ids).forEach((key) => {
      const el = document.getElementById(ids[key]);
      if (el) el.style.display = key === state ? "block" : "none";
    });
    // The sign-out button lives in the page header (next to the title); only show it
    // once the signed-in content is on screen.
    const signout = document.getElementById("profile-signout-btn");
    if (signout) signout.style.display = state === "content" ? "inline-flex" : "none";
  }

  function showSkeleton() {
    setState("skeleton");
  }

  function showGate() {
    setState("gate");
    const btn = document.getElementById("profile-signin-btn");
    if (btn && !btn._wired) {
      btn._wired = true;
      btn.addEventListener("click", () => {
        const modal = document.getElementById("auth-modal");
        if (modal) modal.classList.add("active");
      });
    }
  }

  // Shown when we ARE signed in but the server couldn't return the profile (e.g. a
  // backend/database error). Surfacing the real reason — instead of the misleading
  // "Please sign in" gate — means a server fault never looks like a logout.
  function showError(text) {
    setState("error");
    const msg = document.getElementById("profile-error-text");
    if (msg && text) msg.textContent = text;
    const retry = document.getElementById("profile-retry-btn");
    if (retry && !retry._wired) {
      retry._wired = true;
      retry.addEventListener("click", () => { showSkeleton(); loadProfile(); });
    }
  }

  function showContent() {
    setState("content");
  }

  function whenRendererReady() {
    return new Promise((resolve) => {
      if (typeof window.pamcaRenderOrderCard === "function") return resolve(window.pamcaRenderOrderCard);
      let tries = 0;
      const t = setInterval(() => {
        if (typeof window.pamcaRenderOrderCard === "function" || tries++ > 60) {
          clearInterval(t);
          resolve(window.pamcaRenderOrderCard);
        }
      }, 50);
    });
  }

  function fillProfile(p) {
    setVal("profile-first", p.firstName);
    setVal("profile-last", p.lastName);
    setVal("profile-email", p.email);
    setVal("profile-street-number", p.streetNumber);
    setVal("profile-street-name", p.streetName);
    setVal("profile-province", p.province);
    setVal("profile-postal-code", p.postalCode);
    setVal("profile-phone", (p.phone || "").replace(/^\+1/, ""));
    if (typeof window.pamcaFormatPhone === "function") window.pamcaFormatPhone(document.getElementById("profile-phone"));
    if (typeof window.pamcaFormatPostal === "function") window.pamcaFormatPostal(document.getElementById("profile-postal-code"));
    // Resync the custom province dropdown to the value we just set programmatically.
    document.getElementById("profile-province")?.dispatchEvent(new Event("change"));
    const note = document.getElementById("login-email-note");
    if (note && p.loginEmail) note.textContent = "Signed in as " + p.loginEmail;
  }

  let currentOrders = [];

  async function renderOrders(orders) {
    const host = document.getElementById("profile-orders");
    if (!host) return;
    currentOrders = Array.isArray(orders) ? orders : [];
    if (currentOrders.length === 0) {
      host.innerHTML = '<p class="profile-orders-empty">You have no orders yet.</p>';
      return;
    }
    const render = await whenRendererReady();
    host.innerHTML = typeof render === "function"
      ? currentOrders.map((o) => render(o)).join("")
      : '<p class="profile-orders-empty">Unable to display orders right now.</p>';
  }

  // Edit → open the dedicated order page; Refund → shared confirmation card.
  function wireOrderActions() {
    const host = document.getElementById("profile-orders");
    if (!host) return;
    host.addEventListener("click", (e) => {
      const editBtn = e.target.closest(".order-edit-btn");
      if (editBtn) {
        window.location.href = "/order.html?id=" + encodeURIComponent(editBtn.getAttribute("data-order-id"));
        return;
      }
      const refundBtn = e.target.closest(".order-refund-btn");
      if (refundBtn && typeof window.pamcaConfirmRefund === "function") {
        const id = refundBtn.getAttribute("data-order-id");
        const order = currentOrders.find((o) => o.id === id);
        window.pamcaConfirmRefund({
          creds: { orderId: id },
          headers: authHeader() || {},
          purchaseId: order && order.purchase_id,
          onDone: () => loadProfile(),
        });
      }
    });
  }

  function wireSignOut() {
    const btn = document.getElementById("profile-signout-btn");
    if (!btn || btn._wired) return;
    btn._wired = true;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try { if (typeof window.signOut === "function") await window.signOut(); } catch (_) {}
      // Clear the nav auth cache so the navbar doesn't flash a logged-in state.
      try { localStorage.removeItem(AUTH_CACHE_KEY); sessionStorage.removeItem(AUTH_CACHE_KEY); } catch (_) {}
      window.location.href = "/";
    });
  }

  function wireTabs() {
    document.querySelectorAll(".profile-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.getAttribute("data-panel");
        document.querySelectorAll(".profile-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
        document.querySelectorAll(".profile-panel").forEach((p) => p.classList.toggle("is-active", p.id === target));
      });
    });
  }

  async function loadProfile() {
    const auth = authHeader();
    // No session at all → genuinely signed out → show the sign-in gate.
    if (!auth) { showGate(); return; }

    let res;
    try {
      res = await fetch("/api/profile", { headers: auth });
    } catch (_) {
      showError("We couldn't reach the server. Check your connection and try again.");
      return;
    }
    // Only a 401 means the session is no longer valid → back to the sign-in gate.
    if (res.status === 401) { showGate(); return; }

    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.success || !json.data) {
      // Signed in, but the server failed (e.g. a database error). Show the real
      // message rather than pretending the shopper is logged out.
      showError((json && json.message) || "Something went wrong loading your profile. Please try again.");
      return;
    }

    showContent();
    fillProfile(json.data.profile || {});
    await renderOrders(json.data.orders || []);
  }

  async function saveProfile(e) {
    e.preventDefault();
    const auth = authHeader();
    if (!auth) { showGate(); return; }

    const payload = {
      firstName: getVal("profile-first"),
      lastName: getVal("profile-last"),
      email: getVal("profile-email"),
      streetNumber: getVal("profile-street-number"),
      streetName: getVal("profile-street-name"),
      province: getVal("profile-province"),
      postalCode: getVal("profile-postal-code"),
      phone: getVal("profile-phone"),
    };
    if (!payload.firstName || !payload.lastName || !payload.email || !payload.streetNumber || !payload.streetName || !payload.province || !payload.postalCode) {
      setMessage("Please fill in every field.");
      return;
    }
    if (payload.phone.replace(/\D/g, "").length !== 10) {
      setMessage("Enter a valid 10-digit Canadian phone number.");
      return;
    }

    const btn = document.getElementById("profile-save");
    const orig = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    setMessage("");
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: Object.assign({ "Content-Type": "application/json" }, auth),
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.success) {
        if (json.data?.profile) fillProfile(json.data.profile);
        setMessage("Your details have been saved.", "success");
      } else {
        setMessage((json && json.message) || "Could not save your changes.");
      }
    } catch (_) {
      setMessage("Could not save your changes. Please try again.");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
    }
  }

  async function init() {
    // Show a loading state immediately so the page is never a bare heading. When no
    // session was ever cached, fall straight to the gate to avoid a needless spinner.
    if (cachedLoggedIn()) showSkeleton();
    else showGate();

    if (!window.getSession) {
      await new Promise((resolve) => {
        if (window.authReady) resolve();
        else window.addEventListener("authReady", resolve, { once: true });
      });
    }
    wireTabs();
    wireOrderActions();
    wireSignOut();
    document.getElementById("profile-form")?.addEventListener("submit", saveProfile);
    // The phone/postal formatters and custom dropdown are published together by
    // shared-scripts at the end of its bootstrap; wait for that (same readiness as
    // the order-card renderer) before upgrading the static fields.
    await whenRendererReady();
    if (typeof window.pamcaEnhanceSelect === "function") window.pamcaEnhanceSelect(document.getElementById("profile-province"));
    if (typeof window.pamcaFormatPhone === "function") window.pamcaFormatPhone(document.getElementById("profile-phone"));
    if (typeof window.pamcaFormatPostal === "function") window.pamcaFormatPostal(document.getElementById("profile-postal-code"));
    await loadProfile();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
