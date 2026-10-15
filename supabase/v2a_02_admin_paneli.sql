begin;
set local lock_timeout='5s';
alter table public.barbers add column if not exists application_revision bigint not null default 0;
alter table public.notifications add column if not exists barber_id uuid references public.barbers(id) on delete set null;
create index if not exists notifications_barber_idx on public.notifications(barber_id) where barber_id is not null;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in (
  'appointment_requested','appointment_confirmed','appointment_rejected','appointment_counter_proposed',
  'appointment_cancelled','appointment_completed','appointment_no_show','proposal_accepted','security_recovery',
  'barber_application_submitted','barber_application_decided'));
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using(user_id=(select auth.uid()) and (select public.mfa_ok())
  and (type<>'barber_application_submitted' or (select public.is_admin())));

create or replace function private.admin_applications(p_status text,p_search text,p_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare answer jsonb;
begin
  if not public.is_admin() then raise exception 'Yönetici doğrulaması gerekli.' using errcode='42501'; end if;
  if p_status is null or p_status not in('pending','approved','rejected','suspended') or p_search is null or char_length(p_search)>120
    or p_page is null or p_page not between 1 and 1000 then raise exception 'Filtre geçersiz.' using errcode='22023'; end if;
  with filtered as (
    select b.id,b.shop_name,b.city,b.district,b.verification_status,b.submitted_at,b.decided_at,b.application_count,b.photo_url,
      p.full_name as owner_name,p.phone as owner_phone,u.email as owner_email
    from public.barbers b join public.profiles p on p.id=b.owner_id join auth.users u on u.id=b.owner_id
    where b.verification_status=p_status and (trim(p_search)='' or strpos(lower(b.shop_name||' '||p.full_name||' '||coalesce(u.email,'')||' '||b.city),lower(trim(p_search)))>0)
  ), page_rows as (select * from filtered order by submitted_at,id limit 20 offset (p_page-1)*20)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.submitted_at,r.id) from page_rows r),'[]'::jsonb),
    'total',(select count(*) from filtered),'pending_count',(select count(*) from public.barbers where verification_status='pending')) into answer;
  return answer;
end $$;
create or replace function public.admin_applications(p_status text default 'pending',p_search text default '',p_page integer default 1) returns jsonb
language sql stable security invoker set search_path='' as $$select private.admin_applications(p_status,p_search,p_page)$$;

create or replace function private.admin_application(p_barber_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare answer jsonb;
begin
  if not public.is_admin() then raise exception 'Yönetici doğrulaması gerekli.' using errcode='42501'; end if;
  select to_jsonb(b)||jsonb_build_object('owner_name',p.full_name,'owner_phone',p.phone,'owner_email',u.email) into answer
  from public.barbers b join public.profiles p on p.id=b.owner_id join auth.users u on u.id=b.owner_id where b.id=p_barber_id;
  if answer is null then raise exception 'Başvuru bulunamadı.' using errcode='P0002'; end if;
  return answer;
end $$;
create or replace function public.admin_application(p_barber_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.admin_application(p_barber_id)$$;

create or replace function private.admin_review_save(p_barber_id uuid,p_checklist jsonb,p_note text,p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous public.barbers; revision bigint;
begin
  perform 1 from public.admin_users where user_id=auth.uid() for share;
  if not found or not public.is_admin() then raise exception 'Yönetici doğrulaması gerekli.' using errcode='42501'; end if;
  if p_note is null or char_length(p_note)>2000 or p_checklist is null or jsonb_typeof(p_checklist)<>'object' then raise exception 'Not veya kontrol listesi geçersiz.' using errcode='22023'; end if;
  select * into previous from public.barbers where id=p_barber_id for update;
  if not found then raise exception 'Başvuru bulunamadı.' using errcode='P0002'; end if;
  if p_revision is null or previous.application_revision<>p_revision then raise exception 'Başvuru değişti, yenileyin.' using errcode='P2005'; end if;
  update public.barbers set checklist=p_checklist,admin_note=trim(p_note),application_revision=application_revision+1 where id=p_barber_id returning application_revision into revision;
  insert into public.admin_audit_log(admin_id,action,target_type,target_id,detail)
  values(auth.uid(),'review_saved','barber',p_barber_id,jsonb_build_object('checklist',p_checklist,'note_changed',previous.admin_note is distinct from trim(p_note)));
  return jsonb_build_object('application_revision',revision);
end $$;
create or replace function public.admin_review_save(p_barber_id uuid,p_checklist jsonb,p_note text,p_revision bigint) returns jsonb
language sql security invoker set search_path='' as $$select private.admin_review_save(p_barber_id,p_checklist,p_note,p_revision)$$;

create or replace function public.basvuru_karar(p_barber_id uuid,p_karar text,p_sebep text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous public.barbers; next_status text; heading text; reason text;
begin
  perform 1 from public.admin_users where user_id=auth.uid() for share;
  if not found or not public.is_admin() then raise exception 'Yönetici doğrulaması gerekli.' using errcode='42501'; end if;
  if p_karar is null or p_karar not in('approve','reject','suspend','reapprove') or p_sebep is null or char_length(p_sebep)>1000 then
    raise exception 'Karar veya gerekçe geçersiz.' using errcode='22023'; end if;
  reason:=nullif(trim(p_sebep),'');
  if p_karar in('reject','suspend') and reason is null then raise exception 'Gerekçe zorunlu.' using errcode='22023'; end if;
  select * into previous from public.barbers where id=p_barber_id for update;
  if not found then raise exception 'Başvuru bulunamadı.' using errcode='P0002'; end if;
  if not ((p_karar in('approve','reject') and previous.verification_status='pending')
    or (p_karar='suspend' and previous.verification_status='approved')
    or (p_karar='reapprove' and previous.verification_status in('rejected','suspended'))) then
    raise exception 'Başvuru durumu değişti, yenileyin.' using errcode='P2005'; end if;
  next_status:=case p_karar when 'reject' then 'rejected' when 'suspend' then 'suspended' else 'approved' end;
  heading:=case next_status when 'rejected' then 'Dükkan başvurun onaylanmadı' when 'suspended' then 'Dükkanın yayını askıya alındı' else 'Dükkan başvurun onaylandı' end;
  update public.barbers set verification_status=next_status,rejection_reason=case when next_status='approved' then null else reason end,
    decided_at=now(),decided_by=auth.uid(),application_revision=application_revision+1 where id=p_barber_id;
  insert into public.admin_audit_log(admin_id,action,target_type,target_id,detail)
  values(auth.uid(),p_karar,'barber',p_barber_id,jsonb_build_object('from',previous.verification_status,'to',next_status,'reason',case when next_status='approved' then null else reason end));
  insert into public.notifications(user_id,type,title,body,barber_id)
  values(previous.owner_id,'barber_application_decided',heading,previous.shop_name||case when next_status='approved' then ' artık yayına alınabilir.' else ': '||reason end,p_barber_id);
  return jsonb_build_object('verification_status',next_status,'barber_id',p_barber_id);
end $$;

create or replace function private.notify_barber_application() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.verification_status='pending' and (tg_op='INSERT' or old.verification_status is distinct from 'pending') then
    insert into public.notifications(user_id,type,title,body,barber_id)
    select user_id,'barber_application_submitted','Yeni dükkan başvurusu',new.shop_name||' başvurusu inceleme bekliyor.',new.id from public.admin_users;
  end if;
  return null;
end $$;
revoke all on function private.notify_barber_application() from public,anon,authenticated,service_role;
drop trigger if exists barber_application_notice on public.barbers;
create trigger barber_application_notice after insert or update of verification_status on public.barbers for each row execute function private.notify_barber_application();

revoke all on function private.admin_applications(text,text,integer),public.admin_applications(text,text,integer),
  private.admin_application(uuid),public.admin_application(uuid),private.admin_review_save(uuid,jsonb,text,bigint),public.admin_review_save(uuid,jsonb,text,bigint),
  public.basvuru_karar(uuid,text,text) from public,anon;
grant execute on function private.admin_applications(text,text,integer),public.admin_applications(text,text,integer),
  private.admin_application(uuid),public.admin_application(uuid),private.admin_review_save(uuid,jsonb,text,bigint),public.admin_review_save(uuid,jsonb,text,bigint),
  public.basvuru_karar(uuid,text,text) to authenticated;
commit;
