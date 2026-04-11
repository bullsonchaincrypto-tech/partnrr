---
name: gmail-inbox-monitor
description: Övervakar Gmail-inkorg för svar på Partnrr-outreach. Matchar inkommande e-post mot skickade influencer- och sponsor-meddelanden, registrerar dem i databasen och flaggar viktiga svar.
metadata:
  openclaw:
    always: true
    emoji: "📬"
    requires:
      env:
        - GMAIL_CLIENT_ID
        - GMAIL_CLIENT_SECRET
---

# Gmail Inbox Monitor — Partnrr

Du övervakar Gmail-inkorgen för svar på outreach-meddelanden som skickats via Partnrr CRM.

## NÄR DENNA SKILL KÖRS

Denna skill körs automatiskt via heartbeat (var 30:e minut) eller manuellt via `/gmail-inbox-monitor`.

## STEG-FÖR-STEG FLÖDE

### Steg 1: Hämta nya e-postmeddelanden

Kör följande kommando för att hämta nya meddelanden från Gmail:

```bash
curl -s http://localhost:3001/api/auth/google/status
```

Om Gmail inte är ansluten (authenticated = false), rapportera: "Gmail inte ansluten — logga in via Partnrr-appen först." och avsluta.

Om Gmail är ansluten, hämta senaste meddelanden:

```bash
curl -s "http://localhost:3001/api/auth/google/inbox?maxResults=20&unreadOnly=true"
```

### Steg 2: Registrera varje nytt meddelande

För varje e-postmeddelande, skicka det till Partnrr API för matchning:

```bash
curl -s -X POST http://localhost:3001/api/automation/inbox \
  -H "Content-Type: application/json" \
  -d '{
    "gmail_message_id": "<message_id>",
    "gmail_thread_id": "<thread_id>",
    "from_email": "<avsändarens email>",
    "from_name": "<avsändarens namn>",
    "subject": "<ämne>",
    "snippet": "<kort utdrag>",
    "body_preview": "<första 500 tecken>",
    "received_at": "<ISO-datum>"
  }'
```

### Steg 3: Analysera matchade svar

Om svaret matchar en outreach (match_type = "influencer" eller "sponsor"):

1. Läs meddelandets innehåll
2. Bedöm sentiment: `positiv` (intresserad), `neutral` (fråga/mer info), `negativ` (avböjer)
3. Föreslå nästa åtgärd: `boka_mote`, `skicka_kontrakt`, `svara_fraga`, `ingen_atgard`

Spara analysen:

```bash
curl -s -X PUT http://localhost:3001/api/automation/inbox/<id>/ai-analysis \
  -H "Content-Type: application/json" \
  -d '{
    "ai_summary": "<kort sammanfattning av svaret>",
    "ai_sentiment": "positiv|neutral|negativ",
    "ai_suggested_action": "boka_mote|skicka_kontrakt|svara_fraga|ingen_atgard"
  }'
```

### Steg 4: Logga jobbet

```bash
curl -s -X POST http://localhost:3001/api/automation/log \
  -H "Content-Type: application/json" \
  -d '{"job_type": "gmail_inbox_check", "details": "Kontrollerade inbox"}'
```

Spara resultatet med antal nya meddelanden.

## REGLER

- Registrera ALDRIG samma meddelande två gånger (gmail_message_id är unikt)
- Fokusera bara på svar relaterade till outreach — ignorera spam, nyhetsbrev, etc.
- Om ett meddelande inte matchar någon outreach, registrera det ändå med match_type = "unknown"
- Var SNABB — hela flödet ska ta under 30 sekunder
- Logga alltid jobbet i automation_log oavsett resultat

## RAPPORTERING

Efter varje körning, rapportera kort:
- Antal nya meddelanden hittade
- Antal matchade mot outreach
- Antal med positivt sentiment
- Eventuella viktiga svar som behöver manuell åtgärd
