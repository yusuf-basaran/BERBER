begin;

create or replace function public.get_available_slots(p_barber_id uuid, p_service_id uuid, p_date date)
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

create or replace function private.proposal_slots(p_appointment_id uuid,p_date date)
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

commit;
