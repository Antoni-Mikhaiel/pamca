create table if not exists products (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null,
  description text not null default '',
  image_url text,
  price_regular numeric(10,2) not null,
  price_sale numeric(10,2),
  is_on_sale boolean not null default false,
  redirect_path text not null,
  created_at timestamptz not null default now() 
);

-- Rich product fields managed by the admin console (added in the Supabase migration
-- from the localStorage placeholder). Legacy columns above are kept in sync for the
-- existing public store/cart reads (image_url = images[0], price_regular = base price,
-- price_sale/is_on_sale derived from sale_percent).
alter table products add column if not exists status text not null default 'active';
alter table products add column if not exists images jsonb not null default '[]'::jsonb;
alter table products add column if not exists sale_percent numeric(5,2) not null default 0;
alter table products add column if not exists sale_start date;
alter table products add column if not exists sale_end date;
alter table products add column if not exists stock integer not null default 0;
-- Unit cost (what PAMCA pays per unit) — used only for the admin Dashboard's profit
-- figures. Optional; defaults to 0 (a product with no cost contributes 0 COGS).
alter table products add column if not exists cost_price numeric(10,2) not null default 0;
alter table products add column if not exists key_features jsonb not null default '[]'::jsonb;
alter table products add column if not exists option_groups jsonb not null default '[]'::jsonb;
-- Per-combination inventory for multi-dropdown products. Each entry is
-- { "key": "<opt> / <opt>", "stock": N } where key is the option values joined by
-- " / " in dropdown order (the same label the cart stores as variation_label). This
-- replaces the ambiguous per-option stock: 3 styles × 2 colours = 6 tracked counts.
-- When a product has no dropdowns, the top-level `stock` column is used instead.
alter table products add column if not exists variants jsonb not null default '[]'::jsonb;
-- The former free-text "specifications" list was removed; "key_features" is now
-- surfaced as "Specifications" in the UI. Drop the old column if it still exists.
alter table products drop column if exists specifications;
alter table products add column if not exists updated_at timestamptz not null default now();

-- Singleton content documents edited in the admin (Minor Ailments pillars, Incident report).
-- Each row is one JSON document keyed by name (e.g. 'pillars', 'incident_report').
create table if not exists site_content (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists product_variations (
  id bigint generated always as identity primary key,
  product_id bigint not null references products(id) on delete cascade,
  label text not null,
  value text not null,
  price_regular numeric(10,2) not null,
  price_sale numeric(10,2),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create type user_role as enum ('user', 'admin');

create table if not exists user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  avatar_url text,
  role user_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_role_idx on user_profiles(role);

-- Delivery/contact details editable from the profile page and used to pre-fill
-- the checkout pop-up. `email` above stays the login email; `contact_email` is
-- the (optionally different) address used for orders/receipts. Phone is stored as
-- the 10-digit national number (the +1 country code is implied — Canada only).
-- Address is now broken down into separate fields for Canadian Post API integration.
alter table user_profiles add column if not exists first_name text;
alter table user_profiles add column if not exists last_name text;
alter table user_profiles add column if not exists contact_email text;
-- Legacy address field (deprecated — will be migrated to separate fields)
alter table user_profiles add column if not exists address text;
-- New address fields (Canadian)
alter table user_profiles add column if not exists street_number text;
alter table user_profiles add column if not exists street_name text;
alter table user_profiles add column if not exists city text;  -- e.g. 'Toronto'
alter table user_profiles add column if not exists province text;  -- e.g. 'ON', 'BC', 'AB'
alter table user_profiles add column if not exists postal_code text; -- e.g. 'M4S 3E6'
alter table user_profiles add column if not exists phone text;

create table if not exists cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_token uuid not null,
  product_id bigint not null references products(id),
  variation_id bigint references product_variations(id),
  quantity integer not null check (quantity >= 0),
  product_name text not null,
  variation_label text,
  unit_price numeric(10,2) not null,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cart_items_cart_token_idx on cart_items(cart_token);

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cart_items_touch_updated_at on cart_items;
create trigger cart_items_touch_updated_at
before update on cart_items
for each row execute function touch_updated_at();

drop trigger if exists user_profiles_touch_updated_at on user_profiles;
create trigger user_profiles_touch_updated_at
before update on user_profiles
for each row execute function touch_updated_at();

drop trigger if exists products_touch_updated_at on products;
create trigger products_touch_updated_at
before update on products
for each row execute function touch_updated_at();

drop trigger if exists site_content_touch_updated_at on site_content;
create trigger site_content_touch_updated_at
before update on site_content
for each row execute function touch_updated_at();

-- Storage bucket for admin-uploaded product images (device upload). Public read so the
-- store can display them; writes go through the server (service-role) upload endpoint.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Allow public read of objects in the product-images bucket.
drop policy if exists "Public read product-images" on storage.objects;
create policy "Public read product-images"
on storage.objects for select
using (bucket_id = 'product-images');

-- To grant a user admin rights for the console:
--   update user_profiles set role = 'admin' where email = 'you@example.com';

-- ---------------------------------------------------------------------------
-- Orders (Square hosted checkout). When a shopper proceeds to checkout the
-- server snapshots the cart into a pending `orders` row + `order_items`, then
-- creates a Square Payment Link and stores its identifiers here. A Square
-- webhook (payment.updated, status COMPLETED) flips the order to 'paid' and the
-- cart is cleared. Money is stored in integer minor units (cents) to avoid
-- floating-point drift; `currency` is an ISO 4217 code (e.g. 'CAD').
-- ---------------------------------------------------------------------------
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  cart_token uuid,
  status text not null default 'pending', -- pending | paid | failed | canceled
  currency text not null default 'CAD',
  subtotal_cents integer not null default 0,
  total_cents integer not null default 0,
  square_payment_link_id text,
  square_order_id text,
  square_payment_id text,
  checkout_url text,
  customer_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Human-friendly 6-digit reference a shopper can use to look up an order without
-- an account (guest lookup also requires the matching phone number). Optional
-- link to the logged-in buyer, plus the delivery details captured at checkout.
alter table orders add column if not exists purchase_id text;
alter table orders add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table orders add column if not exists customer_first_name text;
alter table orders add column if not exists customer_last_name text;
alter table orders add column if not exists customer_phone text;     -- '+1' + 10 digits
-- Legacy address field (deprecated — will be migrated to separate fields)
alter table orders add column if not exists customer_address text;
-- New address fields (Canadian)
alter table orders add column if not exists customer_street_number text;
alter table orders add column if not exists customer_street_name text;
alter table orders add column if not exists customer_city text;  -- e.g. 'Toronto'
alter table orders add column if not exists customer_province text;  -- e.g. 'ON', 'BC', 'AB'
alter table orders add column if not exists customer_postal_code text; -- e.g. 'M4S 3E6'
alter table orders add column if not exists stock_applied boolean not null default false;

-- Order editing (24h window) & refunds (48h window).
-- `uneditable` is an admin early-lock (settable only within the first 24h); it
-- blocks edits but never refunds. `payments` records every successful charge for
-- the order — the original plus any applied top-ups — as
-- [{ square_payment_id, amount_cents, refunded_cents }], so refunds can be issued
-- against the right payment(s) and never exceed what was charged.
alter table orders add column if not exists uneditable boolean not null default false;
-- Admin-set fulfillment marker surfaced to the customer ("Completed"). Purely a
-- status/communication flag — it does not change edit/refund eligibility.
alter table orders add column if not exists completed_at timestamptz;
alter table orders add column if not exists refunded_at timestamptz;
alter table orders add column if not exists amount_refunded_cents integer not null default 0;
alter table orders add column if not exists payments jsonb not null default '[]'::jsonb;
-- Tax amount (in cents) applied to the order. Calculated from subtotal_cents * (hst_percent / 100).
alter table orders add column if not exists tax_cents integer not null default 0;
-- HST percent applied to this order (e.g. 13 for 13%). Snapshot of the rate at order creation time.
alter table orders add column if not exists hst_percent numeric(5,2) not null default 13;

-- A staged edit that requires an extra payment. The new item set + stock changes
-- are applied only when its top-up payment completes (Square webhook). Edits that
-- net to zero or a refund are applied immediately and never create a row here.
create table if not exists order_edits (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  status text not null default 'pending', -- pending | applied | canceled
  delta_cents integer not null,           -- amount to charge (always > 0 here)
  new_items jsonb not null,               -- full desired item snapshot (order_items shape)
  square_order_id text,
  square_payment_id text,
  checkout_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_edits_order_id_idx on order_edits(order_id);
create index if not exists order_edits_square_order_id_idx on order_edits(square_order_id);

drop trigger if exists order_edits_touch_updated_at on order_edits;
create trigger order_edits_touch_updated_at
before update on order_edits
for each row execute function touch_updated_at();

create index if not exists orders_cart_token_idx on orders(cart_token);
create index if not exists orders_square_order_id_idx on orders(square_order_id);
create unique index if not exists orders_purchase_id_idx on orders(purchase_id);
create index if not exists orders_user_id_idx on orders(user_id);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id bigint,
  variation_id bigint,
  product_name text not null,
  variation_label text,
  unit_price_cents integer not null,
  quantity integer not null,
  line_total_cents integer not null
);

create index if not exists order_items_order_id_idx on order_items(order_id);

drop trigger if exists orders_touch_updated_at on orders;
create trigger orders_touch_updated_at
before update on orders
for each row execute function touch_updated_at();
