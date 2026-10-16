begin;
create table if not exists private.app_settings(key text primary key,value jsonb not null);
alter table private.app_settings enable row level security;
revoke all on private.app_settings from public,anon,authenticated;
insert into private.app_settings(key,value) values('request_limits','{"pending_total":3,"pending_shop":1,"daily_total":10,"profile_minute":10,"review_ten_minutes":5}') on conflict(key) do nothing;
alter table public.profiles add column if not exists is_banned boolean not null default false;
create index if not exists appointments_customer_created_idx on public.appointments(customer_id,created_at) where source='online';
create table if not exists private.operation_windows(
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  window_at timestamptz not null,
  used integer not null default 1,
  primary key(user_id,kind,window_at)
);
alter table private.operation_windows enable row level security;
revoke all on private.operation_windows from public,anon,authenticated;
create or replace function private.limit_operation(p_kind text,p_seconds integer,p_limit integer) returns void
language plpgsql security definer set search_path='' as $$
declare used_count integer;starts timestamptz:=to_timestamp(floor(extract(epoch from now())/p_seconds)*p_seconds);
begin
  if auth.uid() is null then raise exception 'Giriş gerekli.' using errcode='42501';end if;
  insert into private.operation_windows(user_id,kind,window_at) values(auth.uid(),p_kind,starts)
  on conflict(user_id,kind,window_at) do update set used=operation_windows.used+1 returning used into used_count;
  if used_count>p_limit then raise exception 'İşlem sınırına ulaştın. Biraz sonra tekrar dene.' using errcode='P2009';end if;
  delete from private.operation_windows where user_id=auth.uid() and window_at<now()-interval '1 day';
end $$;
revoke all on function private.limit_operation(text,integer,integer) from public,anon,authenticated,service_role;
create or replace function private.guard_profile_rate() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid()=old.id and row(new.full_name,new.phone,new.preference_note) is distinct from row(old.full_name,old.phone,old.preference_note) then
    perform private.limit_operation('profile',60,(select (value->>'profile_minute')::integer from private.app_settings where key='request_limits'));
  end if;return new;
end $$;
revoke all on function private.guard_profile_rate() from public,anon,authenticated,service_role;
drop trigger if exists profile_rate on public.profiles;
create trigger profile_rate before update on public.profiles for each row execute function private.guard_profile_rate();
create or replace function private.check_request_limits() returns trigger
language plpgsql security definer set search_path='' as $$
declare limits jsonb;
begin
  if new.customer_id is null then return new;end if;
  perform 1 from public.profiles where id=new.customer_id for update;
  if exists(select 1 from public.profiles where id=new.customer_id and is_banned) then raise exception 'Bu hesapla randevu veya yorum işlemi yapılamıyor.' using errcode='P2010';end if;
  if new.source<>'online' then return new;end if;
  select value into limits from private.app_settings where key='request_limits';
  if (select count(*) from public.appointments where customer_id=new.customer_id and status='pending')>=(limits->>'pending_total')::int
    or (select count(*) from public.appointments where customer_id=new.customer_id and barber_id=new.barber_id and status='pending')>=(limits->>'pending_shop')::int
    or (select count(*) from public.appointments where customer_id=new.customer_id and source='online' and created_at>=date_trunc('day',now() at time zone 'Europe/Nicosia') at time zone 'Europe/Nicosia')>=(limits->>'daily_total')::int then
    raise exception 'Talep sınırına ulaştın. Bekleyen taleplerini kontrol edip daha sonra tekrar dene.' using errcode='P2011';
  end if;return new;
end $$;
revoke all on function private.check_request_limits() from public,anon,authenticated,service_role;
drop trigger if exists z_request_limits on public.appointments;
create trigger z_request_limits before insert on public.appointments for each row execute function private.check_request_limits();
create or replace function private.review_rate() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.profiles where id=auth.uid() and is_banned) then raise exception 'Bu hesapla yorum işlemi yapılamıyor.' using errcode='P2010';end if;
  perform private.limit_operation('review',600,(select (value->>'review_ten_minutes')::integer from private.app_settings where key='request_limits'));
  return new;
end $$;
revoke all on function private.review_rate() from public,anon,authenticated,service_role;
drop trigger if exists z_review_rate on public.reviews;
create trigger z_review_rate before insert on public.reviews for each row execute function private.review_rate();
create or replace function private.admin_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Yönetici doğrulaması gerekli.' using errcode='42501';end if;
  return jsonb_build_object('users',(select count(*) from public.profiles),'shops',(select count(*) from public.barbers),
    'appointments',(select count(*) from public.appointments),'banned',(select count(*) from public.profiles where is_banned));
end $$;
create or replace function public.admin_summary() returns jsonb language sql stable security invoker set search_path='' as $$select private.admin_summary()$$;
create or replace function private.admin_users_search(p_search text,p_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare answer jsonb;
begin
  if not public.is_admin() then raise exception 'Yönetici doğrulaması gerekli.' using errcode='42501';end if;
  if p_search is null or char_length(p_search) not between 2 and 120 or p_page is null or p_page not between 1 and 1000 then raise exception 'En az iki karakterle ara.' using errcode='22023';end if;
  with filtered as(select p.id,p.full_name,p.is_banned,u.email from public.profiles p join auth.users u on u.id=p.id
    where strpos(lower(p.full_name||' '||coalesce(u.email,'')),lower(trim(p_search)))>0),
  paged as(select * from filtered order by full_name,id limit 20 offset(p_page-1)*20)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from filtered)) into answer;return answer;
end $$;
create or replace function public.admin_users_search(p_search text,p_page integer default 1) returns jsonb language sql stable security invoker set search_path='' as $$select private.admin_users_search(p_search,p_page)$$;
create or replace function private.admin_user_ban(p_user_id uuid,p_banned boolean,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.admin_users where user_id=auth.uid() for share;
  if not found or not public.is_admin() then raise exception 'Yönetici doğrulaması gerekli.' using errcode='42501';end if;
  if p_banned is null or p_reason is null or char_length(trim(p_reason)) not between 5 and 1000 then raise exception 'Gerekçe zorunlu.' using errcode='22023';end if;
  if exists(select 1 from public.admin_users where user_id=p_user_id) then raise exception 'Yönetici hesabı bu işlemle engellenemez.' using errcode='22023';end if;
  perform 1 from public.profiles where id=p_user_id for update;if not found then raise exception 'Kullanıcı bulunamadı.' using errcode='P0002';end if;
  update public.profiles set is_banned=p_banned where id=p_user_id;
  insert into public.admin_audit_log(admin_id,action,target_type,target_id,detail)
  values(auth.uid(),case when p_banned then 'user_banned' else 'user_unbanned' end,'user',p_user_id,jsonb_build_object('reason',trim(p_reason)));
end $$;
create or replace function public.admin_user_ban(p_user_id uuid,p_banned boolean,p_reason text) returns void language sql security invoker set search_path='' as $$select private.admin_user_ban(p_user_id,p_banned,p_reason)$$;
revoke all on function private.admin_summary(),public.admin_summary(),private.admin_users_search(text,integer),public.admin_users_search(text,integer),private.admin_user_ban(uuid,boolean,text),public.admin_user_ban(uuid,boolean,text) from public,anon;
grant execute on function private.admin_summary(),public.admin_summary(),private.admin_users_search(text,integer),public.admin_users_search(text,integer),private.admin_user_ban(uuid,boolean,text),public.admin_user_ban(uuid,boolean,text) to authenticated;
create or replace function private.booking_allowed(p_barber_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
select auth.uid() is not null and not exists(select 1 from public.profiles where id=auth.uid() and is_banned)
 and exists(select 1 from public.barbers where id=p_barber_id and verification_status='approved' and is_active)
 and not exists(select 1 from public.blocked_customers where barber_id=p_barber_id and customer_id=auth.uid())$$;
drop policy if exists reviews_banned on public.reviews;
create policy reviews_banned on public.reviews as restrictive for insert to authenticated with check(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and not p.is_banned));
create or replace function private.guard_ban_field() returns trigger language plpgsql set search_path='' as $$begin
 if new.is_banned is distinct from old.is_banned and current_user not in('postgres','supabase_admin') then raise exception 'Engel durumu yönetim işlemiyle değişir.' using errcode='42501';end if;return new;end $$;
revoke all on function private.guard_ban_field() from public,anon,authenticated,service_role;
drop trigger if exists profile_ban_guard on public.profiles;
create trigger profile_ban_guard before update on public.profiles for each row execute function private.guard_ban_field();
commit;
