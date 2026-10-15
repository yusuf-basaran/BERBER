begin;
set local lock_timeout='5s';
alter table public.barbers add column if not exists application_ready boolean not null default true;
alter table public.barbers alter column application_ready set default false;
do $$begin
  if exists(select 1 from public.barbers where verification_status in('pending','approved') group by phone having count(*)>1) then
    raise exception 'Aynı telefonla aktif başvurular var; kayıt silmeden inceleyin.' using errcode='23505';
  end if;
end $$;
create unique index if not exists barbers_application_phone_unique on public.barbers(phone) where verification_status in('pending','approved');
create or replace function private.guard_barber_application() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    new.verification_status:='pending';new.application_ready:=false;new.rejection_reason:=null;new.admin_note:='';new.checklist:='{}';
    new.submitted_at:=now();new.decided_at:=null;new.decided_by:=null;new.application_count:=1;new.application_revision:=0;
  else
    if row(new.verification_status,new.application_ready,new.rejection_reason,new.admin_note,new.checklist,new.submitted_at,new.decided_at,new.decided_by,new.application_count,new.application_revision)
      is distinct from row(old.verification_status,old.application_ready,old.rejection_reason,old.admin_note,old.checklist,old.submitted_at,old.decided_at,old.decided_by,old.application_count,old.application_revision)
      and current_user not in('postgres','supabase_admin') then
      raise exception 'Başvuru yalnızca yetkili işlemle değişir.' using errcode='42501';
    end if;
    if row(new.shop_name,new.city,new.district,new.address,new.phone,new.map_url,new.bio,new.photo_url,new.instagram_url)
      is distinct from row(old.shop_name,old.city,old.district,old.address,old.phone,old.map_url,old.bio,old.photo_url,old.instagram_url) then
      new.application_revision:=old.application_revision+1;
    end if;
  end if;
  return new;
end $$;
create or replace function private.barber_application(p_barber_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.panel_owner(p_barber_id);
  return (select jsonb_build_object('verification_status',verification_status,'rejection_reason',rejection_reason,
    'submitted_at',submitted_at,'decided_at',decided_at,'application_count',application_count,'application_ready',application_ready,'application_revision',application_revision)
    from public.barbers where id=p_barber_id);
end $$;
create or replace function private.submit_barber_application(p_barber_id uuid,p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.barbers;
begin
  perform private.panel_owner(p_barber_id);
  select * into b from public.barbers where id=p_barber_id for update;
  if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'E-postanı doğrula.' using errcode='42501'; end if;
  if p_revision is null or p_revision<>b.application_revision then raise exception 'Başvuru değişti, yenileyin.' using errcode='P2005'; end if;
  if not ((b.verification_status='pending' and not b.application_ready) or (b.verification_status='rejected' and b.application_count<3)) then
    raise exception 'Başvuru gönderilemiyor.' using errcode='P2006'; end if;
  if nullif(trim(b.bio),'') is null or b.map_url is null or not exists(select 1 from storage.objects o
    where o.bucket_id='barber-photos' and o.name like b.owner_id::text||'/%'
      and b.photo_url='https://tyxtpfykgitqfhqjkayn.supabase.co/storage/v1/object/public/barber-photos/'||o.name) then
    raise exception 'Açıklama, harita bağlantısı ve dükkan fotoğrafını tamamla.' using errcode='22023'; end if;
  update public.barbers set verification_status='pending',application_ready=true,application_count=application_count+case when b.verification_status='rejected' then 1 else 0 end,
    rejection_reason=null,checklist='{}',decided_at=null,decided_by=null,submitted_at=now(),application_revision=application_revision+1 where id=b.id;
  return private.barber_application(b.id);
end $$;
create or replace function public.submit_barber_application(p_barber_id uuid,p_revision bigint) returns jsonb
language sql security invoker set search_path='' as $$select private.submit_barber_application(p_barber_id,p_revision)$$;
revoke all on function private.submit_barber_application(uuid,bigint),public.submit_barber_application(uuid,bigint) from public,anon;
grant execute on function private.submit_barber_application(uuid,bigint),public.submit_barber_application(uuid,bigint) to authenticated;
create or replace function private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare application jsonb;
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
  application:=new.raw_user_meta_data->'shop_application';
  if new.raw_user_meta_data->>'role'='barber' and application is not null then
    if jsonb_typeof(application)<>'object' then raise exception 'Dükkan bilgileri geçersiz.' using errcode='22023'; end if;
    insert into public.barbers(owner_id,shop_name,city,district,address,phone,map_url,bio,instagram_url)
    values(new.id,trim(application->>'shop_name'),application->>'city',application->>'district',trim(application->>'address'),
      application->>'phone',nullif(application->>'map_url',''),coalesce(application->>'bio',''),nullif(application->>'instagram_url',''));
  end if;
  return new;
end $$;
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
    where b.application_ready and b.verification_status=p_status and (trim(p_search)='' or strpos(lower(b.shop_name||' '||p.full_name||' '||coalesce(u.email,'')||' '||b.city),lower(trim(p_search)))>0)
  ), page_rows as (select * from filtered order by submitted_at,id limit 20 offset (p_page-1)*20)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.submitted_at,r.id) from page_rows r),'[]'::jsonb),
    'total',(select count(*) from filtered),'pending_count',(select count(*) from public.barbers where verification_status='pending' and application_ready)) into answer;
  return answer;
end $$;
create or replace function public.admin_applications(p_status text default 'pending',p_search text default '',p_page integer default 1) returns jsonb
language sql stable security invoker set search_path='' as $$select private.admin_applications(p_status,p_search,p_page)$$;

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
  if not previous.application_ready then raise exception 'Başvuru henüz gönderilmedi.' using errcode='P2006'; end if;
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
  if new.application_ready and new.verification_status='pending' and
    (tg_op='INSERT' or old.verification_status is distinct from 'pending' or not old.application_ready) then
    insert into public.notifications(user_id,type,title,body,barber_id)
    select user_id,'barber_application_submitted','Yeni dükkan başvurusu',new.shop_name||' başvurusu inceleme bekliyor.',new.id from public.admin_users;
  end if;
  return null;
end $$;
drop trigger if exists barber_application_notice on public.barbers;
create trigger barber_application_notice after insert or update of verification_status,application_ready on public.barbers for each row execute function private.notify_barber_application();
commit;
