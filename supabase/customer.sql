-- schema.sql ardından bir kez uygulanır.
begin;
create function public.search_barbers(
  p_query text default '', p_city text default '', p_district text default '',
  p_rating numeric default 0, p_min_price numeric default 0, p_max_price numeric default null,
  p_currency text default 'TRY', p_category text default '', p_sort text default 'rating', p_page integer default 1
) returns table (
  id uuid,shop_name text,city text,district text,photo_url text,avg_rating numeric,
  review_count integer,starting_price numeric,currency text,total_count bigint
) language plpgsql stable security invoker set search_path = '' as $$
declare needle text;
begin
  if p_query is null or length(p_query)>120 or p_rating is null or p_rating not between 0 and 5 or
     p_min_price is null or p_min_price<0 or (p_max_price is not null and p_max_price<p_min_price) or
     p_currency is null or p_currency not in ('TRY','GBP','EUR') or p_sort is null or p_sort not in ('rating','price') or
     p_page is null or p_page not between 1 and 1000 then
    raise exception 'Arama filtreleri geçersiz.' using errcode='22023';
  end if;
  needle:=translate(lower(translate(trim(p_query),'Iİ','ıi')),'ı','i');
  return query with candidates as (
    select b.id,b.shop_name,b.city,b.district,b.photo_url,b.avg_rating,b.review_count,
      min(s.price) as starting_price,p_currency as currency
    from public.barbers b join public.services s on s.barber_id=b.id
    where b.is_active and s.is_active and s.currency=p_currency
      and (coalesce(p_city,'')='' or b.city=p_city) and (coalesce(p_district,'')='' or b.district=p_district)
      and b.avg_rating>=p_rating and (coalesce(p_category,'')='' or s.category=p_category)
      and s.price>=p_min_price and (p_max_price is null or s.price<=p_max_price)
      and strpos(translate(lower(translate(b.shop_name||' '||b.city||' '||b.district,'Iİ','ıi')),'ı','i'),needle)>0
    group by b.id,b.shop_name,b.city,b.district,b.photo_url,b.avg_rating,b.review_count
  ) select c.*,count(*) over() from candidates c
    order by case when p_sort='rating' then c.avg_rating end desc,
      case when p_sort='price' then c.starting_price end asc,c.review_count desc,c.shop_name,c.id
    limit 12 offset (p_page-1)*12;
end $$;
revoke all on function public.search_barbers(text,text,text,numeric,numeric,numeric,text,text,text,integer) from public;
grant execute on function public.search_barbers(text,text,text,numeric,numeric,numeric,text,text,text,integer) to anon,authenticated,service_role;
commit;
