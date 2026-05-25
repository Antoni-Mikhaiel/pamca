import { handleGetContent } from "../../src/controllers/contentController";
import { ApiRequest, ApiResponse } from "../../src/lib/http";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    await handleGetContent(req, res);
  } catch (error) {
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : "Internal error" });
  }
}
