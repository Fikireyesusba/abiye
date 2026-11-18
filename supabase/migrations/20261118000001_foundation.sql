-- =============================================================================
-- 0001 FOUNDATION: extensions, schemas, enums, shared helpers
-- =============================================================================
-- Conventions
--   * Money is numeric(12,2) in Ethiopian Birr (ETB).
--   * Every table has created_at; mutable tables have updated_at (trigger).
--   * SECURITY DEFINER functions always pin search_path = '' and fully qualify
--     every object they touch.
--   * Internal helpers live in schema "private", which is NOT exposed through
--     the Supabase Data API.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists citext with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Never let new tables/functions be auto-exposed. Every grant in this project
-- is explicit.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.department as enum ('cosmetics', 'electronics', 'printing');
create type public.product_status as enum ('draft', 'active', 'archived');

create type public.order_status as enum (
  'awaiting_payment',     -- order created, waiting for customer's bank transfer
  'pending_verification', -- receipt submitted, admin must check the bank account
  'payment_rejected',     -- admin rejected the evidence; customer may resubmit
  'confirmed',            -- payment verified
  'processing',
  'ready_for_pickup',
  'out_for_delivery',
  'completed',
  'cancelled',
  'expired'               -- payment window elapsed; stock released
);

create type public.payment_status as enum (
  'unpaid', 'pending_verification', 'verified', 'rejected', 'refunded'
);

create type public.fulfillment_method as enum ('delivery', 'pickup');
create type public.order_item_type as enum ('product', 'printing');
create type public.submission_status as enum ('pending', 'verified', 'rejected');

create type public.print_job_status as enum (
  'submitted', 'awaiting_quote', 'awaiting_payment', 'payment_verification',
  'printing', 'ready', 'completed', 'cancelled'
);
create type public.print_color_mode as enum ('bw', 'color');
create type public.print_sides as enum ('single', 'double');

create type public.inventory_reason as enum (
  'initial', 'restock', 'adjustment', 'damage', 'return',
  'order_reserved', 'order_released'
);

create type public.notification_status as enum (
  'pending', 'processing', 'sent', 'failed', 'dead'
);

-- ---------------------------------------------------------------------------
-- Shared trigger: updated_at
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Raise an application error with a stable, machine-readable code.
-- The app maps codes (e.g. 'out_of_stock') to translated user messages.
-- ---------------------------------------------------------------------------
create or replace function private.app_error(p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '');
end;
$$;
