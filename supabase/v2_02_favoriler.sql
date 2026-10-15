begin;
create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  barber_id uuid not null references public.barbers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,barber_id)
);
create index if not exists favorites_barber_idx on public.favorites(barber_id);
create index if not exists favorites_user_created_idx on public.favorites(user_id,created_at desc,barber_id);
alter table public.favorites enable row level security;
revoke all on public.favorites from public,anon,authenticated;
grant select,delete on public.favorites to authenticated;
grant insert(user_id,barber_id) on public.favorites to authenticated;
grant all on public.favorites to service_role;
drop policy if exists favorites_read on public.favorites;
create policy favorites_read on public.favorites for select to authenticated
  using(user_id=(select auth.uid()) and (select public.mfa_ok()));
drop policy if exists favorites_insert on public.favorites;
create policy favorites_insert on public.favorites for insert to authenticated
  with check(user_id=(select auth.uid()) and (select public.mfa_ok()));
drop policy if exists favorites_delete on public.favorites;
create policy favorites_delete on public.favorites for delete to authenticated
  using(user_id=(select auth.uid()) and (select public.mfa_ok()));
commit;
