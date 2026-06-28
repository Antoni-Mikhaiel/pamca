import { ApiRequest, ApiResponse } from "../lib/http.js";
import { requireAdmin, readJsonBody } from "../lib/adminAuth.js";
import { listProductsForAdmin, upsertProduct, deleteProduct, clampSalePercent } from "../services/productService.js";
import { AdminProductInput, ProductOptionGroup, ProductVariantStock } from "../models/types.js";
import { asVariants, buildCombinationKeys } from "../lib/variants.js";

function slugify(s: string): string {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sanitizeOptionGroups(value: unknown): ProductOptionGroup[] {
  if (!Array.isArray(value)) return [];
  const groups = value.map((g) => {
    const group = (g ?? {}) as { label?: unknown; options?: unknown; affectsPricing?: unknown };
    const options = Array.isArray(group.options) ? group.options : [];
    const mapped = options.map((o) => {
      const opt = (o ?? {}) as { value?: unknown; price?: unknown; salePercent?: unknown; stock?: unknown };
      const price = opt.price === null || opt.price === undefined || opt.price === "" ? null : Number(opt.price);
      const stockProvided = opt.stock !== null && opt.stock !== undefined && opt.stock !== "";
      const saleProvided = opt.salePercent !== null && opt.salePercent !== undefined && opt.salePercent !== "";
      return {
        value: String(opt.value ?? ""),
        price: Number.isFinite(price as number) ? (price as number) : null,
        salePercent: saleProvided ? clampSalePercent(opt.salePercent) : null,
        stock: stockProvided ? Math.max(0, Math.round(Number(opt.stock) || 0)) : null,
      };
    });
    const affectsPricing =
      typeof group.affectsPricing === "boolean" ? group.affectsPricing : mapped.some((o) => o.price != null);
    return { label: String(group.label ?? ""), affectsPricing, options: mapped };
  });

  // Enforce the rule that at most one dropdown sets price & sale: keep the first
  // pricing dropdown, demote any others to stock-only.
  let pricingSeen = false;
  for (const group of groups) {
    if (group.affectsPricing && !pricingSeen) pricingSeen = true;
    else group.affectsPricing = false;
  }
  return groups;
}

/**
 * Keeps only the stock entries for combinations that actually exist for the given
 * option groups (so removed/renamed options don't leave orphan inventory), and
 * fills in any missing combination with 0.
 */
function sanitizeVariants(value: unknown, groups: ProductOptionGroup[]): ProductVariantStock[] {
  const validKeys = buildCombinationKeys(groups);
  if (validKeys.length === 0) return [];
  const provided = new Map(asVariants(value).map((v) => [v.key, v.stock]));
  return validKeys.map((key) => ({ key, stock: provided.get(key) ?? 0 }));
}

export async function handleAdminListProducts(req: ApiRequest, res: ApiResponse): Promise<void> {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const products = await listProductsForAdmin();
  res.status(200).json({ success: true, data: products });
}

export async function handleSaveProduct(req: ApiRequest, res: ApiResponse): Promise<void> {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const body = readJsonBody<Partial<AdminProductInput>>(req);
  const name = String(body.name ?? "").trim();
  if (!name) {
    res.status(400).json({ success: false, message: "Product name is required" });
    return;
  }

  const toStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

  const input: AdminProductInput = {
    id: body.id ? Number(body.id) : null,
    name,
    slug: slugify(String(body.slug ?? "") || name),
    status: body.status === "draft" ? "draft" : "active",
    images: toStringArray(body.images),
    price: Number(body.price) || 0,
    salePercent: Number(body.salePercent) || 0,
    saleStart: String(body.saleStart ?? ""),
    saleEnd: String(body.saleEnd ?? ""),
    stock: Number(body.stock) || 0,
    cost: Math.max(0, Number(body.cost) || 0),
    weight: Math.max(0, Number(body.weight) || 0),
    description: String(body.description ?? ""),
    keyFeatures: toStringArray(body.keyFeatures),
    optionGroups: sanitizeOptionGroups(body.optionGroups),
    variants: [],
  };
  input.variants = sanitizeVariants(body.variants, input.optionGroups);

  const saved = await upsertProduct(input);
  res.status(200).json({ success: true, data: saved });
}

export async function handleDeleteProduct(req: ApiRequest, res: ApiResponse): Promise<void> {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const fromQuery = req.query?.id;
  const id = Number((Array.isArray(fromQuery) ? fromQuery[0] : fromQuery) ?? readJsonBody<{ id?: number }>(req).id ?? 0);
  if (!id) {
    res.status(400).json({ success: false, message: "Missing product id" });
    return;
  }
  await deleteProduct(id);
  res.status(200).json({ success: true });
}
