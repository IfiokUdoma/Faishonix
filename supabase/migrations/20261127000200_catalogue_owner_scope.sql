drop policy catalogue_read on public.vendor_products;
create policy catalogue_read on public.vendor_products for select to anon, authenticated using (published);
create policy catalogue_owner_read on public.vendor_products for select to authenticated using (vendor_id = (select auth.uid()));
