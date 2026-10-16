begin;
create table if not exists public.waitlist(
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  date date not null,
  time_from time not null,
  time_to time not null,
  status text not null default 'waiting' check(status in('waiting','notified','booked','expired')),
  created_at timestamptz not null default now(),
  check(time_from<time_to)
);
create index if not exists waitlist_match_idx on public.waitlist(barber_id,date,status,created_at);
create index if not exists waitlist_customer_idx on public.waitlist(customer_id,status);
create index if not exists waitlist_service_idx on public.waitlist(service_id);
create unique index if not exists waitlist_active_unique on public.waitlist(customer_id,barber_id,service_id,date) where status in('waiting','notified');
alter table public.waitlist enable row level security;
revoke all on public.waitlist from public,anon,authenticated;
grant select,delete on public.waitlist to authenticated;
grant insert(barber_id,customer_id,service_id,date,time_from,time_to) on public.waitlist to authenticated;
grant all on public.waitlist to service_role;
drop policy if exists waitlist_read on public.waitlist;
create policy waitlist_read on public.waitlist for select to authenticated using(customer_id=(select auth.uid()) and (select public.mfa_ok()));
drop policy if exists waitlist_delete on public.waitlist;
create policy waitlist_delete on public.waitlist for delete to authenticated using(customer_id=(select auth.uid()) and (select public.mfa_ok()));
drop policy if exists waitlist_insert on public.waitlist;
create policy waitlist_insert on public.waitlist for insert to authenticated with check(customer_id=(select auth.uid()) and private.is_customer() and (select public.mfa_ok()) and private.booking_allowed(barber_id));
create or replace function private.guard_waitlist() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.customer_id is distinct from auth.uid() or not public.mfa_ok() or not private.is_customer() or not private.booking_allowed(new.barber_id) then raise exception 'Bu dükkan için bekleme talebi alınamıyor.' using errcode='42501';end if;
  perform 1 from public.profiles where id=new.customer_id for update;
  if new.date<(now() at time zone 'Europe/Nicosia')::date or new.date>(now() at time zone 'Europe/Nicosia')::date+60
    or new.date+new.time_to<=(now() at time zone 'Europe/Nicosia') or not exists(select 1 from public.services where id=new.service_id and barber_id=new.barber_id and is_active) then
    raise exception 'Bekleme günü, saati veya hizmet geçersiz.' using errcode='22023';end if;
  if (select count(*) from public.waitlist where customer_id=new.customer_id and status in('waiting','notified') and date+time_to>(now() at time zone 'Europe/Nicosia'))>=5 then raise exception 'En fazla beş aktif bekleme talebi olabilir.' using errcode='P2012';end if;
  new.status:='waiting';new.created_at:=now();return new;
end $$;
revoke all on function private.guard_waitlist() from public,anon,authenticated,service_role;
drop trigger if exists waitlist_guard on public.waitlist;
create trigger waitlist_guard before insert on public.waitlist for each row execute function private.guard_waitlist();
create or replace function private.notify_waitlist() returns trigger language plpgsql security definer set search_path='' as $$
declare waiter public.waitlist;notified integer:=0;day date:=((case when old.status='counter_proposed' then old.proposed_start_at else old.start_at end) at time zone 'Europe/Nicosia')::date;shop text;
begin
  if new.status<>'cancelled' or old.status='cancelled' then return null;end if;
  select shop_name into shop from public.barbers where id=new.barber_id and verification_status='approved' and is_active;
  if shop is null then return null;end if;
  for waiter in select w.* from public.waitlist w where w.barber_id=new.barber_id and w.date=day and w.status='waiting'
    and not exists(select 1 from public.blocked_customers bc where bc.barber_id=w.barber_id and bc.customer_id=w.customer_id)
    and not exists(select 1 from public.profiles p where p.id=w.customer_id and p.is_banned)
    order by w.created_at,w.id for update skip locked loop
    if exists(select 1 from public.get_available_slots(waiter.barber_id,waiter.service_id,waiter.date) slot
      where (slot.start_at at time zone 'Europe/Nicosia')::time>=waiter.time_from and (slot.end_at at time zone 'Europe/Nicosia')::time<=waiter.time_to) then
      update public.waitlist set status='notified' where id=waiter.id;
      insert into public.notifications(user_id,type,title,body,barber_id) values(waiter.customer_id,'waitlist_available','Beklediğin dükkanda boş saat var',shop||' · '||waiter.date::text||'. Uygun saatler değişebilir; ilk rezervasyon yapan alır.',waiter.barber_id);
      notified:=notified+1;exit when notified>=3;
    end if;
  end loop;return null;
end $$;
revoke all on function private.notify_waitlist() from public,anon,authenticated,service_role;
drop trigger if exists waitlist_cancellation on public.appointments;
create trigger waitlist_cancellation after update of status on public.appointments for each row execute function private.notify_waitlist();
create or replace function private.book_waitlist() returns trigger language plpgsql security definer set search_path='' as $$begin
  if new.customer_id is not null then update public.waitlist set status='booked' where customer_id=new.customer_id and barber_id=new.barber_id and service_id=new.service_id and status in('waiting','notified')
    and date=(new.start_at at time zone 'Europe/Nicosia')::date and (new.start_at at time zone 'Europe/Nicosia')::time>=time_from and (new.end_at at time zone 'Europe/Nicosia')::time<=time_to;end if;return null;
end $$;
revoke all on function private.book_waitlist() from public,anon,authenticated,service_role;
drop trigger if exists waitlist_booked on public.appointments;
create trigger waitlist_booked after insert on public.appointments for each row execute function private.book_waitlist();
commit;
