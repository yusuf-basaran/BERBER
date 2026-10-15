begin;
alter table public.appointments add column if not exists cancelled_by text check(cancelled_by in('customer','barber','system'));
create or replace function private.record_cancellation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='cancelled' and old.status<>'cancelled' then new.cancelled_by:=case when auth.uid()=old.customer_id then 'customer' else 'barber' end;
  else new.cancelled_by:=old.cancelled_by;end if;
  return new;
end $$;
revoke all on function private.record_cancellation() from public,anon,authenticated,service_role;
drop trigger if exists zz_cancellation_actor on public.appointments;
create trigger zz_cancellation_actor before update on public.appointments for each row execute function private.record_cancellation();
create table if not exists public.barber_customer_notes(
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete cascade,
  customer_id uuid references public.profiles(id) on delete cascade,
  guest_phone text,
  note text not null default '' check(char_length(note)<=1000),
  tags text[] not null default '{}' check(cardinality(tags)<=5 and array_position(tags,null) is null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((customer_id is not null)::int+(guest_phone is not null)::int=1),
  check(guest_phone is null or guest_phone ~ '^\+90(5[0-9]{9}|392[0-9]{7})$')
);
create unique index if not exists barber_notes_customer_unique on public.barber_customer_notes(barber_id,customer_id) where customer_id is not null;
create unique index if not exists barber_notes_guest_unique on public.barber_customer_notes(barber_id,guest_phone) where guest_phone is not null;
create index if not exists barber_notes_customer_idx on public.barber_customer_notes(customer_id) where customer_id is not null;
alter table public.barber_customer_notes enable row level security;
revoke all on public.barber_customer_notes from public,anon,authenticated;
grant select,delete on public.barber_customer_notes to authenticated;
grant insert(barber_id,customer_id,guest_phone,note,tags),update(note,tags) on public.barber_customer_notes to authenticated;
grant all on public.barber_customer_notes to service_role;
create or replace function private.customer_relation(p_barber_id uuid,p_customer_id uuid,p_guest_phone text) returns boolean
language sql stable security definer set search_path='' as $$select private.approved_owner(p_barber_id) and
  ((p_customer_id is not null)::int+(p_guest_phone is not null)::int=1) and exists(select 1 from public.appointments a where a.barber_id=p_barber_id and
    ((p_customer_id is not null and a.customer_id=p_customer_id) or (p_guest_phone is not null and a.customer_id is null and a.guest_phone=p_guest_phone)))$$;
revoke all on function private.customer_relation(uuid,uuid,text) from public,anon;
grant execute on function private.customer_relation(uuid,uuid,text) to authenticated;
drop policy if exists notes_read on public.barber_customer_notes;
create policy notes_read on public.barber_customer_notes for select to authenticated using(private.customer_relation(barber_id,customer_id,guest_phone));
drop policy if exists notes_insert on public.barber_customer_notes;
create policy notes_insert on public.barber_customer_notes for insert to authenticated with check(private.customer_relation(barber_id,customer_id,guest_phone));
drop policy if exists notes_update on public.barber_customer_notes;
create policy notes_update on public.barber_customer_notes for update to authenticated using(private.customer_relation(barber_id,customer_id,guest_phone)) with check(private.customer_relation(barber_id,customer_id,guest_phone));
drop policy if exists notes_delete on public.barber_customer_notes;
create policy notes_delete on public.barber_customer_notes for delete to authenticated using(private.customer_relation(barber_id,customer_id,guest_phone));
create or replace function private.guard_customer_note() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from unnest(new.tags) tag where char_length(trim(tag)) not between 1 and 20) then raise exception 'Etiketler 1–20 karakter olmalı.' using errcode='22023'; end if;
  if tg_op='UPDATE' and row(new.id,new.barber_id,new.customer_id,new.guest_phone,new.created_at) is distinct from row(old.id,old.barber_id,old.customer_id,old.guest_phone,old.created_at) then
    raise exception 'Müşteri notu taşınamaz.' using errcode='42501';end if;
  new.updated_at:=now();return new;
end $$;
revoke all on function private.guard_customer_note() from public,anon,authenticated,service_role;
drop trigger if exists customer_note_guard on public.barber_customer_notes;
create trigger customer_note_guard before insert or update on public.barber_customer_notes for each row execute function private.guard_customer_note();
create or replace function private.customer_shop() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare shop uuid;
begin
  select id into shop from public.barbers where owner_id=auth.uid();
  if shop is null or not private.approved_owner(shop) then raise exception 'Onaylı dükkan ve doğrulama gerekli.' using errcode='42501';end if;
  return shop;
end $$;
revoke all on function private.customer_shop() from public,anon;
grant execute on function private.customer_shop() to authenticated;
create or replace function private.musteri_karti(p_customer_id uuid,p_guest_phone text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare shop uuid:=private.customer_shop(); phone text; answer jsonb;
begin
  if p_guest_phone is not null then p_guest_phone:=private.normalize_phone(p_guest_phone);end if;
  if not private.customer_relation(shop,p_customer_id,p_guest_phone) then raise exception 'Müşteri kaydı bulunamadı.' using errcode='42501';end if;
  if exists(select 1 from public.appointments a where a.barber_id=shop and a.status in('confirmed','completed') and
    ((p_customer_id is not null and a.customer_id=p_customer_id) or (p_guest_phone is not null and a.customer_id is null and a.guest_phone=p_guest_phone))) then
    phone:=case when p_customer_id is not null then (select p.phone from public.profiles p where p.id=p_customer_id) else p_guest_phone end;
  end if;
  with visits as(select * from public.appointments a where a.barber_id=shop and
    ((p_customer_id is not null and a.customer_id=p_customer_id) or (p_guest_phone is not null and a.customer_id is null and a.guest_phone=p_guest_phone)))
  select jsonb_build_object('customer_id',p_customer_id,'guest_phone',case when p_customer_id is null then phone else null end,'phone',phone,
    'full_name',coalesce((select p.full_name from public.profiles p where p.id=p_customer_id),(select guest_name from visits order by created_at desc limit 1)),
    'preference_note',coalesce((select p.preference_note from public.profiles p where p.id=p_customer_id),''),
    'total',(select count(*) from visits),'completed',(select count(*) from visits where status='completed'),
    'customer_cancelled',(select count(*) from visits where status='cancelled' and cancelled_by='customer'),
    'no_show',(select count(*) from visits where status='no_show'),
    'first_visit',(select min(start_at) from visits where status='completed'),'last_visit',(select max(start_at) from visits where status='completed'),
    'favorite_service',(select service_name_at_booking from visits where status='completed' group by service_name_at_booking order by count(*) desc,service_name_at_booking limit 1),
    'global_no_show',case when p_customer_id is not null and exists(select 1 from visits where status in('pending','confirmed')) then (select count(*) from public.appointments where customer_id=p_customer_id and status='no_show') else null end,
    'note',coalesce((select n.note from public.barber_customer_notes n where n.barber_id=shop and (n.customer_id=p_customer_id or n.guest_phone=p_guest_phone)),''),
    'tags',coalesce((select to_jsonb(n.tags) from public.barber_customer_notes n where n.barber_id=shop and (n.customer_id=p_customer_id or n.guest_phone=p_guest_phone)),'[]'::jsonb)) into answer;
  return answer;
end $$;
create or replace function public.musteri_karti(p_customer_id uuid default null,p_guest_phone text default null) returns jsonb
language sql stable security invoker set search_path='' as $$select private.musteri_karti(p_customer_id,p_guest_phone)$$;
create or replace function private.musteri_not_kaydet(p_customer_id uuid,p_guest_phone text,p_note text,p_tags text[]) returns void
language plpgsql security definer set search_path='' as $$
declare shop uuid:=private.customer_shop();
begin
  perform 1 from public.barbers where id=shop for update;
  if p_guest_phone is not null then p_guest_phone:=private.normalize_phone(p_guest_phone);end if;
  if not private.customer_relation(shop,p_customer_id,p_guest_phone) then raise exception 'Müşteri kaydı bulunamadı.' using errcode='42501';end if;
  if p_note is null or p_tags is null then raise exception 'Not geçersiz.' using errcode='22023';end if;
  if trim(p_note)='' and cardinality(p_tags)=0 then delete from public.barber_customer_notes where barber_id=shop and (customer_id=p_customer_id or guest_phone=p_guest_phone);return;end if;
  if p_customer_id is not null then
    insert into public.barber_customer_notes(barber_id,customer_id,note,tags) values(shop,p_customer_id,trim(p_note),p_tags)
    on conflict(barber_id,customer_id) where customer_id is not null do update set note=excluded.note,tags=excluded.tags;
  else
    insert into public.barber_customer_notes(barber_id,guest_phone,note,tags) values(shop,p_guest_phone,trim(p_note),p_tags)
    on conflict(barber_id,guest_phone) where guest_phone is not null do update set note=excluded.note,tags=excluded.tags;
  end if;
end $$;
create or replace function public.musteri_not_kaydet(p_customer_id uuid,p_guest_phone text,p_note text,p_tags text[]) returns void
language sql security invoker set search_path='' as $$select private.musteri_not_kaydet(p_customer_id,p_guest_phone,p_note,p_tags)$$;
create or replace function private.musterilerim(p_arama text,p_sayfa integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare shop uuid:=private.customer_shop();answer jsonb;
begin
  if p_arama is null or char_length(p_arama)>100 or p_sayfa is null or p_sayfa not between 1 and 1000 then raise exception 'Arama geçersiz.' using errcode='22023';end if;
  with grouped as(
    select a.customer_id,a.guest_phone,max(coalesce(p.full_name,a.guest_name)) as full_name,count(*) as visits,
      max(a.start_at) filter(where a.status='completed') as last_visit
    from public.appointments a left join public.profiles p on p.id=a.customer_id where a.barber_id=shop group by a.customer_id,a.guest_phone
  ), filtered as(select g.customer_id,g.guest_phone,g.full_name,g.visits,g.last_visit,coalesce(n.tags,'{}') as tags,coalesce(n.note<>'',false) as has_note
    from grouped g left join public.barber_customer_notes n on n.barber_id=shop and (n.customer_id=g.customer_id or n.guest_phone=g.guest_phone)
    where strpos(lower(g.full_name),lower(trim(p_arama)))>0),
  paged as(select * from filtered order by last_visit desc nulls last,full_name,customer_id,guest_phone limit 30 offset (p_sayfa-1)*30)
  select jsonb_build_object('rows',coalesce((select jsonb_agg((to_jsonb(p)-'guest_phone')||jsonb_build_object('guest_reference',(select a.id from public.appointments a where a.barber_id=shop and a.customer_id is null and a.guest_phone=p.guest_phone order by a.created_at desc limit 1))) from paged p),'[]'::jsonb),'total',(select count(*) from filtered)) into answer;
  return answer;
end $$;
create or replace function public.musterilerim(p_arama text default '',p_sayfa integer default 1) returns jsonb
language sql stable security invoker set search_path='' as $$select private.musterilerim(p_arama,p_sayfa)$$;
revoke all on function private.musteri_karti(uuid,text),public.musteri_karti(uuid,text),private.musteri_not_kaydet(uuid,text,text,text[]),public.musteri_not_kaydet(uuid,text,text,text[]),private.musterilerim(text,integer),public.musterilerim(text,integer) from public,anon;
grant execute on function private.musteri_karti(uuid,text),public.musteri_karti(uuid,text),private.musteri_not_kaydet(uuid,text,text,text[]),public.musteri_not_kaydet(uuid,text,text,text[]),private.musterilerim(text,integer),public.musterilerim(text,integer) to authenticated;

create or replace function private.guest_card(p_appointment_id uuid,p_save boolean,p_note text,p_tags text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare shop uuid:=private.customer_shop();phone text;
begin
  select guest_phone into phone from public.appointments where id=p_appointment_id and barber_id=shop and customer_id is null;
  if phone is null then raise exception 'Müşteri kaydı bulunamadı.' using errcode='42501';end if;
  if p_save then perform private.musteri_not_kaydet(null,phone,p_note,p_tags);end if;
  return private.musteri_karti(null,phone);
end $$;
create or replace function public.guest_customer_card(p_appointment_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.guest_card(p_appointment_id,false,null,null)$$;
create or replace function public.guest_customer_note(p_appointment_id uuid,p_note text,p_tags text[]) returns jsonb
language sql security invoker set search_path='' as $$select private.guest_card(p_appointment_id,true,p_note,p_tags)$$;
revoke all on function private.guest_card(uuid,boolean,text,text[]),public.guest_customer_card(uuid),public.guest_customer_note(uuid,text,text[]) from public,anon;
grant execute on function private.guest_card(uuid,boolean,text,text[]),public.guest_customer_card(uuid),public.guest_customer_note(uuid,text,text[]) to authenticated;
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
