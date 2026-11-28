alter table public.vendor_accounts alter column user_id set default auth.uid();
grant insert (brand) on public.vendor_accounts to authenticated;
create policy vendor_register on public.vendor_accounts for insert to authenticated
  with check (user_id = (select auth.uid()) and char_length(btrim(brand)) > 0);

alter table public.vendor_products add column category text check (
  category in ('shirt-long','shirt-short','trouser','dress','jacket','suit','shorts','skirt','sweater','coat','activewear','traditional')
);
grant insert (category), update (category) on public.vendor_products to authenticated;

create table public.fit_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  vendor_id uuid not null references public.vendor_accounts(user_id) on delete cascade,
  product_id uuid not null references public.vendor_products(id) on delete cascade,
  customer_email text not null check (char_length(customer_email) between 1 and 254),
  measurements jsonb not null check (jsonb_typeof(measurements) = 'object' and octet_length(measurements::text) <= 512),
  status text not null default 'requested' check (status in ('requested','accepted','declined')),
  created_at timestamptz not null default now(),
  unique (customer_id, product_id)
);
create index fit_requests_vendor_recent on public.fit_requests (vendor_id, created_at desc);
alter table public.fit_requests enable row level security;
revoke all on public.fit_requests from anon, authenticated;
grant select on public.fit_requests to authenticated;
grant insert (vendor_id,product_id,customer_email,measurements), update (status) on public.fit_requests to authenticated;
create policy fit_request_read on public.fit_requests for select to authenticated using (
  customer_id = (select auth.uid()) or vendor_id = (select auth.uid())
);
create policy fit_request_create on public.fit_requests for insert to authenticated with check (
  customer_id = (select auth.uid()) and vendor_id <> customer_id
  and customer_email = (select auth.jwt()->>'email')
  and exists (select 1 from public.vendor_products p
    where p.id = product_id and p.vendor_id = fit_requests.vendor_id and p.published and p.category is not null
    and case p.category
      when 'shirt-short' then measurements ?& array['chest','shoulder','neck','garment_length']
      when 'shirt-long' then measurements ?& array['chest','shoulder','arm','neck','garment_length']
      when 'suit' then measurements ?& array['chest','waist','hips','shoulder','arm','inseam','garment_length']
      when 'trouser' then measurements ?& array['waist','hips','inseam']
      when 'dress' then measurements ?& array['chest','waist','hips','shoulder','garment_length']
      when 'shorts' then measurements ?& array['waist','hips','inseam']
      when 'skirt' then measurements ?& array['waist','hips','garment_length']
      when 'activewear' then measurements ?& array['chest','waist','hips','garment_length']
      else measurements ?& array['chest','shoulder','arm','garment_length']
    end)
  and not exists (select 1 from jsonb_each(measurements) m
    where m.key not in ('chest','waist','hips','shoulder','arm','inseam','neck','garment_length')
    or case when jsonb_typeof(m.value) = 'number' then (m.value::text)::numeric not between 1 and 300 else true end)
);
create policy fit_request_vendor_decision on public.fit_requests for update to authenticated
  using (vendor_id = (select auth.uid()) and status = 'requested')
  with check (vendor_id = (select auth.uid()) and status in ('accepted','declined'));
