begin;
set local lock_timeout = '5s';
create table if not exists public.barber_photos (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete cascade,
  path text not null unique,
  caption text not null default '' check(char_length(caption)<=200),
  sort_order integer not null default 0 check(sort_order between 0 and 10000),
  created_at timestamptz not null default now(),
  ready boolean not null default false,
  deleted_at timestamptz,
  check(path ~ ('^' || barber_id::text || '/[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$'))
);
create index if not exists barber_photos_order_idx on public.barber_photos(barber_id,sort_order,created_at,id);
alter table public.barber_photos enable row level security;
revoke all on public.barber_photos from public,anon,authenticated;
grant select on public.barber_photos to anon,authenticated;
grant insert(barber_id,path,caption,sort_order) on public.barber_photos to authenticated;
grant update(caption,sort_order,ready,deleted_at) on public.barber_photos to authenticated;
grant delete on public.barber_photos to authenticated;
grant all on public.barber_photos to service_role;
drop policy if exists gallery_read on public.barber_photos;
create policy gallery_read on public.barber_photos for select to authenticated
using ((ready and deleted_at is null) or exists(select 1 from public.barbers b where b.id=barber_id and b.owner_id=(select auth.uid()) and (select public.mfa_ok())));
drop policy if exists gallery_public_read on public.barber_photos;
create policy gallery_public_read on public.barber_photos for select to anon using(ready and deleted_at is null);
drop policy if exists gallery_insert on public.barber_photos;
create policy gallery_insert on public.barber_photos for insert to authenticated
with check(private.owns_barber(barber_id) and (select public.mfa_ok()));
drop policy if exists gallery_update on public.barber_photos;
create policy gallery_update on public.barber_photos for update to authenticated
using(private.owns_barber(barber_id) and (select public.mfa_ok()))
with check(private.owns_barber(barber_id) and (select public.mfa_ok()));
drop policy if exists gallery_delete on public.barber_photos;
create policy gallery_delete on public.barber_photos for delete to authenticated
using(private.owns_barber(barber_id) and (select public.mfa_ok()));

create or replace function private.guard_gallery() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; file_path text;
begin
  target := case when tg_op='DELETE' then old.barber_id else new.barber_id end;
  if tg_op='DELETE' and not exists(select 1 from public.barbers where id=target) then return old; end if;
  if auth.uid() is null or not public.mfa_ok() then raise exception 'Yetki gerekli' using errcode='42501'; end if;
  perform 1 from public.barbers where id=target and owner_id=auth.uid() for update;
  if not found then raise exception 'Dükkan yetkisi gerekli' using errcode='42501'; end if;
  if tg_op='INSERT' then
    if (select count(*) from public.barber_photos where barber_id=target)>=12 then
      raise exception 'En fazla 12 fotoğraf yüklenebilir' using errcode='P2003';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if old.deleted_at is null or exists(select 1 from storage.objects where bucket_id='barber-gallery' and name=old.path) then
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
  if new.deleted_at is not null and old.deleted_at is null then
    file_path := '/storage/v1/object/public/barber-gallery/' || old.path;
    update public.barbers set photo_url=null where id=target and right(photo_url,length(file_path))=file_path;
  end if;
  return new;
end $$;
revoke all on function private.guard_gallery() from public,anon,authenticated;
drop trigger if exists gallery_guard on public.barber_photos;
create trigger gallery_guard before insert or update or delete on public.barber_photos for each row execute function private.guard_gallery();

create or replace function private.reorder_gallery(p_barber_id uuid,p_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.mfa_ok() then raise exception 'Yetki gerekli' using errcode='42501'; end if;
  perform 1 from public.barbers where id=p_barber_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Dükkan yetkisi gerekli' using errcode='42501'; end if;
  if p_ids is null or cardinality(p_ids)>12 or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x)
    or cardinality(p_ids)<>(select count(*) from public.barber_photos where barber_id=p_barber_id and ready and deleted_at is null)
    or exists(select 1 from unnest(p_ids) x where not exists(select 1 from public.barber_photos p where p.id=x and p.barber_id=p_barber_id and p.ready and p.deleted_at is null)) then
    raise exception 'Galeri değişti, yenileyin' using errcode='22023';
  end if;
  update public.barber_photos p set sort_order=v.ordinality::integer
    from unnest(p_ids) with ordinality v(id,ordinality) where p.id=v.id and p.barber_id=p_barber_id;
end $$;
revoke all on function private.reorder_gallery(uuid,uuid[]) from public,anon,authenticated;
grant execute on function private.reorder_gallery(uuid,uuid[]) to authenticated;
create or replace function public.reorder_gallery(p_barber_id uuid,p_ids uuid[]) returns void
language sql security invoker set search_path='' as $$ select private.reorder_gallery(p_barber_id,p_ids) $$;
revoke all on function public.reorder_gallery(uuid,uuid[]) from public,anon;
grant execute on function public.reorder_gallery(uuid,uuid[]) to authenticated;

create or replace function private.guard_gallery_cover() returns trigger
language plpgsql security definer set search_path='' as $$
declare file_path text;
begin
  if new.photo_url is not distinct from old.photo_url or new.photo_url is null or position('/storage/v1/object/public/barber-gallery/' in new.photo_url)=0 then return new; end if;
  if auth.uid() is null or new.owner_id<>auth.uid() or not public.mfa_ok() then raise exception 'Yetki gerekli' using errcode='42501'; end if;
  file_path := split_part(new.photo_url,'/storage/v1/object/public/barber-gallery/',2);
  if not exists(select 1 from public.barber_photos p where p.barber_id=new.id and p.path=file_path and p.ready and p.deleted_at is null) then
    raise exception 'Kapak fotoğrafı bulunamadı' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function private.guard_gallery_cover() from public,anon,authenticated;
drop trigger if exists gallery_cover_guard on public.barbers;
create trigger gallery_cover_guard before update of photo_url on public.barbers for each row execute function private.guard_gallery_cover();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('barber-gallery','barber-gallery',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists gallery_files_read on storage.objects;
create policy gallery_files_read on storage.objects for select to anon,authenticated using(bucket_id='barber-gallery');
drop policy if exists gallery_files_insert on storage.objects;
create policy gallery_files_insert on storage.objects for insert to authenticated with check(
  bucket_id='barber-gallery' and array_length(storage.foldername(name),1)=1 and (select public.mfa_ok())
  and exists(select 1 from public.barbers b where b.id::text=(storage.foldername(name))[1] and b.owner_id=(select auth.uid()))
  and exists(select 1 from public.barber_photos p where p.path=name and not p.ready and p.deleted_at is null)
);
drop policy if exists gallery_files_delete on storage.objects;
create policy gallery_files_delete on storage.objects for delete to authenticated using(
  bucket_id='barber-gallery' and array_length(storage.foldername(name),1)=1 and (select public.mfa_ok())
  and exists(select 1 from public.barbers b where b.id::text=(storage.foldername(name))[1] and b.owner_id=(select auth.uid()))
  and not exists(select 1 from public.barber_photos p where p.path=name and p.deleted_at is null)
);
commit;
