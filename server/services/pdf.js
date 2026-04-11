import PDFDocument from 'pdfkit';

export function generateKontraktPdf({ foretag, influencer, kontaktperson, datum, kontraktVillkor }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const referralKod = influencer.referral_kod ||
      (influencer.kanalnamn || influencer.namn || 'INFLUENCER').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

    // Hämta villkor från kontraktBrief eller använd defaults
    const v = kontraktVillkor || {};
    const ersattningPerVideo = parseInt(v.ersattning_per_video) || 300;
    const maxVideos = parseInt(v.max_videos) || 5;
    const provisionPerSignup = v.provision_per_signup != null ? parseInt(v.provision_per_signup) : 10;
    const avtalstidDagar = parseInt(v.avtalstid) || 30;
    const deadlineDagar = v.deadline_dagar != null ? parseInt(v.deadline_dagar) : null;
    const extraVillkor = v.extra_villkor || '';
    const maxFastErsattning = ersattningPerVideo * maxVideos;

    // Header
    doc.fontSize(20).font('Helvetica-Bold')
      .text('SAMARBETSAVTAL', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica')
      .text(`${foretag.namn} — Influencer-partnerskap`, { align: 'center' });
    doc.moveDown(1.5);

    // Parter
    doc.fontSize(14).font('Helvetica-Bold').text('1. Parter');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Uppdragsgivare: ${foretag.namn}`);
    if (foretag.org_nummer) doc.text(`Organisationsnummer: ${foretag.org_nummer}`);
    doc.text(`Kontaktperson: ${kontaktperson}`);
    doc.text(`E-post: ${foretag.epost}`);
    doc.moveDown(0.5);
    doc.text(`Influencer: ${influencer.namn}`);
    doc.text(`Kanal: ${influencer.kanalnamn} (${influencer.plattform})`);
    if (influencer.kontakt_epost) doc.text(`E-post: ${influencer.kontakt_epost}`);
    doc.moveDown(1);

    // Uppdragsbeskrivning
    doc.fontSize(14).font('Helvetica-Bold').text('2. Uppdragsbeskrivning');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text(
      `Influencern åtar sig att producera och publicera videoinnehåll på ${influencer.plattform} ` +
      `som marknadsför ${foretag.namn}${foretag.webbplats ? ` (${foretag.webbplats})` : ''}${foretag.beskrivning ? '. ' + foretag.beskrivning : ''}.`
    );
    doc.moveDown(1);

    // Ersättning
    doc.fontSize(14).font('Helvetica-Bold').text('3. Ersättning');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text(`• Fast ersättning: ${ersattningPerVideo} SEK per publicerad video`);
    doc.text(`• Maximalt antal videos: ${maxVideos} ${maxVideos === 1 ? 'stycke' : 'stycken'}`);
    if (provisionPerSignup > 0) {
      doc.text(`• Provisionsersättning: ${provisionPerSignup} SEK per användare som registrerar sig med referral-kod: ${referralKod}`);
    }
    doc.text(`• Maximal fast ersättning: ${maxFastErsattning.toLocaleString('sv-SE')} SEK (${maxVideos} × ${ersattningPerVideo} SEK)`);
    if (provisionPerSignup > 0) {
      doc.text('• Provisionsersättningen har inget tak');
    }
    doc.moveDown(1);

    // Krav på innehåll
    doc.fontSize(14).font('Helvetica-Bold').text('4. Krav på innehåll');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text(
      `Varje video MÅSTE innehålla en tydlig och hård call-to-action (CTA) som uppmanar ` +
      `tittarna att agera via influencerns unika referral-länk eller referral-kod.`
    );
    doc.moveDown(0.3);
    doc.text('Innehållet ska:');
    doc.text('• Tydligt visa och nämna referral-koden/länken');
    doc.text(`• Förklara vad ${foretag.namn} erbjuder och varför tittarna bör agera`);
    doc.text('• Innehålla en tydlig uppmaning att agera (inte bara nämna varumärket)');
    doc.text('• Fokusera på konvertering, inte enbart viralitet');
    doc.moveDown(1);

    // Avtalstid
    doc.fontSize(14).font('Helvetica-Bold').text('5. Avtalstid');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Avtalet gäller i ${avtalstidDagar} dagar från signeringsdatum om inte annat skriftligen överenskommits.`);
    if (deadlineDagar) {
      doc.moveDown(0.3);
      doc.text(`Videoinnehåll måste publiceras senast ${deadlineDagar} dagar efter signering av detta avtal.`);
    }
    doc.moveDown(1);

    // Extra villkor (om angivna)
    let sectionNum = 6;
    if (extraVillkor.trim()) {
      doc.fontSize(14).font('Helvetica-Bold').text(`${sectionNum}. Särskilda villkor`);
      doc.moveDown(0.3);
      doc.fontSize(11).font('Helvetica');
      doc.text(extraVillkor);
      doc.moveDown(1);
      sectionNum++;
    }

    // Övrigt
    doc.fontSize(14).font('Helvetica-Bold').text(`${sectionNum}. Övrigt`);
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text('• Influencern ansvarar för att innehållet följer plattformens riktlinjer');
    doc.text('• Samarbetet ska tydligt markeras som reklam enligt ICC:s regler och marknadsföringslagen');
    doc.text('• Eventuella tvister avgörs enligt svensk lag');
    doc.moveDown(1.5);
    sectionNum++;

    // Signaturer
    doc.fontSize(14).font('Helvetica-Bold').text(`${sectionNum}. Signaturer`);
    doc.moveDown(1);
    doc.fontSize(11).font('Helvetica');

    doc.text(`Datum: ${datum}`);
    doc.moveDown(1.5);

    doc.text('_________________________________');
    doc.text(`${kontaktperson}, ${foretag.namn}`);
    doc.moveDown(1.5);

    doc.text('_________________________________');
    doc.text(`${influencer.namn}`);

    doc.end();
  });
}

/**
 * Genererar sponsoravtal-PDF baserat på brief-svar.
 */
export function generateSponsorKontraktPdf({ foretag, sponsor, kontaktperson, datum, kontraktVillkor }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const v = kontraktVillkor || {};
    const samarbetstyper = v.samarbetstyper || [];
    const vadNiErbjuder = v.vad_ni_erbjuder || '';
    const vadNiVillHa = v.vad_ni_vill_ha || '';
    const sponsorPris = v.sponsor_pris || 'Enligt separat överenskommelse';
    const avtalstidDagar = parseInt(v.sponsor_avtalstid) || 90;
    const extraVillkor = v.extra_villkor || '';

    const samarbetsLabels = {
      logotyp: 'Logotyp på hemsida',
      content: 'Omnämning i content',
      turnering: 'Turneringssponsring',
      banner: 'Bannerplats/annons',
      rabattkod: 'Exklusiv rabattkod',
      ovrigt: 'Övrigt samarbete',
    };

    // Header
    doc.fontSize(20).font('Helvetica-Bold')
      .text('SPONSORAVTAL', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica')
      .text(`${foretag.namn} — Sponsorsamarbete`, { align: 'center' });
    doc.moveDown(1.5);

    // 1. Parter
    doc.fontSize(14).font('Helvetica-Bold').text('1. Parter');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Uppdragsgivare: ${foretag.namn}`);
    if (foretag.org_nummer) doc.text(`Organisationsnummer: ${foretag.org_nummer}`);
    doc.text(`Kontaktperson: ${kontaktperson}`);
    doc.text(`E-post: ${foretag.epost}`);
    doc.moveDown(0.5);
    doc.text(`Sponsor: ${sponsor.namn}`);
    if (sponsor.bransch) doc.text(`Bransch: ${sponsor.bransch}`);
    if (sponsor.kontakt_epost) doc.text(`E-post: ${sponsor.kontakt_epost}`);
    if (sponsor.hemsida) doc.text(`Hemsida: ${sponsor.hemsida}`);
    if (sponsor.telefon) doc.text(`Telefon: ${sponsor.telefon}`);
    doc.moveDown(1);

    // 2. Samarbetsform
    doc.fontSize(14).font('Helvetica-Bold').text('2. Samarbetsform');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text('Detta avtal omfattar följande samarbetsformer:');
    doc.moveDown(0.3);
    for (const typ of samarbetstyper) {
      doc.text(`• ${samarbetsLabels[typ] || typ}`);
    }
    doc.moveDown(1);

    // 3. Uppdragsgivarens åtaganden
    doc.fontSize(14).font('Helvetica-Bold').text('3. Uppdragsgivarens åtaganden');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text(`${foretag.namn} åtar sig att tillhandahålla följande till sponsorn:`);
    doc.moveDown(0.3);
    doc.text(vadNiErbjuder);
    doc.moveDown(1);

    // 4. Sponsorns åtaganden
    if (vadNiVillHa.trim()) {
      doc.fontSize(14).font('Helvetica-Bold').text('4. Sponsorns åtaganden');
      doc.moveDown(0.3);
      doc.fontSize(11).font('Helvetica');
      doc.text(`${sponsor.namn} åtar sig att tillhandahålla följande:`);
      doc.moveDown(0.3);
      doc.text(vadNiVillHa);
      doc.moveDown(1);
    }

    // 5. Ersättning
    let sectionNum = vadNiVillHa.trim() ? 5 : 4;
    doc.fontSize(14).font('Helvetica-Bold').text(`${sectionNum}. Ersättning`);
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Ersättning: ${sponsorPris}`);
    doc.text('Betalning sker enligt separat överenskommelse mellan parterna.');
    doc.moveDown(1);
    sectionNum++;

    // Avtalstid
    doc.fontSize(14).font('Helvetica-Bold').text(`${sectionNum}. Avtalstid`);
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Avtalet gäller i ${avtalstidDagar} dagar från signeringsdatum om inte annat skriftligen överenskommits.`);
    doc.text('Avtalet kan förlängas efter skriftlig överenskommelse mellan parterna.');
    doc.moveDown(1);
    sectionNum++;

    // Extra villkor
    if (extraVillkor.trim()) {
      doc.fontSize(14).font('Helvetica-Bold').text(`${sectionNum}. Särskilda villkor`);
      doc.moveDown(0.3);
      doc.fontSize(11).font('Helvetica');
      doc.text(extraVillkor);
      doc.moveDown(1);
      sectionNum++;
    }

    // Övrigt
    doc.fontSize(14).font('Helvetica-Bold').text(`${sectionNum}. Övrigt`);
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text('• Vardera part har rätt att säga upp avtalet med 30 dagars skriftligt varsel');
    doc.text('• Sponsorns varumärke och logotyp används i enlighet med sponsorns riktlinjer');
    doc.text('• Eventuella tvister avgörs enligt svensk lag');
    doc.moveDown(1.5);
    sectionNum++;

    // Signaturer
    doc.fontSize(14).font('Helvetica-Bold').text(`${sectionNum}. Signaturer`);
    doc.moveDown(1);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Datum: ${datum}`);
    doc.moveDown(1.5);

    doc.text('_________________________________');
    doc.text(`${kontaktperson}, ${foretag.namn}`);
    doc.moveDown(1.5);

    doc.text('_________________________________');
    doc.text(`${sponsor.namn}`);

    doc.end();
  });
}
