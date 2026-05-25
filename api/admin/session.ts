import { handleSession } from "../../src/controllers/adminController";
import { ApiRequest, ApiResponse } from "../../src/lib/http";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    await handleSession(req, res);
  } catch (error) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : "Internal error" });
  }
}
