---
name: contract-monitor
description: Övervakar avtalslivscykeln i Partnrr. Hittar kontrakt som löper ut snart, redan utgångna avtal, och osignerade kontrakt. Skickar påminnelser automatiskt.
metadata:
  openclaw:
    always: true
    emoji: "📋"
    requires:
      env:
        - GMAIL_CLIENT_ID
---

# Contract Monitor — Partnrr

Du övervakar avtalslivscykeln och skickar påminnelser för kontrakt som behöver uppmärksamhet.

## NÄR DENNA SKILL KÖRS

Körs via heartbeat (dagligen) eller manuellt via `/contract-monitor`.

## STEG-FÖR-STEG FLÖDE

### Steg 1: Hämta kontrakt som behöver åtgärd

```bash
curl -s http://localhost:3001/api/contracts/reminders/due
```

Returnerar tre kategorier:
- `expiring_soon` — aktiva avtal som löper ut inom 7 dagar
- `expired` — avtal som redan gått ut men inte notifierats
- `unsigned_stale` — skickade kontrakt utan svar efter 5 dagar

### Steg 2: Skicka påminnelser

**För avtal som löper ut snart:**
```bash
curl -s -X POST http://localhost:3001/api/contracts/<id>/send-reminder \
  -H "Content-Type: application/json" \
  -d '{"type": "expiry"}'
```

**För redan utgångna avtal:**
```bash
curl -s -X POST http://localhost:3001/api/contracts/<id>/send-reminder \
  -H "Content-Type: application/json" \
  -d '{"type": "expired"}'
```

**För osignerade kontrakt (5+ dagar):**
```bash
curl -s -X POST http://localhost:3001/api/contracts/<id>/send-reminder \
  -H "Content-Type: application/json" \
  -d '{"type": "sign"}'
```

### Steg 3: Hämta översikt

```bash
curl -s http://localhost:3001/api/contracts/overview
```

### Steg 4: Logga jobbet

```bash
curl -s -X POST http://localhost:3001/api/automation/log \
  -H "Content-Type: application/json" \
  -d '{"job_type": "contract_monitor", "details": "Kontrollerade avtalslivscykler"}'
```

## REGLER

- Skicka MAX 1 påminnelse per kontrakt per kategori
- Skicka ALDRIG påminnelse om Gmail inte är ansluten
- Expiry-påminnelse: bara om `expiry_reminder_sent = 0`
- Expired-notifiering: bara om `expired_notified = 0`
- Signerings-påminnelse: bara efter 5 dagar utan svar
- Max 10 påminnelser per körning

## RAPPORTERING

Rapportera efter varje körning:

**📋 Contract Monitor — Rapport**

| Kategori | Antal |
|---|---|
| Löper ut snart (7d) | X |
| Redan utgångna | X |
| Osignerade (5d+) | X |
| Påminnelser skickade | X |

Plus eventuella rekommendationer om specifika influencers.
