-- Yeni Supabase projesinde SQL Editor üzerinden bir kez çalıştırılır.
begin;

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
set local search_path = public, extensions, pg_catalog;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('customer', 'barber')),
  full_name text not null check (char_length(trim(full_name)) between 2 and 100),
  phone text not null check (phone ~ '^\+90(5[0-9]{9}|392[0-9]{7})$'),
  terms_accepted_at timestamptz not null default now(),
  privacy_accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  district text not null,
  unique (city, district)
);
insert into public.locations (city, district)
select city, unnest(districts) from (values
  ('Lefkoşa', array['Surlariçi','Gönyeli','Hamitköy','Yenikent','Küçük Kaymaklı','Kermiya','Dereboyu','Ortaköy']),
  ('Girne', array['Merkez','Alsancak','Lapta','Karaoğlanoğlu','Çatalköy','Ozanköy','Bellapais','Edremit']),
  ('Gazimağusa', array['Merkez','Karakol','Çanakkale','Tuzla','Yeni Boğaziçi','Mutluyaka']),
  ('Güzelyurt', array['Merkez','Serdarlı','Gaziveren']),
  ('İskele', array['Merkez','Long Beach','Boğaz','Yeni Erenköy']),
  ('Lefke', array['Merkez','Yeşilyurt','Gemikonağı'])
) as seed(city, districts);

create table public.barbers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete cascade,
  shop_name text not null check (char_length(trim(shop_name)) between 2 and 120),
  city text not null,
  district text not null,
  address text not null check (char_length(trim(address)) between 5 and 500),
  map_url text check (map_url is null or (length(map_url) <= 2000 and map_url ~ '^https://(maps\.app\.goo\.gl/|goo\.gl/maps/|([a-z0-9-]+\.)?google\.(com|com\.tr)/maps)')),
  phone text not null check (phone ~ '^\+90(5[0-9]{9}|392[0-9]{7})$'),
  whatsapp text check (whatsapp is null or whatsapp ~ '^\+905[0-9]{9}$'),
  bio text not null default '' check (char_length(bio) <= 2000),
  photo_url text check (photo_url is null or (length(photo_url) <= 2000 and photo_url ~ '^https://')),
  avg_rating numeric(3,2) not null default 0 check (avg_rating between 0 and 5),
  review_count integer not null default 0 check (review_count >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (city, district) references public.locations(city, district)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  category text not null check (category in ('Saç Kesimi','Sakal','Saç + Sakal','Cilt Bakımı','Damat Traşı','Çocuk Traşı','Fön','Boya')),
  price numeric(10,2) not null check (price between 0 and 99999999.99),
  currency text not null default 'TRY' check (currency in ('TRY','GBP','EUR')),
  duration_min integer not null check (duration_min between 5 and 480 and duration_min % 5 = 0),
  is_active boolean not null default true
);

-- weekday: 0 Pazar, 1 Pazartesi, ... 6 Cumartesi.
create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  open_time time,
  close_time time,
  break_start time,
  break_end time,
  is_closed boolean not null default false,
  unique (barber_id, weekday),
  check (is_closed or (open_time is not null and close_time is not null and open_time < close_time)),
  check ((break_start is null and break_end is null) or
    (break_start is not null and break_end is not null and open_time is not null
      and close_time is not null and open_time <= break_start and break_start < break_end and break_end <= close_time))
);
create table public.closed_dates (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete cascade,
  date date not null,
  reason text not null default '' check (char_length(reason) <= 300),
  unique (barber_id, date)
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id),
  customer_id uuid not null references public.profiles(id),
  service_id uuid not null references public.services(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','confirmed','rejected','counter_proposed','cancelled','completed')),
  customer_note text not null default '' check (char_length(customer_note) <= 1000),
  barber_note text not null default '' check (char_length(barber_note) <= 1000),
  proposed_start_at timestamptz,
  proposed_end_at timestamptz,
  price_at_booking numeric(10,2) not null check (price_at_booking >= 0),
  currency_at_booking text not null check (currency_at_booking in ('TRY','GBP','EUR')),
  duration_at_booking integer not null check (duration_at_booking between 5 and 480),
  service_name_at_booking text not null,
  created_at timestamptz not null default now(),
  check (end_at = start_at + duration_at_booking * interval '1 minute'),
  check ((status = 'counter_proposed' and proposed_start_at is not null and
      proposed_end_at = proposed_start_at + duration_at_booking * interval '1 minute') or
    (status <> 'counter_proposed' and proposed_start_at is null and proposed_end_at is null)),
  constraint appointments_no_overlap exclude using gist (
    barber_id with =,
    tstzrange(
      case when status = 'counter_proposed' then proposed_start_at else start_at end,
      case when status = 'counter_proposed' then proposed_end_at else end_at end, '[)'
    ) with &&
  ) where (status in ('pending','confirmed','counter_proposed'))
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id),
  barber_id uuid not null references public.barbers(id),
  customer_id uuid not null references public.profiles(id),
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 1500),
  created_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('appointment_requested','appointment_confirmed','appointment_rejected','appointment_counter_proposed','appointment_cancelled','appointment_completed','proposal_accepted','security_recovery')),
  title text not null check (char_length(title) between 1 and 150),
  body text not null check (char_length(body) <= 2000),
  appointment_id uuid references public.appointments(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code_hash)
);
-- Kurtarma denemelerini Edge Function kullanıcı başına kilitleyerek günceller.
create table private.recovery_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  failed_count integer not null default 0 check (failed_count >= 0),
  window_started_at timestamptz not null default now(),
  locked_until timestamptz
);
alter table private.recovery_attempts enable row level security;
grant usage on schema private to service_role;
grant all on private.recovery_attempts to service_role;

create index barbers_location_idx on public.barbers(city, district);
create index services_barber_idx on public.services(barber_id);
create index appointments_barber_start_idx on public.appointments(barber_id, start_at);
create index appointments_customer_start_idx on public.appointments(customer_id, start_at desc);
create index appointments_service_idx on public.appointments(service_id);
create index appointments_start_idx on public.appointments(start_at);
create index reviews_barber_idx on public.reviews(barber_id, created_at desc);
create index reviews_customer_idx on public.reviews(customer_id);
create index notifications_user_read_idx on public.notifications(user_id, is_read, created_at desc);
create index notifications_appointment_idx on public.notifications(appointment_id);

create function private.normalize_phone(value text) returns text
language plpgsql immutable set search_path = '' as $$
declare digits text;
begin
  if value is null or trim(value) = '' then return null; end if;
  if value !~ '^\+?[0-9 ()-]+$' then raise exception 'Telefon numarası geçersiz.' using errcode = '22023'; end if;
  digits := regexp_replace(value, '[^0-9]', '', 'g');
  if left(digits, 4) = '0090' then digits := substr(digits, 3); end if;
  if length(digits) = 11 and left(digits, 1) = '0' then digits := '90' || substr(digits, 2); end if;
  if digits !~ '^90(5[0-9]{9}|392[0-9]{7})$' then
    raise exception 'Telefonu 05xx, 0392 veya +90 biçiminde girin.' using errcode = '22023';
  end if;
  return '+' || digits;
end $$;

create function private.normalize_contact() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.phone := private.normalize_phone(new.phone);
  if tg_table_name = 'barbers' then new.whatsapp := private.normalize_phone(new.whatsapp); end if;
  return new;
end $$;
create trigger profiles_phone before insert or update on public.profiles for each row execute function private.normalize_contact();
create trigger barbers_phone before insert or update on public.barbers for each row execute function private.normalize_contact();

create function private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.raw_user_meta_data->>'role' not in ('customer','barber') or new.raw_user_meta_data->>'role' is null then
    raise exception 'Müşteri veya berber rolünü seçin.' using errcode = '22023';
  end if;
  if coalesce(new.raw_user_meta_data->>'terms_accepted', '') <> 'true' or
     coalesce(new.raw_user_meta_data->>'privacy_accepted', '') <> 'true' then
    raise exception 'Koşulları ve gizlilik politikasını onaylayın.' using errcode = '22023';
  end if;
  insert into public.profiles(id, role, full_name, phone)
  values (new.id, new.raw_user_meta_data->>'role', trim(new.raw_user_meta_data->>'full_name'), new.raw_user_meta_data->>'phone');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.create_profile();

create function public.mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
    or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
  );
$$;

create function private.owns_barber(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.barbers b where b.id = target and b.owner_id = auth.uid()
  );
$$;

create function private.is_customer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'customer');
$$;

create function private.check_window(target uuid, starts timestamptz, finishes timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare local_start timestamp; local_end timestamp; hours public.working_hours; day date;
begin
  if starts is null or finishes is null or starts <= now() or finishes <= starts then
    raise exception 'Gelecekte bir saat seçin.' using errcode = '22023';
  end if;
  local_start := starts at time zone 'Europe/Nicosia';
  local_end := finishes at time zone 'Europe/Nicosia';
  day := local_start::date;
  if local_end::date <> day or local_end <= local_start then
    raise exception 'Randevu aynı çalışma günü içinde olmalı.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.barbers where id = target and is_active) or
    exists (select 1 from public.closed_dates where barber_id = target and date = day) then
    raise exception 'Dükkan bu tarihte kapalı.' using errcode = '22023';
  end if;
  select * into hours from public.working_hours where barber_id = target and weekday = extract(dow from day)::integer;
  if not found or hours.is_closed or local_start::time < hours.open_time or local_end::time > hours.close_time then
    raise exception 'Çalışma saatleri dışında randevu alınamaz.' using errcode = '22023';
  end if;
  if hours.break_start is not null and local_start::time < hours.break_end and local_end::time > hours.break_start then
    raise exception 'Bu saat öğle molasıyla çakışıyor.' using errcode = '22023';
  end if;
end $$;

create function private.guard_appointment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare service public.services; owner uuid; caller uuid := auth.uid();
begin
  select owner_id into owner from public.barbers where id = new.barber_id for update;
  if tg_op = 'INSERT' then
    if caller is null or caller <> new.customer_id or not private.is_customer() or not public.mfa_ok() then
      raise exception 'Bu randevuyu oluşturma yetkiniz yok.' using errcode = '42501';
    end if;
    select * into service from public.services where id = new.service_id and barber_id = new.barber_id and is_active;
    if not found then raise exception 'Hizmet artık sunulmuyor.' using errcode = '22023'; end if;
    new.status := 'pending';
    new.duration_at_booking := service.duration_min;
    new.end_at := new.start_at + service.duration_min * interval '1 minute';
    new.price_at_booking := service.price;
    new.currency_at_booking := service.currency;
    new.service_name_at_booking := service.name;
    new.barber_note := '';
    new.proposed_start_at := null; new.proposed_end_at := null;
    new.created_at := now();
    perform private.check_window(new.barber_id, new.start_at, new.end_at);
    return new;
  end if;
  if caller is null or not public.mfa_ok() then raise exception 'Giriş ve gerekiyorsa iki faktörlü doğrulama gerekli.' using errcode = '42501'; end if;
  if row(new.id,new.barber_id,new.customer_id,new.service_id,new.price_at_booking,new.currency_at_booking,new.duration_at_booking,new.service_name_at_booking,new.created_at,new.customer_note)
     is distinct from row(old.id,old.barber_id,old.customer_id,old.service_id,old.price_at_booking,old.currency_at_booking,old.duration_at_booking,old.service_name_at_booking,old.created_at,old.customer_note) then
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
    elsif old.status = 'counter_proposed' and new.status = 'confirmed' then
      new.start_at := old.proposed_start_at;
      new.end_at := old.proposed_end_at;
      perform private.check_window(new.barber_id, new.start_at, new.end_at);
    elsif old.status = 'counter_proposed' and new.status = 'rejected' then
      null;
    else raise exception 'Bu durum değişikliğini yapamazsınız.' using errcode = '42501'; end if;
  elsif caller = owner then
    if old.status = 'pending' and new.status in ('confirmed','rejected','counter_proposed') then
      null;
    elsif old.status = 'confirmed' and new.status in ('cancelled','counter_proposed','completed') then
      if new.status = 'completed' and old.end_at > now() then raise exception 'Randevu henüz bitmedi.' using errcode = '22023'; end if;
    elsif old.status = 'counter_proposed' and new.status in ('counter_proposed','rejected','cancelled') then
      null;
    else raise exception 'Bu durum değişikliği geçersiz.' using errcode = '42501'; end if;
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
create trigger appointment_guard before insert or update on public.appointments for each row execute function private.guard_appointment();

-- Bu kilit, çalışma takvimi değişikliğiyle rezervasyonu aynı sıraya koyar.
create function private.lock_schedule() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if tg_op = 'DELETE' then target := old.barber_id; else target := new.barber_id; end if;
  if tg_op = 'UPDATE' and new.barber_id <> old.barber_id then raise exception 'Dükkan değiştirilemez.' using errcode = '42501'; end if;
  perform 1 from public.barbers where id = target for update;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger hours_lock before insert or update or delete on public.working_hours for each row execute function private.lock_schedule();
create trigger closed_dates_lock before insert or update or delete on public.closed_dates for each row execute function private.lock_schedule();
create trigger services_lock before insert or update or delete on public.services for each row execute function private.lock_schedule();

create function private.guard_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare booking public.appointments;
begin
  select * into booking from public.appointments where id = new.appointment_id;
  if not found or booking.status <> 'completed' or booking.customer_id <> auth.uid() or not public.mfa_ok() then
    raise exception 'Yalnızca tamamlanan kendi randevunuza yorum yapabilirsiniz.' using errcode = '42501';
  end if;
  perform 1 from public.barbers where id = booking.barber_id for update;
  new.barber_id := booking.barber_id;
  new.customer_id := booking.customer_id;
  new.created_at := now();
  return new;
end $$;
create trigger review_guard before insert on public.reviews for each row execute function private.guard_review();
create function private.refresh_rating() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if tg_op = 'DELETE' then target := old.barber_id; else target := new.barber_id; end if;
  perform 1 from public.barbers where id = target for update;
  update public.barbers set
    avg_rating = (select coalesce(round(avg(rating),2),0) from public.reviews where barber_id = target),
    review_count = (select count(*) from public.reviews where barber_id = target)
  where id = target;
  return null;
end $$;
create trigger review_rating after insert or update or delete on public.reviews for each row execute function private.refresh_rating();

create function private.appointment_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare owner uuid; shop text; recipient uuid; kind text; heading text; message text;
begin
  select owner_id, shop_name into owner, shop from public.barbers where id = new.barber_id;
  if tg_op = 'INSERT' then
    recipient := owner; kind := 'appointment_requested'; heading := 'Yeni randevu talebi';
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
create trigger appointment_notice after insert or update on public.appointments for each row execute function private.appointment_notification();

-- Ziyaretçilere müşteri kimliği veya notlar yerine yalnızca boş saatler döner.
create function public.get_available_slots(p_barber_id uuid, p_service_id uuid, p_date date)
returns table (start_at timestamptz, end_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare duration integer; hours public.working_hours;
begin
  if p_date is null or p_date < (now() at time zone 'Europe/Nicosia')::date or
     p_date > (now() at time zone 'Europe/Nicosia')::date + 90 then return; end if;
  select s.duration_min into duration from public.services s join public.barbers b on b.id = s.barber_id
    where s.id = p_service_id and s.barber_id = p_barber_id and s.is_active and b.is_active;
  if not found or exists (select 1 from public.closed_dates where barber_id = p_barber_id and date = p_date) then return; end if;
  select * into hours from public.working_hours where barber_id = p_barber_id and weekday = extract(dow from p_date)::integer;
  if not found or hours.is_closed then return; end if;
  return query
    with candidates as (
      select instant as starts, instant + duration * interval '1 minute' as finishes
      from generate_series((p_date + hours.open_time) at time zone 'Europe/Nicosia',
        (p_date + hours.close_time) at time zone 'Europe/Nicosia', duration * interval '1 minute') instant
    )
    select c.starts, c.finishes from candidates c
    where c.starts > now()
      and (c.starts at time zone 'Europe/Nicosia')::time >= hours.open_time
      and (c.finishes at time zone 'Europe/Nicosia')::date = p_date
      and (c.finishes at time zone 'Europe/Nicosia')::time <= hours.close_time
      and (c.finishes at time zone 'Europe/Nicosia') > (c.starts at time zone 'Europe/Nicosia')
      and (hours.break_start is null or
        (c.starts at time zone 'Europe/Nicosia')::time >= hours.break_end or
        (c.finishes at time zone 'Europe/Nicosia')::time <= hours.break_start)
      and not exists (
        select 1 from public.appointments a where a.barber_id = p_barber_id
          and a.status in ('pending','confirmed','counter_proposed')
          and tstzrange(c.starts,c.finishes,'[)') && tstzrange(
            case when a.status = 'counter_proposed' then a.proposed_start_at else a.start_at end,
            case when a.status = 'counter_proposed' then a.proposed_end_at else a.end_at end,'[)')
      ) order by c.starts;
end $$;

alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.barbers enable row level security;
alter table public.services enable row level security;
alter table public.working_hours enable row level security;
alter table public.closed_dates enable row level security;
alter table public.appointments enable row level security;
alter table public.reviews enable row level security;
alter table public.notifications enable row level security;
alter table public.recovery_codes enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (id = (select auth.uid()) and (select public.mfa_ok()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select public.mfa_ok()))
  with check (id = (select auth.uid()) and (select public.mfa_ok()));
create policy locations_read on public.locations for select to anon, authenticated using (true);
create policy barbers_read on public.barbers for select to anon, authenticated using (true);
create policy barbers_insert on public.barbers for insert to authenticated with check (
  owner_id = (select auth.uid()) and (select public.mfa_ok()) and
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'barber')
);
create policy barbers_update on public.barbers for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.mfa_ok()))
  with check (owner_id = (select auth.uid()) and (select public.mfa_ok()));
create policy barbers_delete on public.barbers for delete to authenticated using (owner_id = (select auth.uid()) and (select public.mfa_ok()));

create policy services_read on public.services for select to anon, authenticated using (true);
create policy services_insert on public.services for insert to authenticated with check (private.owns_barber(barber_id) and (select public.mfa_ok()));
create policy services_update on public.services for update to authenticated using (private.owns_barber(barber_id) and (select public.mfa_ok())) with check (private.owns_barber(barber_id) and (select public.mfa_ok()));
create policy services_delete on public.services for delete to authenticated using (private.owns_barber(barber_id) and (select public.mfa_ok()));
create policy hours_read on public.working_hours for select to anon, authenticated using (true);
create policy hours_insert on public.working_hours for insert to authenticated with check (private.owns_barber(barber_id) and (select public.mfa_ok()));
create policy hours_update on public.working_hours for update to authenticated using (private.owns_barber(barber_id) and (select public.mfa_ok())) with check (private.owns_barber(barber_id) and (select public.mfa_ok()));
create policy hours_delete on public.working_hours for delete to authenticated using (private.owns_barber(barber_id) and (select public.mfa_ok()));
create policy closed_dates_read on public.closed_dates for select to anon, authenticated using (true);
create policy closed_dates_insert on public.closed_dates for insert to authenticated with check (private.owns_barber(barber_id) and (select public.mfa_ok()));
create policy closed_dates_update on public.closed_dates for update to authenticated using (private.owns_barber(barber_id) and (select public.mfa_ok())) with check (private.owns_barber(barber_id) and (select public.mfa_ok()));
create policy closed_dates_delete on public.closed_dates for delete to authenticated using (private.owns_barber(barber_id) and (select public.mfa_ok()));

create policy appointments_read on public.appointments for select to authenticated
  using ((customer_id = (select auth.uid()) or private.owns_barber(barber_id)) and (select public.mfa_ok()));
create policy appointments_insert on public.appointments for insert to authenticated
  with check (customer_id = (select auth.uid()) and private.is_customer() and status = 'pending' and (select public.mfa_ok()));
create policy appointments_customer_update on public.appointments for update to authenticated
  using (customer_id = (select auth.uid()) and status in ('pending','confirmed','counter_proposed') and (select public.mfa_ok()))
  with check (customer_id = (select auth.uid()) and status in ('confirmed','rejected','cancelled') and (select public.mfa_ok()));
create policy appointments_barber_update on public.appointments for update to authenticated
  using (private.owns_barber(barber_id) and (select public.mfa_ok()))
  with check (private.owns_barber(barber_id) and (select public.mfa_ok()));

create policy reviews_read on public.reviews for select to anon, authenticated using (true);
create policy reviews_insert on public.reviews for insert to authenticated with check (
  customer_id = (select auth.uid()) and (select public.mfa_ok()) and exists (
    select 1 from public.appointments a where a.id = appointment_id and a.customer_id = (select auth.uid())
      and a.barber_id = reviews.barber_id and a.status = 'completed'
  )
);
create policy notifications_read on public.notifications for select to authenticated using (user_id = (select auth.uid()) and (select public.mfa_ok()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and (select public.mfa_ok()))
  with check (user_id = (select auth.uid()) and is_read and (select public.mfa_ok()));

-- Satır politikaları yanında sütun izinleri de istemciyi sınırlar.
revoke all on public.profiles, public.locations, public.barbers, public.services,
  public.working_hours, public.closed_dates, public.appointments, public.reviews,
  public.notifications, public.recovery_codes from public, anon, authenticated;
grant select on public.locations, public.barbers, public.services, public.working_hours, public.closed_dates to anon, authenticated;
grant select on public.profiles, public.appointments, public.notifications to authenticated;
grant select (id,appointment_id,barber_id,rating,comment,created_at) on public.reviews to anon, authenticated;
grant update (full_name,phone) on public.profiles to authenticated;
grant insert (owner_id,shop_name,city,district,address,map_url,phone,whatsapp,bio,photo_url,is_active) on public.barbers to authenticated;
grant update (shop_name,city,district,address,map_url,phone,whatsapp,bio,photo_url,is_active) on public.barbers to authenticated;
grant delete on public.barbers to authenticated;
grant insert (barber_id,name,category,price,currency,duration_min,is_active) on public.services to authenticated;
grant update (name,category,price,currency,duration_min,is_active) on public.services to authenticated;
grant delete on public.services to authenticated;
grant insert (barber_id,weekday,open_time,close_time,break_start,break_end,is_closed) on public.working_hours to authenticated;
grant update (weekday,open_time,close_time,break_start,break_end,is_closed) on public.working_hours to authenticated;
grant delete on public.working_hours to authenticated;
grant insert (barber_id,date,reason) on public.closed_dates to authenticated;
grant update (date,reason) on public.closed_dates to authenticated;
grant delete on public.closed_dates to authenticated;
grant insert (barber_id,customer_id,service_id,start_at,customer_note) on public.appointments to authenticated;
grant update (status,barber_note,proposed_start_at) on public.appointments to authenticated;
grant insert (appointment_id,rating,comment) on public.reviews to authenticated;
grant update (is_read) on public.notifications to authenticated;
grant all on public.profiles, public.locations, public.barbers, public.services,
  public.working_hours, public.closed_dates, public.appointments, public.reviews,
  public.notifications, public.recovery_codes to service_role;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.owns_barber(uuid), private.is_customer() to authenticated;
-- Normalizasyon tetikleyicisi çağrıyı başlatan kullanıcının izinleriyle çalışır.
grant execute on function private.normalize_phone(text) to authenticated, service_role;
revoke all on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated, service_role;
revoke all on function public.get_available_slots(uuid,uuid,date) from public;
grant execute on function public.get_available_slots(uuid,uuid,date) to anon, authenticated, service_role;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('barber-photos','barber-photos',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy barber_photos_read on storage.objects for select to anon, authenticated using (bucket_id = 'barber-photos');
create policy barber_photos_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'barber-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.mfa_ok())
  and exists (select 1 from public.barbers b where b.owner_id = (select auth.uid()))
);
create policy barber_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'barber-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.mfa_ok()))
  with check (bucket_id = 'barber-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.mfa_ok()));
create policy barber_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'barber-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.mfa_ok()));

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

commit;
