# RankLeague Outreach Tool

CRM- och outreach-verktyg for influencer-marknadsforing och sponsorpartnerskap.

## Tech Stack

- **Frontend:** React 18 + Vite + TailwindCSS 4
- **Backend:** Node.js + Express
- **Databas:** SQLite (via sql.js)
- **E-post:** Gmail API (OAuth2) med tracking pixel
- **AI:** Anthropic Claude API
- **UI:** Lucide React icons, Recharts

## Setup

### 1. Klona och installera

```bash
cd rankleague-outreach-tool
npm run install:all
```

### 2. Konfigurera miljovariabler

```bash
cp server/.env.example server/.env
```

Fyll i:
- `ANTHROPIC_API_KEY` - Din Anthropic API-nyckel
- `GMAIL_CLIENT_ID` - Google OAuth Client ID
- `GMAIL_CLIENT_SECRET` - Google OAuth Client Secret

### 3. Konfigurera Gmail OAuth2 (Google Cloud Console)

1. Ga till [Google Cloud Console](https://console.cloud.google.com/)
2. Skapa ett nytt projekt (eller valj ett befintligt)
3. Aktivera **Gmail API** under "APIs & Services" > "Library"
4. Ga till "APIs & Services" > "Credentials"
5. Klicka "Create Credentials" > "OAuth client ID"
6. Valj "Web application"
7. Lagg till under "Authorized redirect URIs":
   ```
   http://localhost:3001/api/auth/google/callback
   ```
8. Kopiera Client ID och Client Secret till din `.env`-fil
9. Under "OAuth consent screen", lagg till testanvandare (din Gmail)

### 4. Anthropic API-nyckel

1. Ga till [Anthropic Console](https://console.anthropic.com/)
2. Skapa en API-nyckel under "API Keys"
3. Kopiera nyckeln till `ANTHROPIC_API_KEY` i `.env`

### 5. Starta applikationen

```bash
npm run dev
```

Backend kors pa port 3001, frontend pa port 5173.
Oppna: **http://localhost:5173**

## Funktioner

### Influencer Outreach Wizard (7 steg)
1. **Foretagsprofil** - Ange foretagsinfo
2. **Hitta Influencers** - AI soker 20 relevanta svenska influencers
3. **Valj Influencers** - Bocka i vilka du vill kontakta
4. **Generera Outreach** - AI skapar personliga meddelanden
5. **Kontrakt** - Valfritt: bifoga samarbetsavtal (PDF)
6. **Granska** - Se over alla meddelanden
7. **Skicka** - Skicka via Gmail

### Sponsor Outreach (B2B) - NYTT
- Separat wizard for att pitcha sponsormojligheter till foretag
- AI hittar relevanta svenska sponsorprospects
- Val mellan e-postpitch och Instagram DM-mall
- Anpassad pitch baserat pa foretagets bransch
- Skicka via Gmail

### E-postspaarning - NYTT
- Tracking pixel infogad i e-post
- Loggar nar e-post oppnas (datum, antal gangar)
- Oppningsfrekvens-statistik i dashboard

### Dashboard (utokad)
- **Oversikt:** KPI-kort (inkl oppningsfrekvens), konverteringstratt, uppfoljningsflaggning
- **E-postspaarning:** Oppnade e-post, oppningsfrekvens, senaste oppnade
- **Statistik:** Outreach-volym per vecka/manad, svarsfrekvens per plattform (YT vs IG vs TikTok), konverteringstratt
- **Influencer Ranking:** Rankade efter signups och konverteringsrate, manuell signup-uppdatering
- **Outreach-tabell:** Filter pa status/plattform, andring av status, kontraktnedladdning

### AI-analys (utokad)
- **Snabbanalys:** Overgripande forbattringsforslag
- **Djupanalys:** CTA-optimering, plattformsrekommendationer, influencer-typanalys, datadriven analys

### Export - NYTT
- Exportera outreach-data som CSV
- Exportera sponsordata som CSV
- Exportera influencer-ranking som CSV
- Ladda ner kontrakt som PDF

### Kontraktsvillkor
- 300 SEK per publicerad video (max 5 st)
- 10 SEK per signup via referral-kod
- Krav pa hard CTA i varje video
- Rapportering inom 7 dagar
- 30 dagars avtalstid
