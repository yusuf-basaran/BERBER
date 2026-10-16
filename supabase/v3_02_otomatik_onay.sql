begin;
alter table public.barbers add column if not exists auto_approve_mode text not null default 'off';
alter table public.barbers drop constraint if exists barbers_auto_approve_check;
alter table public.barbers add constraint barbers_auto_approve_check check(auto_approve_mode in('off','trusted','all'));
grant select(auto_approve_mode) on public.barbers to anon,authenticated;
grant update(auto_approve_mode) on public.barbers to authenticated;
create or replace function private.guard_auto_setting() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.auto_approve_mode is distinct from old.auto_approve_mode and new.auto_approve_mode<>'off' then perform private.approved_panel_owner(old.id);end if;return new;end $$;
revoke all on function private.guard_auto_setting() from public,anon,authenticated,service_role;
drop trigger if exists barber_auto_setting on public.barbers;
create trigger barber_auto_setting before update on public.barbers for each row execute function private.guard_auto_setting();
create or replace function private.auto_approve_booking() returns trigger language plpgsql security definer set search_path='' as $$
declare mode text;
begin
 if new.source<>'online' or not private.booking_allowed(new.barber_id) then return new;end if;
 select auto_approve_mode into mode from public.barbers where id=new.barber_id and verification_status='approved' and is_active;
 if mode='all' or (mode='trusted' and (select count(*) from public.appointments where barber_id=new.barber_id and customer_id=new.customer_id and status='completed')>=2
   and not exists(select 1 from public.appointments where barber_id=new.barber_id and customer_id=new.customer_id and status='no_show')) then new.status:='confirmed';end if;
 return new;
end $$;
revoke all on function private.auto_approve_booking() from public,anon,authenticated,service_role;
drop trigger if exists zz_auto_approval on public.appointments;
create trigger zz_auto_approval before insert on public.appointments for each row execute function private.auto_approve_booking();
drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments for insert to authenticated with check((select public.mfa_ok()) and (
 (source='online' and customer_id=(select auth.uid()) and private.is_customer() and status in('pending','confirmed') and private.booking_allowed(barber_id)) or
 (source='manual' and private.approved_owner(barber_id) and status='confirmed')));
create or replace function private.appointment_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare owner uuid; shop text; recipient uuid; kind text; heading text; message text;
begin
  if new.customer_id is null then return null; end if;
  select owner_id, shop_name into owner, shop from public.barbers where id = new.barber_id;
  if tg_op = 'INSERT' then
    recipient := owner; kind := 'appointment_requested'; heading := 'Yeni randevu talebi';
    if new.source='manual' then recipient:=new.customer_id; kind:='appointment_confirmed'; heading:='Randevunuz oluşturuldu'; end if;
    message := new.service_name_at_booking || ' için bir talep geldi.';
    if new.source='online' and new.status='confirmed' then
      insert into public.notifications(user_id,type,title,body,appointment_id) values(owner,'appointment_requested','Randevu otomatik onaylandı',shop||' · '||new.service_name_at_booking,new.id);
      recipient:=new.customer_id;kind:='appointment_confirmed';heading:='Randevunuz onaylandı';message:=shop||' · '||new.service_name_at_booking;
    end if;
  else
    if new.status = old.status and new.proposed_start_at is not distinct from old.proposed_start_at then return null; end if;
    recipient := new.customer_id; kind := 'appointment_' || new.status;
    case new.status
      when 'confirmed' then
        heading := 'Randevunuz onaylandı';
        if old.status = 'counter_proposed' then recipient := owner; kind := 'proposal_accepted'; heading := 'Önerdiğiniz saat kabul edildi'; end if;
      when 'rejected' then heading := 'Randevu talebi reddedildi';
        if old.status = 'counter_proposed' and auth.uid() = new.customer_id then recipient := owner; heading := 'Saat önerisi reddedildi'; end if;
      when 'counter_proposed' then heading := 'Yeni saat önerildi';
      when 'cancelled' then heading := 'Randevu iptal edildi'; if auth.uid() = new.customer_id then recipient := owner; end if;
      when 'no_show' then heading := 'Randevunuza gelmediğiniz işaretlendi';
      when 'completed' then heading := 'Randevunuz tamamlandı';
      else return null;
    end case;
    message := shop || ' · ' || new.service_name_at_booking;
    if new.barber_note <> '' then message := message || ': ' || new.barber_note; end if;
  end if;
  insert into public.notifications(user_id,type,title,body,appointment_id)
  values (recipient,kind,heading,message,new.id);
  return null;
end $$;
commit;
