begin;
alter table public.barbers add column if not exists lat numeric(9,6);
alter table public.barbers add column if not exists lng numeric(9,6);
alter table public.barbers drop constraint if exists barbers_coordinates_check;
alter table public.barbers add constraint barbers_coordinates_check check((lat is null and lng is null) or(lat is not null and lng is not null and lat between -90 and 90 and lng between -180 and 180));
grant select(lat,lng) on public.barbers to anon,authenticated;
grant insert(lat,lng),update(lat,lng) on public.barbers to authenticated;
create or replace function public.search_map_barbers(p_filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare needle text;query text:=coalesce(p_filters->>'p_query','');v_city text:=coalesce(p_filters->>'p_city','');v_district text:=coalesce(p_filters->>'p_district','');
 rating numeric:=coalesce((p_filters->>'p_rating')::numeric,0);min_price numeric:=coalesce((p_filters->>'p_min_price')::numeric,0);max_price numeric:=(p_filters->>'p_max_price')::numeric;
 v_currency text:=coalesce(p_filters->>'p_currency','TRY');v_category text:=coalesce(p_filters->>'p_category','');sort text:=coalesce(p_filters->>'p_sort','rating');result jsonb;
begin
 if p_filters is null or jsonb_typeof(p_filters)<>'object' then raise exception 'Filtreler geçersiz.' using errcode='22023';end if;
 perform 1 from public.search_barbers(query,v_city,v_district,rating,min_price,max_price,v_currency,v_category,sort,1);
 needle:=translate(lower(translate(trim(query),'Iİ','ıi')),'ı','i');
 with filtered as(
  select b.id,b.shop_name,b.city,b.district,coalesce(b.photo_thumbnail_url,b.photo_url) as photo_url,b.avg_rating,b.review_count,b.lat,b.lng,b.slug,min(s.price) as starting_price,v_currency as currency
  from public.barbers b join public.services s on s.barber_id=b.id
  where b.verification_status='approved' and b.is_active and s.is_active and s.currency=v_currency
    and(v_city='' or b.city=v_city) and(v_district='' or b.district=v_district) and b.avg_rating>=rating
    and(v_category='' or s.category=v_category) and s.price>=min_price and(max_price is null or s.price<=max_price)
    and strpos(translate(lower(translate(b.shop_name||' '||b.city||' '||b.district,'Iİ','ıi')),'ı','i'),needle)>0
  group by b.id
 ),paged as(select * from filtered order by case when sort='rating' then avg_rating end desc,case when sort='price' then starting_price end,review_count desc,shop_name,id limit 500)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),'total',(select count(*) from filtered),'limited',(select count(*)>500 from filtered)) into result;
 return result;
end $$;
revoke all on function public.search_map_barbers(jsonb) from public;
grant execute on function public.search_map_barbers(jsonb) to anon,authenticated;
commit;
