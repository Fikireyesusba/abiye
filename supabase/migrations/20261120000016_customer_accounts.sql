-- =============================================================================
-- 0016 CUSTOMER ACCOUNTS (email + password, confirmed) — required to order
--   * customer_accounts: one row per signed-up user (auto-created on sign-up)
--   * orders.user_id / printing_jobs.user_id: who placed it
--   * New orders/printing jobs REQUIRE a confirmed account (DB-enforced):
--     only the *_for_user wrappers may create them, and a BEFORE INSERT
--     trigger refuses rows without a user.
--   * Customers can read their own orders (RLS); nothing else changes for
--     staff. Signing up never grants admin access (that needs public.profiles).
--   * Editable legal texts (terms / privacy) in website_settings.
-- =============================================================================

create table public.customer_accounts (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text check (char_length(full_name) <= 120),
  phone             text check (phone ~ '^\+251[79][0-9]{8}$'),
  accepted_terms_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger customer_accounts_updated_at before update on public.customer_accounts
  for each row execute function private.set_updated_at();

alter table public.customer_accounts enable row level security;
revoke all on public.customer_accounts from anon, authenticated;
grant select on public.customer_accounts to authenticated;
grant update (full_name, phone) on public.customer_accounts to authenticated;
create policy customer_accounts_own_read on public.customer_accounts for select to authenticated
  using (id = (select auth.uid()));
create policy customer_accounts_own_update on public.customer_accounts for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy customer_accounts_staff_read on public.customer_accounts for select to authenticated
  using ((select private.has_permission('customers.view')));

-- Auto-create the account row on sign-up (name/terms from sign-up metadata).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.customer_accounts (id, full_name, accepted_terms_at)
  values (
    new.id,
    left(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''), 120),
    case when (new.raw_user_meta_data ->> 'accepted_terms') = 'true' then now() end)
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Backfill accounts for existing users (e.g. staff) so every user has one row.
insert into public.customer_accounts (id) select id from auth.users on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Who placed it
-- ---------------------------------------------------------------------------
alter table public.orders add column user_id uuid references auth.users(id) on delete restrict;
create index orders_user_idx on public.orders(user_id, created_at desc) where user_id is not null;
alter table public.printing_jobs add column user_id uuid references auth.users(id) on delete restrict;
create index printing_jobs_user_idx on public.printing_jobs(user_id, created_at desc) where user_id is not null;

-- New rows must carry a user. The wrappers below pass it through a
-- transaction-local setting so the existing (tested) functions stay unchanged.
create or replace function private.require_ordering_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.user_id := coalesce(new.user_id, nullif(current_setting('app.ordering_user_id', true), '')::uuid);
  if new.user_id is null then
    raise exception using errcode = 'P0001', message = 'login_required';
  end if;
  return new;
end;
$$;
create trigger orders_require_user before insert on public.orders
  for each row execute function private.require_ordering_user();
create trigger printing_jobs_require_user before insert on public.printing_jobs
  for each row execute function private.require_ordering_user();

create or replace function private.assert_confirmed_user(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or not exists (
    select 1 from auth.users where id = p_user_id and email_confirmed_at is not null
  ) then
    perform private.app_error('login_required');
  end if;
end;
$$;

create or replace function public.create_order_for_user(p_user_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_result jsonb;
begin
  perform private.assert_confirmed_user(p_user_id);
  -- An idempotent replay must come from the same account.
  select user_id into v_owner from public.orders where idempotency_key = (p_input ->> 'idempotency_key')::uuid;
  if found and v_owner is distinct from p_user_id then
    perform private.app_error('idempotency_conflict');
  end if;
  perform set_config('app.ordering_user_id', p_user_id::text, true);
  v_result := public.create_order(p_input);
  -- Clear immediately so nothing later in the same transaction inherits this user.
  perform set_config('app.ordering_user_id', '', true);
  return v_result;
end;
$$;

create or replace function public.create_printing_job_for_user(p_user_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.assert_confirmed_user(p_user_id);
  perform set_config('app.ordering_user_id', p_user_id::text, true);
  v_result := public.create_printing_job(p_input);
  perform set_config('app.ordering_user_id', '', true);
  return v_result;
end;
$$;

-- Only the wrappers may create orders/printing jobs from now on.
revoke execute on function public.create_order(jsonb) from service_role;
revoke execute on function public.create_printing_job(jsonb) from service_role;
revoke execute on function public.create_order_for_user(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.create_printing_job_for_user(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_order_for_user(uuid, jsonb) to service_role;
grant execute on function public.create_printing_job_for_user(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Customers read their own orders (in addition to the staff policies)
-- ---------------------------------------------------------------------------
create or replace function private.owns_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.orders o where o.id = p_order_id and o.user_id = (select auth.uid()))
$$;
grant execute on function private.owns_order(uuid) to authenticated;

create policy orders_customer_read on public.orders for select to authenticated
  using (user_id = (select auth.uid()));
create policy order_items_customer_read on public.order_items for select to authenticated
  using (private.owns_order(order_id));
create policy order_status_history_customer_read on public.order_status_history for select to authenticated
  using (private.owns_order(order_id));
create policy printing_jobs_customer_read on public.printing_jobs for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Editable legal texts (seeded from the reviewed draft; "approved" hides the draft banner)
-- ---------------------------------------------------------------------------
insert into public.website_settings (key, value, is_public)
values ('legal', '{"privacy":{"en":"## What we collect\n\nWhen you order, we collect your name, phone number, delivery city and address, delivery instructions, the products you order, your bank transaction reference and the payment receipt you upload. For printing services we also store the documents you upload.\n\n## Why we use it\n\nWe use this information only to process, verify, deliver and support your orders, and to contact you about them. We do not sell your information or use it for third-party advertising.\n\n## Payment receipts and documents\n\nReceipts and printing documents are stored privately. Only authorized {name} staff can open them. Printing documents are deleted automatically after the retention period shown on the printing page.\n\n## Who can see your data\n\nOnly staff who need it for your order. Our hosting providers (Vercel and Supabase) store data on our behalf under their security terms. Order notifications are sent to a private staff Telegram chat.\n\n## Your choices\n\nYou may ask us to correct or delete your information by contacting us, unless we must keep it to meet legal or accounting obligations.\n\n## Contact\n\nFor privacy questions, contact {name} using the details on our Contact page.","am":"## የምንሰበስበው መረጃ\n\nሲያዝዙ ስምዎን፣ ስልክ ቁጥርዎን፣ የማድረሻ ከተማና አድራሻዎን፣ የማድረሻ መመሪያዎን፣ ያዘዟቸውን ምርቶች፣ የባንክ ግብይት ማጣቀሻ ቁጥርዎን እና የሚጭኑትን የክፍያ ደረሰኝ እንሰበስባለን። ለህትመት አገልግሎት የሚጭኗቸውን ሰነዶችም እናስቀምጣለን።\n\n## ለምን እንጠቀምበታለን\n\nይህን መረጃ የምንጠቀመው ትዕዛዝዎን ለማስኬድ፣ ለማረጋገጥ፣ ለማድረስ እና ለመደገፍ እንዲሁም ስለ ትዕዛዝዎ ለማግኘትዎ ብቻ ነው። መረጃዎን አንሸጥም ወይም ለሶስተኛ ወገን ማስታወቂያ አንጠቀምበትም።\n\n## የክፍያ ደረሰኞች እና ሰነዶች\n\nደረሰኞች እና የህትመት ሰነዶች በግል ይቀመጣሉ። ሊከፍቷቸው የሚችሉት የተፈቀደላቸው የ{name} ሰራተኞች ብቻ ናቸው። የህትመት ሰነዶች በህትመት ገጹ ላይ ከተገለጸው የማቆያ ጊዜ በኋላ በራስ-ሰር ይሰረዛሉ።\n\n## መረጃዎን ማን ሊያይ ይችላል\n\nለትዕዛዝዎ የሚያስፈልጋቸው ሰራተኞች ብቻ። የማስተናገጃ አቅራቢዎቻችን (Vercel እና Supabase) በደህንነት ውሎቻቸው መሰረት መረጃን በእኛ ስም ያከማቻሉ። የትዕዛዝ ማሳወቂያዎች ወደ የግል የሰራተኞች ቴሌግራም ቡድን ይላካሉ።\n\n## የእርስዎ ምርጫዎች\n\nበህግ ወይም በሂሳብ ግዴታ ምክንያት ማቆየት ካላስፈለገን በስተቀር መረጃዎን እንድናስተካክል ወይም እንድንሰርዝ እኛን በማግኘት መጠየቅ ይችላሉ።\n\n## ያግኙን\n\nለግላዊነት ጥያቄዎች በ«ያግኙን» ገጻችን ላይ ባሉት አድራሻዎች {name}ን ያግኙ።"},"terms":{"en":"## Orders\n\nPlacing an order reserves the items for the payment window shown at checkout. If payment is not submitted in time, the order expires and the items are released.\n\n## Prices\n\nAll prices are in Ethiopian Birr (ETB). The price confirmed at checkout is the price you pay, even if our prices change later.\n\n## Payment\n\nWe accept bank transfer to the account shown at checkout. Your order is confirmed only after our team verifies the transfer in our bank account. A receipt image alone is not proof of payment. We may reject payments that cannot be verified; you can then resubmit.\n\n## Delivery and pickup\n\nDelivery fees depend on your city and are shown before you order. Delivery times are estimates. Pickup orders can be collected at our shop once marked ready.\n\n## Printing services\n\nPrinting prices are calculated from page count, copies, paper size, color and sides. Where we cannot count pages automatically, we send a quote before you pay. You are responsible for having the right to print the documents you upload.\n\n## Cancellations and returns\n\nContact us as soon as possible to cancel. Items must be returned unused and in original packaging, unless faulty. Hygiene-sensitive cosmetics cannot be returned once opened. Refunds for verified payments are made by bank transfer.\n\n## Contact\n\nQuestions about these terms: contact {name} using the details on our Contact page.","am":"## ትዕዛዞች\n\nትዕዛዝ ማስገባት ዕቃዎቹን በክፍያ ጊዜ ውስጥ ለእርስዎ ይይዛል። ክፍያ በጊዜው ካልገባ ትዕዛዙ ጊዜው ያልፍበታል እና ዕቃዎቹ ይለቀቃሉ።\n\n## ዋጋዎች\n\nሁሉም ዋጋዎች በኢትዮጵያ ብር ናቸው። በክፍያ ጊዜ የተረጋገጠው ዋጋ ዋጋችን ቢቀየርም የሚከፍሉት ዋጋ ነው።\n\n## ክፍያ\n\nበክፍያ ጊዜ ወደሚታየው ሂሳብ የሚደረግ የባንክ ዝውውር እንቀበላለን። ትዕዛዝዎ የሚረጋገጠው ቡድናችን ዝውውሩን በባንክ ሂሳባችን ካረጋገጠ በኋላ ብቻ ነው። የደረሰኝ ምስል ብቻውን የክፍያ ማረጋገጫ አይደለም። ሊረጋገጡ የማይችሉ ክፍያዎችን ውድቅ ልናደርግ እንችላለን፤ ከዚያ እንደገና ማስገባት ይችላሉ።\n\n## ማድረስ እና መውሰድ\n\nየማድረሻ ክፍያ በከተማዎ ላይ የተመሰረተ ሲሆን ከማዘዝዎ በፊት ይታያል። የማድረሻ ጊዜዎች ግምቶች ናቸው። የመውሰጃ ትዕዛዞች ዝግጁ ከተባሉ በኋላ ከሱቃችን ሊወሰዱ ይችላሉ።\n\n## የህትመት አገልግሎቶች\n\nየህትመት ዋጋ በገጽ ብዛት፣ በቅጂ፣ በወረቀት መጠን፣ በቀለም እና በገጽ ይሰላል። ገጾችን በራስ-ሰር መቁጠር በማንችልበት ጊዜ ከክፍያ በፊት የዋጋ ግምት እንልካለን። የሚጭኗቸውን ሰነዶች የማሳተም መብት እንዳለዎት ማረጋገጥ የእርስዎ ኃላፊነት ነው።\n\n## ስረዛ እና መመለስ\n\nለመሰረዝ በተቻለ ፍጥነት ያግኙን። ዕቃዎች ጉድለት ከሌለባቸው በስተቀር ያልተጠቀሙባቸው እና በመጀመሪያ ማሸጊያቸው መመለስ አለባቸው። ለንጽህና ስሜታዊ የሆኑ የውበት ምርቶች ከተከፈቱ በኋላ መመለስ አይችሉም። ለተረጋገጡ ክፍያዎች ተመላሽ በባንክ ዝውውር ይደረጋል።\n\n## ያግኙን\n\nስለ እነዚህ ውሎች ጥያቄዎች ካሉዎት በ«ያግኙን» ገጻችን ላይ ባሉት አድራሻዎች {name}ን ያግኙ።"},"approved":false}'::jsonb, true)
on conflict (key) do nothing;
