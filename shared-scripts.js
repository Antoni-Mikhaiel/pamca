(() => {
	const ajaxUrl = "/api/ajax";
	const API_HEADERS = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" };

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

	async function refreshCart() {
		const res = await fetch("/api/cart/get", { credentials: "same-origin" });
		if (!res.ok) return;
		const json = await res.json();
		if (!json?.success || !json.data) return;

		const items = document.getElementById("cart-items");
		if (items && json.data.html) items.innerHTML = json.data.html;

		const badge = document.getElementById("cart-badge");
		if (badge) badge.textContent = String(json.data.count ?? 0);

		const total = document.querySelector(".cart-total-amount");
		if (total) total.innerHTML = json.data.total_html ?? "$0.00";
	}

	function wireCartInteractions() {
		document.addEventListener("click", async (e) => {
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
			const current = Number.parseInt(input?.value || "1", 10);
			const delta = Number.parseInt(qtyBtn.getAttribute("data-delta") || "0", 10);
			const quantity = Math.max(1, current + delta);

			if (input) input.value = String(quantity);

			if (!key) return;

			const res = await postAjax({
				action: "pamca_update_cart_qty",
				cart_item_key: key,
				quantity: String(quantity),
				security: "stateless",
			});

			if (res?.success) {
				await refreshCart();
			}
		});
	}

	async function hydrateProductsPage() {
		const grid = document.querySelector(".products-grid");
		if (!grid) return;

		const response = await fetch("/api/products", { credentials: "same-origin" });
		if (!response.ok) return;

		const payload = await response.json();
		const products = payload?.data;
		if (!Array.isArray(products)) return;

		grid.innerHTML = products
			.map((p) => {
				const regular = Number(p.price_regular || 0);
				const sale = p.price_sale == null ? null : Number(p.price_sale);
				const saleMarkup = p.is_on_sale && sale != null
					? `<div class="sale-price"><div class="sale-price-horizontal"><div class="original-price">$${regular.toFixed(2)}</div><div class="current-price">$${sale.toFixed(2)}</div></div></div>`
					: `<div class="price">$${regular.toFixed(2)}</div>`;

				return `<div class="product-card animate-on-scroll${p.is_on_sale ? " on-sale-special" : ""}" onclick="window.location.href='/${p.redirect_path}'" style="cursor: pointer;">${p.is_on_sale ? '<div class="sale-badge">Sale</div>' : ""}<div class="product-image">${p.image_url ? `<img src="${p.image_url}" alt="${p.name}">` : ""}</div><div class="product-content"><h3 class="product-name">${p.name}</h3><div class="product-price">${saleMarkup}</div></div></div>`;
			})
			.join("");
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

	async function bootstrap() {
		await loadPartial("#header-placeholder", "/partials/header.html");
		await loadPartial("#footer-placeholder", "/partials/footer.html");
		initNavbar();
		wireCartInteractions();
		await refreshCart();
		await hydrateProductsPage();
		await hydrateProductDetails();
		wireContactForm();
		window.pamca_ajax_url = ajaxUrl;
	}

	document.addEventListener("DOMContentLoaded", bootstrap);
})();
