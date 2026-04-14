---
name: content-monitor
description: Övervakar YouTube för publicerat innehåll från influencers med aktiva avtal. Skannar kanaler, detekterar nya videos, analyserar CTA-kvalitet med AI, och uppdaterar dashboard med resultat.
metadata:
  openclaw:
    always: true
    emoji: "📺"
    requires:
      env:
        - YOUTUBE_API_KEY
---

# Content Monitor — SparkCollab

Du övervakar YouTube-kanaler för influencers med aktiva avtal och analyserar deras publicerade content.

## NÄR DENNA SKILL KÖRS

Körs via heartbeat (var 12:e timme) eller manuellt via `/content-monitor`.

## STEG-FÖR-STEG FLÖDE

### Steg 1: Trigga full content-scan

Anropa SparkCollab-serverns scan-endpoint som gör allt automatiskt:

```bash
curl -s -X POST http://localhost:3001/api/content/scan -H "Content-Type: application/json"
```

Detta endpoint gör:
1. Hittar alla influencers med status "avtal_signerat"
2. Skannar deras YouTube-kanaler för nya videos (senaste 30 dagarna)
3. Registrerar nya videos i databasen
4. Analyserar varje ny video med AI för CTA-kvalitet
5. Returnerar en komplett rapport

### Steg 2: Hämta content-översikt

```bash
curl -s http://localhost:3001/api/content/overview
```

Returnerar:
- `total_videos_tracked` — antal trackade videos totalt
- `videos_with_cta` — videos med call-to-action
- `videos_with_referral` — videos med referral-länk/kod
- `cta_quality_breakdown` — fördelning: stark/medium/svag/ingen
- `influencers_with_deal` — totalt antal influencers med avtal
- `influencers_published` — antal som publicerat content
- `influencers_missing` — antal som INTE publicerat
- `influencers_delayed` — antal försenade (>14 dagar utan publicering)
- `delayed_influencers` — lista med namn och dagar sedan avtal

### Steg 3: Rapportera resultat

Presentera en tydlig rapport med:

**📺 Content Monitor — Rapport**

| Mätvärde | Antal |
|---|---|
| Influencers skannade | X |
| Nya videos hittade | X |
| Videos analyserade | X |
| Stark CTA | X |
| Medium CTA | X |
| Svag/Ingen CTA | X |

**Försenade influencers** (>14 dagar utan publicering):
- Lista med namn och dagar sedan avtal

**Rekommendationer:**
- Om svag/ingen CTA: "Kontakta [namn] och påminn om vikten av tydlig CTA med referral-kod"
- Om försenad: "Skicka påminnelse till [namn] — [X] dagar sedan avtal signerades"

## CTA-KVALITETSNIVÅER

| Nivå | Kriterier |
|---|---|
| **Stark** | Tydlig CTA + referral-länk/kod i beskrivning + uppmanar tittare att registrera sig |
| **Medium** | Nämner företaget + har länk ELLER kod, men inte tydlig uppmaning |
| **Svag** | Bara kort omnämning utan tydlig CTA eller referral |
| **Ingen** | Ingen koppling till företaget/RankLeague alls |

## REGLER

- Skanna BARA influencers med status "avtal_signerat"
- Max 10 YouTube API-sökningar per körning (kvothantering)
- Spara ALDRIG API-nycklar i loggar
- Om YouTube API-kvoten är slut, rapportera och försök igen nästa dag
- Flagga influencers som inte publicerat inom 14 dagar som "försenad"

## YOUTUBE API KVOTHANTERING

- search.list (hitta kanal) = 100 units
- search.list (lista videos) = 100 units
- videos.list (detaljer) = 1 unit per video
- Totalt per influencer: ~201 units
- Max 10 influencers per körning = ~2010 units
- Daglig kvot: 10 000 units — räcker till ~5 fullständiga körningar
