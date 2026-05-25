import { ApiRequest, ApiResponse } from "../lib/http";
import { getProductBySlug, listProducts } from "../services/productService";

export async function handleListProducts(_req: ApiRequest, res: ApiResponse): Promise<void> {
  const products = await listProducts();
  res.status(200).json({ success: true, data: products });
}

export async function handleGetProduct(req: ApiRequest, res: ApiResponse): Promise<void> {
  const slug = String(req.query?.slug ?? "");
  if (!slug) {
    res.status(400).json({ success: false, message: "Missing slug" });
    return;
  }

  const product = await getProductBySlug(slug);
  if (!product) {
    res.status(404).json({ success: false, message: "Not found" });
    return;
  }

  res.status(200).json({ success: true, data: product });
}
