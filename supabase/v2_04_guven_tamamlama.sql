begin;
alter table public.barbers add column if not exists support_requested_at timestamptz;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in('appointment_requested','appointment_confirmed','appointment_rejected','appointment_counter_proposed','appointment_cancelled','appointment_completed','appointment_no_show','proposal_accepted','security_recovery','barber_application_submitted','barber_application_decided','barber_application_support'));
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using(user_id=(select auth.uid()) and (select public.mfa_ok())
  and (type not in('barber_application_submitted','barber_application_support') or (select public.is_admin())));
create or replace function private.application_support(p_barber_id uuid,p_message text) returns void
language plpgsql security definer set search_path='' as $$
declare b public.barbers;
begin
  perform private.panel_owner(p_barber_id);
  select * into b from public.barbers where id=p_barber_id for update;
  if b.verification_status not in('suspended','rejected') or p_message is null or char_length(trim(p_message)) not between 10 and 1000 then
    raise exception 'Destek mesajı 10–1000 karakter olmalı.' using errcode='22023';end if;
  if b.support_requested_at>now()-interval '1 day' then raise exception 'Günde bir destek mesajı gönderebilirsin.' using errcode='P2008';end if;
  if not exists(select 1 from public.admin_users) then raise exception 'Yönetim iletişimi henüz etkin değil.' using errcode='P2006';end if;
  update public.barbers set support_requested_at=now() where id=b.id;
  insert into public.notifications(user_id,type,title,body,barber_id)
    select user_id,'barber_application_support','Dükkan destek mesajı',b.shop_name||': '||trim(p_message),b.id from public.admin_users;
end $$;
create or replace function public.application_support(p_barber_id uuid,p_message text) returns void
language sql security invoker set search_path='' as $$select private.application_support(p_barber_id,p_message)$$;
revoke all on function private.application_support(uuid,text),public.application_support(uuid,text) from public,anon;
grant execute on function private.application_support(uuid,text),public.application_support(uuid,text) to authenticated;
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
    select a.*,coalesce(p.full_name,a.guest_name) as customer_name,case when exists(select 1 from public.appointments prior where prior.barber_id=a.barber_id and prior.status in('confirmed','completed') and ((a.customer_id is not null and prior.customer_id=a.customer_id) or (a.customer_id is null and prior.customer_id is null and prior.guest_phone=a.guest_phone))) then coalesce(p.phone,a.guest_phone) else null end as customer_phone,
      case when a.status='pending' and a.customer_id is not null then private.no_show_count(a.id) else null end as no_show_count,
      exists(select 1 from public.blocked_customers bc where bc.barber_id=a.barber_id and bc.customer_id=a.customer_id) as customer_blocked,
      (select count(*) from public.appointments prior where prior.barber_id=a.barber_id and prior.status='completed' and ((a.customer_id is not null and prior.customer_id=a.customer_id) or (a.customer_id is null and prior.customer_id is null and prior.guest_phone=a.guest_phone))) as prior_visits,
      exists(select 1 from public.barber_customer_notes n where n.barber_id=a.barber_id and (n.customer_id=a.customer_id or (a.customer_id is null and n.guest_phone=a.guest_phone)) and (n.note<>'' or cardinality(n.tags)>0)) as has_private_note,
      case when a.status='counter_proposed' then a.proposed_start_at else a.start_at end as effective_start
    from public.appointments a left join public.profiles p on p.id=a.customer_id
    where a.barber_id=p_barber_id and (p_status='' or a.status=p_status)
      and (p_view='all' or (p_view='pending' and a.status='pending') or
        (p_view='today' and a.status not in ('rejected','cancelled') and
          ((case when a.status='counter_proposed' then a.proposed_start_at else a.start_at end) at time zone 'Europe/Nicosia')::date=today))
  ), numbered as (select s.*,count(*) over() as total_count from selected s), paged as (
    select * from numbered order by effective_start,id limit 12 offset (p_page-1)*12
  ) select coalesce(jsonb_agg(to_jsonb(paged)-'total_count'-'guest_phone'),'[]'::jsonb),coalesce(max(total_count),0) into rows,total from paged;
  return jsonb_build_object('rows',rows,'total',total);
end $$;
commit;
