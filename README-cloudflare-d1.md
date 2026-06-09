# Käsino auf Cloudflare D1 umziehen

Diese Version ersetzt JSONBin durch einen Cloudflare Worker mit D1-Datenbank.

## Was gespeichert wird

- Pro Spielername und Woche: aktuelles Guthaben, höchstes Guthaben, größter Einzelgewinn, letzter Speicherzeitpunkt
- Pro abgeschlossener Woche: Champion aus `Höchstes Guthaben` und Champion aus `Größter Einzelgewinn`
- Alte Spielerstände werden beim Wochenwechsel aus D1 gelöscht; die Wochenchampions bleiben erhalten.

## Einmalige Einrichtung

1. Bei Cloudflare einloggen:

   ```bash
   npx wrangler login
   ```

2. D1-Datenbank anlegen:

   ```bash
   npx wrangler d1 create kaesino
   ```

3. Die ausgegebene `database_id` in `wrangler.toml` eintragen:

   ```toml
   database_id = "..."
   ```

4. Tabellen anlegen:

   ```bash
   npx wrangler d1 migrations apply kaesino --remote
   ```

5. Worker samt statischer Website deployen:

   ```bash
   npx wrangler deploy
   ```

## Optionaler manueller Reset

Der Worker hat zusätzlich `/api/weekly-reset`. Normalerweise übernimmt der Cron das automatisch.

Wenn du einen geheimen Reset-Schutz möchtest:

```bash
npx wrangler secret put RESET_SECRET
```

Danach muss ein manueller Reset den Header `X-Reset-Secret` mitsenden.

## JSONBin-Migration

Wenn JSONBin wieder kurz erreichbar ist, können die aktuellen Ranglisten einmalig in D1 übertragen werden. Dafür brauchen wir den letzten JSONBin-Export oder wieder Zugriff auf den Bin. Ohne Zugriff startet D1 sauber leer, lokale Spielerstände in Browsern bleiben aber lokal erhalten und werden beim nächsten Login wieder an D1 gesendet.

1. Import-Secret setzen:

   ```bash
   npx wrangler secret put IMPORT_SECRET
   ```

2. JSONBin-Record als Datei speichern, z.B. `jsonbin-export.json`.

3. Import ausführen:

   ```bash
   curl -X POST "https://<dein-worker>/api/admin/import-jsonbin" \
     -H "Content-Type: application/json" \
     -H "X-Import-Secret: <dein-secret>" \
     --data-binary @jsonbin-export.json
   ```

Der Import übernimmt die aktuelle Rangliste und den gespeicherten Vorwochenchampion. Exakte Guthabenstände pro Spieler können aus JSONBin nur dann importiert werden, wenn sie dort vorhanden sind; sonst werden sie beim nächsten Login wieder aus dem Browserstand des jeweiligen Spielers an D1 geschrieben.
