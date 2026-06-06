import { supabase } from "../lib/supabase.js";

// Aggregated store statistics for the admin Dashboard. Everything is computed from
// `orders` + `order_items`, with product `cost_price` joined in for profit (COGS).
// An order counts as a "sale" once it is paid; refunded orders are tracked
// separately and excluded from sales/profit. Money is in integer cents.

export interface DashboardStats {
  currency: string;
  generatedAt: string;
  totals: {
    salesCents: number; // gross from paid (non-refunded) orders
    netRevenueCents: number; // sales − refunds
    profitCents: number; // Σ (unit price − unit cost) × qty on paid orders
    costCents: number; // COGS on paid orders
    orderCount: number; // paid orders
    unitsSold: number;
    avgOrderCents: number;
    refundCount: number;
    refundsValueCents: number;
  };
  topProducts: Array<{ name: string; qty: number; revenueCents: number }>;
  revenueByProduct: Array<{ name: string; revenueCents: number }>; // top 6 + "Other"
  salesTimeline: Array<{ label: string; ym: string; cents: number; count: number }>; // last 12 months
  statusBreakdown: Array<{ status: string; count: number }>;
}

interface OrderRow {
  id: string;
  status: string;
  total_cents: number;
  amount_refunded_cents: number;
  completed_at: string | null;
  refunded_at: string | null;
  created_at: string;
}

interface ItemRow {
  order_id: string;
  product_id: number | null;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function lastTwelveMonths(): Array<{ ym: string; label: string }> {
  const out: Array<{ ym: string; label: string }> = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ ym: monthKey(d), label: d.toLocaleString("en-US", { month: "short", year: "2-digit" }) });
  }
  return out;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [{ data: orders, error: oErr }, { data: items, error: iErr }, { data: products, error: pErr }] =
    await Promise.all([
      supabase.from("orders").select("id, status, total_cents, amount_refunded_cents, completed_at, refunded_at, created_at"),
      supabase.from("order_items").select("order_id, product_id, product_name, quantity, unit_price_cents, line_total_cents"),
      supabase.from("products").select("id, cost_price"),
    ]);
  if (oErr) throw oErr;
  if (iErr) throw iErr;
  if (pErr) throw pErr;

  const orderRows = (orders ?? []) as OrderRow[];
  const itemRows = (items ?? []) as ItemRow[];
  const costByProduct = new Map<number, number>();
  for (const p of (products ?? []) as Array<{ id: number; cost_price: number }>) {
    costByProduct.set(Number(p.id), Math.round((Number(p.cost_price) || 0) * 100));
  }

  // An order is "refunded" whenever it has a refund stamp/amount — robust even if
  // the status column was left as 'paid' (Square webhooks have done this in the
  // past). A "paid sale" is a paid order that was NOT refunded.
  const isRefunded = (o: OrderRow) => Boolean(o.refunded_at) || (Number(o.amount_refunded_cents) || 0) > 0;
  const isPaidSale = (o: OrderRow) => o.status === "paid" && !isRefunded(o);

  const paidOrders = orderRows.filter(isPaidSale);
  const paidIds = new Set(paidOrders.map((o) => o.id));

  // Totals
  const salesCents = paidOrders.reduce((s, o) => s + (Number(o.total_cents) || 0), 0);
  const orderCount = paidOrders.length;
  const refundedOrders = orderRows.filter(isRefunded);
  const refundsValueCents = orderRows.reduce((s, o) => s + (Number(o.amount_refunded_cents) || 0), 0);

  let unitsSold = 0;
  let costCents = 0;
  let revenueFromItems = 0;
  const qtyByProduct = new Map<string, { qty: number; revenueCents: number }>();

  for (const it of itemRows) {
    if (!paidIds.has(it.order_id)) continue;
    const qty = Number(it.quantity) || 0;
    const line = Number(it.line_total_cents) || 0;
    unitsSold += qty;
    revenueFromItems += line;
    const unitCost = it.product_id != null ? costByProduct.get(Number(it.product_id)) ?? 0 : 0;
    costCents += unitCost * qty;

    const key = it.product_name || "Unknown";
    const agg = qtyByProduct.get(key) ?? { qty: 0, revenueCents: 0 };
    agg.qty += qty;
    agg.revenueCents += line;
    qtyByProduct.set(key, agg);
  }

  const profitCents = revenueFromItems - costCents;
  const avgOrderCents = orderCount > 0 ? Math.round(salesCents / orderCount) : 0;

  // Rankings
  const ranked = Array.from(qtyByProduct.entries()).map(([name, v]) => ({ name, qty: v.qty, revenueCents: v.revenueCents }));
  const topProducts = [...ranked].sort((a, b) => b.qty - a.qty).slice(0, 8);

  const byRevenue = [...ranked].sort((a, b) => b.revenueCents - a.revenueCents);
  const revenueByProduct = byRevenue.slice(0, 6).map((r) => ({ name: r.name, revenueCents: r.revenueCents }));
  const otherCents = byRevenue.slice(6).reduce((s, r) => s + r.revenueCents, 0);
  if (otherCents > 0) revenueByProduct.push({ name: "Other", revenueCents: otherCents });

  // Timeline (last 12 months, paid orders)
  const months = lastTwelveMonths();
  const byMonth = new Map<string, { cents: number; count: number }>();
  for (const o of paidOrders) {
    const d = new Date(o.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const k = monthKey(d);
    const m = byMonth.get(k) ?? { cents: 0, count: 0 };
    m.cents += Number(o.total_cents) || 0;
    m.count += 1;
    byMonth.set(k, m);
  }
  const salesTimeline = months.map((m) => ({
    label: m.label,
    ym: m.ym,
    cents: byMonth.get(m.ym)?.cents ?? 0,
    count: byMonth.get(m.ym)?.count ?? 0,
  }));

  // Status breakdown (exclude pending — never a real sale in the admin view). A
  // paid order that's been fulfilled is reported as its own "completed" status,
  // since `completed_at` is a flag rather than a distinct DB status value.
  const statusCounts = new Map<string, number>();
  for (const o of orderRows) {
    if (o.status === "pending") continue;
    const status = isRefunded(o) ? "refunded" : o.status === "paid" && o.completed_at ? "completed" : o.status;
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const statusOrder = ["paid", "completed", "refunded", "failed", "canceled"];
  const statusBreakdown = Array.from(statusCounts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => {
      const ai = statusOrder.indexOf(a.status);
      const bi = statusOrder.indexOf(b.status);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  return {
    currency: "CAD",
    generatedAt: new Date().toISOString(),
    totals: {
      salesCents,
      netRevenueCents: salesCents - refundsValueCents,
      profitCents,
      costCents,
      orderCount,
      unitsSold,
      avgOrderCents,
      refundCount: refundedOrders.length,
      refundsValueCents,
    },
    topProducts,
    revenueByProduct,
    salesTimeline,
    statusBreakdown,
  };
}
