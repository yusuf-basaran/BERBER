begin;
alter table public.appointments add column if not exists reminder_24h_sent_at timestamptz;
alter table public.appointments add column if not exists reminder_2h_sent_at timestamptz;
create index if not exists appointments_reminders_due_idx on public.appointments(start_at) where status='confirmed' and customer_id is not null;

-- İşçi yalnızca hatırlatma işaretlerini değiştirirken iş randevusu geçişi uygulanmaz.
drop trigger if exists appointment_guard on public.appointments;
create trigger appointment_guard before insert on public.appointments for each row execute function private.guard_appointment();
drop trigger if exists appointment_guard_update on public.appointments;
create trigger appointment_guard_update before update on public.appointments for each row
when (not coalesce(current_setting('role',true)='service_role' and auth.jwt()->>'role'='service_role'
 and (to_jsonb(new)-array['reminder_24h_sent_at','reminder_2h_sent_at'])=(to_jsonb(old)-array['reminder_24h_sent_at','reminder_2h_sent_at'])
 and row(new.reminder_24h_sent_at,new.reminder_2h_sent_at) is distinct from row(old.reminder_24h_sent_at,old.reminder_2h_sent_at),false))
execute function private.guard_appointment();

create or replace function private.guard_reminder_flags() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then new.reminder_24h_sent_at:=null;new.reminder_2h_sent_at:=null;
 elsif row(new.reminder_24h_sent_at,new.reminder_2h_sent_at) is distinct from row(old.reminder_24h_sent_at,old.reminder_2h_sent_at)
 and not coalesce(current_setting('role',true)='service_role' and auth.jwt()->>'role'='service_role',false) then
  raise exception 'Hatırlatma işaretleri değiştirilemez.' using errcode='42501';
 end if;return new;
end $$;
revoke all on function private.guard_reminder_flags() from public,anon,authenticated,service_role;
drop trigger if exists a_reminder_flags on public.appointments;
create trigger a_reminder_flags before insert or update on public.appointments for each row execute function private.guard_reminder_flags();

create or replace function private.invalidate_reminders() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.start_at is distinct from old.start_at then new.reminder_24h_sent_at:=null;new.reminder_2h_sent_at:=null;end if;
 if new.start_at is distinct from old.start_at or (new.status is distinct from old.status and new.status<>'confirmed') then
  update public.notifications set is_read=true where appointment_id=old.id and type='appointment_reminder' and not is_read;
 end if;return new;
end $$;
revoke all on function private.invalidate_reminders() from public,anon,authenticated,service_role;
drop trigger if exists z_reminder_reset on public.appointments;
create trigger z_reminder_reset before update on public.appointments for each row execute function private.invalidate_reminders();

create or replace function private.produce_reminders() returns jsonb language plpgsql security definer set search_path='' as $$
declare booking record;notice_count integer:=0;changed integer;is_two boolean;heading text;
begin
 for booking in select a.id,a.customer_id,a.start_at,a.service_name_at_booking,b.shop_name
 from public.appointments a join public.barbers b on b.id=a.barber_id join public.profiles p on p.id=a.customer_id
 where a.status='confirmed' and a.start_at>now() and a.start_at<=now()+interval '24 hours'
 and b.verification_status='approved' and b.is_active and not p.is_banned
 and case when a.start_at<=now()+interval '2 hours' then a.reminder_2h_sent_at is null else a.reminder_24h_sent_at is null end
 order by (a.start_at<=now()+interval '2 hours') desc,a.start_at,a.id for update of a skip locked limit 200 loop
  is_two:=booking.start_at<=now()+interval '2 hours';
  if is_two then
   update public.appointments set reminder_2h_sent_at=now() where id=booking.id and status='confirmed' and start_at=booking.start_at and reminder_2h_sent_at is null returning 1 into changed;
  else
   update public.appointments set reminder_24h_sent_at=now() where id=booking.id and status='confirmed' and start_at=booking.start_at and reminder_24h_sent_at is null returning 1 into changed;
  end if;
  if changed is null then continue;end if;
  heading:=case when is_two then 'Randevun yaklaşıyor' else 'Randevun için hatırlatma' end;
  insert into public.notifications(user_id,type,title,body,appointment_id)
  values(booking.customer_id,'appointment_reminder',heading,booking.shop_name||' · '||booking.service_name_at_booking||' · '||to_char(booking.start_at at time zone 'Europe/Nicosia','DD.MM.YYYY HH24:MI')||' (Kıbrıs saati).',booking.id);
  notice_count:=notice_count+1;
 end loop;
 return jsonb_build_object('notifications',notice_count);
end $$;
create or replace function public.produce_reminders() returns jsonb language sql security invoker set search_path='' as $$select private.produce_reminders()$$;
create or replace function private.reminder_dispatch_config() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('secret',(select decrypted_secret from vault.decrypted_secrets where name='berber_reminder_dispatch'));
$$;
create or replace function public.reminder_dispatch_config() returns jsonb language sql stable security invoker set search_path='' as $$select private.reminder_dispatch_config()$$;
revoke all on function private.produce_reminders(),public.produce_reminders(),private.reminder_dispatch_config(),public.reminder_dispatch_config() from public,anon,authenticated;
grant execute on function private.produce_reminders(),public.produce_reminders(),private.reminder_dispatch_config(),public.reminder_dispatch_config() to service_role;
commit;
