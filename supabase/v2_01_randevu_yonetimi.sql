begin;
alter table public.appointments alter column customer_id drop not null;
alter table public.appointments add column if not exists guest_name text;
alter table public.appointments add column if not exists guest_phone text;
alter table public.appointments add column if not exists source text not null default 'online';
alter table public.barbers add column if not exists cancel_hours_before integer not null default 2;
alter table public.barbers drop constraint if exists barbers_cancel_hours_check;
alter table public.barbers add constraint barbers_cancel_hours_check check(cancel_hours_before between 0 and 8760);
alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments add constraint appointments_status_check check(status in ('pending','confirmed','rejected','counter_proposed','cancelled','completed','no_show'));
alter table public.appointments drop constraint if exists appointments_guest_check;
alter table public.appointments add constraint appointments_guest_check check(
  (customer_id is not null or guest_name is not null) and source in ('online','manual') and
  (source<>'online' or customer_id is not null) and
  (customer_id is not null or (source='manual' and char_length(trim(guest_name)) between 2 and 100 and
    guest_phone is not null and guest_phone ~ '^\+90(5[0-9]{9}|392[0-9]{7})$'))
);
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in (
  'appointment_requested','appointment_confirmed','appointment_rejected','appointment_counter_proposed',
  'appointment_cancelled','appointment_completed','appointment_no_show','proposal_accepted','security_recovery'));

create table if not exists public.blocked_customers (
  barber_id uuid not null references public.barbers(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(barber_id,customer_id)
);
create index if not exists blocked_customers_customer_idx on public.blocked_customers(customer_id);
create index if not exists appointments_no_show_customer_idx on public.appointments(customer_id) where status='no_show';
create index if not exists profiles_phone_lookup_idx on public.profiles(phone) where role='customer';
alter table public.blocked_customers enable row level security;
revoke all on public.blocked_customers from public,anon,authenticated;
grant select,delete on public.blocked_customers to authenticated;
grant insert(barber_id,customer_id) on public.blocked_customers to authenticated;
grant all on public.blocked_customers to service_role;
drop policy if exists blocked_customers_read on public.blocked_customers;
create policy blocked_customers_read on public.blocked_customers for select to authenticated
  using(private.owns_barber(barber_id) and (select public.mfa_ok()));
drop policy if exists blocked_customers_insert on public.blocked_customers;
create policy blocked_customers_insert on public.blocked_customers for insert to authenticated with check(
  private.owns_barber(barber_id) and (select public.mfa_ok()) and exists(
    select 1 from public.appointments a where a.barber_id=blocked_customers.barber_id and a.customer_id=blocked_customers.customer_id));
drop policy if exists blocked_customers_delete on public.blocked_customers;
create policy blocked_customers_delete on public.blocked_customers for delete to authenticated
  using(private.owns_barber(barber_id) and (select public.mfa_ok()));

create or replace function private.booking_allowed(p_barber_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and not exists(select 1 from public.blocked_customers
    where barber_id=p_barber_id and customer_id=auth.uid());
$$;
revoke all on function private.booking_allowed(uuid) from public,anon;
grant execute on function private.booking_allowed(uuid) to authenticated;
drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments for insert to authenticated with check(
  (select public.mfa_ok()) and (
    (source='online' and customer_id=(select auth.uid()) and private.is_customer() and status='pending' and private.booking_allowed(barber_id)) or
    (source='manual' and private.owns_barber(barber_id) and status='confirmed')));
grant insert(source,guest_name,guest_phone,barber_note) on public.appointments to authenticated;
grant insert(cancel_hours_before),update(cancel_hours_before) on public.barbers to authenticated;

create or replace function private.lock_blocked_customer() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then perform 1 from public.barbers where id=old.barber_id for update; return old; end if;
  perform 1 from public.barbers where id=new.barber_id for update;
  return new;
end $$;
revoke all on function private.lock_blocked_customer() from public,anon,authenticated;
drop trigger if exists blocked_customer_lock on public.blocked_customers;
create trigger blocked_customer_lock before insert or delete on public.blocked_customers for each row execute function private.lock_blocked_customer();

create or replace function private.no_show_count(p_appointment_id uuid) returns bigint
language plpgsql stable security definer set search_path='' as $$
declare booking public.appointments;
begin
  select * into booking from public.appointments where id=p_appointment_id;
  if not found or booking.customer_id is null or booking.status<>'pending' then raise exception 'Bekleyen müşteri talebi bulunamadı.' using errcode='42501'; end if;
  perform private.panel_owner(booking.barber_id);
  return (select count(*) from public.appointments where customer_id=booking.customer_id and status='no_show');
end $$;
create or replace function public.get_customer_no_show_count(p_appointment_id uuid) returns bigint
language sql stable security invoker set search_path='' as $$ select private.no_show_count(p_appointment_id); $$;

create or replace function private.find_booking_customer(p_barber_id uuid,p_phone text)
returns table(id uuid,full_name text,phone text)
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.panel_owner(p_barber_id);
  return query select p.id,p.full_name,p.phone from public.profiles p
    where p.role='customer' and p.phone=private.normalize_phone(p_phone) order by p.id limit 5;
end $$;
create or replace function public.find_booking_customer(p_barber_id uuid,p_phone text)
returns table(id uuid,full_name text,phone text) language sql stable security invoker set search_path='' as $$
  select * from private.find_booking_customer(p_barber_id,p_phone);
$$;

create or replace function private.list_blocked_customers(p_barber_id uuid)
returns table(customer_id uuid,full_name text,phone text,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.panel_owner(p_barber_id);
  return query select bc.customer_id,p.full_name,p.phone,bc.created_at from public.blocked_customers bc
    join public.profiles p on p.id=bc.customer_id where bc.barber_id=p_barber_id order by bc.created_at desc;
end $$;
create or replace function public.list_blocked_customers(p_barber_id uuid)
returns table(customer_id uuid,full_name text,phone text,created_at timestamptz)
language sql stable security invoker set search_path='' as $$ select * from private.list_blocked_customers(p_barber_id); $$;

create or replace function private.guard_appointment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare service public.services; owner uuid; caller uuid := auth.uid();
begin
  select owner_id into owner from public.barbers where id = new.barber_id for update;
  if tg_op = 'INSERT' then
    if caller is null or not public.mfa_ok() then
      raise exception 'Bu randevuyu oluşturma yetkiniz yok.' using errcode = '42501';
    end if;
    select * into service from public.services where id = new.service_id and barber_id = new.barber_id and is_active;
    if not found then raise exception 'Hizmet artık sunulmuyor.' using errcode = '22023'; end if;
    if new.source = 'manual' then
      if caller is distinct from owner then raise exception 'Manuel randevu yalnızca dükkan sahibi tarafından eklenebilir.' using errcode='42501'; end if;
      if new.customer_id is not null and not exists(select 1 from public.profiles where id=new.customer_id and role='customer') then
        raise exception 'Müşteri hesabı bulunamadı.' using errcode='22023';
      end if;
      if new.customer_id is null then
        new.guest_name := nullif(trim(new.guest_name),'');
        new.guest_phone := private.normalize_phone(new.guest_phone);
      else new.guest_name := null; new.guest_phone := null; end if;
      new.status := 'confirmed';
    elsif new.source = 'online' and caller = new.customer_id and private.is_customer() then
      if not private.booking_allowed(new.barber_id) then raise exception 'Bu dükkandan şu an randevu alınamıyor.' using errcode='P2002'; end if;
      new.guest_name := null; new.guest_phone := null;
      new.status := 'pending';
    else raise exception 'Bu randevuyu oluşturma yetkiniz yok.' using errcode='42501'; end if;
    new.duration_at_booking := service.duration_min;
    new.end_at := new.start_at + service.duration_min * interval '1 minute';
    new.price_at_booking := service.price;
    new.currency_at_booking := service.currency;
    new.service_name_at_booking := service.name;
    if new.source='online' then new.barber_note := ''; end if;
    new.proposed_start_at := null; new.proposed_end_at := null;
    new.created_at := now();
    perform private.check_window(new.barber_id, new.start_at, new.end_at);
    return new;
  end if;
  if caller is null or not public.mfa_ok() then raise exception 'Giriş ve gerekiyorsa iki faktörlü doğrulama gerekli.' using errcode = '42501'; end if;
  if row(new.id,new.barber_id,new.customer_id,new.service_id,new.price_at_booking,new.currency_at_booking,new.duration_at_booking,new.service_name_at_booking,new.created_at,new.customer_note,new.source,new.guest_name,new.guest_phone)
     is distinct from row(old.id,old.barber_id,old.customer_id,old.service_id,old.price_at_booking,old.currency_at_booking,old.duration_at_booking,old.service_name_at_booking,old.created_at,old.customer_note,old.source,old.guest_name,old.guest_phone) then
    raise exception 'Randevu bilgileri değiştirilemez.' using errcode = '42501';
  end if;
  if new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at then
    raise exception 'Saat yalnızca müşterinin öneriyi kabul etmesiyle değişir.' using errcode = '42501';
  end if;
  if caller = old.customer_id then
    if new.barber_note is distinct from old.barber_note or new.proposed_start_at is distinct from old.proposed_start_at then
      raise exception 'Berber notu veya önerisi değiştirilemez.' using errcode = '42501';
    end if;
    if new.status = 'cancelled' and old.status in ('pending','confirmed','counter_proposed') then
      if (case when old.status = 'counter_proposed' then old.proposed_start_at else old.start_at end) <= now() then
        raise exception 'Başlamış bir randevu iptal edilemez.' using errcode = '22023';
      end if;
      if exists(select 1 from public.barbers b where b.id=old.barber_id and b.cancel_hours_before>0
        and (case when old.status='counter_proposed' then old.proposed_start_at else old.start_at end)
          < now()+b.cancel_hours_before*interval '1 hour') then
        raise exception 'İptal süresi geçti. Lütfen berberinizle iletişime geçin.' using errcode='P2001';
      end if;
    elsif old.status = 'counter_proposed' and new.status = 'confirmed' then
      new.start_at := old.proposed_start_at;
      new.end_at := old.proposed_end_at;
      perform private.check_window(new.barber_id, new.start_at, new.end_at);
    elsif old.status = 'counter_proposed' and new.status = 'rejected' then
      null;
    else raise exception 'Bu durum değişikliğini yapamazsınız.' using errcode = '42501'; end if;
  elsif caller = owner then
    if old.status = 'pending' and new.status in ('confirmed','rejected','counter_proposed','cancelled') then
      null;
    elsif old.status = 'confirmed' and new.status in ('cancelled','counter_proposed','completed','no_show') then
      if new.status = 'completed' and old.end_at > now() then raise exception 'Randevu henüz bitmedi.' using errcode = '22023'; end if;
    elsif old.status = 'counter_proposed' and new.status in ('counter_proposed','rejected','cancelled') then
      null;
    else raise exception 'Bu durum değişikliği geçersiz.' using errcode = '42501'; end if;
    if old.customer_id is null and new.status='counter_proposed' then raise exception 'Misafir randevusuna saat önerilemez; iptal edip yeni randevu ekleyin.' using errcode='22023'; end if;
    if new.status='no_show' and old.start_at>now() then raise exception 'Randevu saati henüz gelmedi.' using errcode='22023'; end if;
    if new.status='cancelled' and trim(new.barber_note)='' then raise exception 'İptal sebebini yazın.' using errcode='22023'; end if;
    if new.status = 'rejected' and trim(new.barber_note) = '' then raise exception 'Ret sebebini yazın.' using errcode = '22023'; end if;
    if new.status = 'counter_proposed' then
      new.proposed_end_at := new.proposed_start_at + old.duration_at_booking * interval '1 minute';
      perform private.check_window(new.barber_id, new.proposed_start_at, new.proposed_end_at);
    elsif new.status = 'confirmed' then
      perform private.check_window(new.barber_id, new.start_at, new.end_at);
    end if;
  else raise exception 'Bu randevuya erişiminiz yok.' using errcode = '42501'; end if;
  if new.status <> 'counter_proposed' then new.proposed_start_at := null; new.proposed_end_at := null; end if;
  return new;
end $$;
create or replace function private.appointment_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare owner uuid; shop text; recipient uuid; kind text; heading text; message text;
begin
  if new.customer_id is null then return null; end if;
  select owner_id, shop_name into owner, shop from public.barbers where id = new.barber_id;
  if tg_op = 'INSERT' then
    recipient := owner; kind := 'appointment_requested'; heading := 'Yeni randevu talebi';
    if new.source='manual' then recipient:=new.customer_id; kind:='appointment_confirmed'; heading:='Randevunuz oluşturuldu'; end if;
    message := new.service_name_at_booking || ' için bir talep geldi.';
  else
    if new.status = old.status and new.proposed_start_at is not distinct from old.proposed_start_at then return null; end if;
    recipient := new.customer_id; kind := 'appointment_' || new.status;
    case new.status
      when 'confirmed' then
        heading := 'Randevunuz onaylandı';
        if old.status = 'counter_proposed' then recipient := owner; kind := 'proposal_accepted'; heading := 'Önerdiğiniz saat kabul edildi'; end if;
      when 'rejected' then heading := 'Randevu talebi reddedildi';
        if old.status = 'counter_proposed' and auth.uid() = new.customer_id then recipient := owner; heading := 'Saat önerisi reddedildi'; end if;
      when 'counter_proposed' then heading := 'Yeni saat önerildi';
      when 'cancelled' then heading := 'Randevu iptal edildi'; if auth.uid() = new.customer_id then recipient := owner; end if;
      when 'no_show' then heading := 'Randevunuza gelmediğiniz işaretlendi';
      when 'completed' then heading := 'Randevunuz tamamlandı';
      else return null;
    end case;
    message := shop || ' · ' || new.service_name_at_booking;
    if new.barber_note <> '' then message := message || ': ' || new.barber_note; end if;
  end if;
  insert into public.notifications(user_id,type,title,body,appointment_id)
  values (recipient,kind,heading,message,new.id);
  return null;
end $$;
create or replace function private.guard_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare booking public.appointments;
begin
  select * into booking from public.appointments where id = new.appointment_id;
  if not found or booking.customer_id is null or booking.status <> 'completed' or booking.customer_id <> auth.uid() or not public.mfa_ok() then
    raise exception 'Yalnızca tamamlanan kendi randevunuza yorum yapabilirsiniz.' using errcode = '42501';
  end if;
  perform 1 from public.barbers where id = booking.barber_id for update;
  new.barber_id := booking.barber_id;
  new.customer_id := booking.customer_id;
  new.created_at := now();
  return new;
end $$;
create or replace function private.panel_appointments(p_barber_id uuid,p_view text,p_status text,p_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; total bigint; today date:=(now() at time zone 'Europe/Nicosia')::date;
begin
  perform private.panel_owner(p_barber_id);
  if p_view not in ('today','pending','all') or p_view is null or p_page is null or p_page not between 1 and 1000 or
    p_status is null or p_status not in ('','pending','confirmed','rejected','counter_proposed','cancelled','completed','no_show') then
    raise exception 'Filtreler geçersiz.' using errcode='22023';
  end if;
  with selected as (
    select a.*,coalesce(p.full_name,a.guest_name) as customer_name,coalesce(p.phone,a.guest_phone) as customer_phone,
      case when a.status='pending' and a.customer_id is not null then private.no_show_count(a.id) else null end as no_show_count,
      exists(select 1 from public.blocked_customers bc where bc.barber_id=a.barber_id and bc.customer_id=a.customer_id) as customer_blocked,
      case when a.status='counter_proposed' then a.proposed_start_at else a.start_at end as effective_start
    from public.appointments a left join public.profiles p on p.id=a.customer_id
    where a.barber_id=p_barber_id and (p_status='' or a.status=p_status)
      and (p_view='all' or (p_view='pending' and a.status='pending') or
        (p_view='today' and a.status not in ('rejected','cancelled') and
          ((case when a.status='counter_proposed' then a.proposed_start_at else a.start_at end) at time zone 'Europe/Nicosia')::date=today))
  ), numbered as (select s.*,count(*) over() as total_count from selected s), paged as (
    select * from numbered order by effective_start,id limit 12 offset (p_page-1)*12
  ) select coalesce(jsonb_agg(to_jsonb(paged)-'total_count'),'[]'::jsonb),coalesce(max(total_count),0) into rows,total from paged;
  return jsonb_build_object('rows',rows,'total',total);
end $$;
revoke all on function private.no_show_count(uuid),private.find_booking_customer(uuid,text),private.list_blocked_customers(uuid),
  public.get_customer_no_show_count(uuid),public.find_booking_customer(uuid,text),public.list_blocked_customers(uuid) from public,anon;
grant execute on function private.no_show_count(uuid),private.find_booking_customer(uuid,text),private.list_blocked_customers(uuid),
  public.get_customer_no_show_count(uuid),public.find_booking_customer(uuid,text),public.list_blocked_customers(uuid) to authenticated;
commit;
