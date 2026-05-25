import {
  handleAdminListProducts,
  handleSaveProduct,
  handleDeleteProduct,
} from "../../src/controllers/adminProductController";
import { ApiRequest, ApiResponse } from "../../src/lib/http";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method === "GET") {
      await handleAdminListProducts(req, res);
      return;
    }
    if (req.method === "POST" || req.method === "PUT") {
      await handleSaveProduct(req, res);
      return;
    }
    if (req.method === "DELETE") {
      await handleDeleteProduct(req, res);
      return;
    }
    res.status(405).json({ success: false, message: "Method not allowed" });
  } catch (error) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : "Internal error" });
  }
}
