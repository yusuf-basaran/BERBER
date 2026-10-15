begin;
alter table public.profiles add column if not exists preference_note text not null default '';
alter table public.profiles drop constraint if exists profiles_preference_check;
alter table public.profiles add constraint profiles_preference_check check(char_length(preference_note)<=300);
grant update(preference_note) on public.profiles to authenticated;
create or replace function private.booking_profile_complete() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.customer_id is not null and not exists(select 1 from public.profiles p where p.id=new.customer_id
    and char_length(trim(p.full_name)) between 2 and 100 and p.phone ~ '^\+90(5[0-9]{9}|392[0-9]{7})$') then
    raise exception 'Randevu öncesi profilindeki ad ve telefonu tamamla.' using errcode='P2007';
  end if;
  return new;
end $$;
revoke all on function private.booking_profile_complete() from public,anon,authenticated,service_role;
drop trigger if exists appointment_profile_complete on public.appointments;
create trigger appointment_profile_complete before insert on public.appointments for each row execute function private.booking_profile_complete();
commit;
