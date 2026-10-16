begin;
alter table public.barbers add column if not exists loyalty_enabled boolean not null default false;
alter table public.barbers add column if not exists loyalty_stamps_required integer not null default 10;
alter table public.barbers add column if not exists loyalty_reward text not null default '';
alter table public.barbers drop constraint if exists barbers_loyalty_check;
alter table public.barbers add constraint barbers_loyalty_check check(loyalty_stamps_required between 1 and 50
 and char_length(trim(loyalty_reward))<=120 and (not loyalty_enabled or char_length(trim(loyalty_reward))>=2));
grant select(loyalty_enabled,loyalty_stamps_required,loyalty_reward) on public.barbers to anon,authenticated;
grant update(loyalty_enabled,loyalty_stamps_required,loyalty_reward) on public.barbers to authenticated;
create or replace function private.guard_loyalty_settings() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.loyalty_enabled and row(new.loyalty_enabled,new.loyalty_stamps_required,new.loyalty_reward)
  is distinct from row(old.loyalty_enabled,old.loyalty_stamps_required,old.loyalty_reward) then
  perform private.approved_panel_owner(old.id);
 end if;
 new.loyalty_reward:=trim(new.loyalty_reward);return new;
end $$;
revoke all on function private.guard_loyalty_settings() from public,anon,authenticated,service_role;
drop trigger if exists barber_loyalty_settings on public.barbers;
create trigger barber_loyalty_settings before update on public.barbers for each row execute function private.guard_loyalty_settings();

create table if not exists public.loyalty_redemptions(
 id uuid primary key default gen_random_uuid(),
 barber_id uuid not null references public.barbers(id) on delete cascade,
 customer_id uuid not null references public.profiles(id) on delete cascade,
 appointment_id uuid not null unique references public.appointments(id),
 stamps_used integer not null check(stamps_used between 1 and 50),
 reward text not null check(char_length(reward) between 2 and 120),
 created_at timestamptz not null default now()
);
create index if not exists loyalty_redemptions_shop_customer_idx on public.loyalty_redemptions(barber_id,customer_id);
create index if not exists loyalty_redemptions_customer_idx on public.loyalty_redemptions(customer_id);
create index if not exists appointments_loyalty_idx on public.appointments(barber_id,customer_id) where status='completed' and customer_id is not null;
alter table public.loyalty_redemptions enable row level security;
revoke all on public.loyalty_redemptions from public,anon,authenticated;
grant select on public.loyalty_redemptions to authenticated;
grant all on public.loyalty_redemptions to service_role;
drop policy if exists loyalty_redemptions_read on public.loyalty_redemptions;
create policy loyalty_redemptions_read on public.loyalty_redemptions for select to authenticated
 using((select public.mfa_ok()) and (customer_id=(select auth.uid()) or private.approved_owner(barber_id)));
create or replace function private.keep_loyalty_redemption() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Kullanılmış sadakat ödülü değiştirilemez.' using errcode='42501';end $$;
revoke all on function private.keep_loyalty_redemption() from public,anon,authenticated,service_role;
drop trigger if exists loyalty_redemption_immutable on public.loyalty_redemptions;
create trigger loyalty_redemption_immutable before update on public.loyalty_redemptions for each row execute function private.keep_loyalty_redemption();

-- Counts come from appointment history; no writable stamp balance exists.
create or replace view public.loyalty_progress with(security_invoker=true) as
 select a.barber_id,a.customer_id,count(*) filter(where a.status='completed') as completed_visits,
 coalesce((select sum(r.stamps_used) from public.loyalty_redemptions r where r.barber_id=a.barber_id and r.customer_id=a.customer_id),0)::bigint as spent_stamps,
 greatest(0,count(*) filter(where a.status='completed')-coalesce((select sum(r.stamps_used) from public.loyalty_redemptions r where r.barber_id=a.barber_id and r.customer_id=a.customer_id),0))::bigint as available_stamps
 from public.appointments a where a.customer_id is not null group by a.barber_id,a.customer_id;
revoke all on public.loyalty_progress from public,anon,authenticated;
grant select on public.loyalty_progress to authenticated;

create or replace function public.get_loyalty_card(p_customer_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare shop uuid:=private.customer_shop();result jsonb;
begin
 select to_jsonb(p)||jsonb_build_object('enabled',b.loyalty_enabled,'required',b.loyalty_stamps_required,'reward',b.loyalty_reward,
 'redeemed_appointments',coalesce((select jsonb_agg(r.appointment_id) from public.loyalty_redemptions r where r.barber_id=shop and r.customer_id=p_customer_id),'[]'::jsonb))
 into result from public.loyalty_progress p join public.barbers b on b.id=p.barber_id where p.barber_id=shop and p.customer_id=p_customer_id;
 if result is null then raise exception 'Bu müşteriyle randevu ilişkisi bulunamadı.' using errcode='42501';end if;
 return result;
end $$;
create or replace function public.get_customer_loyalty(p_page integer default 1) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.mfa_ok() or not private.is_customer() then raise exception 'Müşteri oturumu gerekli.' using errcode='42501';end if;
 if p_page is null or p_page not between 1 and 1000 then raise exception 'Sayfa geçersiz.' using errcode='22023';end if;
 with selected as(
  select p.*,b.shop_name,b.loyalty_enabled as enabled,b.loyalty_stamps_required as required,b.loyalty_reward as reward
  from public.loyalty_progress p join public.barbers b on b.id=p.barber_id
  where p.customer_id=auth.uid() and (b.loyalty_enabled or b.loyalty_reward<>'' or p.spent_stamps>0)
 ), paged as(select * from selected order by shop_name,barber_id limit 12 offset (p_page-1)*12)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from selected)) into result;
 return result;
end $$;
create or replace function private.redeem_loyalty(p_appointment_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare booking public.appointments;shop public.barbers;earned bigint;spent bigint;existing uuid;redemption uuid;
begin
 if auth.uid() is null or not public.mfa_ok() then raise exception 'Giriş ve gerekiyorsa iki faktörlü doğrulama gerekli.' using errcode='42501';end if;
 select * into booking from public.appointments where id=p_appointment_id;
 if not found then raise exception 'Randevu bulunamadı.' using errcode='42501';end if;
 perform private.approved_panel_owner(booking.barber_id);
 -- Same lock as booking/status changes. Completed appointments are terminal, so no inverse appointment row lock is needed.
 select * into shop from public.barbers where id=booking.barber_id for update;
 if shop.owner_id is distinct from auth.uid() or shop.verification_status<>'approved' or not shop.is_active then
  raise exception 'Onaylı ve aktif dükkan sahibi gerekli.' using errcode='P2004';end if;
 if booking.status<>'completed' or booking.customer_id is null then raise exception 'Ödül yalnızca tamamlanmış kayıtlı müşteri randevusunda kullanılabilir.' using errcode='22023';end if;
 select id into existing from public.loyalty_redemptions where appointment_id=booking.id;
 if found then return jsonb_build_object('id',existing,'already_used',true);end if;
 if not shop.loyalty_enabled then raise exception 'Sadakat programı etkin değil.' using errcode='22023';end if;
 select count(*) into earned from public.appointments where barber_id=shop.id and customer_id=booking.customer_id and status='completed';
 select coalesce(sum(stamps_used),0) into spent from public.loyalty_redemptions where barber_id=shop.id and customer_id=booking.customer_id;
 if earned-spent<shop.loyalty_stamps_required then raise exception 'Ödül için yeterli damga yok.' using errcode='22023';end if;
 insert into public.loyalty_redemptions(barber_id,customer_id,appointment_id,stamps_used,reward)
 values(shop.id,booking.customer_id,booking.id,shop.loyalty_stamps_required,shop.loyalty_reward) returning id into redemption;
 return jsonb_build_object('id',redemption,'already_used',false);
end $$;
create or replace function public.redeem_loyalty(p_appointment_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.redeem_loyalty(p_appointment_id)$$;
revoke all on function public.get_loyalty_card(uuid),public.get_customer_loyalty(integer),private.redeem_loyalty(uuid),public.redeem_loyalty(uuid) from public,anon;
grant execute on function public.get_loyalty_card(uuid),public.get_customer_loyalty(integer),private.redeem_loyalty(uuid),public.redeem_loyalty(uuid) to authenticated;
commit;
