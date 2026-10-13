# Kellerboxen

Private Web-App, um Aufbewahrungsboxen zu ordnen: was ist in welcher Box, und wo steht sie.
Läuft auf dem iPhone im Browser oder als Symbol auf dem Home-Bildschirm.

## Datenschutz

- Alle Inhalte (Boxnummern, Bezeichnungen, Räume, Gegenstände, Fotos) werden **auf dem Gerät verschlüsselt**,
  bevor sie gespeichert werden: AES-GCM 256, Schlüssel per PBKDF2-SHA256 (1 000 000 Runden) und HKDF aus dem
  Haushalts-Schlüssel abgeleitet.
- Der Haushalts-Schlüssel ist standardmässig ein zufälliger Code mit 20 Zeichen (rund 100 Bit). Er wird nie
  gesendet und nie im Klartext gespeichert. Auf jedem Gerät bleibt nur ein nicht auslesbarer Schlüssel im Browser.
- Die Datenbank (Supabase) sieht nur unlesbare Datensätze mit zufälligen Kennungen und einheitlicher Länge.
  Sichtbar bleiben für den Anbieter nur die Anzahl der Einträge, Änderungszeitpunkte und die ungefähre
  Grösse der Fotos.
- Zugang haben nur freigeschaltete Konten (Tabelle `mitglieder`), öffentliche Registrierung ist ausgeschaltet.
  Die Schlüsselinfo in der Datenbank kann nicht geändert oder gelöscht werden.
- Sicherungen («?» › «Sicherung herunterladen») sind ebenfalls verschlüsselt.
- Die App sendet nie etwas, das wie der Haushalts-Schlüssel aussieht, als Login-Passwort. Ein eigener Schlüssel
  darf nicht das Login-Passwort sein.
- Zwei Geräte gleichzeitig: Änderungen werden auf den letzten Stand der Datenbank aufgesetzt, nicht blind
  überschrieben. Nach jedem Wiederverbinden lädt die App nach.
- Dieses Repository enthält nur den Programmcode, keine Daten und keine E-Mail-Adressen. Schriften und
  Bibliotheken liegen lokal im Repository, die App lädt nichts von fremden Servern ausser der eigenen Datenbank.
- **Der Haushalts-Schlüssel lässt sich nicht wiederherstellen.** Als eigenen Eintrag im Passwort-Manager
  aufbewahren, getrennt vom Login-Passwort.

## Einrichten

1. Supabase-Projekt anlegen (Region Europa, z. B. Zürich oder Frankfurt).
2. `supabase/setup.sql` im SQL Editor ausführen.
3. Die E-Mail-Adressen der Mitglieder separat im SQL Editor freischalten (Befehl steht am Ende von `setup.sql`).
4. Authentication › Sign In / Providers: Registrierung erlaubt lassen, «Confirm email» ausschalten
   (der Gratis-Mailversand erreicht nur Projektmitglieder). Konten können trotzdem nur für Adressen in
   `mitglieder` entstehen, dafür sorgt der Trigger `nur_mitglieder` auf `auth.users`.
   Jedes Mitglied legt sein Konto selbst in der App an («Konto erstellen») und wählt sein Passwort selbst.
   Das Login-Passwort darf nicht wie der Haushalts-Schlüssel aussehen (XXXX-XXXX-XXXX-XXXX-XXXX).
5. Projekt-URL und öffentlichen Schlüssel (publishable / anon key) in `config.js` eintragen und in
   `index.html` bei `connect-src` die genaue Projekt-Adresse einsetzen.
6. GitHub Pages für den Branch `main` aktivieren.
7. Der Wachhalter (`.github/workflows/wachhalten.yml`) fragt alle zwei Tage `wach()` ab, damit das
   Gratis-Projekt nicht nach 7 Tagen ohne Zugriff pausiert.

Beim ersten Anmelden erzeugt die App den Haushalts-Schlüssel. Danach mit «?» › «Sicherung importieren»
bestehende Daten übernehmen. Weitere Geräte geben den Schlüssel einmal ein.

## Etiketten

HERMA 63,5 × 38,1 mm, 21 Stück pro A4-Bogen. Die App erstellt das PDF selbst (Reiter «Etiketten»).
Alternativ als Vektor-PDF: `python tools/etiketten_generator.py 41 61 --start 20`.
Der QR-Code enthält nur die Adresse der App und die Boxnummer. Der Scanner in der App liest auch
Etiketten mit einer früheren Adresse.

## Lizenzen

Supabase JS (MIT), jsPDF (MIT), qrcode-generator (MIT), jsQR (Apache 2.0),
Schriften Shippori Mincho, Zen Kaku Gothic New, IBM Plex Mono (SIL Open Font License).
