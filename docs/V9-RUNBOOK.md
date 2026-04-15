# V9 Pipeline — Runbook

SparkCollab's V9 influencer discovery-pipeline. Dokumentet beskriver hur man
aktiverar, övervakar, rollar tillbaka och debuggar V9.

---

## Arkitektur (snabböversikt)

14 faser (Fas 0 → 10) orkestrerade i `server/services/search-v9-orchestrator.js`:

```
0  Brief interpretation (Haiku)
1  Search term generation (Sonnet ×2)
2  Parallel discovery (YT + IG + TT)
2.5 Cross-platform merge
2.6 Comment discovery (YT)
2.7 Bio-link harvest
2.8 List discovery (Serper)
1.5 Query refinement (conditional)
3  Swedish Gate (8 signaler)
4  Brand Filter (8 signaler)
5  Haiku Classifier
5.5 Lookalike expansion (first + FoF)
6  Profile enrichment
7  Two-stage scoring (Haiku + Sonnet)
7.5 Obscurity validation (Serper)
8  Dynamic cut + reserve refill
9  Email finder (Serper waterfall)
10 Persistens (influencers + search_metrics)
```

Providers: **ScrapeCreators (primär)**, **HikerAPI (fallback IG)**, **Serper.dev (Google)**.
Global timeout: 180s. Concurrent-lock per foretag_id via `search_locks`.

---

## Aktivering — gradvis rollout

V9 är gatekeepad bakom två env-vars i Railway:

| Env var | Effekt |
|---|---|
| `USE_V9_PIPELINE=false` | V9 är helt avstängd (default). Alla sökningar går via V1/Apify. |
| `USE_V9_PIPELINE=true` + `V9_SEARCH_ROLLOUT_PCT=10` | 10% av foretag (deterministisk hash-bucket) → V9. Resten V1. |

### Rollout-plan

1. **Vecka 0 (idag):** `USE_V9_PIPELINE=true`, `V9_SEARCH_ROLLOUT_PCT=10`. Övervaka 24h.
2. **+3 dagar:** Om alla acceptance tests gröna → `V9_SEARCH_ROLLOUT_PCT=25`.
3. **+1 vecka:** → `50`. **+2 veckor:** → `100`.
4. **+4 veckor stabil:** Ta bort `apify-discovery.js` + `APIFY_API_TOKEN` i separat PR.

### Kontrollera bucket för specifik foretag_id

```bash
curl https://api.sparkcollab.se/api/v9/bucket/42
# → { "foretag_id": 42, "bucket": 57, "rollout_pct": 25, "would_use_v9": false }
```

---

## Observability

### Endpoints

| Endpoint | Innehåll |
|---|---|
| `GET /api/v9/status` | Feature flags + provider-presence + rollout-pct |
| `GET /api/v9/metrics/summary` | 24h avg/p50/p95 cost, duration, final_count |
| `GET /api/v9/metrics/providers` | Per-provider 24h success-rate + latency |
| `GET /api/v9/metrics/recent?limit=50` | Senaste search_metrics-raderna |
| `GET /api/v9/bucket/:foretag_id` | Rollout-bucket för given foretag |

### Alerts (waterfall: PagerDuty → Slack → console)

Konfigureras via `PAGERDUTY_INTEGRATION_KEY` och/eller `SLACK_WEBHOOK_URL` i Railway.

Kritiska triggers (auto via `costGuard()` + `provider-health.js`):

- SC eller Hiker 5xx-rate > 10% / 60 min (min 20 samples) → **critical**
- V9 avg cost 24h > `V9_HARD_CEILING_AVG` ($0.80 default) → **critical**
- V9 p95 cost 24h > `V9_HARD_CEILING_P95` ($0.80 default) → **critical**
- V9 avg cost 24h > `V9_SOFT_CEILING_AVG` ($0.60 default) → **warning**
- V9 final_count avg 24h < `V9_LOW_FINAL_FLOOR` (15 default) → **warning**

---

## Rollback

### Snabb rollback (under sekunder)

Sätt i Railway:
```
USE_V9_PIPELINE=false
```
Redeployen tar ~30s. Alla sökningar faller omedelbart tillbaka till V1/Apify.

### Gradvis rollback (reducera %-vis)

Minska `V9_SEARCH_ROLLOUT_PCT` t.ex. från 50 → 10. Foretag som nyss låg i
11-50-intervallet återgår direkt till V1.

### Fallback vid V9 runtime-error

Routen i `routes/search.js` fångar V9-errors och faller automatiskt tillbaka
till V1 inom samma request (fail-open). Loggas som:
```
[Search][V9] Fallback till V1/Apify-pipen pga V9-fel
```

---

## Fallback-drill: HikerAPI

Om ScrapeCreators börjar få 5xx-burst (>10% / 60 min) → automatiskt
PagerDuty/Slack-larm. Operatören sätter:

```
USE_HIKERAPI_FALLBACK=true
```

Alla IG-anrop (reels, hashtag, profile) går då till Hiker istället. TikTok
rör sig fortsatt via SC (Hiker saknar TT-stöd). När SC återhämtar (5xx < 2% /
30 min) → sätt tillbaka `USE_HIKERAPI_FALLBACK=false`.

---

## Debug-scenarier

### "V9 returnerar 0 results"

1. `GET /api/v9/status` — verifiera flaggor + provider-nycklar.
2. `GET /api/v9/metrics/recent?limit=5` — kolla `raw_candidates`,
   `after_swedish_gate`, `after_brand_filter`, `after_haiku`.
3. Railway-loggar `[Discovery]`, `[SwedishGate]`, `[BrandFilter]`.
4. Vanliga orsaker:
   - Alla providers returnerar 0 → nyckel/endpoint-paritet fel. Inspektera
     provider_events-tabellen: `SELECT * FROM provider_events ORDER BY created_at DESC LIMIT 20;`
   - Swedish Gate filtrerar för hårt → inspektera rejected-kategorin.
   - Brief-interpreter ger dålig nisch → kolla `[Brief]`-loggen.

### "V9 kostar för mycket"

1. `GET /api/v9/metrics/summary` för per-fas-overview.
2. Stäng av de dyra flaggorna i ordning: `USE_FOF_LOOKALIKE` →
   `USE_OBSCURITY_VALIDATION` → `USE_LOOKALIKE_EXPANSION` → `USE_QUERY_REFINEMENT`.
3. Sänk `V9_FINAL_CAP_MAX` från 40 → 25.

### "V9 timeout (504)"

180s global timeout bruten. Vanligaste orsaker:

- Provider-hang (timeout på individuella anrop är 15s, men 8 parallella × 30 cands
  ger stort N).
- Slow DB-insert i persist-steget (kolla Railway Postgres-load).

Fix: skippa en provider-lane tillfälligt (sätt t.ex. `USE_HASHTAG_DISCOVERY=false`).

---

## Nyckel-filer (för nya utvecklare)

| Fil | Roll |
|---|---|
| `services/search-v9-orchestrator.js` | Entry point `runV9Pipeline()` |
| `services/v9-rollout.js` | `shouldUseV9()`, `costGuard()`, summary |
| `services/providers/social-provider.js` | Router SC/Hiker |
| `services/data/brand-keywords.js` | All keyword-data |
| `services/swedish-gate.js`, `brand-detector.js` | Fas 3+4 filters |
| `routes/v9-metrics.js` | Admin + Grafana-endpoints |
| `routes/search.js` (rad ~35) | V9-gate + V1-fallback |

---

## Acceptance tests (för gradvis rollout)

Varje tröskel (10 → 25 → 50 → 100%) kräver:

- **AT1 Yield:** median final_count ≥ 30
- **AT2 Brand ratio:** ≤ 10% (manuell spot-check 20 sökningar)
- **AT3 Non-obvious ratio:** ≤ 22% topp-page-1 på "niche svensk"
- **AT4 Swedish ratio:** ≥ 95%
- **AT5 Kostnad:** avg ≤ $0.55, p95 ≤ $0.70
- **AT6 Latens:** median ≤ 80s, p95 ≤ 140s
- **AT7 Multi-platform:** ≥ 30% av final har platform_count ≥ 2
- **AT8 Fallback-drill:** flip `USE_HIKERAPI_FALLBACK=true`, 20 sökningar,
  degradation ≤ 15%

Rollback-trigger: **AT2 > 15%** ELLER **AT3 > 40%** ELLER **AT5 p95 > $0.80**.

---

## Nödstopp

Samtidiga kritiska tecken → stäng av V9 omedelbart:

```
railway vars set USE_V9_PIPELINE=false
railway up --detach
```

Totala nedstängningstid: ~30s. Aktiva V9-sökningar som redan startat
slutför sin körning (180s timeout som safety net).
