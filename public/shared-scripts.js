(() => {
	const ajaxUrl = "/api/ajax";
	const API_HEADERS = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" };
	// Remembers the nav button state across page loads (and tabs) so it doesn't
	// flicker "Profile" → "Admin" while the async auth check runs. Uses localStorage
	// so a freshly opened tab reflects the logged-in state immediately.
	const AUTH_CACHE_KEY = "pamca_auth";

	function getCachedAuthState() {
		try {
			return JSON.parse(
				localStorage.getItem(AUTH_CACHE_KEY) || sessionStorage.getItem(AUTH_CACHE_KEY) || "null",
			);
		} catch (_) { return null; }
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

	// Last HST rate the server reported, kept so the optimistic quantity-change
	// recompute (recomputeCartLocally) can re-derive the tax before the next sync.
	let cartHstPercent = 13;

	function applyCartData(data) {
		if (!data) return;
		const items = document.getElementById("cart-items");
		if (items && typeof data.html === "string") items.innerHTML = data.html;

		const badge = document.getElementById("cart-badge");
		if (badge) badge.textContent = String(data.count ?? 0);

		if (data.hst_percent != null) {
			cartHstPercent = Number(data.hst_percent) || 0;
			const rate = document.querySelector(".cart-hst-rate");
			if (rate) rate.textContent = String(data.hst_percent);
		}

		const subtotal = document.querySelector(".cart-subtotal-amount");
		if (subtotal && data.subtotal_html != null) subtotal.innerHTML = data.subtotal_html;
		const tax = document.querySelector(".cart-tax-amount");
		if (tax && data.tax_html != null) tax.innerHTML = data.tax_html;
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
			setFieldValue("checkout-street-number", p.streetNumber);
			setFieldValue("checkout-street-name", p.streetName);
			setFieldValue("checkout-province", p.province);
			setFieldValue("checkout-postal-code", p.postalCode);
			setFieldValue("checkout-phone", (p.phone || "").replace(/^\+1/, ""));
			// Reformat/resync the prefilled values so they display formatted, and the
			// custom province dropdown reflects the chosen province.
			attachPhoneFormatter(document.getElementById("checkout-phone"));
			attachPostalFormatter(document.getElementById("checkout-postal-code"));
			document.getElementById("checkout-province")?.dispatchEvent(new Event("change"));
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
			streetNumber: fieldValue("checkout-street-number"),
			streetName: fieldValue("checkout-street-name"),
			province: fieldValue("checkout-province"),
			postalCode: fieldValue("checkout-postal-code"),
			phone: fieldValue("checkout-phone"),
		};
		if (!payload.firstName || !payload.lastName || !payload.email || !payload.streetNumber || !payload.streetName || !payload.province || !payload.postalCode) {
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

	// ---- Live phone formatting -----------------------------------------------
	// Formats a phone field as (XXX) XXX-XXXX while typing. Purely cosmetic — the
	// server strips non-digits, so the stored value is unaffected. Exposed so pages
	// with their own phone inputs (profile) can opt in.
	function formatPhoneValue(raw) {
		const d = String(raw || "").replace(/\D/g, "").slice(0, 10);
		if (d.length === 0) return "";
		if (d.length < 4) return "(" + d;
		if (d.length < 7) return "(" + d.slice(0, 3) + ") " + d.slice(3);
		return "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
	}

	function attachPhoneFormatter(input) {
		if (!input) return;
		// Always (re)format the current value — this is what makes a *prefilled* value
		// (profile/checkout prefill) display formatted, not just live typing. The input
		// listener is wired only once so re-calling this is safe.
		input.value = formatPhoneValue(input.value);
		if (input._phoneFormatted) return;
		input._phoneFormatted = true;
		input.addEventListener("input", () => { input.value = formatPhoneValue(input.value); });
	}

	// ---- Live Canadian postal-code formatting --------------------------------
	// Upper-cases and inserts the space so the field always reads "A1A 1A1" while
	// typing. Cosmetic only (the value is validated server-side); keeps at most
	// 6 alphanumerics. Exposed for pages with their own postal inputs (profile).
	function formatPostalValue(raw) {
		const s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
		return s.length > 3 ? s.slice(0, 3) + " " + s.slice(3) : s;
	}

	function attachPostalFormatter(input) {
		if (!input) return;
		input.value = formatPostalValue(input.value); // (re)format prefilled value too
		if (input._postalFormatted) return;
		input._postalFormatted = true;
		input.addEventListener("input", () => { input.value = formatPostalValue(input.value); });
	}

	// ---- Custom styled dropdown ----------------------------------------------
	// Native <select> option lists can't be styled, so we build a custom menu that
	// mirrors the real <select> (which stays in the DOM, hidden, to carry the value
	// and submit with the form). Progressive enhancement: until this runs, the native
	// select is fully usable. Re-syncs when the underlying select fires "change", so
	// programmatic prefill (profile/checkout) updates the visible label too.
	function enhanceSelect(select) {
		if (!select || select._enhanced) return;
		select._enhanced = true;

		const wrap = document.createElement("div");
		wrap.className = "c-select";

		const trigger = document.createElement("button");
		trigger.type = "button";
		trigger.className = "c-select-trigger";
		trigger.setAttribute("aria-haspopup", "listbox");
		trigger.setAttribute("aria-expanded", "false");
		const valueEl = document.createElement("span");
		valueEl.className = "c-select-value";
		trigger.appendChild(valueEl);
		trigger.insertAdjacentHTML(
			"beforeend",
			'<svg class="c-select-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>',
		);

		const menu = document.createElement("ul");
		menu.className = "c-select-menu";
		menu.setAttribute("role", "listbox");

		Array.from(select.options).forEach((opt) => {
			const li = document.createElement("li");
			li.className = "c-select-option" + (opt.value === "" ? " is-placeholder" : "");
			li.setAttribute("role", "option");
			li.dataset.value = opt.value;
			li.textContent = opt.textContent;
			li.addEventListener("click", () => {
				select.value = opt.value;
				select.dispatchEvent(new Event("change", { bubbles: true }));
				close();
				trigger.focus();
			});
			menu.appendChild(li);
		});

		function syncFromSelect() {
			const sel = select.options[select.selectedIndex] || select.options[0];
			const isPlaceholder = !sel || sel.value === "";
			valueEl.textContent = sel ? sel.textContent : "";
			wrap.classList.toggle("is-placeholder", isPlaceholder);
			menu.querySelectorAll(".c-select-option").forEach((li) => {
				const on = li.dataset.value === select.value;
				li.classList.toggle("is-selected", on);
				li.setAttribute("aria-selected", on ? "true" : "false");
			});
		}

		function open() {
			wrap.classList.add("is-open");
			trigger.setAttribute("aria-expanded", "true");
			const sel = menu.querySelector(".c-select-option.is-selected");
			if (sel) sel.scrollIntoView({ block: "nearest" });
			document.addEventListener("click", onDocClick, true);
			document.addEventListener("keydown", onKey, true);
		}
		function close() {
			wrap.classList.remove("is-open");
			trigger.setAttribute("aria-expanded", "false");
			document.removeEventListener("click", onDocClick, true);
			document.removeEventListener("keydown", onKey, true);
		}
		function onDocClick(e) { if (!wrap.contains(e.target)) close(); }
		function onKey(e) {
			const opts = Array.from(menu.querySelectorAll(".c-select-option"));
			const cur = opts.findIndex((li) => li.dataset.value === select.value);
			if (e.key === "Escape") { close(); trigger.focus(); }
			else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				const next = e.key === "ArrowDown" ? Math.min(opts.length - 1, cur + 1) : Math.max(0, cur - 1);
				const li = opts[next];
				if (li) { select.value = li.dataset.value; syncFromSelect(); li.scrollIntoView({ block: "nearest" }); }
			} else if (e.key === "Enter" || e.key === " ") {
				e.preventDefault(); close(); trigger.focus();
			}
		}

		trigger.addEventListener("click", (e) => {
			e.preventDefault();
			wrap.classList.contains("is-open") ? close() : open();
		});
		select.addEventListener("change", syncFromSelect);

		select.parentNode.insertBefore(wrap, select.nextSibling);
		wrap.appendChild(trigger);
		wrap.appendChild(menu);
		select.classList.add("c-select-native"); // visually hide the native control
		syncFromSelect();
	}

	// ---- Refund confirmation card --------------------------------------------
	// Shared by the profile order list and the order detail page. `opts`:
	//   { creds, headers, purchaseId?, onDone? }
	// creds/headers address the order (owner: {orderId}+Bearer; guest: {purchaseId,phone}).
	let refundCtx = null;

	function closeRefundModal() {
		const modal = document.getElementById("refund-modal");
		if (modal) modal.classList.remove("active");
		refundCtx = null;
	}

	function openRefundConfirm(opts) {
		const modal = document.getElementById("refund-modal");
		if (!modal || !opts) return;
		refundCtx = opts;
		const sub = document.getElementById("refund-modal-sub");
		if (sub) {
			sub.textContent = opts.purchaseId
				? `This refunds order #${opts.purchaseId} in full back to your card and cancels it. This can't be undone.`
				: "This refunds the full amount back to your card and cancels the order. This can't be undone.";
		}
		const msg = document.getElementById("refund-modal-message");
		if (msg) { msg.textContent = ""; msg.className = "auth-message"; }
		const btn = document.getElementById("refund-confirm-btn");
		if (btn) { btn.disabled = false; btn.textContent = "Yes, refund my order"; }
		modal.classList.add("active");
	}

	async function performRefund() {
		if (!refundCtx) return;
		const btn = document.getElementById("refund-confirm-btn");
		const msg = document.getElementById("refund-modal-message");
		const setMsg = (t, kind) => { if (msg) { msg.textContent = t || ""; msg.className = "auth-message" + (t ? " " + (kind || "error") : ""); } };
		if (btn) { btn.disabled = true; btn.textContent = "Refunding…"; }
		setMsg("");
		try {
			const res = await fetch("/api/orders/refund", {
				method: "POST",
				credentials: "same-origin",
				headers: Object.assign({ "Content-Type": "application/json" }, refundCtx.headers || {}),
				body: JSON.stringify(refundCtx.creds || {}),
			});
			const json = await res.json().catch(() => ({}));
			if (res.ok && json.success && json.data) {
				const cents = Number(json.data.refundedCents) || 0;
				setMsg(`Refunded ${formatMoney(cents / 100)} to your card.`, "success");
				const onDone = refundCtx.onDone;
				setTimeout(() => { closeRefundModal(); if (typeof onDone === "function") onDone(); }, 1300);
				return;
			}
			setMsg((json && json.message) || "Could not refund this order.");
			if (btn) { btn.disabled = false; btn.textContent = "Yes, refund my order"; }
		} catch (_) {
			setMsg("Could not refund this order. Please try again.");
			if (btn) { btn.disabled = false; btn.textContent = "Yes, refund my order"; }
		}
	}

	function wireRefundModal() {
		document.querySelectorAll("[data-close-refund='1']").forEach((el) => el.addEventListener("click", closeRefundModal));
		const btn = document.getElementById("refund-confirm-btn");
		if (btn) btn.addEventListener("click", performRefund);
		// Format the +1 phone fields that live in the injected header (checkout +
		// guest lookup). Page-local fields opt in via window.pamcaFormatPhone.
		["checkout-phone", "purchase-phone-input"].forEach((id) => attachPhoneFormatter(document.getElementById(id)));
		// Auto-format the checkout postal code (A1A 1A1). Profile opts in itself.
		attachPostalFormatter(document.getElementById("checkout-postal-code"));
		// Replace the native province <select> with the styled custom dropdown.
		enhanceSelect(document.getElementById("checkout-province"));
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
		// Tax breakdown row (only for orders that actually carry HST; older pre-tax
		// orders have tax_cents = 0 and just show their single total).
		const taxRow = Number(order.tax_cents) > 0
			? `<div class="order-tax-row"><span>HST (${Number(order.hst_percent) || 0}%)</span><span>${money(order.tax_cents)}</span></div>`
			: "";
		const completedPill = order.completed_at
			? `<span class="order-status order-status-completed">completed</span>`
			: "";
		const actions = [];
		if (order.editable) actions.push(`<button type="button" class="order-edit-btn" data-order-id="${escapeHtml(order.id)}">Edit order</button>`);
		if (order.refundable) actions.push(`<button type="button" class="order-refund-btn" data-order-id="${escapeHtml(order.id)}">Refund</button>`);
		const actionsHtml = actions.length ? `<div class="order-actions-row">${actions.join("")}</div>` : "";
		return `
			<div class="order-card" data-order-id="${escapeHtml(order.id)}">
				<div class="order-card-head">
					<span class="order-pid">#${escapeHtml(order.purchase_id || "")}</span>
					<span class="order-card-pills">${completedPill}<span class="order-status order-status-${escapeHtml(status)}">${escapeHtml(status)}</span></span>
				</div>
				<div class="order-meta">${escapeHtml(created)} · Total ${money(order.total_cents)}</div>
				${refunded}
				<ul class="order-lines">${lines}</ul>
					${taxRow}
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
		let subtotal = 0;
		document.querySelectorAll("#cart-items .cart-item").forEach((row) => {
			const unit = parseFloat(row.getAttribute("data-unit-price")) || 0;
			const input = row.querySelector("[data-qty-input], input.qty, input[type='number']");
			const qty = Math.max(1, parseInt(input && input.value, 10) || 1);
			const sub = unit * qty;
			count += qty;
			subtotal += sub;
			const subEl = row.querySelector(".cart-item-subtotal");
			if (subEl) subEl.textContent = " · " + formatMoney(sub);
		});
		// Mirror the server's cents-based tax rounding so the optimistic total matches
		// the next /api/cart response (and what Square will charge).
		const subtotalCents = Math.round(subtotal * 100);
		const taxCents = Math.round((subtotalCents * (Number(cartHstPercent) || 0)) / 100);
		const badge = document.getElementById("cart-badge");
		if (badge) badge.textContent = String(count);
		const subtotalEl = document.querySelector(".cart-subtotal-amount");
		if (subtotalEl) subtotalEl.innerHTML = formatMoney(subtotalCents / 100);
		const taxEl = document.querySelector(".cart-tax-amount");
		if (taxEl) taxEl.innerHTML = formatMoney(taxCents / 100);
		const totalEl = document.querySelector(".cart-total-amount");
		if (totalEl) totalEl.innerHTML = formatMoney((subtotalCents + taxCents) / 100);
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
		// Verifies the Purchase ID + phone, then hands off to the dedicated order page
		// (the creds are stashed in sessionStorage so they never travel in the URL).
		async function runPurchaseLookup(purchaseId, phone) {
			const message = document.getElementById("purchase-id-message");
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
					try { sessionStorage.setItem("pamca_order_lookup", JSON.stringify({ purchaseId, phone })); } catch (_) {}
					window.location.href = "/order.html";
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
			if (!/^\d{6}$/.test(purchaseId) || phone.replace(/\D/g, "").length !== 10) {
				const message = document.getElementById("purchase-id-message");
				if (message) { message.textContent = "Enter your 6-digit Purchase ID and the phone number on the order."; message.className = "auth-message error"; }
				return;
			}
			runPurchaseLookup(purchaseId, phone);
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
					try { localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({ loggedIn: true, isAdmin: goAdmin })); } catch (_) {}
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
			try { localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(state)); } catch (_) {}
		} else if (navLoginBtn) {
			applyNavAuthState(null);
			try { localStorage.removeItem(AUTH_CACHE_KEY); } catch (_) {}
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
		wireRefundModal();
		maybeShowOrderStatus();
		await refreshCart();
		wireContactForm();
		await initAuthModal();
		window.pamca_ajax_url = ajaxUrl;
		// Expose cart helpers for product pages that render their own markup.
		window.pamcaAddToCart = addToCart;
		window.pamcaOpenCart = openCart;
		window.pamcaRefreshCart = refreshCart;
		// Shared helpers reused by the profile and order pages.
		window.pamcaRenderOrderCard = renderOrderCard;
		window.pamcaGetAuthHeader = getAuthHeader;
		window.pamcaConfirmRefund = openRefundConfirm;
		window.pamcaFormatPhone = attachPhoneFormatter;
		window.pamcaFormatPostal = attachPostalFormatter;
		window.pamcaEnhanceSelect = enhanceSelect;

		await Promise.allSettled([productsReady, detailsReady]);
	}

	document.addEventListener("DOMContentLoaded", bootstrap);
})();
