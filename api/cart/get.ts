import { handleGetCart } from "../../src/controllers/cartController";
import { ApiRequest, ApiResponse } from "../../src/lib/http";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    await handleGetCart(req, res);
  } catch (error) {
    res.status(500).json({ success: false, data: { message: error instanceof Error ? error.message : "Internal error" } });
  }
}
