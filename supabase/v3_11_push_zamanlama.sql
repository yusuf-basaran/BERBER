begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$begin
 if not exists(select 1 from vault.secrets where name='berber_push_dispatch') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'berber_push_dispatch');end if;
end $$;
create or replace function private.schedule_push_dispatch() returns bigint language plpgsql security definer set search_path='' as $$
declare request_id bigint;
begin
 if not exists(select 1 from vault.secrets where name='berber_webpush_public') or exists(
 select 1 from private.push_queue where available_at<=now() and coalesce(lease_until,'-infinity')<=now()) then
  select net.http_post(url:='https://tyxtpfykgitqfhqjkayn.supabase.co/functions/v1/send-push',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5eHRwZnlrZ2l0cWZocWprYXluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMTQxODIsImV4cCI6MjEwNzU5MDE4Mn0.-NG0Vb7Cq-P9sIAaw8noBOw44RMvoi7TpdIf50yw4sc'),
  body:=jsonb_build_object('secret',(select decrypted_secret from vault.decrypted_secrets where name='berber_push_dispatch')),timeout_milliseconds:=60000) into request_id;
 end if;return request_id;
end $$;
revoke all on function private.schedule_push_dispatch() from public,anon,authenticated,service_role;
select cron.schedule('berber-push-dispatch','* * * * *',$job$select private.schedule_push_dispatch();$job$);
commit;
