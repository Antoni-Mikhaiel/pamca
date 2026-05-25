import { handleWebhook } from "../../src/controllers/checkoutController";
import { ApiRequest, ApiResponse } from "../../src/lib/http";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method === "POST") {
      await handleWebhook(req, res);
      return;
    }
    res.status(405).json({ success: false, message: "Method not allowed" });
  } catch (error) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : "Internal error" });
  }
}
