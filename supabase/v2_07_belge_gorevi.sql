begin;
select cron.schedule('berber-document-cleanup','17 * * * *',$job$
select net.http_post(url:='https://tyxtpfykgitqfhqjkayn.supabase.co/functions/v1/cleanup-application-documents',
headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5eHRwZnlrZ2l0cWZocWprYXluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMTQxODIsImV4cCI6MjEwNzU5MDE4Mn0.-NG0Vb7Cq-P9sIAaw8noBOw44RMvoi7TpdIf50yw4sc'),
body:=jsonb_build_object('secret',(select decrypted_secret from vault.decrypted_secrets where name='berber_document_cleanup')));
$job$);
commit;
