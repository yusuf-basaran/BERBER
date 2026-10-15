begin;

create table private.app_settings (
  key text primary key,
  value jsonb not null
);
alter table private.app_settings enable row level security;
revoke all on private.app_settings from public, anon, authenticated;
grant select on private.app_settings to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'berber_recovery_pepper') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
      'berber_recovery_pepper', 'BERBER recovery code hashing secret');
  end if;
end;
$$;

insert into private.app_settings (key, value) values ('recovery_origins', '[]'::jsonb);

create function private.get_recovery_config()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pepper', (select decrypted_secret from vault.decrypted_secrets where name = 'berber_recovery_pepper'),
    'origins', (select value from private.app_settings where key = 'recovery_origins')
  );
$$;
revoke all on function private.get_recovery_config() from public, anon, authenticated;
grant execute on function private.get_recovery_config() to service_role;

create function public.get_recovery_config()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.get_recovery_config(); $$;
revoke all on function public.get_recovery_config() from public, anon, authenticated;
grant execute on function public.get_recovery_config() to service_role;

commit;
