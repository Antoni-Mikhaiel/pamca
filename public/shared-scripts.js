(() => {
	const ajaxUrl = "/api/ajax";
	const API_HEADERS = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" };
	// Remembers the nav button state across page loads in this tab so it doesn't
	// flicker "Profile" → "Admin" while the async auth check runs.
	const AUTH_CACHE_KEY = "pamca_auth";

	function getCachedAuthState() {
		try { return JSON.parse(sessionStorage.getItem(AUTH_CACHE_KEY) || "null"); } catch (_) { return null; }
	}

	function applyNavAuthState(state) {
		const btn = document.getElementById("nav-login-btn");
		if (!btn) return;
		if (state && state.isAdmin) {
			btn.textContent = "Admin";
			btn.dataset.mode = "admin";
			btn.classList.add("logged-in");
		} else if (state && state.loggedIn) {
			btn.textContent = "Profile";
			btn.dataset.mode = "profile";
			btn.classList.add("logged-in");
		} else {
			btn.textContent = "Profile";
			btn.dataset.mode = "guest";
			btn.classList.remove("logged-in");
		}
	}

	async function loadPartial(selector, path) {
		const el = document.querySelector(selector);
		if (!el) return;
		const res = await fetch(path, { credentials: "same-origin" });
		if (!res.ok) return;
		el.innerHTML = await res.text();
	}

	function initNavbar() {
		const mobileMenu = document.getElementById("mobile-menu");
		const navMenu = document.getElementById("nav-menu");
		const navClose = document.getElementById("nav-close");
		const navCart = document.getElementById("nav-cart");
		const cartModal = document.getElementById("cart-modal");

		if (mobileMenu && navMenu) {
			mobileMenu.addEventListener("click", () => {
				mobileMenu.classList.toggle("active");
				navMenu.classList.toggle("active");
			});
		}

		if (navClose && navMenu && mobileMenu) {
			navClose.addEventListener("click", () => {
				mobileMenu.classList.remove("active");
				navMenu.classList.remove("active");
			});
		}

		if (navCart && cartModal) {
			navCart.addEventListener("click", () => {
				cartModal.classList.toggle("active");
			});
		}

		document.querySelectorAll("[data-close-cart='1']").forEach((btn) => {
			btn.addEventListener("click", () => {
				if (cartModal) cartModal.classList.remove("active");
			});
		});
	}

	async function postAjax(payload) {
		const body = new URLSearchParams(payload);
		const res = await fetch(ajaxUrl, {
			method: "POST",
			credentials: "same-origin",
			headers: API_HEADERS,
			body: body.toString(),
		});
		return res.json();
	}

	function applyCartData(data) {
		if (!data) return;
		const items = document.getElementById("cart-items");
		if (items && typeof data.html === "string") items.innerHTML = data.html;

		const badge = document.getElementById("cart-badge");
		if (badge) badge.textContent = String(data.count ?? 0);

		const total = document.querySelector(".cart-total-amount");
		if (total) total.innerHTML = data.total_html ?? "$0.00";
	}

	async function refreshCart() {
		const res = await fetch("/api/cart/get", { credentials: "same-origin" });
		if (!res.ok) return;
		const json = await res.json();
		if (!json?.success || !json.data) return;
		applyCartData(json.data);
	}

	function openCart() {
		const cartModal = document.getElementById("cart-modal");
		if (cartModal) cartModal.classList.add("active");
	}

	// Adds a product to the cart. `options` is an array of { label, value } for
	// the selected dropdown choices; the server recomputes the price. Returns true
	// on success and updates the mini-cart in place.
	async function addToCart({ slug, quantity, options }) {
		if (!slug) return false;
		const res = await postAjax({
			action: "pamca_add_to_cart",
			slug: slug,
			quantity: String(Math.max(1, parseInt(quantity, 10) || 1)),
			options: JSON.stringify(Array.isArray(options) ? options : []),
			security: "stateless",
		});
		if (res?.success && res.data) {
			applyCartData(res.data);
			return true;
		}
		return false;
	}

	function showCartNotice(text) {
		const content = document.querySelector("#cart-modal .cart-content");
		if (!content) { window.alert(text); return; }
		let notice = content.querySelector(".cart-notice");
		if (!notice) {
			notice = document.createElement("div");
			notice.className = "cart-notice";
			notice.style.cssText = "margin:12px 16px;padding:10px 12px;border-radius:8px;background:#f8d7da;color:#721c24;font-size:0.9rem;";
			const footer = content.querySelector(".cart-footer");
			content.insertBefore(notice, footer);
		}
		notice.textContent = text;
	}

	// Returns an { Authorization } header for the current session, or null when
	// the shopper isn't signed in.
	function getAuthHeader() {
		try {
			const s = window.getSession && window.getSession();
			return s && s.access_token ? { Authorization: "Bearer " + s.access_token } : null;
		} catch (_) {
			return null;
		}
	}

	function escapeHtml(value) {
		return String(value == null ? "" : value)
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#039;");
	}

	function fieldValue(id) {
		const el = document.getElementById(id);
		return el ? el.value.trim() : "";
	}
	function setFieldValue(id, value) {
		const el = document.getElementById(id);
		if (el) el.value = value == null ? "" : value;
	}

	function setCheckoutMessage(text, kind) {
		const box = document.getElementById("checkout-message");
		if (!box) return;
		box.textContent = text || "";
		box.className = "auth-message" + (text ? " " + (kind || "error") : "");
	}

	function closeCheckoutModal() {
		const modal = document.getElementById("checkout-modal");
		if (modal) modal.classList.remove("active");
	}

	// Pre-fills the checkout form from the signed-in shopper's saved profile and
	// reveals the "save details" toggle. For guests it just clears the toggle.
	async function prefillCheckoutFromProfile() {
		const saveRow = document.getElementById("checkout-save-row");
		const saveBox = document.getElementById("checkout-save");
		if (saveBox) saveBox.checked = false;
		const auth = getAuthHeader();
		if (!auth) {
			if (saveRow) saveRow.style.display = "none";
			return;
		}
		if (saveRow) saveRow.style.display = "flex";
		try {
			const res = await fetch("/api/profile", { headers: auth });
			if (!res.ok) return;
			const json = await res.json();
			const p = json && json.data && json.data.profile;
			if (!p) return;
			setFieldValue("checkout-first", p.firstName);
			setFieldValue("checkout-last", p.lastName);
			setFieldValue("checkout-email", p.email);
			setFieldValue("checkout-address", p.address);
			setFieldValue("checkout-phone", (p.phone || "").replace(/^\+1/, ""));
		} catch (_) {}
	}

	// Opens the delivery-details pop-up. The actual Square redirect happens when the
	// shopper submits the form (see submitCheckout).
	async function openCheckoutModal() {
		const modal = document.getElementById("checkout-modal");
		if (!modal) return;
		const cartModal = document.getElementById("cart-modal");
		if (cartModal) cartModal.classList.remove("active");
		// Make sure debounced quantity changes have reached the server before we
		// snapshot the cart for checkout.
		await flushPendingQty();
		setCheckoutMessage("");
		await prefillCheckoutFromProfile();
		modal.classList.add("active");
		const first = document.getElementById("checkout-first");
		if (first) first.focus();
	}

	// Validates the delivery details, asks the server to create a Square hosted
	// checkout for the current cart, and redirects there.
	async function submitCheckout(e) {
		e.preventDefault();
		const submit = document.getElementById("checkout-submit");
		const payload = {
			firstName: fieldValue("checkout-first"),
			lastName: fieldValue("checkout-last"),
			email: fieldValue("checkout-email"),
			address: fieldValue("checkout-address"),
			phone: fieldValue("checkout-phone"),
		};
		if (!payload.firstName || !payload.lastName || !payload.email || !payload.address) {
			setCheckoutMessage("Please fill in every field.");
			return;
		}
		if (payload.phone.replace(/\D/g, "").length !== 10) {
			setCheckoutMessage("Enter a valid 10-digit Canadian phone number.");
			return;
		}

		const auth = getAuthHeader();
		const saveBox = document.getElementById("checkout-save");
		if (auth && saveBox && saveBox.checked) payload.saveProfile = true;

		const original = submit ? submit.textContent : "";
		if (submit) { submit.disabled = true; submit.textContent = "Redirecting…"; }
		setCheckoutMessage("");
		try {
			const res = await fetch("/api/checkout/create", {
				method: "POST",
				credentials: "same-origin",
				headers: Object.assign({ "Content-Type": "application/json" }, auth || {}),
				body: JSON.stringify(payload),
			});
			const json = await res.json().catch(() => ({}));
			if (res.ok && json?.success && json.data?.url) {
				window.location.href = json.data.url;
				return;
			}
			setCheckoutMessage((json && json.message) || "Checkout is unavailable right now. Please try again.");
		} catch (_) {
			setCheckoutMessage("Checkout is unavailable right now. Please try again.");
		} finally {
			if (submit) { submit.disabled = false; submit.textContent = original; }
		}
	}

	function wireCheckoutModal() {
		const form = document.getElementById("checkout-form");
		if (form) form.addEventListener("submit", submitCheckout);
		document.querySelectorAll("[data-close-checkout='1']").forEach((el) => {
			el.addEventListener("click", closeCheckoutModal);
		});
	}

	// ---- Order edit / refund -------------------------------------------------
	// Drives the #order-modal for both signed-in owners (acts with the order id +
	// auth token) and guests (acts with Purchase ID + phone). The net price change
	// is computed authoritatively by the server's preview endpoint.
	let orderModalState = null; // { order, ctx, existing[], additions[], previewTimer }
	let productsCatalog = null;

	async function loadProductsCatalog() {
		if (productsCatalog) return productsCatalog;
		try {
			const res = await fetch("/api/products", { credentials: "same-origin" });
			const json = await res.json().catch(() => ({}));
			productsCatalog = Array.isArray(json && json.data) ? json.data : [];
		} catch (_) {
			productsCatalog = [];
		}
		return productsCatalog;
	}

	function omMoney(cents) { return formatMoney((Number(cents) || 0) / 100); }

	function omSetMessage(text, kind) {
		const box = document.getElementById("order-modal-message");
		if (!box) return;
		box.textContent = text || "";
		box.className = "auth-message" + (text ? " " + (kind || "error") : "");
	}

	function closeOrderModal() {
		const modal = document.getElementById("order-modal");
		if (modal) modal.classList.remove("active");
		orderModalState = null;
	}

	// Credentials the order endpoints expect: owner sends orderId + auth header;
	// guest sends purchaseId + phone.
	function orderRequestCreds() {
		const ctx = orderModalState.ctx;
		if (ctx.purchaseId) return { creds: { purchaseId: ctx.purchaseId, phone: ctx.phone }, headers: {} };
		return { creds: { orderId: ctx.orderId }, headers: getAuthHeader() || {} };
	}

	function buildEditPayload() {
		const st = orderModalState;
		const existing = st.existing
			.filter((e) => e.qty !== e.originalQty)
			.map((e) => ({ orderItemId: e.id, quantity: e.qty }));
		const additions = st.additions.map((a) => ({ slug: a.slug, options: a.options, quantity: a.qty }));
		return { existing, additions };
	}

	function omPopulateProductPicker() {
		const sel = document.getElementById("order-add-product");
		if (!sel) return;
		sel.innerHTML = (productsCatalog || [])
			.map((p) => `<option value="${escapeHtml(p.slug)}">${escapeHtml(p.name)}</option>`)
			.join("");
		omRenderOptionSelects();
	}

	function omRenderOptionSelects() {
		const host = document.getElementById("order-add-options");
		const sel = document.getElementById("order-add-product");
		if (!host || !sel) return;
		const product = (productsCatalog || []).find((p) => p.slug === sel.value);
		const groups = (product && Array.isArray(product.option_groups)) ? product.option_groups : [];
		host.innerHTML = groups
			.filter((g) => g.options && g.options.length)
			.map((g) => {
				const opts = g.options.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.value)}</option>`).join("");
				return `<label class="om-opt"><span>${escapeHtml(g.label || "Option")}</span><select data-group-label="${escapeHtml(g.label || "Option")}">${opts}</select></label>`;
			})
			.join("");
	}

	function omAddProduct() {
		const sel = document.getElementById("order-add-product");
		const qtyEl = document.getElementById("order-add-qty");
		if (!sel || !orderModalState) return;
		const product = (productsCatalog || []).find((p) => p.slug === sel.value);
		if (!product) return;
		const qty = Math.max(1, parseInt(qtyEl && qtyEl.value, 10) || 1);
		const options = Array.from(document.querySelectorAll("#order-add-options select")).map((s) => ({
			label: s.getAttribute("data-group-label"),
			value: s.value,
		}));
		const variant = options.map((o) => o.value).filter(Boolean).join(" / ");
		orderModalState.additions.push({ slug: product.slug, name: product.name, options, variant, qty });
		if (qtyEl) qtyEl.value = "1";
		omRenderItems();
		omQueuePreview();
	}

	function omRenderItems() {
		const host = document.getElementById("order-modal-items");
		if (!host || !orderModalState) return;
		const st = orderModalState;

		const existingRows = st.existing.map((e, i) => {
			const variant = e.variant ? `<span class="order-line-variant"> — ${escapeHtml(e.variant)}</span>` : "";
			return `<div class="om-row" data-kind="existing" data-i="${i}">
				<div class="om-row-name">${escapeHtml(e.name)}${variant}<span class="om-row-unit">${omMoney(e.unitCents)} each</span></div>
				<div class="om-stepper">
					<button type="button" class="om-step" data-step="-1" aria-label="Decrease">−</button>
					<span class="om-qty">${e.qty}</span>
					<button type="button" class="om-step" data-step="1" aria-label="Increase">+</button>
				</div>
			</div>`;
		}).join("");

		const addRows = st.additions.map((a, i) => {
			const variant = a.variant ? `<span class="order-line-variant"> — ${escapeHtml(a.variant)}</span>` : "";
			return `<div class="om-row om-row-add" data-kind="add" data-i="${i}">
				<div class="om-row-name">+ ${escapeHtml(a.name)}${variant}<span class="om-row-unit">adding ${a.qty} · current price</span></div>
				<button type="button" class="om-remove-add">Remove</button>
			</div>`;
		}).join("");

		host.innerHTML = `<div class="om-section-label">Current items</div>${existingRows}` + (addRows ? `<div class="om-section-label">Adding</div>${addRows}` : "");
	}

	function omQueuePreview() {
		const st = orderModalState;
		if (!st) return;
		if (st.previewTimer) clearTimeout(st.previewTimer);
		st.previewTimer = setTimeout(omPreview, 250);
	}

	async function omPreview() {
		if (!orderModalState) return;
		const payload = buildEditPayload();
		const summary = document.getElementById("order-modal-summary");
		if (payload.existing.length === 0 && payload.additions.length === 0) {
			if (summary) summary.textContent = "No changes yet.";
			return;
		}
		const { creds, headers } = orderRequestCreds();
		try {
			const res = await fetch("/api/orders/edit/preview", {
				method: "POST",
				credentials: "same-origin",
				headers: Object.assign({ "Content-Type": "application/json" }, headers),
				body: JSON.stringify(Object.assign({}, creds, payload)),
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok || !json.success || !json.data) {
				if (summary) { summary.textContent = (json && json.message) || "Could not price these changes."; summary.className = "om-summary is-error"; }
				return;
			}
			const d = json.data;
			let text;
			if (d.deltaCents > 0) text = `New total ${omMoney(d.newTotalCents)} · you'll pay ${omMoney(d.deltaCents)} more at checkout.`;
			else if (d.deltaCents < 0) text = `New total ${omMoney(d.newTotalCents)} · you'll be refunded ${omMoney(-d.deltaCents)}.`;
			else text = `New total ${omMoney(d.newTotalCents)} · no change to pay.`;
			if (summary) { summary.textContent = text; summary.className = "om-summary"; }
		} catch (_) {
			if (summary) { summary.textContent = "Could not price these changes."; summary.className = "om-summary is-error"; }
		}
	}

	async function omConfirm() {
		if (!orderModalState) return;
		const payload = buildEditPayload();
		if (payload.existing.length === 0 && payload.additions.length === 0) {
			omSetMessage("Make a change first.");
			return;
		}
		const { creds, headers } = orderRequestCreds();
		const onChanged = orderModalState.ctx.onChanged;
		const btn = document.getElementById("order-confirm-btn");
		const original = btn ? btn.textContent : "";
		if (btn) { btn.disabled = true; btn.textContent = "Working…"; }
		omSetMessage("");
		try {
			const res = await fetch("/api/orders/edit/commit", {
				method: "POST",
				credentials: "same-origin",
				headers: Object.assign({ "Content-Type": "application/json" }, headers),
				body: JSON.stringify(Object.assign({}, creds, payload)),
			});
			const json = await res.json().catch(() => ({}));
			if (res.ok && json.success && json.data) {
				if (json.data.url) { window.location.href = json.data.url; return; }
				const refunded = Number(json.data.refundedCents) || 0;
				omSetMessage(refunded > 0 ? `Done — ${omMoney(refunded)} refunded to your card.` : "Your order has been updated.", "success");
				setTimeout(() => { closeOrderModal(); if (typeof onChanged === "function") onChanged(); }, 1100);
				return;
			}
			omSetMessage((json && json.message) || "Could not apply changes.");
		} catch (_) {
			omSetMessage("Could not apply changes. Please try again.");
		} finally {
			if (btn) { btn.disabled = false; btn.textContent = original; }
		}
	}

	async function omRefund() {
		if (!orderModalState) return;
		if (!window.confirm("Refund this entire order back to your card? This cannot be undone.")) return;
		const { creds, headers } = orderRequestCreds();
		const onChanged = orderModalState.ctx.onChanged;
		const btn = document.getElementById("order-refund-btn");
		const original = btn ? btn.textContent : "";
		if (btn) { btn.disabled = true; btn.textContent = "Refunding…"; }
		omSetMessage("");
		try {
			const res = await fetch("/api/orders/refund", {
				method: "POST",
				credentials: "same-origin",
				headers: Object.assign({ "Content-Type": "application/json" }, headers),
				body: JSON.stringify(creds),
			});
			const json = await res.json().catch(() => ({}));
			if (res.ok && json.success && json.data) {
				omSetMessage(`Refunded ${omMoney(json.data.refundedCents)} to your card.`, "success");
				setTimeout(() => { closeOrderModal(); if (typeof onChanged === "function") onChanged(); }, 1300);
				return;
			}
			omSetMessage((json && json.message) || "Could not refund this order.");
		} catch (_) {
			omSetMessage("Could not refund this order. Please try again.");
		} finally {
			if (btn) { btn.disabled = false; btn.textContent = original; }
		}
	}

	// Opens the edit/refund modal. ctx is either { orderId, onChanged } (owner) or
	// { purchaseId, phone, onChanged } (guest).
	async function openOrderActions(order, ctx) {
		const modal = document.getElementById("order-modal");
		if (!modal || !order) return;
		orderModalState = {
			order,
			ctx: ctx || {},
			existing: (order.items || [])
				.filter((it) => it.id)
				.map((it) => ({
					id: it.id,
					name: it.product_name,
					variant: it.variation_label || "",
					unitCents: it.unit_price_cents,
					originalQty: it.quantity,
					qty: it.quantity,
				})),
			additions: [],
			previewTimer: null,
		};
		await loadProductsCatalog();
		omPopulateProductPicker();
		const pidEl = document.getElementById("order-modal-pid");
		if (pidEl) pidEl.textContent = order.purchase_id ? "#" + order.purchase_id : "";
		const refundBtn = document.getElementById("order-refund-btn");
		if (refundBtn) refundBtn.style.display = order.refundable ? "" : "none";
		omSetMessage("");
		const summary = document.getElementById("order-modal-summary");
		if (summary) { summary.textContent = "No changes yet."; summary.className = "om-summary"; }
		omRenderItems();
		modal.classList.add("active");
	}

	function wireOrderModal() {
		document.querySelectorAll("[data-close-order='1']").forEach((el) => el.addEventListener("click", closeOrderModal));
		const picker = document.getElementById("order-add-product");
		if (picker) picker.addEventListener("change", omRenderOptionSelects);
		const addBtn = document.getElementById("order-add-btn");
		if (addBtn) addBtn.addEventListener("click", omAddProduct);
		const confirmBtn = document.getElementById("order-confirm-btn");
		if (confirmBtn) confirmBtn.addEventListener("click", omConfirm);
		const refundBtn = document.getElementById("order-refund-btn");
		if (refundBtn) refundBtn.addEventListener("click", omRefund);

		const items = document.getElementById("order-modal-items");
		if (items) items.addEventListener("click", (e) => {
			if (!orderModalState) return;
			const step = e.target.closest(".om-step");
			if (step) {
				const row = step.closest(".om-row[data-kind='existing']");
				const idx = Number(row && row.getAttribute("data-i"));
				const entry = orderModalState.existing[idx];
				if (!entry) return;
				const delta = Number(step.getAttribute("data-step")) || 0;
				entry.qty = Math.max(0, Math.min(entry.originalQty, entry.qty + delta));
				omRenderItems();
				omQueuePreview();
				return;
			}
			const removeAdd = e.target.closest(".om-remove-add");
			if (removeAdd) {
				const row = removeAdd.closest(".om-row[data-kind='add']");
				const idx = Number(row && row.getAttribute("data-i"));
				if (idx >= 0) orderModalState.additions.splice(idx, 1);
				omRenderItems();
				omQueuePreview();
			}
		});
	}

	// Renders an order summary card (shared by the profile page and guest lookup).
	// Edit/Refund buttons appear only when the server says the order still qualifies.
	function renderOrderCard(order) {
		if (!order) return "";
		const money = (cents) => formatMoney((Number(cents) || 0) / 100);
		const status = String(order.status || "pending").toLowerCase();
		const created = order.created_at ? new Date(order.created_at).toLocaleDateString() : "";
		const lines = (order.items || [])
			.map((it) => {
				const variant = it.variation_label
					? `<span class="order-line-variant"> — ${escapeHtml(it.variation_label)}</span>`
					: "";
				return `<li><span class="order-line-name">${Number(it.quantity) || 0} × ${escapeHtml(it.product_name)}${variant}</span><span>${money(it.line_total_cents)}</span></li>`;
			})
			.join("");
		const refunded = Number(order.amount_refunded_cents) > 0
			? `<div class="order-refunded">${money(order.amount_refunded_cents)} refunded</div>`
			: "";
		const actions = [];
		if (order.editable) actions.push(`<button type="button" class="order-edit-btn" data-order-id="${escapeHtml(order.id)}">Edit order</button>`);
		if (order.refundable) actions.push(`<button type="button" class="order-refund-btn" data-order-id="${escapeHtml(order.id)}">Refund</button>`);
		const actionsHtml = actions.length ? `<div class="order-actions-row">${actions.join("")}</div>` : "";
		return `
			<div class="order-card" data-order-id="${escapeHtml(order.id)}">
				<div class="order-card-head">
					<span class="order-pid">#${escapeHtml(order.purchase_id || "")}</span>
					<span class="order-status order-status-${escapeHtml(status)}">${escapeHtml(status)}</span>
				</div>
				<div class="order-meta">${escapeHtml(created)} · Total ${money(order.total_cents)}</div>
				${refunded}
				<ul class="order-lines">${lines}</ul>
				${actionsHtml}
			</div>`;
	}

	// One-time banner shown when Square returns the shopper after payment. When a
	// Purchase ID is present we surface it so guests can save it to track the order.
	function maybeShowOrderStatus() {
		const params = new URLSearchParams(window.location.search);
		const order = params.get("order");
		if (order !== "success" && order !== "edit-success") return;
		const pid = (params.get("pid") || "").trim();
		let text;
		if (order === "edit-success") {
			text = pid
				? `Thank you! Your additional payment was received and order ${pid} has been updated.`
				: "Thank you! Your additional payment was received and your order has been updated.";
		} else {
			text = pid
				? `Thank you! Your payment was received. Your Purchase ID is ${pid} — keep it to track your order.`
				: "Thank you! Your payment was received and your order is confirmed.";
		}
		const bar = document.createElement("div");
		bar.textContent = text;
		bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#d4edda;color:#155724;padding:14px;text-align:center;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.15);";
		document.body.appendChild(bar);
		setTimeout(() => bar.remove(), pid ? 12000 : 6000);
	}

	// --- Quantity updates: optimistic UI + debounced, serialized server sync ---
	// Spam-clicking +/- must not fire a request (and full re-render) per click —
	// that races the responses, so an earlier (lower) value can land after a later
	// one and the number jumps around. Instead we update the cart locally on every
	// click and sync only the *final* value per item once clicking pauses, with at
	// most one request in flight per item so responses can't arrive out of order.
	const qtyUpdates = {}; // cart_item_key -> { desired, timer, inflight }

	function formatMoney(n) {
		return "$" + (Number(n) || 0).toFixed(2);
	}

	function recomputeCartLocally() {
		let count = 0;
		let total = 0;
		document.querySelectorAll("#cart-items .cart-item").forEach((row) => {
			const unit = parseFloat(row.getAttribute("data-unit-price")) || 0;
			const input = row.querySelector("[data-qty-input], input.qty, input[type='number']");
			const qty = Math.max(1, parseInt(input && input.value, 10) || 1);
			const sub = unit * qty;
			count += qty;
			total += sub;
			const subEl = row.querySelector(".cart-item-subtotal");
			if (subEl) subEl.textContent = " · " + formatMoney(sub);
		});
		const badge = document.getElementById("cart-badge");
		if (badge) badge.textContent = String(count);
		const totalEl = document.querySelector(".cart-total-amount");
		if (totalEl) totalEl.innerHTML = formatMoney(total);
	}

	function queueQtyUpdate(key, quantity) {
		let st = qtyUpdates[key];
		if (!st) st = qtyUpdates[key] = { desired: quantity, timer: null, inflight: false };
		st.desired = quantity;
		if (st.timer) clearTimeout(st.timer);
		st.timer = setTimeout(() => { st.timer = null; flushQtyUpdate(key); }, 350);
	}

	async function flushQtyUpdate(key) {
		const st = qtyUpdates[key];
		if (!st) return;
		if (st.timer) { clearTimeout(st.timer); st.timer = null; }
		if (st.inflight) return; // a request is already running; it re-checks on completion

		st.inflight = true;
		const sent = st.desired;
		let data = null;
		try {
			const res = await postAjax({
				action: "pamca_update_cart_qty",
				cart_item_key: key,
				quantity: String(sent),
				security: "stateless",
			});
			if (res?.success && res.data) data = res.data;
		} catch (_) {}
		st.inflight = false;

		// The value changed while the request was in flight — send the latest and
		// don't paint the now-stale response.
		if (st.desired !== sent) { flushQtyUpdate(key); return; }

		// Settled: repaint the authoritative server state once (this also reflects
		// any stock clamping the server applied) and warn if we hit the stock cap.
		if (data) {
			applyCartData(data);
			if (data.clamped) showStockNotice(data.available);
		}
		delete qtyUpdates[key];
	}

	// Amber "alarm" shown in the cart when a quantity was reduced to the available
	// stock. Lives inside .cart-content (a sibling of #cart-items) so it survives
	// the cart repaint, and auto-dismisses.
	function showStockNotice(available) {
		const content = document.querySelector("#cart-modal .cart-content");
		if (!content) return;

		let notice = content.querySelector(".cart-stock-notice");
		if (!notice) {
			notice = document.createElement("div");
			notice.className = "cart-stock-notice";
			notice.setAttribute("role", "alert");
			const footer = content.querySelector(".cart-footer");
			content.insertBefore(notice, footer);
		}

		const n = Number(available);
		notice.textContent = !Number.isFinite(n)
			? "Quantity adjusted to the maximum available."
			: n <= 0
				? "Sorry — this item is now out of stock."
				: "Only " + n + " in stock — quantity set to the maximum available.";

		// Replay the shake each time so repeated bumps re-alarm.
		notice.classList.remove("is-flash");
		void notice.offsetWidth;
		notice.classList.add("is-flash");

		clearTimeout(notice._dismiss);
		notice._dismiss = setTimeout(() => { if (notice) notice.remove(); }, 4500);
	}

	// Force-syncs any pending quantity changes and resolves once they have all
	// settled (used before checkout). Bails out after ~5s so it can never hang.
	async function flushPendingQty() {
		Object.keys(qtyUpdates).forEach((key) => flushQtyUpdate(key));
		for (let i = 0; i < 100 && Object.keys(qtyUpdates).length; i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}

	function wireCartInteractions() {
		document.addEventListener("click", async (e) => {
			const checkout = e.target.closest("#checkout-btn, .checkout-btn");
			if (checkout) {
				e.preventDefault();
				openCheckoutModal();
				return;
			}

			const remove = e.target.closest("a.remove-item, a[href*='remove_item=']");
			if (remove) {
				e.preventDefault();
				const key = remove.getAttribute("data-cart-item-key") || "";
				if (!key) return;

				const res = await postAjax({
					action: "pamca_remove_cart_item",
					cart_item_key: key,
					security: "stateless",
				});

				if (res?.success) {
					await refreshCart();
				}
				return;
			}

			const qtyBtn = e.target.closest("[data-action='qty-change']");
			if (!qtyBtn) return;

			e.preventDefault();
			const row = qtyBtn.closest("[data-cart-item-key]");
			const key = row?.getAttribute("data-cart-item-key") || qtyBtn.getAttribute("data-key") || "";
			const input = row?.querySelector("[data-qty-input], input.qty, input[type='number']");
			const current = Number.parseInt(input?.value || "1", 10) || 1;
			const delta = Number.parseInt(qtyBtn.getAttribute("data-delta") || "0", 10);
			const quantity = Math.max(1, current + delta);

			if (input) input.value = String(quantity);
			if (!key) return;

			recomputeCartLocally();        // instant local feedback
			queueQtyUpdate(key, quantity); // debounced + serialized server sync
		});

		// Typing directly into a cart quantity field goes through the same
		// debounced/serialized sync path.
		document.addEventListener("change", (e) => {
			const input = e.target.closest("[data-qty-input], input.qty");
			if (!input || !input.closest("#cart-items")) return;
			const row = input.closest("[data-cart-item-key]");
			const key = row?.getAttribute("data-cart-item-key") || input.getAttribute("data-cart-item-key") || "";
			let quantity = Number.parseInt(input.value, 10);
			if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;
			input.value = String(quantity);
			if (!key) return;

			recomputeCartLocally();
			queueQtyUpdate(key, quantity);
		});
	}

	const PRODUCTS_CACHE_KEY = "pamca_cache_products";

	function renderProducts(grid, products) {
		if (!Array.isArray(products)) return;
		grid.innerHTML = products
			.map((p) => {
				const regular = Number(p.price_regular || 0);
				const sale = p.price_sale == null ? null : Number(p.price_sale);
				const saleMarkup = p.is_on_sale && sale != null
					? `<div class="sale-price"><div class="sale-price-horizontal"><div class="original-price">$${regular.toFixed(2)}</div><div class="current-price">$${sale.toFixed(2)}</div></div></div>`
					: `<div class="price">$${regular.toFixed(2)}</div>`;
				// Link to the generic product page by slug. Using a query param (rather
				// than a pretty URL) means it works identically on the local dev server
				// and on Vercel with no rewrite config to keep in sync.
				const href = `/product.html?slug=${encodeURIComponent(p.slug || "")}`;

				// No entrance animation here on purpose — these cards are injected
				// dynamically, and animating them caused a late "pop"/jiggle.
				return `<div class="product-card${p.is_on_sale ? " on-sale-special" : ""}" onclick="window.location.href='${href}'" style="cursor: pointer;">${p.is_on_sale ? '<div class="sale-badge">Sale</div>' : ""}<div class="product-image">${p.image_url ? `<img src="${p.image_url}" alt="${p.name}">` : ""}</div><div class="product-content"><h3 class="product-name">${p.name}</h3><div class="product-price">${saleMarkup}</div></div></div>`;
			})
			.join("");
	}

	async function hydrateProductsPage() {
		const grid = document.querySelector(".products-grid");
		if (!grid) return;

		// 1) Paint instantly from the last-known list so there is no late "pop".
		try {
			const cached = JSON.parse(localStorage.getItem(PRODUCTS_CACHE_KEY) || "null");
			if (Array.isArray(cached) && cached.length) renderProducts(grid, cached);
		} catch (_) {}

		// 2) Revalidate from the API and refresh the cache.
		try {
			const response = await fetch("/api/products", { credentials: "same-origin" });
			if (!response.ok) return;
			const payload = await response.json();
			const products = payload?.data;
			if (Array.isArray(products)) {
				renderProducts(grid, products);
				try { localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(products)); } catch (_) {}
			}
		} catch (_) {}
	}

	async function hydrateProductDetails() {
		const map = {
			"/gel-dispenser.html": "gel-dispenser",
			"/thermometer-dual.html": "thermometer-dual",
			"/thermometer-mono.html": "thermometer-mono",
		};

		const slug = map[window.location.pathname];
		if (!slug) return;

		const response = await fetch(`/api/products/${slug}`, { credentials: "same-origin" });
		if (!response.ok) return;

		const payload = await response.json();
		const product = payload?.data;
		if (!product) return;

		const priceEl = document.getElementById("product-price");
		if (priceEl) {
			const value = product.price_sale != null ? product.price_sale : product.price_regular;
			priceEl.innerHTML = `$${Number(value).toFixed(2)}`;
		}

		const select = document.getElementById("style");
		const variationId = document.getElementById("variation_id");
		if (select && Array.isArray(product.variations) && product.variations.length > 0) {
			select.innerHTML = product.variations
				.map((v) => `<option value="${v.value}" data-id="${v.id}" data-price="$${Number((v.price_sale ?? v.price_regular)).toFixed(2)}">${v.label}</option>`)
				.join("");

			select.addEventListener("change", () => {
				const selected = select.options[select.selectedIndex];
				if (variationId) variationId.value = selected.getAttribute("data-id") || "";
				if (priceEl) priceEl.innerHTML = selected.getAttribute("data-price") || "$0.00";
			});

			select.dispatchEvent(new Event("change"));
		}

		// Wire the legacy WooCommerce-style "Add to Cart" form on these static
		// product pages to the real cart endpoint (it previously posted nowhere).
		const form = document.querySelector("form.cart");
		if (form) {
			form.addEventListener("submit", async (e) => {
				e.preventDefault();
				const qtyInput = form.querySelector("input.qty, #quantity, input[name='quantity']");
				const quantity = Math.max(1, parseInt(qtyInput && qtyInput.value, 10) || 1);
				const options = [];
				if (select && select.value) {
					const selected = select.options[select.selectedIndex];
					options.push({ label: "Option", value: (selected && selected.text) || select.value });
				}
				const btn = form.querySelector("button[type='submit'], .single_add_to_cart_button");
				if (btn) btn.disabled = true;
				try {
					const ok = await addToCart({ slug, quantity, options });
					if (ok) openCart();
				} finally {
					if (btn) btn.disabled = false;
				}
			});
		}
	}

	function wireContactForm() {
		const form = document.getElementById("contactForm");
		if (!form) return;

		form.setAttribute("action", "/api/contact/submit");
		form.setAttribute("method", "post");

		const status = new URLSearchParams(window.location.search).get("status");
		if (!status) return;

		const box = document.createElement("div");
		box.style.padding = "12px";
		box.style.borderRadius = "6px";
		box.style.marginBottom = "20px";

		if (status === "success") {
			box.style.background = "#d4edda";
			box.style.color = "#155724";
			box.style.border = "1px solid #c3e6cb";
			box.textContent = "Thank you, your message has been sent successfully!";
		} else {
			box.style.background = "#f8d7da";
			box.style.color = "#721c24";
			box.style.border = "1px solid #f5c6cb";
			box.textContent = "Sorry, something went wrong. Please try again.";
		}

		const host = form.closest(".contact-form");
		if (host) host.insertBefore(box, host.firstChild.nextSibling);
	}

	async function initAuthModal() {
		const authModal = document.getElementById("auth-modal");
		const authOverlay = document.querySelector(".auth-overlay");
		const authClose = document.getElementById("auth-close");
		const navLoginBtn = document.getElementById("nav-login-btn");
		const authTabs = document.querySelectorAll(".auth-tab");
		const authForms = document.querySelectorAll(".auth-form");
		const loginForm = document.getElementById("login-form");
		const signupForm = document.getElementById("signup-form");

		if (!authModal) return;

		window.togglePasswordVisibility = function(toggle) {
			const button = toggle?.closest ? toggle.closest(".password-toggle") : toggle;
			if (!button) return;

			const targetId = button.dataset.target;
			const passwordInput = document.getElementById(targetId);
			if (!passwordInput) return;

			const reveal = passwordInput.type === "password";
			passwordInput.type = reveal ? "text" : "password";
			button.classList.toggle("is-revealed", reveal);
			button.setAttribute("aria-pressed", String(reveal));
			button.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
		};

		// Wait for auth to be ready
		if (!window.signUp || !window.signIn || !window.getCurrentUser) {
			await new Promise(resolve => {
				if (window.authReady) {
					resolve();
				} else {
					window.addEventListener('authReady', resolve, { once: true });
				}
			});
		}

		// Open modal (or, when signed in, go straight to the admin console / profile)
		navLoginBtn?.addEventListener("click", (event) => {
			if (navLoginBtn.dataset.mode === "admin") {
				event.preventDefault();
				window.location.href = "/admin.html";
				return;
			}
			if (navLoginBtn.dataset.mode === "profile") {
				event.preventDefault();
				window.location.href = "/profile.html";
				return;
			}
			authModal.classList.add("active");
		});

		// Close modal (and always reset back to the login view)
		const closeModal = () => { authModal.classList.remove("active"); showPurchaseView(false); };
		authClose?.addEventListener("click", closeModal);
		authOverlay?.addEventListener("click", closeModal);

		// Tab switching
		authTabs.forEach(tab => {
			tab.addEventListener("click", () => {
				const tabName = tab.dataset.tab;
				authTabs.forEach(t => t.classList.remove("active"));
				authForms.forEach(f => f.classList.remove("active"));
				tab.classList.add("active");
				document.getElementById(`${tabName}-form`).classList.add("active");
			});
		});

		// Purchase ID flow — the "Purchase ID" link swaps the login card for a
		// dedicated entry card; Back returns to login.
		const loginView = document.getElementById("auth-login-view");
		const purchaseView = document.getElementById("auth-purchase-view");
		function showPurchaseView(show) {
			if (loginView) loginView.style.display = show ? "none" : "";
			if (purchaseView) purchaseView.style.display = show ? "block" : "none";
		}
		document.getElementById("open-purchase-id")?.addEventListener("click", (e) => {
			e.preventDefault();
			showPurchaseView(true);
			document.getElementById("purchase-id-input")?.focus();
		});
		document.getElementById("auth-purchase-back")?.addEventListener("click", () => {
			showPurchaseView(false);
			const result = document.getElementById("purchase-id-result");
			if (result) { result.style.display = "none"; result.innerHTML = ""; }
		});
		// Looks up an order by Purchase ID + phone, renders it, and remembers the
		// credentials so the edit/refund actions (and post-action refresh) can reuse them.
		let lastLookup = null;
		async function runPurchaseLookup(purchaseId, phone) {
			const message = document.getElementById("purchase-id-message");
			const result = document.getElementById("purchase-id-result");
			const setMsg = (text, kind) => {
				if (message) { message.textContent = text || ""; message.className = "auth-message" + (text ? " " + (kind || "error") : ""); }
			};
			setMsg("Looking up your order…", "success");
			try {
				const res = await fetch("/api/orders/lookup", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ purchaseId, phone }),
				});
				const json = await res.json().catch(() => ({}));
				if (res.ok && json?.success && json.data?.order) {
					setMsg("");
					lastLookup = { purchaseId, phone };
					if (result) {
						result.innerHTML = renderOrderCard(json.data.order);
						result.dataset.order = JSON.stringify(json.data.order);
						result.style.display = "block";
					}
					return;
				}
				setMsg((json && json.message) || "No order matches that Purchase ID and phone number.");
			} catch (_) {
				setMsg("Something went wrong. Please try again.");
			}
		}

		document.getElementById("purchase-id-form")?.addEventListener("submit", (e) => {
			e.preventDefault();
			const purchaseId = (document.getElementById("purchase-id-input")?.value || "").trim();
			const phone = (document.getElementById("purchase-phone-input")?.value || "").trim();
			const result = document.getElementById("purchase-id-result");
			if (result) { result.style.display = "none"; result.innerHTML = ""; }
			if (!/^\d{6}$/.test(purchaseId) || phone.replace(/\D/g, "").length !== 10) {
				const message = document.getElementById("purchase-id-message");
				if (message) { message.textContent = "Enter your 6-digit Purchase ID and the phone number on the order."; message.className = "auth-message error"; }
				return;
			}
			runPurchaseLookup(purchaseId, phone);
		});

		// Edit / refund actions on a guest-looked-up order act with the Purchase ID + phone.
		document.getElementById("purchase-id-result")?.addEventListener("click", (e) => {
			const btn = e.target.closest(".order-edit-btn, .order-refund-btn");
			if (!btn || !lastLookup || typeof window.pamcaOpenOrderActions !== "function") return;
			const result = document.getElementById("purchase-id-result");
			let order = null;
			try { order = JSON.parse(result.dataset.order || "null"); } catch (_) {}
			if (!order) return;
			window.pamcaOpenOrderActions(order, {
				purchaseId: lastLookup.purchaseId,
				phone: lastLookup.phone,
				onChanged: () => runPurchaseLookup(lastLookup.purchaseId, lastLookup.phone),
			});
		});

		const togglePasswordVisibility = (toggle) => {
			const targetId = toggle.dataset.target;
			const passwordInput = document.getElementById(targetId);
			if (!passwordInput) return;

			const reveal = passwordInput.type === "password";
			passwordInput.type = reveal ? "text" : "password";
			toggle.classList.toggle("is-revealed", reveal);
			toggle.setAttribute("aria-pressed", String(reveal));
			toggle.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
		};

		authModal.addEventListener("click", (event) => {
			const toggle = event.target.closest?.(".password-toggle");
			if (!toggle || !authModal.contains(toggle)) return;

			event.preventDefault();
			togglePasswordVisibility(toggle);
		});

		// Login form
		loginForm?.addEventListener("submit", async (e) => {
			e.preventDefault();
			const email = document.getElementById("login-email").value;
			const password = document.getElementById("login-password").value;
			const message = document.getElementById("login-message");

			try {
				const result = await window.signIn(email, password);
				if (result.error) {
					message.textContent = result.error.message;
					message.className = "auth-message error";
				} else {
					const goAdmin = await isAdminUser();
					try { sessionStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({ loggedIn: true, isAdmin: goAdmin })); } catch (_) {}
					message.textContent = goAdmin ? "Welcome back, admin — redirecting…" : "Login successful!";
					message.className = "auth-message success";
					setTimeout(() => {
						closeModal();
						if (goAdmin) {
							window.location.href = "/admin.html";
						} else {
							updateAuthUI();
							location.reload();
						}
					}, 900);
				}
			} catch (err) {
				message.textContent = err.message;
				message.className = "auth-message error";
			}
		});

		// Signup form
		signupForm?.addEventListener("submit", async (e) => {
			e.preventDefault();
			const email = document.getElementById("signup-email").value;
			const password = document.getElementById("signup-password").value;
			const confirm = document.getElementById("signup-confirm").value;
			const message = document.getElementById("signup-message");
			const passwordRules = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;

			if (password !== confirm) {
				message.textContent = "Passwords do not match";
				message.className = "auth-message error";
				return;
			}

			if (!passwordRules.test(password)) {
				message.textContent = "Use at least 8 characters with uppercase, lowercase, number, and symbol.";
				message.className = "auth-message error";
				return;
			}

			try {
				const result = await window.signUp(email, password);
				if (result.error) {
					message.textContent = result.error.message;
					message.className = "auth-message error";
				} else {
					message.textContent = "Account created — you're signed in!";
					message.className = "auth-message success";
					setTimeout(() => {
						closeModal();
						loginForm.reset();
						signupForm.reset();
						updateAuthUI();
						location.reload();
					}, 1000);
				}
			} catch (err) {
				message.textContent = err.message;
				message.className = "auth-message error";
			}
		});

		// Live password criteria checklist on the signup form
		const signupPassword = document.getElementById("signup-password");
		const signupCriteria = document.getElementById("signup-criteria");
		if (signupPassword && signupCriteria) {
			const updateCriteria = () => {
				const v = signupPassword.value;
				const checks = {
					len: v.length >= 8,
					lower: /[a-z]/.test(v),
					upper: /[A-Z]/.test(v),
					num: /[0-9]/.test(v),
					sym: /[^A-Za-z0-9]/.test(v),
				};
				signupCriteria.querySelectorAll("[data-rule]").forEach((li) => {
					li.classList.toggle("met", !!checks[li.dataset.rule]);
				});
			};
			signupPassword.addEventListener("input", updateCriteria);
			updateCriteria();
		}

		// Check current auth state
		await updateAuthUI();
	}

	async function isAdminUser() {
		try {
			const session = window.getSession && window.getSession();
			if (!session || !session.access_token) return false;
			const res = await fetch("/api/admin/session", {
				headers: { Authorization: "Bearer " + session.access_token },
			});
			if (!res.ok) return false;
			const json = await res.json();
			return !!(json && json.data && json.data.isAdmin);
		} catch (e) {
			return false;
		}
	}

	async function updateAuthUI() {
		// Wait for auth to be ready
		if (!window.getCurrentUser) {
			await new Promise(resolve => {
				if (window.authReady) {
					resolve();
				} else {
					window.addEventListener('authReady', resolve, { once: true });
				}
			});
		}

		const navLoginBtn = document.getElementById("nav-login-btn");
		const navActions = document.querySelector(".nav-actions");
		const user = await window.getCurrentUser();

		if (user && navLoginBtn) {
			const admin = await isAdminUser();
			const state = { loggedIn: true, isAdmin: admin };
			applyNavAuthState(state);
			try { sessionStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(state)); } catch (_) {}
		} else if (navLoginBtn) {
			applyNavAuthState(null);
			try { sessionStorage.removeItem(AUTH_CACHE_KEY); } catch (_) {}
		}
	}

	async function bootstrap() {
		// Guard against this script being included more than once on a page — a
		// second run would attach duplicate listeners (e.g. the cart toggle would
		// open then immediately close again).
		if (window.__pamcaBootstrapped) return;
		window.__pamcaBootstrapped = true;

		// Kick off product data immediately (in parallel with header/footer/cart) so it
		// is ready as early as possible instead of waiting on those network round-trips.
		const productsReady = hydrateProductsPage();
		const detailsReady = hydrateProductDetails();

		await loadPartial("#header-placeholder", "/partials/header.html");
		// Set the nav button from the cached auth state immediately (before paint) so
		// it doesn't flash "Profile" before the async check resolves to "Admin".
		applyNavAuthState(getCachedAuthState());
		await loadPartial("#footer-placeholder", "/partials/footer.html");
		// Keep the footer copyright year current without a yearly code change.
		const footerYear = document.getElementById("footer-year");
		if (footerYear) footerYear.textContent = String(new Date().getFullYear());
		initNavbar();
		wireCartInteractions();
		wireCheckoutModal();
		wireOrderModal();
		maybeShowOrderStatus();
		await refreshCart();
		wireContactForm();
		await initAuthModal();
		window.pamca_ajax_url = ajaxUrl;
		// Expose cart helpers for product pages that render their own markup.
		window.pamcaAddToCart = addToCart;
		window.pamcaOpenCart = openCart;
		window.pamcaRefreshCart = refreshCart;
		// Shared helpers reused by the profile page (profile.js).
		window.pamcaRenderOrderCard = renderOrderCard;
		window.pamcaGetAuthHeader = getAuthHeader;
		window.pamcaOpenOrderActions = openOrderActions;

		await Promise.allSettled([productsReady, detailsReady]);
	}

	document.addEventListener("DOMContentLoaded", bootstrap);
})();
