---
name: smart-email-finder
description: Söker aktivt efter e-postadresser för influencers som saknar kontaktinfo. Använder YouTube "Om"-sida, Google-sökningar, sociala profiler och webbsidor. Körs dagligen via heartbeat.
metadata:
  openclaw:
    always: true
    emoji: "📧"
    requires:
      env:
        - SERPAPI_KEY
---

# Smart E-postsökning — SparkCollab

Du söker aktivt efter e-postadresser för influencers i SparkCollab-databasen som saknar kontaktinfo.

## NÄR DENNA SKILL KÖRS

Körs automatiskt via heartbeat (dagligen) eller manuellt via `/smart-email-finder`.

## STEG-FÖR-STEG FLÖDE

### Steg 1: Hämta influencers som saknar e-post

```bash
curl -s "http://localhost:3001/api/email-finder/missing"
```

Detta returnerar en lista med influencers som:
- Har ingen `kontakt_epost` sparad
- Eller har en kontakt_epost som markerats som ogiltig

Om listan är tom: rapportera "Alla influencers har e-postadresser." och avsluta.

### Steg 2: Sök e-post via YouTube "Om"-sida

För varje influencer i listan, börja med att kolla YouTube-kanalen direkt.

Öppna YouTube-kanalens "Om"-sida i webbläsaren:

**URL-mönster:**
- `https://www.youtube.com/@{kanalnamn}/about`
- `https://www.youtube.com/c/{kanalnamn}/about`

**Sök efter:**
1. "Business email" / "Business inquiries" / "För affärsförfrågningar" — det finns ofta en e-post som visas efter att man klickar "Visa e-postadress"
2. Länkade sociala profiler (Instagram, Twitter, etc.)
3. Länkade webbsidor

**Om du hittar en e-post direkt på YouTube, registrera den:**

```bash
curl -s -X POST http://localhost:3001/api/email-finder/save \
  -H "Content-Type: application/json" \
  -d '{
    "influencer_id": <id>,
    "email": "<hittad e-post>",
    "method": "youtube_about_page",
    "confidence": "high"
  }'
```

### Steg 3: Sök via API (automatisk)

Om YouTube-sidan inte hade en synlig e-post, trigga den automatiska sökningen:

```bash
curl -s -X POST http://localhost:3001/api/email-finder/search \
  -H "Content-Type: application/json" \
  -d '{"influencer_id": <id>}'
```

Detta kör hela sökmotorn: YouTube-beskrivning → SerpAPI → sociala profiler → DuckDuckGo/Bing, med MX-validering.

### Steg 4: Följ sociala profil-länkar

Om varken YouTube eller den automatiska sökningen hittade något, och influencern har sociala profil-länkar (Instagram, Twitter):

1. Öppna Instagram-profilen i webbläsaren
2. Sök efter e-post i bio-texten
3. Kolla om det finns en "Kontakt"-knapp eller länkad webbsida

```bash
curl -s -X POST http://localhost:3001/api/email-finder/save \
  -H "Content-Type: application/json" \
  -d '{
    "influencer_id": <id>,
    "email": "<hittad e-post>",
    "method": "browser_social_profile",
    "confidence": "medium"
  }'
```

### Steg 5: Kolla personliga webbsidor

Om influencern har en länkad webbsida (ofta i YouTube-beskrivningen):

1. Öppna webbsidan
2. Navigera till /kontakt, /contact, /om, /about
3. Sök efter e-postadress på sidan

Registrera eventuell träff med method "browser_website".

### Steg 6: Logga resultatet

```bash
curl -s -X POST http://localhost:3001/api/automation/log \
  -H "Content-Type: application/json" \
  -d '{
    "job_type": "smart_email_finder",
    "details": "Sökte e-post för influencers utan kontaktinfo",
    "items_processed": <antal sökta>,
    "items_found": <antal hittade>
  }'
```

## REGLER

- Kör MAX 10 influencers per session (för att inte överdriva API-anrop)
- Prioritera influencers kopplade till AKTIVA kontrakt (de är viktigast)
- Validera alltid e-posten med MX-check innan du sparar
- Om du hittar FLERA e-poster, välj den som ser mest ut som en business-adress (business@, kontakt@, samarbete@)
- Uppdatera aldrig en existerande e-post som redan är verifierad
- Undvik e-poster som uppenbart är system-adresser (noreply@, admin@, etc.)
- Var SNABB — max 2 minuter för hela körningen

## RAPPORTERING

Efter varje körning, rapportera kort:
- Antal influencers utan e-post (före sökning)
- Antal nya e-poster hittade
- Vilka metoder som fungerade (YouTube, SerpAPI, sociala profiler, webbsida)
- Eventuella influencers som fortfarande saknar e-post
