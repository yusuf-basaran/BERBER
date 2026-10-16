begin;
alter table public.reviews add column if not exists barber_reply text not null default '' check(char_length(barber_reply)<=1500);
alter table public.reviews add column if not exists barber_reply_at timestamptz;
alter table public.reviews add column if not exists is_hidden boolean not null default false;
grant select(barber_reply,barber_reply_at,is_hidden) on public.reviews to anon,authenticated;
grant update(barber_reply) on public.reviews to authenticated;
drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews for select to anon using(not is_hidden and exists(select 1 from public.barbers b where b.id=barber_id));
drop policy if exists reviews_authenticated_read on public.reviews;
create policy reviews_authenticated_read on public.reviews for select to authenticated using(exists(select 1 from public.barbers b where b.id=barber_id)
  and (not is_hidden or private.approved_owner(barber_id) or customer_id=(select auth.uid()) or (select public.is_admin())));
drop policy if exists reviews_barber_reply on public.reviews;
create policy reviews_barber_reply on public.reviews for update to authenticated using(private.approved_owner(barber_id)) with check(private.approved_owner(barber_id));
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in('appointment_requested','appointment_confirmed','appointment_rejected','appointment_counter_proposed','appointment_cancelled','appointment_completed','appointment_no_show','proposal_accepted','security_recovery','barber_application_submitted','barber_application_decided','barber_application_support','review_reply','review_report','waitlist_available','appointment_reminder'));
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using(user_id=(select auth.uid()) and (select public.mfa_ok())
  and (type not in('barber_application_submitted','barber_application_support','review_report') or (select public.is_admin())));
create or replace function private.guard_review_update() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user not in('postgres','supabase_admin') then
    if not private.approved_owner(old.barber_id) or row(new.id,new.appointment_id,new.barber_id,new.customer_id,new.rating,new.comment,new.created_at,new.is_hidden)
      is distinct from row(old.id,old.appointment_id,old.barber_id,old.customer_id,old.rating,old.comment,old.created_at,old.is_hidden) then
      raise exception 'Yalnızca dükkan yanıtı düzenlenebilir.' using errcode='42501';end if;
  end if;
  if new.barber_reply is distinct from old.barber_reply then new.barber_reply_at:=now();else new.barber_reply_at:=old.barber_reply_at;end if;return new;
end $$;
revoke all on function private.guard_review_update() from public,anon,authenticated,service_role;
drop trigger if exists review_update_guard on public.reviews;
create trigger review_update_guard before update on public.reviews for each row execute function private.guard_review_update();
create or replace function private.review_reply_notice() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.barber_reply is distinct from old.barber_reply and new.barber_reply<>'' and not new.is_hidden then
    insert into public.notifications(user_id,type,title,body,appointment_id,barber_id) values(new.customer_id,'review_reply','Yorumuna dükkan yanıtı geldi',left(new.barber_reply,1500),new.appointment_id,new.barber_id);
  end if;return null;
end $$;
revoke all on function private.review_reply_notice() from public,anon,authenticated,service_role;
drop trigger if exists review_reply_notice on public.reviews;
create trigger review_reply_notice after update on public.reviews for each row execute function private.review_reply_notice();
create or replace function private.refresh_rating() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  target:=case when tg_op='DELETE' then old.barber_id else new.barber_id end;
  perform 1 from public.barbers where id=target for update;
  update public.barbers set avg_rating=(select coalesce(round(avg(rating),2),0) from public.reviews where barber_id=target and not is_hidden),
    review_count=(select count(*) from public.reviews where barber_id=target and not is_hidden) where id=target;return null;
end $$;
create table if not exists public.review_reports(
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check(char_length(trim(reason)) between 5 and 1000),
  status text not null default 'open' check(status in('open','resolved','dismissed')),
  created_at timestamptz not null default now(),
  unique(review_id,reporter_id)
);
create index if not exists review_reports_reporter_idx on public.review_reports(reporter_id);
create index if not exists review_reports_status_idx on public.review_reports(status,created_at);
alter table public.review_reports enable row level security;
revoke all on public.review_reports from public,anon,authenticated;
grant select on public.review_reports to authenticated;
grant insert(review_id,reporter_id,reason) on public.review_reports to authenticated;
grant all on public.review_reports to service_role;
drop policy if exists reports_read on public.review_reports;
create policy reports_read on public.review_reports for select to authenticated using((reporter_id=(select auth.uid()) and (select public.mfa_ok())) or (select public.is_admin()));
drop policy if exists reports_insert on public.review_reports;
create policy reports_insert on public.review_reports for insert to authenticated with check(reporter_id=(select auth.uid()) and (select public.mfa_ok()) and
  exists(select 1 from public.reviews r where r.id=review_id and private.approved_owner(r.barber_id)));
create or replace function private.report_notice() returns trigger language plpgsql security definer set search_path='' as $$begin
  insert into public.notifications(user_id,type,title,body,barber_id) select user_id,'review_report','Yorum inceleme talebi','Bir dükkan yorumunun incelenmesi istendi.',(select barber_id from public.reviews where id=new.review_id) from public.admin_users;
  return null;end $$;
revoke all on function private.report_notice() from public,anon,authenticated,service_role;
drop trigger if exists review_report_notice on public.review_reports;
create trigger review_report_notice after insert on public.review_reports for each row execute function private.report_notice();
create or replace function private.admin_review_reports(p_page integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare answer jsonb;
begin
  if not public.is_admin() then raise exception 'Yönetici doğrulaması gerekli.' using errcode='42501';end if;
  if p_page is null or p_page not between 1 and 1000 then raise exception 'Sayfa geçersiz.' using errcode='22023';end if;
  with reports as(select rr.id,rr.reason,rr.status,rr.created_at,r.id as review_id,r.rating,r.comment,r.barber_reply,r.is_hidden,b.shop_name from public.review_reports rr join public.reviews r on r.id=rr.review_id join public.barbers b on b.id=r.barber_id where rr.status='open'),
  paged as(select * from reports order by created_at,id limit 20 offset(p_page-1)*20)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from reports)) into answer;return answer;
end $$;
create or replace function public.admin_review_reports(p_page integer default 1) returns jsonb language sql stable security invoker set search_path='' as $$select private.admin_review_reports(p_page)$$;
create or replace function private.admin_report_decide(p_report_id uuid,p_action text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare report public.review_reports;
begin
  perform 1 from public.admin_users where user_id=auth.uid() for share;
  if not found or not public.is_admin() then raise exception 'Yönetici doğrulaması gerekli.' using errcode='42501';end if;
  if p_action is null or p_action not in('hide','dismiss') or p_reason is null or char_length(trim(p_reason)) not between 5 and 1000 then raise exception 'Karar ve gerekçe geçersiz.' using errcode='22023';end if;
  select * into report from public.review_reports where id=p_report_id for update;
  if not found or report.status<>'open' then raise exception 'Şikayet değişti, yenileyin.' using errcode='P2005';end if;
  if p_action='hide' then update public.reviews set is_hidden=true where id=report.review_id;end if;
  update public.review_reports set status=case when p_action='hide' then 'resolved' else 'dismissed' end where id=report.id;
  insert into public.admin_audit_log(admin_id,action,target_type,target_id,detail) values(auth.uid(),'review_'||p_action,'review',report.review_id,jsonb_build_object('report_id',report.id,'reason',trim(p_reason)));
end $$;
create or replace function public.admin_report_decide(p_report_id uuid,p_action text,p_reason text) returns void language sql security invoker set search_path='' as $$select private.admin_report_decide(p_report_id,p_action,p_reason)$$;
revoke all on function private.admin_review_reports(integer),public.admin_review_reports(integer),private.admin_report_decide(uuid,text,text),public.admin_report_decide(uuid,text,text) from public,anon;
grant execute on function private.admin_review_reports(integer),public.admin_review_reports(integer),private.admin_report_decide(uuid,text,text),public.admin_report_decide(uuid,text,text) to authenticated;
commit;
