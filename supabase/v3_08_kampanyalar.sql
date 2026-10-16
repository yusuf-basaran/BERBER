begin;
create table if not exists public.promotions (
 id uuid primary key default gen_random_uuid(),
 barber_id uuid not null references public.barbers(id) on delete cascade,
 title text not null check(char_length(trim(title)) between 2 and 80),
 discount_percent numeric(5,2), discount_amount numeric(10,2), currency text,
 service_id uuid references public.services(id) on delete cascade,
 weekdays integer[] not null default array[0,1,2,3,4,5,6],
 time_from time not null default '00:00', time_to time not null default '24:00',
 valid_from date not null, valid_until date not null,
 is_active boolean not null default true, created_at timestamptz not null default now(),
 constraint promotions_discount_check check(
  (discount_percent is not null and discount_percent between 0.01 and 100 and discount_amount is null and currency is null) or
  (discount_percent is null and discount_amount is not null and discount_amount between 0.01 and 99999999.99 and currency is not null and currency in('TRY','GBP','EUR'))),
 constraint promotions_window_check check(valid_until>=valid_from and valid_until-valid_from<=366 and time_to>time_from
  and cardinality(weekdays) between 1 and 7 and weekdays <@ array[0,1,2,3,4,5,6] and array_position(weekdays,null) is null)
);
create index if not exists promotions_barber_idx on public.promotions(barber_id,is_active,valid_until);
create index if not exists promotions_service_idx on public.promotions(service_id) where service_id is not null;
alter table public.promotions enable row level security;
revoke all on public.promotions from public,anon,authenticated;
grant select,delete on public.promotions to authenticated;
grant insert(barber_id,title,discount_percent,discount_amount,currency,service_id,weekdays,time_from,time_to,valid_from,valid_until,is_active),
 update(title,discount_percent,discount_amount,currency,service_id,weekdays,time_from,time_to,valid_from,valid_until,is_active) on public.promotions to authenticated;
grant all on public.promotions to service_role;
drop policy if exists promotions_owner_read on public.promotions;
create policy promotions_owner_read on public.promotions for select to authenticated
 using((select public.mfa_ok()) and private.approved_owner(barber_id));
drop policy if exists promotions_owner_insert on public.promotions;
create policy promotions_owner_insert on public.promotions for insert to authenticated
 with check((select public.mfa_ok()) and private.approved_owner(barber_id));
drop policy if exists promotions_owner_update on public.promotions;
create policy promotions_owner_update on public.promotions for update to authenticated
 using((select public.mfa_ok()) and private.approved_owner(barber_id))
 with check((select public.mfa_ok()) and private.approved_owner(barber_id));
drop policy if exists promotions_owner_delete on public.promotions;
create policy promotions_owner_delete on public.promotions for delete to authenticated
 using((select public.mfa_ok()) and private.approved_owner(barber_id));

create or replace function private.guard_promotion() returns trigger
language plpgsql security definer set search_path='' as $$
declare shop_id uuid:=case when tg_op='DELETE' then old.barber_id else new.barber_id end;
begin
 perform private.approved_panel_owner(shop_id);
 perform 1 from public.barbers where id=shop_id for update;
 if tg_op='DELETE' then return old;end if;
 if tg_op='UPDATE' and row(new.id,new.barber_id,new.created_at) is distinct from row(old.id,old.barber_id,old.created_at) then
  raise exception 'Kampanya sahibi değiştirilemez.' using errcode='42501';end if;
 if tg_op='INSERT' and (select count(*) from public.promotions where barber_id=shop_id)>=20 then
  raise exception 'En fazla 20 kampanya saklayabilirsin.' using errcode='22023';end if;
 if new.service_id is not null and not exists(select 1 from public.services where id=new.service_id and barber_id=shop_id and is_active) then
  raise exception 'Kendi dükkanından aktif bir hizmet seç.' using errcode='22023';end if;
 new.title:=trim(new.title);
 new.weekdays:=array(select distinct d from unnest(new.weekdays) d order by d);
 return new;
end $$;
revoke all on function private.guard_promotion() from public,anon,authenticated,service_role;
drop trigger if exists promotion_guard on public.promotions;
create trigger promotion_guard before insert or update or delete on public.promotions for each row execute function private.guard_promotion();

-- Internal calculation: appointment start in Nicosia, inclusive dates, half-open clock window.
create or replace function private.promotion_for_service(p_barber uuid,p_service uuid,p_price numeric,p_currency text,p_start timestamptz)
returns table(title text,discount numeric) language sql stable security invoker set search_path='' as $$
 select p.title,least(p_price,case when p.discount_percent is not null then round(p_price*p.discount_percent/100,2) else p.discount_amount end) as discount
 from public.promotions p
 where p.barber_id=p_barber and p.is_active and (p.service_id is null or p.service_id=p_service)
  and (p.discount_percent is not null or p.currency=p_currency)
  and (p_start at time zone 'Europe/Nicosia')::date between p.valid_from and p.valid_until
  and extract(dow from p_start at time zone 'Europe/Nicosia')::integer=any(p.weekdays)
  and (p_start at time zone 'Europe/Nicosia')::time>=p.time_from and (p_start at time zone 'Europe/Nicosia')::time<p.time_to
 order by discount desc,p.created_at,p.id limit 1;
$$;
revoke all on function private.promotion_for_service(uuid,uuid,numeric,text,timestamptz) from public,anon,authenticated,service_role;

alter table public.appointments add column if not exists base_price_at_booking numeric(10,2);
alter table public.appointments add column if not exists discount_at_booking numeric(10,2) not null default 0;
alter table public.appointments add column if not exists promotion_title_at_booking text not null default '';
alter table public.appointments drop constraint if exists appointments_promotion_check;
alter table public.appointments add constraint appointments_promotion_check check(discount_at_booking>=0 and
 (base_price_at_booking is null or (base_price_at_booking>=discount_at_booking and price_at_booking=base_price_at_booking-discount_at_booking))
 and char_length(promotion_title_at_booking)<=80);
create or replace function private.snapshot_promotion() returns trigger
language plpgsql security definer set search_path='' as $$
declare deal record;
begin
 if tg_op='UPDATE' then
  if row(new.base_price_at_booking,new.discount_at_booking,new.promotion_title_at_booking) is distinct from row(old.base_price_at_booking,old.discount_at_booking,old.promotion_title_at_booking) then
   raise exception 'Randevunun kampanya bilgileri değiştirilemez.' using errcode='42501';end if;
  return new;
 end if;
 -- appointment_guard has already set the authoritative service price.
 new.base_price_at_booking:=new.price_at_booking;new.discount_at_booking:=0;new.promotion_title_at_booking:='';
 select * into deal from private.promotion_for_service(new.barber_id,new.service_id,new.price_at_booking,new.currency_at_booking,new.start_at);
 if found and deal.discount>0 then
  new.discount_at_booking:=deal.discount;new.promotion_title_at_booking:=deal.title;new.price_at_booking:=new.price_at_booking-deal.discount;
 end if;
 return new;
end $$;
revoke all on function private.snapshot_promotion() from public,anon,authenticated,service_role;
drop trigger if exists z_promotion_price on public.appointments;
create trigger z_promotion_price before insert or update on public.appointments for each row execute function private.snapshot_promotion();

-- No anonymous table grant. Only these bounded, explicitly public prices leave the private helper.
grant usage on schema private to anon;
create or replace function private.public_promotion_prices(p_barber_id uuid,p_start_at timestamptz)
returns table(service_id uuid,service_name text,base_price numeric,price numeric,currency text,promotion_title text,discount_amount numeric)
language plpgsql stable security definer set search_path='' as $$
begin
 if p_start_at is null or not isfinite(p_start_at) or p_start_at<now()-interval '1 day' or p_start_at>now()+interval '91 days' then
  raise exception 'Kampanya saati geçersiz.' using errcode='22023';end if;
 return query select s.id,s.name,s.price,s.price-d.discount,s.currency,d.title,d.discount
 from public.services s join public.barbers b on b.id=s.barber_id
 cross join lateral private.promotion_for_service(b.id,s.id,s.price,s.currency,p_start_at) d
 where b.id=p_barber_id and b.verification_status='approved' and b.is_active and s.is_active and d.discount>0
 order by s.id limit 500;
end $$;
create or replace function public.get_promotion_prices(p_barber_id uuid,p_start_at timestamptz default now())
returns table(service_id uuid,service_name text,base_price numeric,price numeric,currency text,promotion_title text,discount_amount numeric)
language sql stable security invoker set search_path='' as $$select * from private.public_promotion_prices(p_barber_id,p_start_at)$$;
create or replace function private.public_promotion_cards(p_barber_ids uuid[],p_currency text)
returns table(barber_id uuid,service_name text,base_price numeric,price numeric,currency text,promotion_title text,discount_amount numeric)
language plpgsql stable security definer set search_path='' as $$
begin
 if p_barber_ids is null or cardinality(p_barber_ids)>12 or p_currency is null or p_currency not in('TRY','GBP','EUR') then
  raise exception 'Kampanya filtreleri geçersiz.' using errcode='22023';end if;
 return query select distinct on(b.id) b.id,s.name,s.price,s.price-d.discount,s.currency,d.title,d.discount
 from public.barbers b join public.services s on s.barber_id=b.id
 cross join lateral private.promotion_for_service(b.id,s.id,s.price,s.currency,now()) d
 where b.id=any(p_barber_ids) and b.verification_status='approved' and b.is_active and s.is_active and s.currency=p_currency and d.discount>0
 order by b.id,(s.price-d.discount),d.discount desc,s.id;
end $$;
create or replace function public.get_promotion_cards(p_barber_ids uuid[],p_currency text default 'TRY')
returns table(barber_id uuid,service_name text,base_price numeric,price numeric,currency text,promotion_title text,discount_amount numeric)
language sql stable security invoker set search_path='' as $$select * from private.public_promotion_cards(p_barber_ids,p_currency)$$;
revoke all on function private.public_promotion_prices(uuid,timestamptz),public.get_promotion_prices(uuid,timestamptz),
 private.public_promotion_cards(uuid[],text),public.get_promotion_cards(uuid[],text) from public;
grant execute on function private.public_promotion_prices(uuid,timestamptz),public.get_promotion_prices(uuid,timestamptz),
 private.public_promotion_cards(uuid[],text),public.get_promotion_cards(uuid[],text) to anon,authenticated;
commit;
