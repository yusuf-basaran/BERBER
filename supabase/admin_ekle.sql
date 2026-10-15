create or replace function pg_temp.admin_ekle(p_email text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare target uuid; matches integer;
begin
  if current_user not in('postgres','supabase_admin') then raise exception 'Yalnızca SQL işletmecisi kullanabilir.' using errcode='42501'; end if;
  if p_email is null or length(trim(p_email))<3 then raise exception 'Hesap e-postasını girin.' using errcode='22023'; end if;
  select count(*)::integer,(array_agg(id))[1] into matches,target from auth.users where lower(email)=lower(trim(p_email));
  if matches<>1 then raise exception 'Tek bir mevcut hesap bulunmalı.' using errcode='22023'; end if;
  if not exists(select 1 from public.profiles where id=target) then raise exception 'Hesap profili tamamlanmalı.' using errcode='22023'; end if;
  insert into public.admin_users(user_id) values(target) on conflict(user_id) do nothing;
  return target;
end $$;
revoke all on function pg_temp.admin_ekle(text) from public,anon,authenticated,service_role;
