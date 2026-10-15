-- schema.sql ardından bir kez uygulanır.
begin;
create function private.panel_owner(p_barber_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.mfa_ok() or not exists(
    select 1 from public.barbers b join public.profiles p on p.id=b.owner_id
    where b.id=p_barber_id and b.owner_id=auth.uid() and p.role='barber'
  ) then raise exception 'Bu dükkanın paneline erişiminiz yok.' using errcode='42501'; end if;
end $$;

create function private.panel_appointments(p_barber_id uuid,p_view text,p_status text,p_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; total bigint; today date:=(now() at time zone 'Europe/Nicosia')::date;
begin
  perform private.panel_owner(p_barber_id);
  if p_view not in ('today','pending','all') or p_view is null or p_page is null or p_page not between 1 and 1000 or
    p_status is null or p_status not in ('','pending','confirmed','rejected','counter_proposed','cancelled','completed') then
    raise exception 'Filtreler geçersiz.' using errcode='22023';
  end if;
  with selected as (
    select a.*,p.full_name as customer_name,p.phone as customer_phone,
      case when a.status='counter_proposed' then a.proposed_start_at else a.start_at end as effective_start
    from public.appointments a join public.profiles p on p.id=a.customer_id
    where a.barber_id=p_barber_id and (p_status='' or a.status=p_status)
      and (p_view='all' or (p_view='pending' and a.status='pending') or
        (p_view='today' and a.status not in ('rejected','cancelled') and
          ((case when a.status='counter_proposed' then a.proposed_start_at else a.start_at end) at time zone 'Europe/Nicosia')::date=today))
  ), numbered as (select s.*,count(*) over() as total_count from selected s), paged as (
    select * from numbered order by effective_start,id limit 12 offset (p_page-1)*12
  ) select coalesce(jsonb_agg(to_jsonb(paged)-'total_count'),'[]'::jsonb),coalesce(max(total_count),0) into rows,total from paged;
  return jsonb_build_object('rows',rows,'total',total);
end $$;
create function public.get_barber_appointments(p_barber_id uuid,p_view text default 'today',p_status text default '',p_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.panel_appointments(p_barber_id,p_view,p_status,p_page);
$$;

create function private.panel_stats(p_barber_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare counts jsonb; day date:=(now() at time zone 'Europe/Nicosia')::date; monday date;
begin
  perform private.panel_owner(p_barber_id);monday:=date_trunc('week',day::timestamp)::date;
  select jsonb_build_object(
    'pending',count(*) filter(where a.status='pending'),
    'today',count(*) filter(where a.status not in ('rejected','cancelled') and (effective_start at time zone 'Europe/Nicosia')::date=day),
    'week',count(*) filter(where a.status not in ('rejected','cancelled') and (effective_start at time zone 'Europe/Nicosia')::date>=monday and (effective_start at time zone 'Europe/Nicosia')::date<monday+7)
  ) into counts from (select status,case when status='counter_proposed' then proposed_start_at else start_at end as effective_start from public.appointments where barber_id=p_barber_id) a;
  return counts;
end $$;
create function public.get_barber_dashboard(p_barber_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.panel_stats(p_barber_id);$$;

create function public.save_working_hours(p_barber_id uuid,p_hours jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
  perform private.panel_owner(p_barber_id);
  if jsonb_typeof(p_hours)<>'array' or p_hours is null or jsonb_array_length(p_hours)<>7 or
     (select count(distinct (r->>'weekday')::integer) from jsonb_array_elements(p_hours) r)<>7 or
     exists(select 1 from jsonb_array_elements(p_hours) r where (r->>'weekday')::integer not between 0 and 6 or
       r->>'weekday' is null or jsonb_typeof(r->'is_closed') is distinct from 'boolean') then
    raise exception 'Yedi günün saatlerini birlikte gönderin.' using errcode='22023';
  end if;
  insert into public.working_hours(barber_id,weekday,open_time,close_time,break_start,break_end,is_closed)
  select p_barber_id,(r->>'weekday')::smallint,nullif(r->>'open_time','')::time,nullif(r->>'close_time','')::time,
    nullif(r->>'break_start','')::time,nullif(r->>'break_end','')::time,(r->>'is_closed')::boolean
  from jsonb_array_elements(p_hours) r
  on conflict(barber_id,weekday) do update set open_time=excluded.open_time,close_time=excluded.close_time,
    break_start=excluded.break_start,break_end=excluded.break_end,is_closed=excluded.is_closed;
end $$;

create function private.proposal_slots(p_appointment_id uuid,p_date date)
returns table(start_at timestamptz,end_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare booking public.appointments; hours public.working_hours;
begin
  select * into booking from public.appointments where id=p_appointment_id;
  if not found then raise exception 'Randevu bulunamadı.' using errcode='42501'; end if;
  perform private.panel_owner(booking.barber_id);
  if booking.status not in ('pending','confirmed','counter_proposed') or p_date is null or
    p_date<(now() at time zone 'Europe/Nicosia')::date or p_date>(now() at time zone 'Europe/Nicosia')::date+90 or
    not exists(select 1 from public.barbers where id=booking.barber_id and is_active) or
    exists(select 1 from public.closed_dates where barber_id=booking.barber_id and date=p_date) then return; end if;
  select * into hours from public.working_hours where barber_id=booking.barber_id and weekday=extract(dow from p_date)::integer;
  if not found or hours.is_closed then return; end if;
  return query with candidates as (
    select instant as starts,instant+booking.duration_at_booking*interval '1 minute' as finishes
    from generate_series(p_date::timestamp at time zone 'Europe/Nicosia',
      (p_date+1)::timestamp at time zone 'Europe/Nicosia'-interval '1 second',interval '15 minutes') instant
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
create function public.get_proposal_slots(p_appointment_id uuid,p_date date) returns table(start_at timestamptz,end_at timestamptz)
language sql stable security invoker set search_path='' as $$select * from private.proposal_slots(p_appointment_id,p_date);$$;

revoke all on function private.panel_owner(uuid),private.panel_appointments(uuid,text,text,integer),private.panel_stats(uuid),private.proposal_slots(uuid,date) from public,anon,authenticated;
grant execute on function private.panel_owner(uuid),private.panel_appointments(uuid,text,text,integer),private.panel_stats(uuid),private.proposal_slots(uuid,date) to authenticated;
revoke all on function public.get_barber_appointments(uuid,text,text,integer),public.get_barber_dashboard(uuid),public.save_working_hours(uuid,jsonb),public.get_proposal_slots(uuid,date) from public,anon;
grant execute on function public.get_barber_appointments(uuid,text,text,integer),public.get_barber_dashboard(uuid),public.save_working_hours(uuid,jsonb),public.get_proposal_slots(uuid,date) to authenticated;
commit;
