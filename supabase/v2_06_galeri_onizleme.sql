begin;
alter table public.barber_photos add column if not exists thumbnail_path text generated always as(regexp_replace(path,'\.[^.]+$','-thumb.webp')) stored;
alter table public.barber_photos add column if not exists thumbnail_ready boolean not null default false;
alter table public.barbers add column if not exists photo_thumbnail_url text;
grant update(thumbnail_ready) on public.barber_photos to authenticated;
grant select(photo_thumbnail_url) on public.barbers to anon,authenticated;
create or replace function private.guard_gallery() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; file_path text;
begin
  target := case when tg_op='DELETE' then old.barber_id else new.barber_id end;
  if tg_op='DELETE' and not exists(select 1 from public.barbers where id=target) then return old; end if;
  if auth.uid() is null or not public.mfa_ok() then raise exception 'Yetki gerekli' using errcode='42501'; end if;
  perform 1 from public.barbers where id=target and owner_id=auth.uid() for update;
  if not found then raise exception 'Dükkan yetkisi gerekli' using errcode='42501'; end if;
  if (tg_op='INSERT' or (tg_op='UPDATE' and new.ready and not old.ready)) and not private.approved_owner(target) then
    raise exception 'Galeri yüklemek için onaylı ve aktif dükkan gerekli.' using errcode='P2004';
  end if;
  if tg_op='INSERT' then
    if (select count(*) from public.barber_photos where barber_id=target)>=12 then
      raise exception 'En fazla 12 fotoğraf yüklenebilir' using errcode='P2003';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if old.deleted_at is null or exists(select 1 from storage.objects where bucket_id='barber-gallery' and name in(old.path,old.thumbnail_path)) then
      raise exception 'Önce galeri dosyasını temizleyin' using errcode='22023';
    end if;
    return old;
  end if;
  if new.id<>old.id or new.barber_id<>old.barber_id or new.path<>old.path or new.created_at<>old.created_at
    or (old.ready and not new.ready) or (old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at) then
    raise exception 'Galeri kaydı taşınamaz' using errcode='42501';
  end if;
  if new.ready and not old.ready and not exists(select 1 from storage.objects where bucket_id='barber-gallery' and name=new.path) then
    raise exception 'Yükleme tamamlanmadı' using errcode='22023';
  end if;
  if new.thumbnail_ready and not old.thumbnail_ready and not exists(select 1 from storage.objects where bucket_id='barber-gallery' and name=regexp_replace(new.path,'\.[^.]+$','-thumb.webp')) then raise exception 'Önizleme yüklenmedi.' using errcode='22023';end if;
  if old.thumbnail_ready and not new.thumbnail_ready then raise exception 'Önizleme geri alınamaz.' using errcode='42501';end if;
  if new.deleted_at is not null and old.deleted_at is null then
    file_path := '/storage/v1/object/public/barber-gallery/' || old.path;
    update public.barbers set photo_url=null where id=target and right(photo_url,length(file_path))=file_path;
  end if;
  return new;
end $$;
create or replace function private.guard_gallery_cover() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.barber_photos;file_path text;
begin
 if new.photo_url is not distinct from old.photo_url then return new;end if;
 new.photo_thumbnail_url:=null;
 if new.photo_url is null or position('/storage/v1/object/public/barber-gallery/' in new.photo_url)=0 then return new;end if;
 if auth.uid() is null or new.owner_id<>auth.uid() or not public.mfa_ok() then raise exception 'Yetki gerekli.' using errcode='42501';end if;
 if new.photo_url not like 'https://tyxtpfykgitqfhqjkayn.supabase.co/storage/v1/object/public/barber-gallery/%' then raise exception 'Kapak bağlantısı geçersiz.' using errcode='22023';end if;
 file_path:=split_part(new.photo_url,'/storage/v1/object/public/barber-gallery/',2);
 select * into p from public.barber_photos where barber_id=new.id and path=file_path and ready and deleted_at is null;
 if not found then raise exception 'Kapak fotoğrafı bulunamadı.' using errcode='22023';end if;
 if p.thumbnail_ready then new.photo_thumbnail_url:='https://tyxtpfykgitqfhqjkayn.supabase.co/storage/v1/object/public/barber-gallery/'||p.thumbnail_path;end if;
 return new;
end $$;
drop policy if exists gallery_files_insert on storage.objects;
create policy gallery_files_insert on storage.objects for insert to authenticated with check(bucket_id='barber-gallery'
 and array_length(storage.foldername(name),1)=1 and (select public.mfa_ok())
 and exists(select 1 from public.barbers b where b.id::text=(storage.foldername(name))[1] and b.owner_id=(select auth.uid()) and b.verification_status='approved' and b.is_active)
 and exists(select 1 from public.barber_photos p where name in(p.path,p.thumbnail_path) and not p.ready and p.deleted_at is null));
drop policy if exists gallery_files_delete on storage.objects;
create policy gallery_files_delete on storage.objects for delete to authenticated using(bucket_id='barber-gallery'
 and array_length(storage.foldername(name),1)=1 and (select public.mfa_ok())
 and exists(select 1 from public.barbers b where b.id::text=(storage.foldername(name))[1] and b.owner_id=(select auth.uid()))
 and not exists(select 1 from public.barber_photos p where name in(p.path,p.thumbnail_path) and p.deleted_at is null));
create or replace function public.search_barbers(
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
    select b.id,b.shop_name,b.city,b.district,coalesce(b.photo_thumbnail_url,b.photo_url) as photo_url,b.avg_rating,b.review_count,
      min(s.price) as starting_price,p_currency as currency
    from public.barbers b join public.services s on s.barber_id=b.id
    where b.is_active and b.verification_status='approved' and s.is_active and s.currency=p_currency
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
commit;
