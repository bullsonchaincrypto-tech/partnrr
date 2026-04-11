tasks:
- name: gmail-inbox-check
  interval: 30m
  prompt: "Kör gmail-inbox-monitor skill. Kontrollera Gmail-inkorgen för nya svar på outreach. Registrera alla nya meddelanden och analysera matchade svar. Rapportera kort om antal nya svar."

- name: auto-followup-check
  interval: 24h
  prompt: "Kör auto-followup skill. Kontrollera vilken outreach som behöver uppföljning (5+ dagar utan svar). Generera och skicka uppföljningar. Rapportera antal skickade."

- name: content-monitor-check
  interval: 12h
  prompt: "Kör content-monitor skill. Kontrollera YouTube för nya videos från influencers med aktiva avtal. Rapportera CTA-kvalitet och eventuella försenade influencers."

- name: contract-monitor-check
  interval: 24h
  prompt: "Kör contract-monitor skill. Kontrollera avtalslivscykler: löper snart ut, redan utgångna, osignerade. Skicka påminnelser. Rapportera status."

- name: smart-email-finder
  interval: 24h
  prompt: "Kör smart-email-finder skill. Sök e-postadresser för influencers som saknar kontaktinfo. Prioritera influencers med aktiva kontrakt. Kör batch-sökning via POST http://localhost:3001/api/email-finder/batch och komplettera med browser-sökning på YouTube Om-sidor för de som inte hittas automatiskt. Rapportera antal hittade."
