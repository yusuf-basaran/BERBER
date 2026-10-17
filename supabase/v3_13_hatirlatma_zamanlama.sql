begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$begin
 if not exists(select 1 from vault.secrets where name='berber_reminder_dispatch') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'berber_reminder_dispatch');end if;
end $$;
create or replace function private.schedule_reminders() returns bigint language sql security definer set search_path='' as $$
 select net.http_post(url:='https://tyxtpfykgitqfhqjkayn.supabase.co/functions/v1/send-reminders',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5eHRwZnlrZ2l0cWZocWprYXluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMTQxODIsImV4cCI6MjEwNzU5MDE4Mn0.-NG0Vb7Cq-P9sIAaw8noBOw44RMvoi7TpdIf50yw4sc','x-reminder-secret',(select decrypted_secret from vault.decrypted_secrets where name='berber_reminder_dispatch')),
 body:='{}'::jsonb,timeout_milliseconds:=60000);
$$;
revoke all on function private.schedule_reminders() from public,anon,authenticated,service_role;
select cron.schedule('berber-appointment-reminders','*/10 * * * *',$job$select private.schedule_reminders();$job$);
commit;
