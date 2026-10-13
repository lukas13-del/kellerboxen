-- Kellerboxen: Datenbank einrichten (einmal im Supabase SQL Editor ausführen)
-- Die App speichert nur verschlüsselte Datensätze. Die Datenbank sieht keine Boxnummern,
-- keine Raumnamen und keinen Inhalt, nur zufällige Kennungen, Zeitstempel und unlesbaren Text.
-- Das Skript darf mehrmals ausgeführt werden.

-- 1) Wer darf rein: Liste der freigeschalteten E-Mail-Adressen
create table if not exists public.mitglieder (
  email text primary key
);
alter table public.mitglieder enable row level security;
-- Keine Policies: die Liste ist über die App-Schnittstelle weder lesbar noch änderbar.
revoke all on public.mitglieder from anon, authenticated;

-- Prüft, ob das angemeldete Konto auf der Liste steht
create or replace function public.ist_mitglied()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.mitglieder m
    where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.ist_mitglied() from public, anon;
grant execute on function public.ist_mitglied() to authenticated;

-- Konten können nur für freigeschaltete Adressen entstehen (Registrierung in der App und im Dashboard)
create or replace function public.nur_mitglieder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.mitglieder m where lower(m.email) = lower(coalesce(new.email, ''))) then
    raise exception 'Adresse nicht freigeschaltet';
  end if;
  return new;
end $$;
revoke all on function public.nur_mitglieder() from public, anon, authenticated;
drop trigger if exists nur_mitglieder on auth.users;
create trigger nur_mitglieder before insert on auth.users for each row execute function public.nur_mitglieder();

-- Für den Wachhalter (GitHub Action): gibt nur 1 zurück, liest keine Daten
create or replace function public.wach() returns integer language sql stable as $$ select 1 $$;
revoke all on function public.wach() from public;
grant execute on function public.wach() to anon, authenticated;

-- 2) Die verschlüsselten Datensätze
create table if not exists public.daten (
  id text primary key check (char_length(id) between 1 and 80),
  blob text not null check (char_length(blob) < 300000),
  geaendert timestamptz not null default now()
);
alter table public.daten enable row level security;
revoke all on public.daten from anon, authenticated;
grant select, insert, update, delete on public.daten to authenticated;

drop policy if exists "daten lesen" on public.daten;
drop policy if exists "daten anlegen" on public.daten;
drop policy if exists "daten aendern" on public.daten;
drop policy if exists "daten loeschen" on public.daten;
create policy "daten lesen"   on public.daten for select to authenticated using (public.ist_mitglied());
create policy "daten anlegen" on public.daten for insert to authenticated with check (public.ist_mitglied());
-- Die Schlüsselinfo (id 'schluessel') kann nur einmal angelegt, nie geändert oder gelöscht werden.
create policy "daten aendern" on public.daten for update to authenticated
  using (public.ist_mitglied() and id <> 'schluessel') with check (public.ist_mitglied() and id <> 'schluessel');
create policy "daten loeschen" on public.daten for delete to authenticated
  using (public.ist_mitglied() and id <> 'schluessel');

-- Zeitstempel bei jeder Änderung nachführen
create or replace function public.daten_zeit() returns trigger language plpgsql as $$
begin new.geaendert := now(); return new; end $$;
drop trigger if exists daten_zeit on public.daten;
create trigger daten_zeit before insert or update on public.daten for each row execute function public.daten_zeit();

-- Zweite Sperre für die Schlüsselinfo, gilt auch für Abfragen im SQL Editor
create or replace function public.schluessel_schutz() returns trigger language plpgsql as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'Tabelle daten ist geschützt';
  end if;
  if old.id = 'schluessel' or (tg_op = 'UPDATE' and new.id = 'schluessel') then
    raise exception 'Schlüsselinfo ist geschützt';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists schluessel_schutz on public.daten;
create trigger schluessel_schutz before update or delete on public.daten for each row execute function public.schluessel_schutz();
drop trigger if exists daten_truncate_schutz on public.daten;
create trigger daten_truncate_schutz before truncate on public.daten for each statement execute function public.schluessel_schutz();

-- Live-Abgleich zwischen den Handys (Realtime beachtet die Policies oben)
do $$ begin
  alter publication supabase_realtime add table public.daten;
exception when duplicate_object then null; end $$;

-- 3) Verschlüsselte Fotos (privater Speicher, nur für Mitglieder)
insert into storage.buckets (id, name, public, file_size_limit)
values ('fotos', 'fotos', false, 20971520)
on conflict (id) do update set public = false;

drop policy if exists "fotos lesen" on storage.objects;
drop policy if exists "fotos anlegen" on storage.objects;
drop policy if exists "fotos aendern" on storage.objects;
drop policy if exists "fotos loeschen" on storage.objects;
create policy "fotos lesen"   on storage.objects for select to authenticated using (bucket_id = 'fotos' and public.ist_mitglied());
create policy "fotos anlegen" on storage.objects for insert to authenticated with check (bucket_id = 'fotos' and public.ist_mitglied());
create policy "fotos aendern" on storage.objects for update to authenticated using (bucket_id = 'fotos' and public.ist_mitglied()) with check (bucket_id = 'fotos' and public.ist_mitglied());
create policy "fotos loeschen" on storage.objects for delete to authenticated using (bucket_id = 'fotos' and public.ist_mitglied());

-- 4) Mitglieder freischalten: diese Zeilen separat im SQL Editor ausführen, Adressen anpassen.
--    Die echten Adressen gehören nicht in dieses Repository.
--
--    insert into public.mitglieder (email) values ('erste@adresse.ch'), ('zweite@adresse.ch')
--    on conflict do nothing;
--    select email from public.mitglieder;
--
--    Mitglied entfernen: auch das Login-Konto löschen, sonst sieht es weiterhin die Zeitpunkte von Löschungen.
--
--    delete from public.mitglieder where lower(email) = lower('adresse@beispiel.ch');
--    delete from auth.users where lower(email) = lower('adresse@beispiel.ch');
--
--    Passwort vergessen: nur das Login-Konto und seinen hinterlegten Schlüssel löschen, die Freischaltung in
--    mitglieder bleibt. Danach in der App «Konto erstellen» und einmal den Haushalts-Code eingeben; die Daten
--    bleiben erhalten. Nie ein Passwort im Dashboard, per Admin-API oder per SQL setzen und keine
--    Wiederherstellungs-Mail senden: die App sendet nie das Passwort selbst, ein so gesetztes geht nicht.
--
--    delete from public.daten where id in (
--      select 'w' || left(encode(sha256(convert_to(v.p || u.id::text, 'UTF8')), 'hex'), 32)
--      from auth.users u, (values ('kb-wrap:'), ('kb-wrap-next:')) v(p)
--      where lower(u.email) = lower('adresse@beispiel.ch'));
--    delete from auth.users where lower(email) = lower('adresse@beispiel.ch');
--
--    Konten aus der Zeit vor dem 14.10.2026 (Passwort noch im Klartext übertragen) finden:
--    select email from auth.users where coalesce((raw_user_meta_data->>'kb_login')::int, 0) < 1;
