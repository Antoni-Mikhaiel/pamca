import {
  handleAddToCart,
  handleRemoveCartItem,
  handleUpdateCartItem,
  handleUpdateCartQty,
} from "../src/controllers/cartController";
import { parseBody, ApiRequest, ApiResponse } from "../src/lib/http";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, data: { message: "Method not allowed" } });
    return;
  }

  try {
    const body = await parseBody(req);
    const action = body.action ?? "";

    if (action === "pamca_add_to_cart") {
      await handleAddToCart({ ...req, body }, res);
      return;
    }

    if (action === "pamca_update_cart_qty") {
      await handleUpdateCartQty({ ...req, body }, res);
      return;
    }

    if (action === "update_cart_item") {
      await handleUpdateCartItem({ ...req, body }, res);
      return;
    }

    if (action === "pamca_remove_cart_item") {
      await handleRemoveCartItem({ ...req, body }, res);
      return;
    }

    res.status(400).json({ success: false, data: { message: "Unknown action" } });
  } catch (error) {
    res.status(500).json({
      success: false,
      data: { message: error instanceof Error ? error.message : "Internal error" },
    });
  }
}
