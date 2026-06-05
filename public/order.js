// Order detail page. Reached two ways:
//   • owner   — /order.html?id=<orderId>  (uses the Supabase session token)
//   • guest   — after a Purchase-ID lookup, creds in sessionStorage 'pamca_order_lookup'
// Shows a full receipt, lets the shopper add items (capped to stock) and pay the
// difference via Square, and offers a full refund (through the shared confirm card).
(() => {
  const GUEST_KEY = "pamca_order_lookup";

  function money(cents) { return "$" + ((Number(cents) || 0) / 100).toFixed(2); }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function authHeader() {
    try {
      const s = window.getSession && window.getSession();
      return s && s.access_token ? { Authorization: "Bearer " + s.access_token } : null;
    } catch (_) { return null; }
  }

  // Resolve how we address this order for every request: owner (id + token) or
  // guest (purchaseId + phone from sessionStorage).
  function resolveContext() {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) {
      const headers = authHeader();
      if (headers) return { creds: { orderId: id }, headers };
    }
    try {
      const guest = JSON.parse(sessionStorage.getItem(GUEST_KEY) || "null");
      if (guest && guest.purchaseId && guest.phone) {
        return { creds: { purchaseId: guest.purchaseId, phone: guest.phone }, headers: {} };
      }
    } catch (_) {}
    return null;
  }

  let ctx = null;
  let order = null;
  let products = [];
  let additions = []; // { slug, name, variant, options[], qty }
  let previewTimer = null;

  function show(id, display) {
    const el = document.getElementById(id);
    if (el) el.style.display = display;
  }

  function setMsg(text, kind) {
    const box = document.getElementById("order-msg");
    if (!box) return;
    box.textContent = text || "";
    box.className = "order-msg" + (text ? " " + (kind || "error") : "");
  }

  // ---- Receipt ----
  function renderReceipt() {
    const host = document.getElementById("receipt-lines");
    const totals = document.getElementById("receipt-totals");
    if (!host || !order) return;

    host.innerHTML = (order.items || []).map((it) => {
      const variant = it.variation_label ? `<span class="receipt-variant"> — ${escapeHtml(it.variation_label)}</span>` : "";
      return `<div class="receipt-line">
        <div class="receipt-name">${escapeHtml(it.product_name)}${variant}
          <span class="receipt-qty">${Number(it.quantity) || 0} × ${money(it.unit_price_cents)}</span>
        </div>
        <div class="receipt-amount">${money(it.line_total_cents)}</div>
      </div>`;
    }).join("");

    const refunded = Number(order.amount_refunded_cents) || 0;
    let rows = `<div class="receipt-total-row grand"><span>Total paid</span><span>${money(order.total_cents)}</span></div>`;
    if (refunded > 0) {
      rows += `<div class="receipt-total-row refund"><span>Refunded</span><span>−${money(refunded)}</span></div>`;
    }
    totals.innerHTML = rows;
  }

  // ---- Stock resolution (mirrors the server: per-combination stock from variants) ----
  function availableStock(product, selectedValues) {
    const base = Math.max(0, Math.round(Number(product.stock) || 0));
    const groups = (product.option_groups || []).filter((g) => g.options && g.options.length);
    if (groups.length === 0) return base;

    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length) {
      const match = variants.find((v) => v.key === selectedValues.join(" / "));
      return match ? Math.max(0, Math.round(Number(match.stock) || 0)) : 0;
    }
    // Legacy fallback (product saved before per-combination stock): min option stock.
    const candidates = [];
    groups.forEach((g) => {
      const opt = g.options.find((o) => selectedValues.includes(o.value)) || g.options[0];
      if (opt && opt.stock != null) candidates.push(Math.max(0, Math.round(Number(opt.stock))));
    });
    return candidates.length ? Math.min.apply(null, candidates) : base;
  }

  function selectedAddValues() {
    return Array.from(document.querySelectorAll("#add-options select")).map((s) => s.value);
  }

  function currentAddProduct() {
    const sel = document.getElementById("add-product");
    return products.find((p) => p.slug === (sel && sel.value));
  }

  function renderAddOptions() {
    const host = document.getElementById("add-options");
    const product = currentAddProduct();
    if (!host) return;
    const groups = (product && product.option_groups ? product.option_groups : []).filter((g) => g.options && g.options.length);
    host.innerHTML = groups.map((g) => {
      const opts = g.options.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.value)}</option>`).join("");
      return `<div><label>${escapeHtml(g.label || "Option")}</label><select data-group-label="${escapeHtml(g.label || "Option")}">${opts}</select></div>`;
    }).join("");
    host.querySelectorAll("select").forEach((s) => s.addEventListener("change", syncStockCap));
    syncStockCap();
  }

  // Cap the quantity field to the available stock for the chosen product+options so
  // an over-stock add can't even be entered.
  function syncStockCap() {
    const product = currentAddProduct();
    const qty = document.getElementById("add-qty");
    const hint = document.getElementById("add-stockhint");
    const btn = document.getElementById("add-btn");
    if (!product || !qty) return;
    const stock = availableStock(product, selectedAddValues());
    qty.max = String(stock);
    qty.min = stock > 0 ? "1" : "0";
    if (stock <= 0) {
      qty.value = "0";
      qty.disabled = true;
      if (btn) btn.disabled = true;
      if (hint) hint.textContent = "Out of stock for this selection.";
    } else {
      qty.disabled = false;
      if (btn) btn.disabled = false;
      if (Number(qty.value) > stock) qty.value = String(stock);
      if (Number(qty.value) < 1) qty.value = "1";
      if (hint) hint.textContent = stock + " available";
    }
  }

  function renderProductPicker() {
    const sel = document.getElementById("add-product");
    if (!sel) return;
    sel.innerHTML = products.map((p) => `<option value="${escapeHtml(p.slug)}">${escapeHtml(p.name)}</option>`).join("");
    renderAddOptions();
  }

  function renderPendingAdds() {
    const host = document.getElementById("pending-adds");
    if (!host) return;
    host.innerHTML = additions.map((a, i) => {
      const variant = a.variant ? ` — ${escapeHtml(a.variant)}` : "";
      return `<li><span>+ ${a.qty} × ${escapeHtml(a.name)}${variant}</span><button type="button" class="pa-remove" data-i="${i}">Remove</button></li>`;
    }).join("");
  }

  function addCurrentSelection() {
    const product = currentAddProduct();
    const qtyEl = document.getElementById("add-qty");
    if (!product || !qtyEl) return;
    const stock = availableStock(product, selectedAddValues());
    const qty = Math.max(1, Math.min(stock, parseInt(qtyEl.value, 10) || 1));
    if (qty < 1) return;
    const options = Array.from(document.querySelectorAll("#add-options select")).map((s) => ({
      label: s.getAttribute("data-group-label"), value: s.value,
    }));
    const variant = options.map((o) => o.value).filter(Boolean).join(" / ");
    additions.push({ slug: product.slug, name: product.name, variant, options, qty });
    qtyEl.value = "1";
    renderPendingAdds();
    queuePreview();
  }

  function buildEditPayload() {
    return {
      existing: [], // current items are read-only; editing is add-only
      additions: additions.map((a) => ({ slug: a.slug, options: a.options, quantity: a.qty })),
    };
  }

  function queuePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(runPreview, 250);
  }

  async function runPreview() {
    const summary = document.getElementById("edit-summary");
    const confirm = document.getElementById("edit-confirm");
    if (additions.length === 0) {
      if (summary) summary.style.display = "none";
      if (confirm) confirm.style.display = "none";
      return;
    }
    try {
      const res = await fetch("/api/orders/edit/preview", {
        method: "POST",
        credentials: "same-origin",
        headers: Object.assign({ "Content-Type": "application/json" }, ctx.headers),
        body: JSON.stringify(Object.assign({}, ctx.creds, buildEditPayload())),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success || !json.data) {
        if (summary) { summary.textContent = (json && json.message) || "Could not price these changes."; summary.className = "edit-summary is-error"; summary.style.display = "block"; }
        if (confirm) confirm.style.display = "none";
        return;
      }
      const d = json.data;
      if (summary) {
        summary.className = "edit-summary";
        summary.textContent = `New total ${money(d.newTotalCents)} · you'll pay ${money(d.deltaCents)} more.`;
        summary.style.display = "block";
      }
      if (confirm) { confirm.textContent = `Confirm & pay ${money(d.deltaCents)}`; confirm.style.display = "block"; }
    } catch (_) {
      if (summary) { summary.textContent = "Could not price these changes."; summary.className = "edit-summary is-error"; summary.style.display = "block"; }
    }
  }

  async function confirmEdit() {
    if (additions.length === 0) return;
    const btn = document.getElementById("edit-confirm");
    const original = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Redirecting…"; }
    setMsg("");
    try {
      const res = await fetch("/api/orders/edit/commit", {
        method: "POST",
        credentials: "same-origin",
        headers: Object.assign({ "Content-Type": "application/json" }, ctx.headers),
        body: JSON.stringify(Object.assign({}, ctx.creds, buildEditPayload())),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success && json.data && json.data.url) {
        window.location.href = json.data.url; // pay the difference on Square
        return;
      }
      if (res.ok && json.success && json.data && json.data.applied) {
        setMsg("Your order has been updated.", "success");
        additions = [];
        await loadOrder();
        return;
      }
      setMsg((json && json.message) || "Could not apply your changes.");
    } catch (_) {
      setMsg("Could not apply your changes. Please try again.");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = original; }
    }
  }

  function openRefund() {
    if (typeof window.pamcaConfirmRefund !== "function") return;
    window.pamcaConfirmRefund({
      creds: ctx.creds,
      headers: ctx.headers,
      purchaseId: order.purchase_id,
      onDone: () => loadOrder(),
    });
  }

  // ---- State / render ----
  function applyState() {
    const editCard = document.getElementById("edit-card");
    const lockedCard = document.getElementById("locked-card");
    const refundCard = document.getElementById("refund-card");
    const lockedNote = document.getElementById("locked-note");

    if (order.editable) {
      if (editCard) editCard.style.display = "";
      if (lockedCard) lockedCard.style.display = "none";
    } else {
      if (editCard) editCard.style.display = "none";
      if (order.refundable) {
        if (lockedCard) lockedCard.style.display = "";
        if (lockedNote) {
          lockedNote.textContent =
            "This order has been packaged, so it can no longer be changed. You can still request a full refund within 48 hours of placing it.";
        }
      } else if (lockedCard) {
        lockedCard.style.display = "none";
      }
    }
    if (refundCard) refundCard.style.display = order.refundable ? "" : "none";
  }

  function renderOrder() {
    document.getElementById("order-pid").textContent = order.purchase_id ? "#" + order.purchase_id : "";
    const status = String(order.status || "pending").toLowerCase();
    const pill = document.getElementById("order-status");
    pill.textContent = status;
    pill.className = "status-pill " + status;
    const placed = order.created_at ? new Date(order.created_at).toLocaleString() : "";
    document.getElementById("order-date").textContent = placed ? "Placed " + placed : "";
    const completed = document.getElementById("order-completed");
    if (completed) completed.style.display = order.completed_at ? "" : "none";
    renderReceipt();
    applyState();
  }

  async function loadProducts() {
    if (products.length) return;
    try {
      const res = await fetch("/api/products", { credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      products = Array.isArray(json && json.data) ? json.data : [];
    } catch (_) { products = []; }
  }

  async function loadOrder() {
    const res = await fetch("/api/orders/get", {
      method: "POST",
      credentials: "same-origin",
      headers: Object.assign({ "Content-Type": "application/json" }, ctx.headers),
      body: JSON.stringify(ctx.creds),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success || !json.data || !json.data.order) {
      show("order-loading", "none");
      show("order-body", "none");
      const err = document.getElementById("order-error");
      if (err) { err.style.display = "block"; err.textContent = (json && json.message) || "We couldn't find this order."; }
      return;
    }
    order = json.data.order;
    show("order-loading", "none");
    show("order-body", "block");
    if (order.editable) await loadProducts();
    renderOrder();
    if (order.editable && products.length) renderProductPicker();
    renderPendingAdds();
  }

  function wire() {
    const back = document.getElementById("order-back");
    if (back) back.addEventListener("click", (e) => {
      e.preventDefault();
      if (history.length > 1) history.back();
      else window.location.href = "/profile.html";
    });

    document.getElementById("add-product")?.addEventListener("change", renderAddOptions);
    document.getElementById("add-qty")?.addEventListener("input", syncStockCap);
    document.getElementById("add-btn")?.addEventListener("click", addCurrentSelection);
    document.getElementById("edit-confirm")?.addEventListener("click", confirmEdit);
    document.getElementById("order-refund")?.addEventListener("click", openRefund);

    document.getElementById("pending-adds")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".pa-remove");
      if (!btn) return;
      const i = Number(btn.getAttribute("data-i"));
      if (i >= 0) { additions.splice(i, 1); renderPendingAdds(); queuePreview(); }
    });
  }

  async function init() {
    // Wait for auth.js so owner mode can read the session token.
    if (!window.getSession) {
      await new Promise((resolve) => {
        if (window.authReady) resolve();
        else window.addEventListener("authReady", resolve, { once: true });
      });
    }
    ctx = resolveContext();
    wire();
    if (!ctx) {
      show("order-loading", "none");
      const err = document.getElementById("order-error");
      if (err) {
        err.style.display = "block";
        err.innerHTML = 'We couldn\'t identify this order. <a href="/profile.html" style="color:#008080;font-weight:600;">Go to your profile</a> or look it up with your Purchase ID.';
      }
      return;
    }
    await loadOrder();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
