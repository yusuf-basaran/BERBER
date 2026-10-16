begin;
alter table public.barbers add column if not exists slug text;
create or replace function private.shop_slug(p_name text) returns text
language sql immutable set search_path='' as $$select coalesce(nullif(trim(both '-' from left(regexp_replace(translate(lower(p_name),'çğıöşü','cgiosu'),'[^a-z0-9]+','-','g'),35)),''),'berber')$$;
revoke all on function private.shop_slug(text) from public,anon,authenticated,service_role;
do $$declare b record;stem text;candidate text;i integer;begin
  for b in select id,shop_name from public.barbers where slug is null order by created_at,id loop
    stem:=private.shop_slug(b.shop_name);if char_length(stem)<3 then stem:='berber-'||stem;end if;candidate:=stem;i:=1;
    while exists(select 1 from public.barbers where slug=candidate) loop i:=i+1;candidate:=stem||'-'||i;end loop;
    update public.barbers set slug=candidate where id=b.id;
  end loop;
end $$;
create unique index if not exists barbers_slug_unique on public.barbers(slug);
alter table public.barbers alter column slug set not null;
alter table public.barbers drop constraint if exists barbers_slug_check;
alter table public.barbers add constraint barbers_slug_check check(slug ~ '^[a-z0-9-]{3,40}$');
create or replace function private.assign_shop_slug() returns trigger
language plpgsql security definer set search_path='' as $$
declare stem text;i integer:=1;
begin
  if new.slug is null then
    stem:=private.shop_slug(new.shop_name);if char_length(stem)<3 then stem:='berber-'||stem;end if;
    perform pg_advisory_xact_lock(hashtextextended(stem,0));new.slug:=stem;
    while exists(select 1 from public.barbers where slug=new.slug) loop i:=i+1;new.slug:=stem||'-'||i;end loop;
  end if;
  return new;
end $$;
revoke all on function private.assign_shop_slug() from public,anon,authenticated,service_role;
drop trigger if exists barber_slug on public.barbers;
create trigger barber_slug before insert on public.barbers for each row execute function private.assign_shop_slug();
grant select(slug) on public.barbers to anon,authenticated;
grant insert(slug),update(slug) on public.barbers to authenticated;
commit;
