-- Shipment updates are separate from requests so order tracking cannot edit buyer measurements or account fields.
create table public.fit_request_progress (
  request_id uuid not null references public.fit_requests(id) on delete cascade,
  status text not null check (status in ('in_production','shipped','delivered')),
  tracking_reference text check (char_length(tracking_reference) between 1 and 120),
  created_at timestamptz not null default now(),
  primary key (request_id,status),
  check ((status = 'shipped') = (tracking_reference is not null))
);
alter table public.fit_request_progress enable row level security;
revoke all on public.fit_request_progress from anon, authenticated;
grant select on public.fit_request_progress to authenticated;
grant insert (request_id,status,tracking_reference) on public.fit_request_progress to authenticated;
create policy fit_progress_read on public.fit_request_progress for select to authenticated using (
  exists (select 1 from public.fit_requests r where r.id = request_id and
    (r.vendor_id = (select auth.uid()) or r.customer_id = (select auth.uid())))
);
create policy fit_progress_add on public.fit_request_progress for insert to authenticated with check (
  exists (select 1 from public.fit_requests r where r.id = request_id and r.status = 'accepted'
    and r.vendor_id = (select auth.uid()))
);

create function public.check_fit_request_progress() returns trigger language plpgsql
set search_path = '' as $$
declare
  prerequisite text;
begin
  prerequisite := case new.status when 'shipped' then 'in_production' when 'delivered' then 'shipped' end;
  if prerequisite is not null and not exists (
    select 1 from public.fit_request_progress p where p.request_id = new.request_id and p.status = prerequisite
  ) then
    raise exception 'Invalid order progression' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger validate_fit_request_progress before insert on public.fit_request_progress
for each row execute function public.check_fit_request_progress();

create table public.try_on_daily_slots (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null default ((now() at time zone 'utc')::date),
  slot smallint not null check (slot between 1 and 4),
  primary key (user_id,day,slot)
);
alter table public.try_on_daily_slots enable row level security;
revoke all on public.try_on_daily_slots from anon, authenticated;
grant insert (slot) on public.try_on_daily_slots to authenticated;
create policy try_on_slot_claim on public.try_on_daily_slots for insert to authenticated
with check (user_id = (select auth.uid()) and day = ((now() at time zone 'utc')::date));
