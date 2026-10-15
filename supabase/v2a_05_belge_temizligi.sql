begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$begin
  if not exists(select 1 from vault.secrets where name='berber_document_cleanup') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'berber_document_cleanup');
  end if;
end $$;
create or replace function private.application_cleanup_secret() returns text
language sql stable security definer set search_path='' as $$select decrypted_secret from vault.decrypted_secrets where name='berber_document_cleanup'$$;
create or replace function public.application_cleanup_secret() returns text
language sql stable security invoker set search_path='' as $$select private.application_cleanup_secret()$$;
revoke all on function private.application_cleanup_secret(),public.application_cleanup_secret() from public,anon,authenticated;
grant execute on function private.application_cleanup_secret(),public.application_cleanup_secret() to service_role;
select cron.schedule('berber-document-cleanup','17 * * * *',$job$
select net.http_post(url:='https://tyxtpfykgitqfhqjkayn.supabase.co/functions/v1/cleanup-application-documents',
headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5eHRwZnlrZ2l0cWZocWprYXluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMTQxODIsImV4cCI6MjEwNzU5MDE4Mn0.-NG0Vb7Cq-P9sIAaw8noBOw44RMvoi7TpdIf50yw4sc),
body:=jsonb_build_object('secret',(select decrypted_secret from vault.decrypted_secrets where name='berber_document_cleanup')));
$job$);
commit;
