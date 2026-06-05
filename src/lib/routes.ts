import { ApiRequest, ApiResponse, parseBody } from "./http.js";
import {
  handleAddToCart,
  handleGetCart,
  handleRemoveCartItem,
  handleUpdateCartItem,
  handleUpdateCartQty,
} from "../controllers/cartController.js";
import { handleGetProduct, handleListProducts } from "../controllers/productController.js";
import { handleContactSubmit } from "../controllers/contactController.js";
import { handleSignup } from "../controllers/authController.js";
import { handleGetContent, handleSaveContent } from "../controllers/contentController.js";
import { handleSession, handleUpload } from "../controllers/adminController.js";
import {
  handleAdminListProducts,
  handleDeleteProduct,
  handleSaveProduct,
} from "../controllers/adminProductController.js";
import { handleCreateCheckout, handleWebhook } from "../controllers/checkoutController.js";
import { handleGetProfile, handleUpdateProfile, handleLookupOrder } from "../controllers/profileController.js";
import { handleAdminListOrders, handleAdminFlagOrder, handleAdminCompleteOrder } from "../controllers/adminOrderController.js";
import { handleGetOrder, handleEditPreview, handleEditCommit, handleRefundOrder } from "../controllers/orderEditController.js";

/**
 * Single source of truth for API routing, shared by the Vercel catch-all
 * function (`api/[...path].ts`) and the local dev server (`scripts/dev-server.ts`).
 * Adding or renaming a route is now a one-file change here.
 *
 * On the Hobby plan Vercel allows at most 12 Serverless Functions per deployment;
 * collapsing every endpoint into one catch-all keeps the whole API as a single
 * function, mirroring how the dev server has always routed.
 */

type RouteHandler = (req: ApiRequest, res: ApiResponse) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
  /** Name to store the first captured group under in `req.query` (dynamic segment). */
  param?: string;
  /** Error envelope shape on a thrown handler error. Most routes use `{ message }`;
   *  the legacy cart endpoints use `{ data: { message } }`. */
  errorEnvelope?: "message" | "data";
}

/**
 * `/api/ajax` multiplexes the legacy WordPress cart actions by the `action` field
 * in the form body. Mirrors the former `api/ajax.ts` exactly, including its
 * `{ data: { message } }` error envelope.
 */
async function handleAjax(req: ApiRequest, res: ApiResponse): Promise<void> {
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

const routes: Route[] = [
  { method: "POST", pattern: /^\/api\/ajax$/, handler: handleAjax },
  { method: "GET", pattern: /^\/api\/cart\/get$/, handler: handleGetCart, errorEnvelope: "data" },
  { method: "POST", pattern: /^\/api\/contact\/submit$/, handler: handleContactSubmit },
  { method: "GET", pattern: /^\/api\/products$/, handler: handleListProducts },
  { method: "GET", pattern: /^\/api\/products\/([^/]+)$/, handler: handleGetProduct, param: "slug" },
  { method: "POST", pattern: /^\/api\/auth\/signup$/, handler: handleSignup },
  { method: "GET", pattern: /^\/api\/content\/([^/]+)$/, handler: handleGetContent, param: "key" },
  { method: "GET", pattern: /^\/api\/admin\/session$/, handler: handleSession },
  { method: "POST", pattern: /^\/api\/admin\/content$/, handler: handleSaveContent },
  { method: "PUT", pattern: /^\/api\/admin\/content$/, handler: handleSaveContent },
  { method: "GET", pattern: /^\/api\/admin\/products$/, handler: handleAdminListProducts },
  { method: "POST", pattern: /^\/api\/admin\/products$/, handler: handleSaveProduct },
  { method: "PUT", pattern: /^\/api\/admin\/products$/, handler: handleSaveProduct },
  { method: "DELETE", pattern: /^\/api\/admin\/products$/, handler: handleDeleteProduct },
  { method: "POST", pattern: /^\/api\/admin\/upload$/, handler: handleUpload },
  { method: "POST", pattern: /^\/api\/checkout\/create$/, handler: handleCreateCheckout },
  { method: "POST", pattern: /^\/api\/checkout\/webhook$/, handler: handleWebhook },
  { method: "GET", pattern: /^\/api\/profile$/, handler: handleGetProfile },
  { method: "PUT", pattern: /^\/api\/profile$/, handler: handleUpdateProfile },
  { method: "POST", pattern: /^\/api\/orders\/lookup$/, handler: handleLookupOrder },
  { method: "POST", pattern: /^\/api\/orders\/get$/, handler: handleGetOrder },
  { method: "POST", pattern: /^\/api\/orders\/edit\/preview$/, handler: handleEditPreview },
  { method: "POST", pattern: /^\/api\/orders\/edit\/commit$/, handler: handleEditCommit },
  { method: "POST", pattern: /^\/api\/orders\/refund$/, handler: handleRefundOrder },
  { method: "GET", pattern: /^\/api\/admin\/orders$/, handler: handleAdminListOrders },
  { method: "POST", pattern: /^\/api\/admin\/orders\/flag$/, handler: handleAdminFlagOrder },
  { method: "POST", pattern: /^\/api\/admin\/orders\/complete$/, handler: handleAdminCompleteOrder },
];

/**
 * Matches `pathname` + `method` against the route table, injects any dynamic
 * segment into `req.query`, and runs the handler (catching thrown errors into the
 * route's error envelope). Returns false when no route matched so the caller can
 * reply 404.
 */
export async function dispatch(req: ApiRequest, res: ApiResponse, pathname: string): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = pathname.match(route.pattern);
    if (!match) continue;

    if (route.param && match[1] != null) {
      req.query = { ...req.query, [route.param]: decodeURIComponent(match[1]) };
    }

    try {
      await route.handler(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      if (route.errorEnvelope === "data") {
        res.status(500).json({ success: false, data: { message } });
      } else {
        res.status(500).json({ success: false, message });
      }
    }
    return true;
  }

  return false;
}
