-- schema.sql ardından bir kez uygulanır; mevcut verileri silmez.
begin;
alter table private.recovery_attempts add column if not exists pending_hash text;
alter table private.recovery_attempts add column if not exists pending_token uuid;
alter table private.recovery_attempts add column if not exists lease_until timestamptz;
alter table private.recovery_attempts add column if not exists recovered_at timestamptz;

create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and not exists (select 1 from private.recovery_attempts r where r.user_id = auth.uid() and r.pending_hash is not null)
    and not exists (
      select 1 from private.recovery_attempts r where r.user_id = auth.uid() and r.recovered_at is not null
      and not exists (select 1 from auth.sessions s where s.user_id = auth.uid()
        and s.id = (auth.jwt()->>'session_id')::uuid and s.created_at > r.recovered_at)
    )
    and (not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
      or coalesce(auth.jwt()->>'aal','aal1') = 'aal2');
$$;

create function public.recovery_status(p_user_id uuid) returns integer
language sql security definer set search_path = '' as $$
  select count(*)::integer from public.recovery_codes where user_id = p_user_id and used_at is null;
$$;

create function public.recovery_session_ok(p_user_id uuid, p_session_id uuid, p_allow_pending boolean) returns boolean
language sql security definer set search_path = '' as $$
  select exists (select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id)
    and (p_allow_pending or not exists (select 1 from private.recovery_attempts r where r.user_id = p_user_id and
      (r.pending_hash is not null or (r.recovered_at is not null and not exists (
        select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id and s.created_at > r.recovered_at
      )))));
$$;

create function public.replace_recovery_codes(p_user_id uuid, p_hashes text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if cardinality(p_hashes) <> 8 or p_hashes is null or
    (select count(distinct h) from unnest(p_hashes) h) <> 8 or
    exists (select 1 from unnest(p_hashes) h where h is null or h !~ '^[a-f0-9]{64}$') then
    raise exception 'Geçersiz kod listesi.' using errcode = '22023';
  end if;
  insert into private.recovery_attempts(user_id) values (p_user_id) on conflict do nothing;
  perform 1 from private.recovery_attempts where user_id = p_user_id for update;
  if exists (select 1 from private.recovery_attempts where user_id = p_user_id and pending_hash is not null) or
     not exists (select 1 from auth.mfa_factors where user_id = p_user_id and status = 'verified') then
    raise exception 'Doğrulayıcı veya kurtarma durumu uygun değil.' using errcode = '42501';
  end if;
  delete from public.recovery_codes where user_id = p_user_id;
  insert into public.recovery_codes(user_id,code_hash) select p_user_id,h from unnest(p_hashes) h;
  update private.recovery_attempts set failed_count = 0, locked_until = null, window_started_at = now() where user_id = p_user_id;
end $$;

create function public.claim_recovery(p_user_id uuid, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare attempt private.recovery_attempts; code_id uuid; ticket uuid;
begin
  insert into private.recovery_attempts(user_id) values (p_user_id) on conflict do nothing;
  select * into attempt from private.recovery_attempts where user_id = p_user_id for update;
  if attempt.locked_until > now() then return jsonb_build_object('status','locked'); end if;
  if attempt.pending_hash is not null and attempt.lease_until > now() then return jsonb_build_object('status','busy'); end if;
  if attempt.pending_hash is not null and attempt.pending_hash = p_hash then
    ticket := gen_random_uuid();
    update private.recovery_attempts set pending_token = ticket, lease_until = now() + interval '90 seconds' where user_id = p_user_id;
    return jsonb_build_object('status','claimed','ticket',ticket);
  end if;
  if attempt.window_started_at <= now() - interval '15 minutes' then
    update private.recovery_attempts set failed_count = 0, window_started_at = now(), locked_until = null where user_id = p_user_id;
    attempt.failed_count := 0;
  end if;
  select id into code_id from public.recovery_codes where user_id = p_user_id and code_hash = p_hash and used_at is null for update;
  if code_id is null then
    update private.recovery_attempts set failed_count = attempt.failed_count + 1,
      locked_until = case when attempt.failed_count + 1 >= 5 then now() + interval '15 minutes' else null end
    where user_id = p_user_id;
    return jsonb_build_object('status',case when attempt.failed_count + 1 >= 5 then 'locked' else 'invalid' end);
  end if;
  ticket := gen_random_uuid();
  update public.recovery_codes set used_at = now() where id = code_id;
  update private.recovery_attempts set pending_hash = p_hash, pending_token = ticket,
    lease_until = now() + interval '90 seconds', failed_count = 0, locked_until = null where user_id = p_user_id;
  return jsonb_build_object('status','claimed','ticket',ticket);
end $$;

create function public.revoke_recovery_codes(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.recovery_attempts(user_id) values (p_user_id) on conflict do nothing;
  perform 1 from private.recovery_attempts where user_id = p_user_id for update;
  if exists (select 1 from private.recovery_attempts where user_id = p_user_id and pending_hash is not null) then
    raise exception 'Kurtarma devam ediyor.' using errcode = '42501';
  end if;
  update public.recovery_codes set used_at = coalesce(used_at,now()) where user_id = p_user_id;
end $$;

create function public.renew_recovery(p_user_id uuid, p_ticket uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update private.recovery_attempts set lease_until = now() + interval '90 seconds'
    where user_id = p_user_id and pending_token = p_ticket and pending_hash is not null;
  return found;
end $$;
create function public.release_recovery(p_user_id uuid, p_ticket uuid) returns void
language sql security definer set search_path = '' as $$
  update private.recovery_attempts set lease_until = now() where user_id = p_user_id and pending_token = p_ticket;
$$;
create function public.finish_recovery(p_user_id uuid, p_ticket uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from private.recovery_attempts where user_id = p_user_id and pending_token = p_ticket and pending_hash is not null for update;
  if not found then return false; end if;
  if exists (select 1 from auth.mfa_factors where user_id = p_user_id and status = 'verified') then return false; end if;
  update private.recovery_attempts set pending_hash = null, pending_token = null, lease_until = null,
    recovered_at = clock_timestamp(), failed_count = 0, locked_until = null where user_id = p_user_id;
  update public.recovery_codes set used_at = coalesce(used_at,now()) where user_id = p_user_id;
  insert into public.notifications(user_id,type,title,body)
  values (p_user_id,'security_recovery','Hesabınız kurtarma koduyla açıldı','Doğrulayıcı cihazlarınız kaldırıldı ve oturumlarınız kapatıldı. Yeniden giriş yapıp yeni bir doğrulayıcı ekleyin.');
  return true;
end $$;

revoke all on function public.revoke_recovery_codes(uuid),public.recovery_session_ok(uuid,uuid,boolean),public.recovery_status(uuid), public.replace_recovery_codes(uuid,text[]),
  public.claim_recovery(uuid,text),public.renew_recovery(uuid,uuid),public.release_recovery(uuid,uuid),public.finish_recovery(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.revoke_recovery_codes(uuid),public.recovery_session_ok(uuid,uuid,boolean),public.recovery_status(uuid), public.replace_recovery_codes(uuid,text[]),
  public.claim_recovery(uuid,text),public.renew_recovery(uuid,uuid),public.release_recovery(uuid,uuid),public.finish_recovery(uuid,uuid)
  to service_role;
commit;
