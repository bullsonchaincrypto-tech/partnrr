import PDFDocument from 'pdfkit';

export function generateKontraktPdf({ foretag, influencer, kontaktperson, datum }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const referralKod = influencer.referral_kod ||
      influencer.kanalnamn.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);

    // Header
    doc.fontSize(20).font('Helvetica-Bold')
      .text('SAMARBETSAVTAL', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica')
      .text('RankLeague Influencer-partnerskap', { align: 'center' });
    doc.moveDown(1.5);

    // Parter
    doc.fontSize(14).font('Helvetica-Bold').text('1. Parter');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Uppdragsgivare: ${foretag.namn}`);
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
      `som marknadsför RankLeague (rankleague.com) och dess tävlingsplattform för gaming.`
    );
    doc.moveDown(1);

    // Ersättning
    doc.fontSize(14).font('Helvetica-Bold').text('3. Ersättning');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text('• Fast ersättning: 300 SEK per publicerad video');
    doc.text('• Maximalt antal videos: 5 stycken');
    doc.text(`• Provisionsersättning: 10 SEK per användare som registrerar sig med referral-kod: ${referralKod}`);
    doc.text(`• Maximal fast ersättning: 1 500 SEK (5 × 300 SEK)`);
    doc.text('• Provisionsersättningen har inget tak');
    doc.moveDown(1);

    // Krav på innehåll
    doc.fontSize(14).font('Helvetica-Bold').text('4. Krav på innehåll');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text(
      'Varje video MÅSTE innehålla en tydlig och hård call-to-action (CTA) som uppmanar ' +
      'tittarna att registrera sig på RankLeague via influencerns unika referral-länk eller referral-kod.'
    );
    doc.moveDown(0.3);
    doc.text('Innehållet ska:');
    doc.text('• Tydligt visa och nämna referral-koden/länken');
    doc.text('• Förklara vad RankLeague är och varför tittarna bör gå med');
    doc.text('• Innehålla en uppmaning att registrera sig (inte bara nämna plattformen)');
    doc.text('• Fokusera på konvertering, inte enbart viralitet');
    doc.moveDown(1);

    // Rapportering
    doc.fontSize(14).font('Helvetica-Bold').text('5. Rapportering & KPI:er');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text('Influencern ska inom 7 dagar efter varje publicering dela följande statistik:');
    doc.text('• Antal visningar');
    doc.text('• Antal klick på referral-länk');
    doc.text('• Engagement rate (likes, kommentarer, delningar)');
    doc.text('• Antal registreringar via referral-kod (om tillgängligt)');
    doc.moveDown(1);

    // Avtalstid
    doc.fontSize(14).font('Helvetica-Bold').text('6. Avtalstid');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Avtalet gäller i 30 dagar från signeringsdatum om inte annat skriftligen överenskommits.`);
    doc.moveDown(1);

    // Övrigt
    doc.fontSize(14).font('Helvetica-Bold').text('7. Övrigt');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica');
    doc.text('• Influencern ansvarar för att innehållet följer plattformens riktlinjer');
    doc.text('• Samarbetet ska tydligt markeras som reklam enligt ICC:s regler och marknadsföringslagen');
    doc.text('• Eventuella tvister avgörs enligt svensk lag');
    doc.moveDown(1.5);

    // Signaturer
    doc.fontSize(14).font('Helvetica-Bold').text('8. Signaturer');
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
