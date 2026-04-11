# OpenClaw Setup — Partnrr

## Vad OpenClaw gör för Partnrr

OpenClaw körs i bakgrunden och automatiserar tre saker:

1. **Gmail Inbox Monitor** (var 30:e minut) — Kollar Gmail för svar på dina outreach-meddelanden, matchar dem mot rätt influencer/sponsor, och analyserar sentiment
2. **Auto-Followup** (dagligen) — Hittar outreach utan svar efter 5 dagar och skickar automatiska uppföljningar
3. **Content Monitor** (2x dagligen) — Kollar YouTube om influencers med avtal har publicerat sina videos

---

## Installation (Windows)

### Steg 1: Installera OpenClaw

Öppna PowerShell eller CMD och kör:

```bash
npm install -g openclaw@latest
```

Verifiera att det fungerar:

```bash
openclaw --version
```

### Steg 2: Kör onboarding

```bash
cd C:\Users\Jimmy\Documents\Claude\Projects\Rankleauge\rankleague-outreach-tool
openclaw onboard --install-daemon
```

Följ stegen — välj "local" gateway och hoppa över channels du inte behöver.

### Steg 3: Starta Gateway

```bash
openclaw gateway --port 18789 --verbose
```

Gateway körs i bakgrunden. Den hanterar heartbeat, skills, och schemalagda jobb.

### Steg 4: Verifiera skills

```bash
openclaw skills list
```

Du ska se tre skills:
- `gmail-inbox-monitor` 📬
- `auto-followup` 🔄
- `content-monitor` 📺

### Steg 5: Testa manuellt

```bash
openclaw agent --message "Kör gmail-inbox-monitor"
openclaw agent --message "Kör auto-followup"
openclaw agent --message "Kör content-monitor"
```

---

## Konfiguration

Allt konfigureras i `openclaw.json` (redan skapat i projektroten).

### Ändra heartbeat-intervall

Öppna `openclaw.json` och ändra `agents.defaults.heartbeat.every`:
- `"15m"` = var 15:e minut
- `"30m"` = var 30:e minut (standard)
- `"1h"` = varje timme
- `"0m"` = avstängt

### Ändra aktiva timmar

I `openclaw.json` → `activeHours`:
```json
"activeHours": {
  "start": "08:00",
  "end": "23:00",
  "timezone": "Europe/Stockholm"
}
```

### Ändra uppgiftsschema

Redigera `HEARTBEAT.md` i projektroten. Varje task har:
- `name` — unikt namn
- `interval` — hur ofta (30m, 1h, 12h, 24h)
- `prompt` — vad OpenClaw ska göra

---

## Viktigt

- **Partnrr-servern MÅSTE köra** (`npm run dev`) för att OpenClaw ska kunna anropa API:t
- Gmail måste vara ansluten i Partnrr innan inbox-monitor fungerar
- YouTube API-kvoten (10 000 units/dag) delas mellan Partnrr och content-monitor
- Alla OpenClaw-jobb loggas i databasen (automation_log-tabellen)

---

## Felsökning

### OpenClaw hittar inte skills

```bash
openclaw skills list
```

Om skills inte syns, kontrollera att du kör OpenClaw från rätt mapp:
```bash
cd C:\Users\Jimmy\Documents\Claude\Projects\Rankleauge\rankleague-outreach-tool
```

### Heartbeat körs inte

```bash
openclaw doctor
```

Kontrollera att gateway körs och att aktiva timmar är korrekta.

### Gmail-fel

Se till att Gmail är ansluten: gå till http://localhost:5173 → Gmail-ikonen → Anslut.

### Se automation-loggar

Alla jobb loggas. Du kan se dem via API:t:
```bash
curl http://localhost:3001/api/automation/log
```
