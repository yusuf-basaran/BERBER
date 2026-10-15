begin;
set local lock_timeout='5s';
do $$
begin
  if exists(select 1 from public.barbers group by owner_id having count(*)>1) then
    raise exception 'Aynı kullanıcıya bağlı birden çok dükkan var; önce raporlanmalı.' using errcode='23505';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='barbers' and column_name='verification_status') then
    alter table public.barbers add column verification_status text not null default 'approved';
  end if;
end $$;
alter table public.barbers alter column verification_status set default 'pending';
alter table public.barbers add column if not exists rejection_reason text;
alter table public.barbers add column if not exists admin_note text not null default '';
alter table public.barbers add column if not exists checklist jsonb not null default '{}';
alter table public.barbers add column if not exists submitted_at timestamptz not null default now();
alter table public.barbers add column if not exists decided_at timestamptz;
alter table public.barbers add column if not exists decided_by uuid;
alter table public.barbers add column if not exists application_count integer not null default 1;
alter table public.barbers add column if not exists instagram_url text;
alter table public.barbers drop constraint if exists barbers_verification_check;
alter table public.barbers add constraint barbers_verification_check check(verification_status in ('pending','approved','rejected','suspended'));
alter table public.barbers drop constraint if exists barbers_application_check;
alter table public.barbers add constraint barbers_application_check check(application_count between 1 and 3 and char_length(admin_note)<=2000 and char_length(rejection_reason)<=1000);
alter table public.barbers drop constraint if exists barbers_checklist_check;
alter table public.barbers add constraint barbers_checklist_check check(jsonb_typeof(checklist)='object'
  and (checklist-array['phone_called','map_checked','listing_checked','document_checked'])='{}'::jsonb
  and not jsonb_path_exists(checklist,'$.* ? (@.type() != "boolean")'));
alter table public.barbers drop constraint if exists barbers_instagram_check;
alter table public.barbers add constraint barbers_instagram_check check(instagram_url is null or instagram_url ~ '^https://(www\.)?instagram\.com/[A-Za-z0-9_.]{1,30}/?$');
create index if not exists barbers_verification_submitted_idx on public.barbers(verification_status,submitted_at,id);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null,
  action text not null check(char_length(action) between 1 and 80),
  target_type text not null check(char_length(target_type) between 1 and 80),
  target_id uuid not null,
  detail jsonb not null default '{}' check(jsonb_typeof(detail)='object' and octet_length(detail::text)<=12000),
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit_log(created_at desc,id);
alter table public.admin_users enable row level security;
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_users,public.admin_audit_log from public,anon,authenticated,service_role;
grant select on public.admin_users,public.admin_audit_log to authenticated,service_role;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and coalesce(auth.jwt()->>'aal','aal1')='aal2' and public.mfa_ok()
    and exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified')
    and exists(select 1 from public.admin_users a where a.user_id=auth.uid());
$$;
revoke all on function public.is_admin() from public,anon;
grant execute on function public.is_admin() to authenticated,service_role;
drop policy if exists admins_read on public.admin_users;
create policy admins_read on public.admin_users for select to authenticated using((select public.is_admin()));
drop policy if exists audit_read on public.admin_audit_log;
create policy audit_read on public.admin_audit_log for select to authenticated using((select public.is_admin()));

create or replace function private.keep_admin_audit() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'Yönetim işlem kaydı değiştirilemez.' using errcode='42501';
end $$;
revoke all on function private.keep_admin_audit() from public,anon,authenticated,service_role;
drop trigger if exists admin_audit_immutable on public.admin_audit_log;
create trigger admin_audit_immutable before update or delete on public.admin_audit_log for each row execute function private.keep_admin_audit();

create or replace function private.guard_barber_application() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    new.verification_status:='pending';new.rejection_reason:=null;new.admin_note:='';new.checklist:='{}';
    new.submitted_at:=now();new.decided_at:=null;new.decided_by:=null;new.application_count:=1;
  elsif row(new.verification_status,new.rejection_reason,new.admin_note,new.checklist,new.submitted_at,new.decided_at,new.decided_by,new.application_count)
    is distinct from row(old.verification_status,old.rejection_reason,old.admin_note,old.checklist,old.submitted_at,old.decided_at,old.decided_by,old.application_count) then
    if current_user not in ('postgres','supabase_admin') and not public.is_admin() then
      raise exception 'Başvuru karar alanları yalnızca yönetim işlemiyle değişir.' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_barber_application() from public,anon,authenticated,service_role;
drop trigger if exists barber_application_guard on public.barbers;
create trigger barber_application_guard before insert or update on public.barbers for each row execute function private.guard_barber_application();

create or replace function private.keep_profile_role() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.id is distinct from old.id or new.role is distinct from old.role then
    raise exception 'Hesap rolü değiştirilemez.' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.keep_profile_role() from public,anon,authenticated,service_role;
drop trigger if exists profile_role_guard on public.profiles;
create trigger profile_role_guard before update on public.profiles for each row execute function private.keep_profile_role();

revoke select on public.barbers from public,anon,authenticated;
revoke select(verification_status,rejection_reason,admin_note,checklist,submitted_at,decided_at,decided_by,application_count,instagram_url) on public.barbers from public,anon,authenticated;
grant select(id,owner_id,shop_name,city,district,address,map_url,phone,whatsapp,bio,photo_url,avg_rating,review_count,is_active,created_at,cancel_hours_before,verification_status,instagram_url) on public.barbers to anon,authenticated;
grant insert(instagram_url),update(instagram_url) on public.barbers to authenticated;
drop policy if exists barbers_read on public.barbers;
create policy barbers_read on public.barbers for select to anon using(verification_status='approved' and is_active);
drop policy if exists barbers_authenticated_read on public.barbers;
create policy barbers_authenticated_read on public.barbers for select to authenticated using(
  (verification_status='approved' and is_active) or (owner_id=(select auth.uid()) and (select public.mfa_ok())) or (select public.is_admin()));

create or replace function private.approved_owner(p_barber_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and public.mfa_ok() and exists(select 1 from public.barbers b join public.profiles p on p.id=b.owner_id
    where b.id=p_barber_id and b.owner_id=auth.uid() and p.role='barber' and b.verification_status='approved' and b.is_active);
$$;
create or replace function private.approved_panel_owner(p_barber_id uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.approved_owner(p_barber_id) then raise exception 'Bu işlem için onaylı ve aktif bir dükkan gerekli.' using errcode='P2004'; end if;
end $$;
revoke all on function private.approved_owner(uuid),private.approved_panel_owner(uuid) from public,anon;
grant execute on function private.approved_owner(uuid),private.approved_panel_owner(uuid) to authenticated;

create or replace function private.barber_application(p_barber_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.panel_owner(p_barber_id);
  return (select jsonb_build_object('verification_status',verification_status,'rejection_reason',rejection_reason,
    'submitted_at',submitted_at,'decided_at',decided_at,'application_count',application_count) from public.barbers where id=p_barber_id);
end $$;
create or replace function public.get_barber_application(p_barber_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.barber_application(p_barber_id) $$;
revoke all on function private.barber_application(uuid),public.get_barber_application(uuid) from public,anon;
grant execute on function private.barber_application(uuid),public.get_barber_application(uuid) to authenticated;

drop policy if exists services_read on public.services;
create policy services_read on public.services for select to anon,authenticated using(exists(select 1 from public.barbers b where b.id=barber_id));
drop policy if exists hours_read on public.working_hours;
create policy hours_read on public.working_hours for select to anon,authenticated using(exists(select 1 from public.barbers b where b.id=barber_id));
drop policy if exists closed_dates_read on public.closed_dates;
create policy closed_dates_read on public.closed_dates for select to anon,authenticated using(exists(select 1 from public.barbers b where b.id=barber_id));
drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews for select to anon,authenticated using(exists(select 1 from public.barbers b where b.id=barber_id));

create or replace function private.booking_allowed(p_barber_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.barbers where id=p_barber_id and verification_status='approved' and is_active)
    and not exists(select 1 from public.blocked_customers where barber_id=p_barber_id and customer_id=auth.uid());
$$;
drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments for insert to authenticated with check((select public.mfa_ok()) and (
  (source='online' and customer_id=(select auth.uid()) and private.is_customer() and status='pending' and private.booking_allowed(barber_id)) or
  (source='manual' and private.approved_owner(barber_id) and status='confirmed')));
drop policy if exists appointments_read on public.appointments;
create policy appointments_read on public.appointments for select to authenticated using((select public.mfa_ok()) and (
  customer_id=(select auth.uid()) or private.approved_owner(barber_id)));
drop policy if exists appointments_barber_update on public.appointments;
create policy appointments_barber_update on public.appointments for update to authenticated
using(private.approved_owner(barber_id)) with check(private.approved_owner(barber_id));
drop policy if exists blocked_customers_read on public.blocked_customers;
create policy blocked_customers_read on public.blocked_customers for select to authenticated using(private.approved_owner(barber_id));
drop policy if exists blocked_customers_insert on public.blocked_customers;
create policy blocked_customers_insert on public.blocked_customers for insert to authenticated with check(private.approved_owner(barber_id)
  and exists(select 1 from public.appointments a where a.barber_id=blocked_customers.barber_id and a.customer_id=blocked_customers.customer_id));
drop policy if exists blocked_customers_delete on public.blocked_customers;
create policy blocked_customers_delete on public.blocked_customers for delete to authenticated using(private.approved_owner(barber_id));

create or replace function private.guard_verified_booking() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.mfa_ok() then raise exception 'Giriş ve doğrulama gerekli.' using errcode='42501'; end if;
  perform 1 from public.barbers where id=new.barber_id and verification_status='approved' and is_active for update;
  if not found then raise exception 'Bu dükkandan şu an randevu alınamıyor.' using errcode='P2004'; end if;
  return new;
end $$;
revoke all on function private.guard_verified_booking() from public,anon,authenticated,service_role;
drop trigger if exists appointment_approval on public.appointments;
create trigger appointment_approval before insert on public.appointments for each row execute function private.guard_verified_booking();

drop policy if exists gallery_public_read on public.barber_photos;
create policy gallery_public_read on public.barber_photos for select to anon using(ready and deleted_at is null
  and exists(select 1 from public.barbers b where b.id=barber_id));
drop policy if exists gallery_read on public.barber_photos;
create policy gallery_read on public.barber_photos for select to authenticated using(
  (ready and deleted_at is null and exists(select 1 from public.barbers b where b.id=barber_id and b.verification_status='approved' and b.is_active))
  or (private.owns_barber(barber_id) and (select public.mfa_ok())));
drop policy if exists gallery_insert on public.barber_photos;
create policy gallery_insert on public.barber_photos for insert to authenticated with check(private.approved_owner(barber_id));
drop policy if exists gallery_files_insert on storage.objects;
create policy gallery_files_insert on storage.objects for insert to authenticated with check(bucket_id='barber-gallery'
  and array_length(storage.foldername(name),1)=1 and (select public.mfa_ok())
  and exists(select 1 from public.barbers b where b.id::text=(storage.foldername(name))[1] and b.owner_id=(select auth.uid()) and b.verification_status='approved' and b.is_active)
  and exists(select 1 from public.barber_photos p where p.path=name and not p.ready and p.deleted_at is null));
drop policy if exists gallery_files_read on storage.objects;
create policy gallery_files_read on storage.objects for select to anon using(bucket_id='barber-gallery'
  and exists(select 1 from public.barbers b where b.id::text=(storage.foldername(name))[1]));
drop policy if exists gallery_files_owner_read on storage.objects;
create policy gallery_files_owner_read on storage.objects for select to authenticated using(bucket_id='barber-gallery'
  and exists(select 1 from public.barbers b where b.id::text=(storage.foldername(name))[1]));
drop policy if exists barber_photos_read on storage.objects;
create policy barber_photos_read on storage.objects for select to anon,authenticated using(bucket_id='barber-photos'
  and exists(select 1 from public.barbers b where b.owner_id::text=(storage.foldername(name))[1]));

create or replace function private.check_window(target uuid, starts timestamptz, finishes timestamptz) returns void
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
  if not exists (select 1 from public.barbers where id = target and is_active and verification_status='approved') or
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

create or replace function public.get_available_slots(p_barber_id uuid, p_service_id uuid, p_date date)
returns table (start_at timestamptz, end_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare duration integer; hours public.working_hours;
begin
  if p_date is null or p_date < (now() at time zone 'Europe/Nicosia')::date or
     p_date > (now() at time zone 'Europe/Nicosia')::date + 90 then return; end if;
  select s.duration_min into duration from public.services s join public.barbers b on b.id = s.barber_id
    where s.id = p_service_id and s.barber_id = p_barber_id and s.is_active and b.is_active and b.verification_status='approved';
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

create or replace function public.search_barbers(
  p_query text default '', p_city text default '', p_district text default '',
  p_rating numeric default 0, p_min_price numeric default 0, p_max_price numeric default null,
  p_currency text default 'TRY', p_category text default '', p_sort text default 'rating', p_page integer default 1
) returns table (
  id uuid,shop_name text,city text,district text,photo_url text,avg_rating numeric,
  review_count integer,starting_price numeric,currency text,total_count bigint
) language plpgsql stable security invoker set search_path = '' as $$
declare needle text;
begin
  if p_query is null or length(p_query)>120 or p_rating is null or p_rating not between 0 and 5 or
     p_min_price is null or p_min_price<0 or (p_max_price is not null and p_max_price<p_min_price) or
     p_currency is null or p_currency not in ('TRY','GBP','EUR') or p_sort is null or p_sort not in ('rating','price') or
     p_page is null or p_page not between 1 and 1000 then
    raise exception 'Arama filtreleri geçersiz.' using errcode='22023';
  end if;
  needle:=translate(lower(translate(trim(p_query),'Iİ','ıi')),'ı','i');
  return query with candidates as (
    select b.id,b.shop_name,b.city,b.district,b.photo_url,b.avg_rating,b.review_count,
      min(s.price) as starting_price,p_currency as currency
    from public.barbers b join public.services s on s.barber_id=b.id
    where b.is_active and b.verification_status='approved' and s.is_active and s.currency=p_currency
      and (coalesce(p_city,'')='' or b.city=p_city) and (coalesce(p_district,'')='' or b.district=p_district)
      and b.avg_rating>=p_rating and (coalesce(p_category,'')='' or s.category=p_category)
      and s.price>=p_min_price and (p_max_price is null or s.price<=p_max_price)
      and strpos(translate(lower(translate(b.shop_name||' '||b.city||' '||b.district,'Iİ','ıi')),'ı','i'),needle)>0
    group by b.id,b.shop_name,b.city,b.district,b.photo_url,b.avg_rating,b.review_count
  ) select c.*,count(*) over() from candidates c
    order by case when p_sort='rating' then c.avg_rating end desc,
      case when p_sort='price' then c.starting_price end asc,c.review_count desc,c.shop_name,c.id
    limit 12 offset (p_page-1)*12;
end $$;

create or replace function private.panel_stats(p_barber_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare counts jsonb; day date:=(now() at time zone 'Europe/Nicosia')::date; monday date;
begin
  perform private.approved_panel_owner(p_barber_id);monday:=date_trunc('week',day::timestamp)::date;
  select jsonb_build_object(
    'pending',count(*) filter(where a.status='pending'),
    'today',count(*) filter(where a.status not in ('rejected','cancelled') and (effective_start at time zone 'Europe/Nicosia')::date=day),
    'week',count(*) filter(where a.status not in ('rejected','cancelled') and (effective_start at time zone 'Europe/Nicosia')::date>=monday and (effective_start at time zone 'Europe/Nicosia')::date<monday+7)
  ) into counts from (select status,case when status='counter_proposed' then proposed_start_at else start_at end as effective_start from public.appointments where barber_id=p_barber_id) a;
  return counts;
end $$;

create or replace function private.proposal_slots(p_appointment_id uuid,p_date date)
returns table(start_at timestamptz,end_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare booking public.appointments; hours public.working_hours;
begin
  select * into booking from public.appointments where id=p_appointment_id;
  if not found then raise exception 'Randevu bulunamadı.' using errcode='42501'; end if;
  perform private.approved_panel_owner(booking.barber_id);
  if booking.status not in ('pending','confirmed','counter_proposed') or p_date is null or
    p_date<(now() at time zone 'Europe/Nicosia')::date or p_date>(now() at time zone 'Europe/Nicosia')::date+90 or
    not exists(select 1 from public.barbers where id=booking.barber_id and is_active) or
    exists(select 1 from public.closed_dates where barber_id=booking.barber_id and date=p_date) then return; end if;
  select * into hours from public.working_hours where barber_id=booking.barber_id and weekday=extract(dow from p_date)::integer;
  if not found or hours.is_closed then return; end if;
  return query with candidates as (
    select instant as starts,instant+booking.duration_at_booking*interval '1 minute' as finishes
    from generate_series((p_date + hours.open_time) at time zone 'Europe/Nicosia',
      (p_date + hours.close_time) at time zone 'Europe/Nicosia',booking.duration_at_booking * interval '1 minute') instant
  ) select c.starts,c.finishes from candidates c where c.starts>now()
    and (c.starts at time zone 'Europe/Nicosia')::time>=hours.open_time
    and (c.finishes at time zone 'Europe/Nicosia')::date=p_date
    and (c.finishes at time zone 'Europe/Nicosia')::time<=hours.close_time
    and (c.finishes at time zone 'Europe/Nicosia')>(c.starts at time zone 'Europe/Nicosia')
    and (hours.break_start is null or (c.starts at time zone 'Europe/Nicosia')::time>=hours.break_end or (c.finishes at time zone 'Europe/Nicosia')::time<=hours.break_start)
    and not exists(select 1 from public.appointments a where a.barber_id=booking.barber_id and a.id<>booking.id and a.status in ('pending','confirmed','counter_proposed')
      and tstzrange(c.starts,c.finishes,'[)') && tstzrange(case when a.status='counter_proposed' then a.proposed_start_at else a.start_at end,
        case when a.status='counter_proposed' then a.proposed_end_at else a.end_at end,'[)')) order by c.starts;
end $$;

create or replace function private.no_show_count(p_appointment_id uuid) returns bigint
language plpgsql stable security definer set search_path='' as $$
declare booking public.appointments;
begin
  select * into booking from public.appointments where id=p_appointment_id;
  if not found or booking.customer_id is null or booking.status<>'pending' then raise exception 'Bekleyen müşteri talebi bulunamadı.' using errcode='42501'; end if;
  perform private.approved_panel_owner(booking.barber_id);
  return (select count(*) from public.appointments where customer_id=booking.customer_id and status='no_show');
end $$;

create or replace function private.find_booking_customer(p_barber_id uuid,p_phone text)
returns table(id uuid,full_name text,phone text)
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.approved_panel_owner(p_barber_id);
  return query select p.id,p.full_name,p.phone from public.profiles p
    where p.role='customer' and p.phone=private.normalize_phone(p_phone) order by p.id limit 5;
end $$;

create or replace function private.list_blocked_customers(p_barber_id uuid)
returns table(customer_id uuid,full_name text,phone text,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.approved_panel_owner(p_barber_id);
  return query select bc.customer_id,p.full_name,p.phone,bc.created_at from public.blocked_customers bc
    join public.profiles p on p.id=bc.customer_id where bc.barber_id=p_barber_id order by bc.created_at desc;
end $$;

create or replace function private.panel_appointments(p_barber_id uuid,p_view text,p_status text,p_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; total bigint; today date:=(now() at time zone 'Europe/Nicosia')::date;
begin
  perform private.approved_panel_owner(p_barber_id);
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

create or replace function private.guard_gallery() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; file_path text;
begin
  target := case when tg_op='DELETE' then old.barber_id else new.barber_id end;
  if tg_op='DELETE' and not exists(select 1 from public.barbers where id=target) then return old; end if;
  if auth.uid() is null or not public.mfa_ok() then raise exception 'Yetki gerekli' using errcode='42501'; end if;
  perform 1 from public.barbers where id=target and owner_id=auth.uid() for update;
  if not found then raise exception 'Dükkan yetkisi gerekli' using errcode='42501'; end if;
  if (tg_op='INSERT' or (tg_op='UPDATE' and new.ready and not old.ready)) and not private.approved_owner(target) then
    raise exception 'Galeri yüklemek için onaylı ve aktif dükkan gerekli.' using errcode='P2004';
  end if;
  if tg_op='INSERT' then
    if (select count(*) from public.barber_photos where barber_id=target)>=12 then
      raise exception 'En fazla 12 fotoğraf yüklenebilir' using errcode='P2003';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if old.deleted_at is null or exists(select 1 from storage.objects where bucket_id='barber-gallery' and name=old.path) then
      raise exception 'Önce galeri dosyasını temizleyin' using errcode='22023';
    end if;
    return old;
  end if;
  if new.id<>old.id or new.barber_id<>old.barber_id or new.path<>old.path or new.created_at<>old.created_at
    or (old.ready and not new.ready) or (old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at) then
    raise exception 'Galeri kaydı taşınamaz' using errcode='42501';
  end if;
  if new.ready and not old.ready and not exists(select 1 from storage.objects where bucket_id='barber-gallery' and name=new.path) then
    raise exception 'Yükleme tamamlanmadı' using errcode='22023';
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    file_path := '/storage/v1/object/public/barber-gallery/' || old.path;
    update public.barbers set photo_url=null where id=target and right(photo_url,length(file_path))=file_path;
  end if;
  return new;
end $$;
commit;
