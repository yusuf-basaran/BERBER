begin;
create or replace function private.barber_calendar(p_date date,p_days integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare shop uuid; result jsonb;
begin
 select id into shop from public.barbers where owner_id=auth.uid();
 perform private.approved_panel_owner(shop);
 if p_date is null or p_days is null or p_days not in(1,7) or p_date<date '2000-01-01'
   or p_date>(now() at time zone 'Europe/Nicosia')::date+366 then raise exception 'Takvim aralığı geçersiz.' using errcode='22023';end if;
 with selected as(
  select a.*,coalesce(p.full_name,a.guest_name) as customer_name,
   case when exists(select 1 from public.appointments prior where prior.barber_id=a.barber_id and prior.status in('confirmed','completed')
     and ((a.customer_id is not null and prior.customer_id=a.customer_id) or(a.customer_id is null and prior.customer_id is null and prior.guest_phone=a.guest_phone))) then coalesce(p.phone,a.guest_phone) else null end as customer_phone,
   case when a.status='pending' and a.customer_id is not null then private.no_show_count(a.id) else null end as no_show_count,
   exists(select 1 from public.blocked_customers bc where bc.barber_id=a.barber_id and bc.customer_id=a.customer_id) as customer_blocked,
   (select count(*) from public.appointments prior where prior.barber_id=a.barber_id and prior.status='completed'
      and ((a.customer_id is not null and prior.customer_id=a.customer_id) or(a.customer_id is null and prior.customer_id is null and prior.guest_phone=a.guest_phone))) as prior_visits,
   case when a.status='counter_proposed' then a.proposed_start_at else a.start_at end as effective_start
  from public.appointments a left join public.profiles p on p.id=a.customer_id
  where a.barber_id=shop and ((case when a.status='counter_proposed' then a.proposed_start_at else a.start_at end) at time zone 'Europe/Nicosia')::date>=p_date
   and ((case when a.status='counter_proposed' then a.proposed_start_at else a.start_at end) at time zone 'Europe/Nicosia')::date<p_date+p_days
 ),paged as(select * from selected order by effective_start,id limit 500)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)-'guest_phone') from paged p),'[]'::jsonb),'total',(select count(*) from selected)) into result;
 return result;
end $$;
create or replace function public.get_barber_calendar(p_date date,p_days integer default 7) returns jsonb
language sql stable security invoker set search_path='' as $$select private.barber_calendar(p_date,p_days)$$;
revoke all on function private.barber_calendar(date,integer),public.get_barber_calendar(date,integer) from public,anon;
grant execute on function private.barber_calendar(date,integer),public.get_barber_calendar(date,integer) to authenticated;

create or replace function private.barber_statistics(p_days integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare shop uuid;today date:=(now() at time zone 'Europe/Nicosia')::date;result jsonb;
begin
 select id into shop from public.barbers where owner_id=auth.uid();
 perform private.approved_panel_owner(shop);
 if p_days is null or p_days not in(7,30,90) then raise exception 'İstatistik dönemi geçersiz.' using errcode='22023';end if;
 with period as(
  select status,service_name_at_booking as service,price_at_booking as price,currency_at_booking as currency,
    (start_at at time zone 'Europe/Nicosia')::date as day,extract(isodow from start_at at time zone 'Europe/Nicosia')::integer as weekday,
    extract(hour from start_at at time zone 'Europe/Nicosia')::integer as hour
  from public.appointments where barber_id=shop and start_at>=((today-p_days+1)::timestamp at time zone 'Europe/Nicosia') and start_at<((today+1)::timestamp at time zone 'Europe/Nicosia')
 ),services as(select service,count(*) as count from period group by service order by count(*) desc,service limit 5),
 days as(select weekday,count(*) as count from period where status in('confirmed','completed','no_show') group by weekday order by count(*) desc,weekday),
 hours as(select hour,count(*) as count from period where status in('confirmed','completed','no_show') group by hour order by count(*) desc,hour limit 5),
 daily as(select series::date as date,(select count(*) from period p where p.day=series::date) as count from generate_series((today-p_days+1)::timestamp,today::timestamp,interval '1 day') series),
 revenues as(select currency,sum(price) as amount from period where status='completed' group by currency)
 select jsonb_build_object('days',p_days,'from',today-p_days+1,'to',today,'total',(select count(*) from period),
 'completed',(select count(*) from period where status='completed'),'cancelled',(select count(*) from period where status='cancelled'),'no_show',(select count(*) from period where status='no_show'),
 'services',coalesce((select jsonb_agg(to_jsonb(s)) from services s),'[]'::jsonb),
 'weekdays',coalesce((select jsonb_agg(to_jsonb(d)) from days d),'[]'::jsonb),
 'hours',coalesce((select jsonb_agg(to_jsonb(h)) from hours h),'[]'::jsonb),
 'daily',coalesce((select jsonb_agg(to_jsonb(d)) from daily d),'[]'::jsonb),
 'revenue',coalesce((select jsonb_agg(to_jsonb(r)) from revenues r),'[]'::jsonb)) into result;
 return result;
end $$;
create or replace function public.get_barber_statistics(p_days integer default 30) returns jsonb
language sql stable security invoker set search_path='' as $$select private.barber_statistics(p_days)$$;
revoke all on function private.barber_statistics(integer),public.get_barber_statistics(integer) from public,anon;
grant execute on function private.barber_statistics(integer),public.get_barber_statistics(integer) to authenticated;
commit;
