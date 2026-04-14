/**
 * Genererar en professionell kontrakts-PDF för RankLeague influencer-avtal.
 * Använder PDFKit (ren Node.js — ingen Python behövs).
 */

import PDFDocument from 'pdfkit';
import fs from 'fs';

// Färger
const PURPLE = '#7c3aed';
const DARK_PURPLE = '#5b21b6';
const LIGHT_PURPLE = '#ede9fe';
const DARK_TEXT = '#111827';
const GRAY_TEXT = '#6b7280';
const LIGHT_GRAY = '#f3f4f6';
const BORDER_GRAY = '#d1d5db';
const WHITE = '#ffffff';

export function generateContractPdf(data, outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 70, right: 70 },
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // === HEADER ===
    doc.fontSize(10).fillColor(PURPLE).font('Helvetica-Bold')
      .text('RANKLEAGUE', { align: 'center' });

    doc.moveDown(0.3);
    doc.fontSize(24).fillColor(DARK_TEXT).font('Helvetica-Bold')
      .text('SAMARBETSAVTAL', { align: 'center' });

    doc.moveDown(0.3);
    doc.fontSize(11).fillColor(GRAY_TEXT).font('Helvetica')
      .text(`Mellan ${data.foretag_namn} och ${data.influencer_namn}`, { align: 'center' });

    doc.moveDown(0.5);

    // Lila linje
    const lineY = doc.y;
    doc.moveTo(doc.page.margins.left, lineY)
      .lineTo(doc.page.width - doc.page.margins.right, lineY)
      .strokeColor(PURPLE).lineWidth(2).stroke();

    doc.moveDown(1);

    // === 1. AVTALSPARTER ===
    sectionHeader(doc, '1. Avtalsparter');

    // Tabell-header
    const tableX = doc.page.margins.left;
    const col1 = 90;
    const col2 = (pageWidth - col1) / 2;
    const col3 = (pageWidth - col1) / 2;
    const rowH = 24;

    let ty = doc.y;

    // Header-rad
    drawRow(doc, ty, tableX, [col1, col2, col3], ['', 'Uppdragsgivare', 'Influencer'], {
      bg: PURPLE, textColor: WHITE, bold: true
    });
    ty += rowH;

    const parterRows = [
      ['Namn', data.foretag_namn || '', data.influencer_namn || ''],
      ['Kontaktperson', data.kontaktperson || '', ''],
      ['E-post', data.foretag_epost || '', data.influencer_epost || ''],
      ['Kanal', '', `@${data.kanalnamn || ''} (${data.plattform || ''})`],
      ['Referral-kod', '', data.referral_kod || ''],
    ];

    for (let i = 0; i < parterRows.length; i++) {
      drawRow(doc, ty, tableX, [col1, col2, col3], parterRows[i], {
        bg: i % 2 === 0 ? LIGHT_GRAY : WHITE,
        textColor: DARK_TEXT,
        labelColor: DARK_PURPLE,
      });
      ty += rowH;
    }

    doc.y = ty + 12;

    // === 2. UPPDRAGSBESKRIVNING ===
    sectionHeader(doc, '2. Uppdragsbeskrivning');
    bodyText(doc, pageWidth,
      `Influencern ska producera och publicera videoinnehåll på ${data.plattform || 'sin kanal'} ` +
      `där ${data.foretag_namn}s tjänst RankLeague (rankleague.com) presenteras ` +
      `och marknadsförs mot influencerns publik.`
    );

    // === 3. ERSÄTTNING ===
    sectionHeader(doc, '3. Ersättning');

    ty = doc.y;
    const eCol1 = 170;
    const eCol2 = 120;
    const eCol3 = pageWidth - eCol1 - eCol2;

    drawRow(doc, ty, tableX, [eCol1, eCol2, eCol3], ['Typ', 'Belopp', 'Detaljer'], {
      bg: DARK_PURPLE, textColor: WHITE, bold: true
    });
    ty += rowH;

    const perVideo = data.per_video_sek || 300;
    const perSignup = data.per_signup_sek || 10;
    const maxVideos = data.videos_required || 5;

    const ersRows = [
      ['Fast ersättning per video', `${perVideo} SEK`, `Max ${maxVideos} videos`],
      ['Provision per signup', `${perSignup} SEK`, `Via referral-kod: ${data.referral_kod || ''}`],
      ['Max fast ersättning', `${perVideo * maxVideos} SEK`, `${maxVideos} videos x ${perVideo} SEK`],
    ];

    for (let i = 0; i < ersRows.length; i++) {
      drawRow(doc, ty, tableX, [eCol1, eCol2, eCol3], ersRows[i], {
        bg: i % 2 === 0 ? LIGHT_PURPLE : WHITE,
        textColor: DARK_TEXT,
      });
      ty += rowH;
    }

    doc.y = ty + 12;

    // === 4. KRAV ===
    sectionHeader(doc, '4. Krav på innehåll');

    const krav = [
      `Varje video MÅSTE innehålla en tydlig och stark call-to-action (CTA) som uppmanar tittarna att registrera sig på RankLeague via influencerns referral-länk eller referral-kod.`,
      `CTA:n ska vara verbal (sägs högt i videon) och visuell (visas på skärmen).`,
      `Influencern ska namnge RankLeague och kort förklara tjänstens värde.`,
      `Referral-koden ${data.referral_kod || ''} eller referral-länken ska vara tydligt synlig i videon och i videobeskrivningen.`,
      `Innehållet får inte strida mot svensk lag eller RankLeagues värderingar.`,
    ];
    for (const item of krav) {
      bulletItem(doc, pageWidth, item);
    }

    // === 5. RAPPORTERING ===
    checkPageSpace(doc, 150);
    sectionHeader(doc, '5. Rapportering');
    bodyText(doc, pageWidth,
      'Influencern ska inom 7 dagar efter varje publicerad video dela följande statistik med Uppdragsgivaren:'
    );
    bulletItem(doc, pageWidth, 'Antal visningar');
    bulletItem(doc, pageWidth, 'Antal klick på referral-länk (om tillgängligt)');
    bulletItem(doc, pageWidth, 'Skärmbild på videostatistik från plattformens analys');

    // === 6. AVTALSTID ===
    checkPageSpace(doc, 100);
    sectionHeader(doc, '6. Avtalstid');
    const avtalstid = data.avtalstid_dagar || 30;
    bodyText(doc, pageWidth,
      `Avtalet gäller i ${avtalstid} dagar från och med signeringsdatum. ` +
      `Om inget annat överenskommits upphör avtalet automatiskt efter avtalstiden.`
    );
    if (data.expires_at) {
      bodyText(doc, pageWidth, `Utgångsdatum: ${data.expires_at.slice(0, 10)}`);
    }

    // === 7. BETALNINGSVILLKOR ===
    checkPageSpace(doc, 100);
    sectionHeader(doc, '7. Betalningsvillkor');
    bodyText(doc, pageWidth,
      'Utbetalning sker inom 30 dagar efter att influencern levererat statistik för respektive video. ' +
      'Provisionsersättning (signups) utbetalas månadsvis baserat på data från RankLeagues system.'
    );

    // === SIGNERING ===
    checkPageSpace(doc, 200);
    doc.moveDown(1);

    // Grå linje
    const sigLineY = doc.y;
    doc.moveTo(doc.page.margins.left, sigLineY)
      .lineTo(doc.page.width - doc.page.margins.right, sigLineY)
      .strokeColor(BORDER_GRAY).lineWidth(0.5).stroke();

    doc.moveDown(0.8);
    sectionHeader(doc, 'Signering');
    bodyText(doc, pageWidth, 'Genom att signera detta avtal godkänner båda parter ovanstående villkor.');

    const datum = data.datum || new Date().toISOString().split('T')[0];
    bodyText(doc, pageWidth, `Datum: ${datum}`);

    doc.moveDown(1.5);

    // Signerings-kolumner
    const sigX1 = doc.page.margins.left;
    const sigX2 = doc.page.margins.left + pageWidth / 2 + 20;
    const sigY = doc.y;

    doc.fontSize(10).fillColor(DARK_TEXT).font('Helvetica');
    doc.text('Uppdragsgivare:', sigX1, sigY);
    doc.text(data.foretag_namn || '', sigX1, sigY + 14);
    doc.text(data.kontaktperson || '', sigX1, sigY + 28);

    doc.text('Influencer:', sigX2, sigY);
    doc.text(data.influencer_namn || '', sigX2, sigY + 14);
    doc.text(`@${data.kanalnamn || ''}`, sigX2, sigY + 28);

    doc.moveDown(4);
    const underY = sigY + 70;

    doc.text('____________________________', sigX1, underY);
    doc.text('____________________________', sigX2, underY);

    doc.fontSize(8).fillColor(GRAY_TEXT);
    doc.text('Underskrift', sigX1, underY + 14);
    doc.text('Underskrift', sigX2, underY + 14);

    // Footer
    doc.moveDown(3);
    const footY = doc.y;
    doc.moveTo(doc.page.margins.left, footY)
      .lineTo(doc.page.width - doc.page.margins.right, footY)
      .strokeColor(BORDER_GRAY).lineWidth(0.5).stroke();

    doc.moveDown(0.5);
    // SparkCollab-branding (diskret, ljusgrå, 8pt)
    doc.fontSize(8).fillColor(GRAY_TEXT).font('Helvetica')
      .text(`Genererat via SparkCollab.se  •  ${datum}`, { align: 'center' });

    // Klart
    doc.end();

    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}


// === Hjälpfunktioner ===

function sectionHeader(doc, text) {
  doc.moveDown(0.6);
  doc.fontSize(13).fillColor(DARK_PURPLE).font('Helvetica-Bold')
    .text(text);
  doc.moveDown(0.3);
}

function bodyText(doc, width, text) {
  doc.fontSize(10).fillColor(DARK_TEXT).font('Helvetica')
    .text(text, { width, lineGap: 3 });
  doc.moveDown(0.3);
}

function bulletItem(doc, width, text) {
  const x = doc.x;
  doc.fontSize(10).fillColor(DARK_TEXT).font('Helvetica')
    .text(`•  ${text}`, doc.page.margins.left + 16, doc.y, { width: width - 16, lineGap: 2 });
  doc.moveDown(0.15);
}

function checkPageSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function drawRow(doc, y, x, colWidths, cells, opts = {}) {
  const rowH = 24;

  // Bakgrund
  if (opts.bg) {
    doc.rect(x, y, colWidths.reduce((a, b) => a + b, 0), rowH)
      .fill(opts.bg);
  }

  // Ram
  doc.rect(x, y, colWidths.reduce((a, b) => a + b, 0), rowH)
    .strokeColor(BORDER_GRAY).lineWidth(0.5).stroke();

  // Text i varje cell
  let cx = x;
  for (let i = 0; i < cells.length; i++) {
    const isLabel = i === 0 && opts.labelColor;
    doc.fontSize(9)
      .fillColor(isLabel ? opts.labelColor : (opts.textColor || DARK_TEXT))
      .font(opts.bold || isLabel ? 'Helvetica-Bold' : 'Helvetica')
      .text(cells[i] || '', cx + 8, y + 7, {
        width: colWidths[i] - 16,
        height: rowH - 4,
        ellipsis: true,
      });
    cx += colWidths[i];
  }
}
