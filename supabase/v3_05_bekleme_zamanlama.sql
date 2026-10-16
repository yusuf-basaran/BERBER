begin;
select cron.schedule('berber-waitlist-expire','23 * * * *',$job$update public.waitlist set status='expired' where status in('waiting','notified') and date+time_to<=(now() at time zone 'Europe/Nicosia');$job$);
commit;
