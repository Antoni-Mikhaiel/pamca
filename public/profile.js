// Profile page: lets a signed-in shopper edit their saved delivery details and
// review their orders. Auth uses the same sessionStorage-backed client as the rest
// of the site (auth.js); order rendering reuses the helper exposed by shared-scripts.js.
(() => {
  function authHeader() {
    try {
      const s = window.getSession && window.getSession();
      return s && s.access_token ? { Authorization: "Bearer " + s.access_token } : null;
    } catch (_) {
      return null;
    }
  }

  function setVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value == null ? "" : value;
  }
  function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function setMessage(text, kind) {
    const box = document.getElementById("profile-message");
    if (!box) return;
    box.textContent = text || "";
    box.className = "auth-message" + (text ? " " + (kind || "error") : "");
  }

  function showGate() {
    const gate = document.getElementById("profile-gate");
    const content = document.getElementById("profile-content");
    if (gate) gate.style.display = "block";
    if (content) content.style.display = "none";
    document.getElementById("profile-signin-btn")?.addEventListener("click", () => {
      const modal = document.getElementById("auth-modal");
      if (modal) modal.classList.add("active");
    });
  }

  function showContent() {
    const gate = document.getElementById("profile-gate");
    const content = document.getElementById("profile-content");
    if (gate) gate.style.display = "none";
    if (content) content.style.display = "block";
  }

  // The order-card renderer is published by shared-scripts.js at the end of its
  // async bootstrap; wait briefly for it before rendering the orders list.
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
    setVal("profile-address", p.address);
    setVal("profile-phone", (p.phone || "").replace(/^\+1/, ""));
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

  // Edit/Refund buttons on the orders list act as the signed-in owner (orderId + token).
  function wireOrderActions() {
    const host = document.getElementById("profile-orders");
    if (!host) return;
    host.addEventListener("click", (e) => {
      const btn = e.target.closest(".order-edit-btn, .order-refund-btn");
      if (!btn || typeof window.pamcaOpenOrderActions !== "function") return;
      const id = btn.getAttribute("data-order-id");
      const order = currentOrders.find((o) => o.id === id);
      if (!order) return;
      window.pamcaOpenOrderActions(order, { orderId: id, onChanged: () => loadProfile() });
    });
  }

  async function loadProfile() {
    const auth = authHeader();
    if (!auth) { showGate(); return; }

    let json = null;
    try {
      const res = await fetch("/api/profile", { headers: auth });
      if (res.status === 401) { showGate(); return; }
      json = await res.json().catch(() => null);
    } catch (_) {
      showGate();
      return;
    }
    if (!json || !json.success || !json.data) { showGate(); return; }

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
      address: getVal("profile-address"),
      phone: getVal("profile-phone"),
    };
    if (!payload.firstName || !payload.lastName || !payload.email || !payload.address) {
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
    // Wait for auth.js to publish the session helpers.
    if (!window.getSession) {
      await new Promise((resolve) => {
        if (window.authReady) resolve();
        else window.addEventListener("authReady", resolve, { once: true });
      });
    }
    document.getElementById("profile-form")?.addEventListener("submit", saveProfile);
    wireOrderActions();
    await loadProfile();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
