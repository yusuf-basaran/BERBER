begin;
create table if not exists public.application_documents (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null unique references public.barbers(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  path text not null unique,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check(path ~ ('^'||owner_id::text||'/[a-f0-9-]{36}\.(jpg|png|webp)$'))
);
create index if not exists application_documents_owner_idx on public.application_documents(owner_id);
alter table public.application_documents enable row level security;
revoke all on public.application_documents from public,anon,authenticated;
grant select on public.application_documents to authenticated;
grant insert(barber_id,owner_id,path) on public.application_documents to authenticated;
grant update(deleted_at) on public.application_documents to authenticated;
grant delete on public.application_documents to authenticated;
grant all on public.application_documents to service_role;
drop policy if exists documents_read on public.application_documents;
create policy documents_read on public.application_documents for select to authenticated using(
  (owner_id=(select auth.uid()) and (select public.mfa_ok())) or (deleted_at is null and (select public.is_admin())));
drop policy if exists documents_insert on public.application_documents;
create policy documents_insert on public.application_documents for insert to authenticated with check(
  owner_id=(select auth.uid()) and (select public.mfa_ok()) and exists(select 1 from public.barbers b where b.id=barber_id and b.owner_id=(select auth.uid())));
drop policy if exists documents_update on public.application_documents;
create policy documents_update on public.application_documents for update to authenticated
using(owner_id=(select auth.uid()) and (select public.mfa_ok())) with check(owner_id=(select auth.uid()) and (select public.mfa_ok()) and deleted_at is not null);
create or replace function private.document_file_absent(p_path text) returns boolean
language sql stable security definer set search_path='' as $$select auth.uid() is not null and public.mfa_ok() and p_path like auth.uid()::text||'/%'
  and not exists(select 1 from storage.objects o where o.bucket_id='basvuru-belgeleri' and o.name=p_path)$$;
revoke all on function private.document_file_absent(text) from public,anon;
grant execute on function private.document_file_absent(text) to authenticated;
drop policy if exists documents_delete on public.application_documents;
create policy documents_delete on public.application_documents for delete to authenticated using(owner_id=(select auth.uid()) and (select public.mfa_ok()) and deleted_at is not null
  and private.document_file_absent(path));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('basvuru-belgeleri','basvuru-belgeleri',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists application_document_read on storage.objects;
create policy application_document_read on storage.objects for select to authenticated using(bucket_id='basvuru-belgeleri' and
  exists(select 1 from public.application_documents d where d.path=name));
drop policy if exists application_document_upload on storage.objects;
create policy application_document_upload on storage.objects for insert to authenticated with check(bucket_id='basvuru-belgeleri' and
  (storage.foldername(name))[1]=(select auth.uid())::text and (select public.mfa_ok()) and
  exists(select 1 from public.application_documents d where d.path=name and d.owner_id=(select auth.uid()) and d.deleted_at is null));
drop policy if exists application_document_delete on storage.objects;
create policy application_document_delete on storage.objects for delete to authenticated using(bucket_id='basvuru-belgeleri' and
  (storage.foldername(name))[1]=(select auth.uid())::text and (select public.mfa_ok()) and
  exists(select 1 from public.application_documents d where d.path=name and d.owner_id=(select auth.uid()) and d.deleted_at is not null));
create or replace function private.claim_expired_documents() returns table(id uuid,path text)
language plpgsql security definer set search_path='' as $$
begin
  if current_setting('request.jwt.claims',true)::jsonb->>'role' is distinct from 'service_role' then raise exception 'Yetki gerekli.' using errcode='42501'; end if;
  return query with due as (
    select d.id from public.application_documents d join public.barbers b on b.id=d.barber_id
    where d.deleted_at is not null or (b.decided_at<now()-interval '30 days' and b.verification_status<>'pending')
      or (d.created_at<now()-interval '1 day' and not exists(select 1 from storage.objects o where o.bucket_id='basvuru-belgeleri' and o.name=d.path))
    order by d.created_at limit 100 for update of d,b skip locked
  ) update public.application_documents d set deleted_at=coalesce(d.deleted_at,now()) from due where due.id=d.id returning d.id,d.path;
end $$;
create or replace function public.claim_expired_documents() returns table(id uuid,path text)
language sql security invoker set search_path='' as $$select * from private.claim_expired_documents()$$;
revoke all on function private.claim_expired_documents(),public.claim_expired_documents() from public,anon,authenticated;
grant execute on function private.claim_expired_documents(),public.claim_expired_documents() to service_role;
commit;

