import { ensureCartToken, parseBody, ApiRequest, ApiResponse, toCurrency } from "../lib/http";
import { buildMiniCartHtml, computeCartTotals } from "../lib/miniCartHtml";
import { addToCart, getCartItems, removeCartItem, updateCartQuantity, SelectedOption } from "../services/cartService";

export async function handleAddToCart(req: ApiRequest, res: ApiResponse): Promise<void> {
  const body = await parseBody(req);
  const cartToken = ensureCartToken(req, res);

  const slug = (body.slug ?? "").trim();
  const quantity = Number.parseInt(body.quantity ?? "1", 10);
  if (!slug || Number.isNaN(quantity) || quantity < 1) {
    res.status(400).json({ success: false, data: { message: "Invalid input" } });
    return;
  }

  let selectedOptions: SelectedOption[] = [];
  if (body.options) {
    try {
      const parsed = JSON.parse(body.options);
      if (Array.isArray(parsed)) {
        selectedOptions = parsed
          .map((o) => ({ label: String(o?.label ?? ""), value: String(o?.value ?? "") }))
          .filter((o) => o.value);
      }
    } catch {
      // Malformed options payload — fall back to no options (base price).
    }
  }

  const result = await addToCart({ cartToken, slug, selectedOptions, quantity });
  if (!result.ok) {
    const message =
      result.reason === "sold_out"
        ? "This product is sold out."
        : result.reason === "not_found"
          ? "Product not found."
          : "Could not add to cart.";
    res.status(400).json({ success: false, data: { message } });
    return;
  }

  const items = await getCartItems(cartToken);
  const totals = computeCartTotals(items);

  res.status(200).json({
    success: true,
    data: {
      html: buildMiniCartHtml(items),
      count: totals.count,
      total_html: toCurrency(totals.total),
    },
  });
}

export async function handleUpdateCartQty(req: ApiRequest, res: ApiResponse): Promise<void> {
  const body = await parseBody(req);
  const cartToken = ensureCartToken(req, res);

  const cartItemKey = body.cart_item_key ?? "";
  const quantity = Number.parseInt(body.quantity ?? "0", 10);

  if (!cartItemKey || Number.isNaN(quantity) || quantity < 0) {
    res.status(400).json({ success: false, data: { message: "Invalid input" } });
    return;
  }

  const result = await updateCartQuantity({ cartToken, itemId: cartItemKey, quantity });

  const items = await getCartItems(cartToken);
  const html = buildMiniCartHtml(items);
  const totals = computeCartTotals(items);

  res.status(200).json({
    success: true,
    data: {
      html,
      count: totals.count,
      total_html: toCurrency(totals.total),
      clamped: result.clamped,
      available: result.stock,
    },
  });
}

export async function handleUpdateCartItem(req: ApiRequest, res: ApiResponse): Promise<void> {
  const body = await parseBody(req);
  const cartToken = ensureCartToken(req, res);

  const cartItemKey = body.cart_item_key ?? "";
  const quantity = Number.parseInt(body.quantity ?? "0", 10);

  if (!cartItemKey || Number.isNaN(quantity) || quantity < 1) {
    res.status(400).json({ success: false, data: { message: "Missing data", debug: body } });
    return;
  }

  await updateCartQuantity({ cartToken, itemId: cartItemKey, quantity });

  const items = await getCartItems(cartToken);
  const html = buildMiniCartHtml(items);
  const totals = computeCartTotals(items);

  res.status(200).json({
    success: true,
    data: {
      fragments: {
        "#cart-items": html,
        "#cart-badge": `<span class=\"cart-badge\" id=\"cart-badge\">${totals.count}</span>`,
      },
    },
  });
}

export async function handleRemoveCartItem(req: ApiRequest, res: ApiResponse): Promise<void> {
  const body = await parseBody(req);
  const cartToken = ensureCartToken(req, res);

  const cartItemKey = body.cart_item_key ?? "";
  if (!cartItemKey) {
    res.status(400).json({ success: false, data: "missing_cart_item_key" });
    return;
  }

  const removed = await removeCartItem(cartToken, cartItemKey);
  if (!removed) {
    res.status(400).json({ success: false, data: "remove_failed" });
    return;
  }

  const items = await getCartItems(cartToken);
  const html = buildMiniCartHtml(items);
  const totals = computeCartTotals(items);

  res.status(200).json({
    success: true,
    data: {
      html,
      count: totals.count,
      total_html: toCurrency(totals.total),
    },
  });
}

export async function handleGetCart(req: ApiRequest, res: ApiResponse): Promise<void> {
  const cartToken = ensureCartToken(req, res);
  const items = await getCartItems(cartToken);
  const html = buildMiniCartHtml(items);
  const totals = computeCartTotals(items);

  res.status(200).json({
    success: true,
    data: {
      html,
      count: totals.count,
      total_html: toCurrency(totals.total),
      items,
    },
  });
}
