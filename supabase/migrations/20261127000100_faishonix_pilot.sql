create table public.scan_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item text not null check (item ~ '^[a-z][a-z_-]{1,24}$'),
  measurements jsonb not null check (jsonb_typeof(measurements) = 'object' and octet_length(measurements::text) <= 2048),
  created_at timestamptz not null default now()
);
create index scan_history_owner_recent on public.scan_history (user_id, created_at desc);
alter table public.scan_history enable row level security;
revoke all on public.scan_history from anon, authenticated;
grant select, delete on public.scan_history to authenticated;
grant insert (item, measurements) on public.scan_history to authenticated;
create policy scan_read on public.scan_history for select to authenticated using (user_id = (select auth.uid()));
create policy scan_write on public.scan_history for insert to authenticated with check (user_id = (select auth.uid()));
create policy scan_remove on public.scan_history for delete to authenticated using (user_id = (select auth.uid()));

create table public.vendor_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  brand text not null check (char_length(brand) between 1 and 100)
);
alter table public.vendor_accounts enable row level security;
revoke all on public.vendor_accounts from anon, authenticated;
grant select on public.vendor_accounts to authenticated;
create policy vendor_self on public.vendor_accounts for select to authenticated using (user_id = (select auth.uid()));

create table public.vendor_products (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null default auth.uid() references public.vendor_accounts(user_id) on delete cascade,
  brand text not null check (char_length(brand) between 1 and 100),
  name text not null check (char_length(name) between 1 and 100),
  description text not null check (char_length(description) between 1 and 500),
  tags text not null default '' check (char_length(tags) <= 180),
  sizes text not null check (char_length(sizes) between 1 and 120),
  size_chart text not null default '' check (char_length(size_chart) <= 500),
  price_kobo integer not null check (price_kobo between 1 and 1000000000),
  purchase_url text not null check (purchase_url ~ '^https://[^[:space:]]+$' and char_length(purchase_url) <= 500),
  photo_path text not null unique check (split_part(photo_path,'/',1) = vendor_id::text and photo_path ~ '^[0-9a-f-]+/[0-9a-f-]+\.(jpg|png|webp)$'),
  published boolean not null default true,
  created_at timestamptz not null default now(),
  search_terms tsvector generated always as (to_tsvector('english'::regconfig, name || ' ' || brand || ' ' || description || ' ' || tags)) stored
);
create index vendor_products_search on public.vendor_products using gin (search_terms) where published;
create index vendor_products_owner on public.vendor_products (vendor_id, created_at desc);
alter table public.vendor_products enable row level security;
revoke all on public.vendor_products from anon, authenticated;
grant select on public.vendor_products to anon, authenticated;
grant insert (brand,name,description,tags,sizes,size_chart,price_kobo,purchase_url,photo_path), update (published) on public.vendor_products to authenticated;
create policy catalogue_read on public.vendor_products for select to anon, authenticated using (published or vendor_id = (select auth.uid()));
create policy catalogue_add on public.vendor_products for insert to authenticated with check (
  vendor_id = (select auth.uid()) and exists (
    select 1 from public.vendor_accounts a where a.user_id = vendor_id and a.brand = vendor_products.brand
  )
);
create policy catalogue_publish on public.vendor_products for update to authenticated using (vendor_id = (select auth.uid())) with check (vendor_id = (select auth.uid()));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('vendor-photos','vendor-photos',true,2097152,array['image/jpeg','image/png','image/webp']);
create policy vendor_photo_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'vendor-photos' and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (select 1 from public.vendor_accounts a where a.user_id = (select auth.uid()))
);
create policy vendor_photo_read_own on storage.objects for select to authenticated using (
  bucket_id = 'vendor-photos' and (storage.foldername(name))[1] = (select auth.uid()::text)
);
create policy vendor_photo_cleanup on storage.objects for delete to authenticated using (
  bucket_id = 'vendor-photos' and (storage.foldername(name))[1] = (select auth.uid()::text)
  and not exists (select 1 from public.vendor_products p where p.photo_path = storage.objects.name)
);
