import { CartItem } from "../models/types";
import { toCurrency } from "./http";

// Renders the inner markup of the cart drawer (#cart-items). Class names match
// the cart styles in public/shared-styles.css, and the data-* hooks match the
// click handlers in public/shared-scripts.js (qty-change buttons + remove link).
export function buildMiniCartHtml(items: CartItem[]): string {
  if (items.length === 0) {
    return '<p class="empty-cart">No products in the cart.</p>';
  }

  return items
    .map((item) => {
      const key = escapeHtml(item.id);
      const subtotal = item.unit_price * item.quantity;

      const image = item.image_url
        ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.product_name)}" />`
        : '<span class="cart-item-emoji" aria-hidden="true">📦</span>';

      const variation = item.variation_label
        ? `<div class="cart-item-variant">${escapeHtml(item.variation_label)}</div>`
        : "";

      return `
      <div class="cart-item" data-cart-item-key="${key}" data-unit-price="${item.unit_price}">
        <div class="cart-item-image">${image}</div>
        <div class="cart-item-details">
          <div class="cart-item-name">${escapeHtml(item.product_name)}</div>
          ${variation}
          <div class="cart-item-price">${toCurrency(item.unit_price)}<span class="cart-item-subtotal"> · ${toCurrency(subtotal)}</span></div>
          <div class="cart-item-controls">
            <div class="quantity-control">
              <button type="button" class="quantity-btn" data-action="qty-change" data-delta="-1" data-key="${key}" aria-label="Decrease quantity">&minus;</button>
              <input type="number" class="qty quantity-display" value="${item.quantity}" min="1" data-qty-input data-cart-item-key="${key}" data-key="${key}" aria-label="Quantity" />
              <button type="button" class="quantity-btn" data-action="qty-change" data-delta="1" data-key="${key}" aria-label="Increase quantity">+</button>
            </div>
            <a href="#" class="remove-item" data-cart-item-key="${key}">Remove</a>
          </div>
        </div>
      </div>`;
    })
    .join("\n");
}

export function computeCartTotals(items: CartItem[]): { count: number; total: number } {
  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  const total = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  return { count, total };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
