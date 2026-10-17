begin;
create table if not exists public.push_subscriptions(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 endpoint text not null unique,keys jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 constraint push_endpoint_check check(char_length(endpoint) between 20 and 2048 and endpoint ~ '^https://(fcm[.]googleapis[.]com|([a-z0-9-]+[.])*push[.]services[.]mozilla[.]com|([a-z0-9-]+[.])+push[.]apple[.]com|([a-z0-9-]+[.])+notify[.]windows[.]com)/[^[:space:]#@]+$'),
 constraint push_keys_check check(jsonb_typeof(keys)='object' and (keys-array['p256dh','auth'])='{}'::jsonb
  and jsonb_typeof(keys->'p256dh')='string' and jsonb_typeof(keys->'auth')='string'
  and keys ? 'p256dh' and keys ? 'auth' and keys->>'p256dh' ~ '^B[A-Za-z0-9_-]{86}$' and keys->>'auth' ~ '^[A-Za-z0-9_-]{22}$')
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public,anon,authenticated;
grant select,delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
drop policy if exists push_subscriptions_read on public.push_subscriptions;
create policy push_subscriptions_read on public.push_subscriptions for select to authenticated using(user_id=(select auth.uid()) and (select public.mfa_ok()));
drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated using(user_id=(select auth.uid()) and (select public.mfa_ok()));

create table if not exists private.push_queue(
 id uuid primary key default gen_random_uuid(),subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 notification_id uuid not null references public.notifications(id) on delete cascade,created_at timestamptz not null default now(),
 available_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '1 hour',
 lease_until timestamptz,lease_token uuid,attempts integer not null default 0,start_snapshot timestamptz,
 unique(subscription_id,notification_id),check(attempts between 0 and 5)
);
create index if not exists push_queue_due_idx on private.push_queue(available_at,lease_until);
create index if not exists push_queue_notification_idx on private.push_queue(notification_id);
alter table private.push_queue enable row level security;
revoke all on private.push_queue from public,anon,authenticated,service_role;

create or replace function private.push_state(p_endpoint text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.mfa_ok() then raise exception 'Doğrulanmış oturum gerekli.' using errcode='42501';end if;
 return jsonb_build_object('public_key',(select decrypted_secret from vault.decrypted_secrets where name='berber_webpush_public'),
 'enabled',exists(select 1 from public.push_subscriptions where user_id=auth.uid() and endpoint=p_endpoint));
end $$;
create or replace function public.get_push_state(p_endpoint text default '') returns jsonb language sql stable security invoker set search_path='' as $$select private.push_state(p_endpoint)$$;
create or replace function private.register_push(p_endpoint text,p_keys jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null or not public.mfa_ok() or not exists(select 1 from public.profiles where id=auth.uid() and not is_banned) then raise exception 'Doğrulanmış oturum gerekli.' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 perform private.limit_operation('push_register',60,10);
 if exists(select 1 from public.push_subscriptions where endpoint=p_endpoint and user_id<>auth.uid()) then
  raise exception 'Bu cihazda eski aboneliği kapatıp tekrar dene.' using errcode='22023';end if;
 if not exists(select 1 from public.push_subscriptions where endpoint=p_endpoint) and (select count(*) from public.push_subscriptions where user_id=auth.uid())>=5 then
  raise exception 'En fazla beş cihazda push bildirimi açabilirsin.' using errcode='22023';end if;
 insert into public.push_subscriptions(user_id,endpoint,keys) values(auth.uid(),p_endpoint,p_keys)
 on conflict(endpoint) do update set keys=excluded.keys,updated_at=now() where push_subscriptions.user_id=auth.uid() returning id into result;
 if result is null then raise exception 'Abonelik kaydedilemedi.' using errcode='42501';end if;return result;
end $$;
create or replace function public.register_push(p_endpoint text,p_keys jsonb) returns uuid language sql security invoker set search_path='' as $$select private.register_push(p_endpoint,p_keys)$$;

create or replace function private.enqueue_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.is_read then delete from private.push_queue where notification_id=new.id;return null;end if;
 if tg_op='UPDATE' then return null;end if;
 insert into private.push_queue(subscription_id,notification_id,expires_at,start_snapshot)
 select s.id,new.id,new.created_at+interval '1 hour',case when new.type='appointment_reminder' then (select start_at from public.appointments where id=new.appointment_id) else null end
 from public.push_subscriptions s where s.user_id=new.user_id on conflict do nothing;
 return null;
end $$;
revoke all on function private.enqueue_push() from public,anon,authenticated,service_role;
drop trigger if exists notification_push_queue on public.notifications;
create trigger notification_push_queue after insert or update of is_read on public.notifications for each row execute function private.enqueue_push();

create or replace function private.push_job_valid(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.push_queue q join public.push_subscriptions s on s.id=q.subscription_id
 join public.notifications n on n.id=q.notification_id and n.user_id=s.user_id join public.profiles p on p.id=s.user_id
 left join public.appointments a on a.id=n.appointment_id where q.id=p_id and q.expires_at>now() and not n.is_read and not p.is_banned
 and (n.type<>'appointment_reminder' or (a.status='confirmed' and a.start_at=q.start_snapshot and a.start_at>now())));
$$;
-- Public service-only wrappers cannot directly read private tables without a narrow definer helper.
create or replace function private.leased_push_valid(p_id uuid,p_token uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.push_job_valid(p_id) and exists(select 1 from private.push_queue where id=p_id and lease_token=p_token and lease_until>now());
$$;
create or replace function public.push_job_valid(p_id uuid,p_token uuid) returns boolean language sql stable security invoker set search_path='' as $$select private.leased_push_valid(p_id,p_token)$$;
create or replace function private.claim_push(p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_limit is null or p_limit not between 1 and 25 then raise exception 'Toplu işlem sınırı geçersiz.' using errcode='22023';end if;
 delete from private.push_queue q where not private.push_job_valid(q.id) or (q.attempts>=5 and coalesce(q.lease_until,'-infinity')<=now());
 with due as(select q.id from private.push_queue q where q.available_at<=now() and coalesce(q.lease_until,'-infinity')<=now() and q.attempts<5
  order by q.available_at,q.id for update skip locked limit p_limit),claimed as(
  update private.push_queue q set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',attempts=q.attempts+1 from due where q.id=due.id returning q.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'token',q.lease_token,'endpoint',s.endpoint,'keys',s.keys,
 'ttl',greatest(1,least(300,extract(epoch from q.expires_at-now())::integer,coalesce(extract(epoch from q.start_snapshot-now())::integer,300))))),'[]'::jsonb)
 into result from claimed q join public.push_subscriptions s on s.id=q.subscription_id;
 return result;
end $$;
create or replace function public.claim_push(p_limit integer default 25) returns jsonb language sql security invoker set search_path='' as $$select private.claim_push(p_limit)$$;
create or replace function private.finish_push(p_id uuid,p_token uuid,p_status integer,p_retry_after integer) returns boolean language plpgsql security definer set search_path='' as $$
declare job private.push_queue;
begin
 select * into job from private.push_queue where id=p_id and lease_token=p_token for update;
 if not found then return false;end if;
 if p_status in(404,410) then delete from public.push_subscriptions where id=job.subscription_id;
 elsif p_status between 200 and 299 or job.attempts>=5 or job.expires_at<=now() then delete from private.push_queue where id=job.id;
 else update private.push_queue set lease_token=null,lease_until=null,available_at=now()+least(1800,greatest(30,coalesce(p_retry_after,30*power(2,job.attempts-1)::integer)))*interval '1 second' where id=job.id;end if;
 return true;
end $$;
create or replace function public.finish_push(p_id uuid,p_token uuid,p_status integer,p_retry_after integer default null) returns boolean language sql security invoker set search_path='' as $$select private.finish_push(p_id,p_token,p_status,p_retry_after)$$;

create or replace function private.push_dispatch_config() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('secret',(select decrypted_secret from vault.decrypted_secrets where name='berber_push_dispatch'),
 'publicKey',(select decrypted_secret from vault.decrypted_secrets where name='berber_webpush_public'),
 'privateKey',(select decrypted_secret from vault.decrypted_secrets where name='berber_webpush_private'));
$$;
create or replace function public.push_dispatch_config() returns jsonb language sql stable security invoker set search_path='' as $$select private.push_dispatch_config()$$;
create or replace function private.setup_push_vapid(p_public text,p_private text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_public is null or p_private is null or p_public!~'^B[A-Za-z0-9_-]{86}$' or p_private!~'^[A-Za-z0-9_-]{43}$' then raise exception 'Anahtar biçimi geçersiz.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('berber-push-vapid',0));
 if exists(select 1 from vault.secrets where name in('berber_webpush_public','berber_webpush_private')) then return;end if;
 perform vault.create_secret(p_public,'berber_webpush_public');perform vault.create_secret(p_private,'berber_webpush_private');
end $$;
create or replace function public.setup_push_vapid(p_public text,p_private text) returns void language sql security invoker set search_path='' as $$select private.setup_push_vapid(p_public,p_private)$$;

revoke all on function private.push_state(text),public.get_push_state(text),private.register_push(text,jsonb),public.register_push(text,jsonb) from public,anon;
grant execute on function private.push_state(text),public.get_push_state(text),private.register_push(text,jsonb),public.register_push(text,jsonb) to authenticated;
revoke all on function private.push_job_valid(uuid),private.leased_push_valid(uuid,uuid),public.push_job_valid(uuid,uuid),private.claim_push(integer),public.claim_push(integer),
 private.finish_push(uuid,uuid,integer,integer),public.finish_push(uuid,uuid,integer,integer),private.push_dispatch_config(),public.push_dispatch_config(),private.setup_push_vapid(text,text),public.setup_push_vapid(text,text) from public,anon,authenticated;
grant execute on function private.leased_push_valid(uuid,uuid),public.push_job_valid(uuid,uuid),private.claim_push(integer),public.claim_push(integer),
 private.finish_push(uuid,uuid,integer,integer),public.finish_push(uuid,uuid,integer,integer),private.push_dispatch_config(),public.push_dispatch_config(),private.setup_push_vapid(text,text),public.setup_push_vapid(text,text) to service_role;
commit;
