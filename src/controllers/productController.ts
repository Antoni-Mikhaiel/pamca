import { ApiRequest, ApiResponse } from "../lib/http.js";
import { getProductBySlug, listProducts, toPublicProduct } from "../services/productService.js";

// Public catalog reads are identical for every visitor, so let Vercel's CDN serve
// them for a minute (and stale for 5 more while it refreshes). Stock is still
// enforced server-side at add-to-cart, so a briefly stale listing can't oversell.
const PUBLIC_CACHE = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

export async function handleListProducts(_req: ApiRequest, res: ApiResponse): Promise<void> {
  const products = await listProducts();
  res.setHeader("Cache-Control", PUBLIC_CACHE);
  res.status(200).json({ success: true, data: products.map(toPublicProduct) });
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

  res.setHeader("Cache-Control", PUBLIC_CACHE);
  res.status(200).json({ success: true, data: toPublicProduct(product) });
}
