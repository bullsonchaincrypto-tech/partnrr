---
name: auto-followup
description: Genererar och skickar automatiska uppföljningsmeddelanden för SparkCollab-outreach som inte fått svar inom 5 dagar. Använder AI för att skapa personliga uppföljningar baserade på det ursprungliga meddelandet.
metadata:
  openclaw:
    always: true
    emoji: "🔄"
    requires:
      env:
        - GMAIL_CLIENT_ID
        - ANTHROPIC_API_KEY
---

# Auto-Followup — SparkCollab

Du hanterar automatiska uppföljningar för outreach-meddelanden som inte fått svar.

## NÄR DENNA SKILL KÖRS

Körs via heartbeat (dagligen) eller manuellt via `/auto-followup`.

## STEG-FÖR-STEG FLÖDE

### Steg 1: Hämta outreach som behöver uppföljning

```bash
curl -s "http://localhost:3001/api/automation/followup/due?days=5"
```

Detta returnerar alla influencer- och sponsor-outreach som:
- Skickades för minst 5 dagar sedan
- INTE har fått något svar (inget i inbox_messages)
- INTE redan har en skickad uppföljning

### Steg 2: Generera uppföljningsmeddelande

För varje outreach som behöver uppföljning, generera ett personligt uppföljningsmeddelande.

**Uppföljningsmeddelandet ska:**
- Vara kort och vänligt (max 100 ord)
- Referera till det ursprungliga meddelandet utan att upprepa allt
- Ha en tydlig och specifik call-to-action
- Vara på svenska
- Inte verka desperat eller pushy

**Mall för influencer-uppföljning:**
```
Hej [NAMN]!

Jag ville bara följa upp mitt tidigare meddelande om ett möjligt samarbete med [FÖRETAGSNAMN] via RankLeague.

Jag förstår att du får många förfrågningar, men jag tror verkligen att detta kan vara intressant för dig och dina följare. Kort sagt: 300 kr per video + 10 kr per signup via din unika kod.

Vore kul att höra dina tankar! Svara gärna på detta mail så berättar jag mer.

Vänliga hälsningar,
[KONTAKTPERSON]
```

**Mall för sponsor-uppföljning:**
```
Hej [NAMN]!

Jag återkommer angående möjligheten att nå era kunder genom RankLeagues gaming-community.

Vi har just nu [X] aktiva influencers med sammanlagt [Y] följare som kan lyfta ert varumärke till rätt målgrupp.

Har ni 15 minuter för ett kort samtal denna vecka?

Med vänlig hälsning,
[KONTAKTPERSON]
```

### Steg 3: Skicka via Gmail

Hämta Gmail-status:
```bash
curl -s http://localhost:3001/api/auth/google/status
```

Om Gmail är ansluten, skicka uppföljningen via samma Gmail-flöde som original-outreach. Använd "Re: [originalämne]" som ämnesrad.

### Steg 4: Logga uppföljningen

```bash
curl -s -X POST http://localhost:3001/api/automation/followup \
  -H "Content-Type: application/json" \
  -d '{
    "outreach_id": <id eller null>,
    "sponsor_outreach_id": <id eller null>,
    "influencer_id": <id eller null>,
    "prospect_id": <id eller null>,
    "followup_nr": 1,
    "trigger_reason": "auto_5days",
    "meddelande": "<uppföljningsmeddelandet>"
  }'
```

### Steg 5: Logga jobbet

```bash
curl -s -X POST http://localhost:3001/api/automation/log \
  -H "Content-Type: application/json" \
  -d '{"job_type": "auto_followup", "details": "Skickade uppföljningar"}'
```

## REGLER

- Skicka MAX 1 uppföljning per outreach (followup_nr = 1)
- Skicka ALDRIG uppföljning om personen redan svarat
- Skicka ALDRIG uppföljning till outreach som redan har status "avböjt" eller "avtal_signerat"
- Om Gmail inte är ansluten: logga uppföljningarna som "pending" istället för "sent"
- Max 10 uppföljningar per körning (för att inte spamma)
- Vänta minst 24h mellan olika uppföljningskörningar

## RAPPORTERING

Rapportera efter varje körning:
- Antal outreach som behöver uppföljning
- Antal uppföljningar genererade
- Antal faktiskt skickade
- Eventuella fel
