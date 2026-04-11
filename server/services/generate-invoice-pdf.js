/**
 * Genererar en professionell faktura-PDF för RankLeague.
 */

import PDFDocument from 'pdfkit';
import fs from 'fs';

const PURPLE = '#7c3aed';
const DARK_PURPLE = '#5b21b6';
const LIGHT_PURPLE = '#ede9fe';
const DARK_TEXT = '#111827';
const GRAY_TEXT = '#6b7280';
const LIGHT_GRAY = '#f3f4f6';
const BORDER_GRAY = '#d1d5db';
const WHITE = '#ffffff';
const GREEN = '#059669';

export function generateInvoicePdf(inv, outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 60, right: 60 },
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const pw = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const lx = doc.page.margins.left;

    // === HEADER: RANKLEAGUE + FAKTURA ===
    doc.fontSize(10).fillColor(PURPLE).font('Helvetica-Bold')
      .text('RANKLEAGUE', lx, doc.page.margins.top, { width: pw / 2 });
    doc.fontSize(8).fillColor(GRAY_TEXT).font('Helvetica')
      .text('rankleague.com', lx, doc.y);

    // Fakturanummer + datum — höger
    const headerRightX = lx + pw / 2;
    doc.fontSize(22).fillColor(DARK_TEXT).font('Helvetica-Bold')
      .text('FAKTURA', headerRightX, doc.page.margins.top, { width: pw / 2, align: 'right' });

    const infoY = doc.page.margins.top + 30;
    doc.fontSize(9).fillColor(GRAY_TEXT).font('Helvetica');
    doc.text(`Fakturanr: ${inv.faktura_nr}`, headerRightX, infoY, { width: pw / 2, align: 'right' });
    doc.text(`Datum: ${new Date(inv.created_at || Date.now()).toLocaleDateString('sv-SE')}`, headerRightX, infoY + 13, { width: pw / 2, align: 'right' });
    if (inv.due_date) {
      doc.text(`Förfallodatum: ${inv.due_date}`, headerRightX, infoY + 26, { width: pw / 2, align: 'right' });
    }

    // Status badge
    const statusLabel = { utkast: 'UTKAST', skickad: 'SKICKAD', betald: 'BETALD', forfallen: 'FÖRFALLEN', makulerad: 'MAKULERAD' };
    const statusColor = { utkast: GRAY_TEXT, skickad: '#2563eb', betald: GREEN, forfallen: '#dc2626', makulerad: GRAY_TEXT };
    if (inv.status && inv.status !== 'utkast') {
      const badgeY = infoY + 42;
      const label = statusLabel[inv.status] || inv.status.toUpperCase();
      const color = statusColor[inv.status] || GRAY_TEXT;
      doc.fontSize(8).fillColor(color).font('Helvetica-Bold')
        .text(label, headerRightX, badgeY, { width: pw / 2, align: 'right' });
    }

    doc.y = doc.page.margins.top + 75;

    // Lila linje
    doc.moveTo(lx, doc.y).lineTo(lx + pw, doc.y)
      .strokeColor(PURPLE).lineWidth(2).stroke();

    doc.y += 16;

    // === PARTER ===
    const colHalf = pw / 2 - 10;
    const parterY = doc.y;

    // Från (RankLeague)
    doc.fontSize(8).fillColor(PURPLE).font('Helvetica-Bold').text('FRÅN', lx, parterY);
    doc.fontSize(10).fillColor(DARK_TEXT).font('Helvetica-Bold').text(inv.foretag_namn || 'RankLeague', lx, parterY + 14);
    doc.fontSize(9).fillColor(GRAY_TEXT).font('Helvetica');
    if (inv.foretag_kontaktperson) doc.text(inv.foretag_kontaktperson, lx, parterY + 28);
    if (inv.foretag_epost) doc.text(inv.foretag_epost, lx, parterY + 41);

    // Till (Influencer)
    const toX = lx + colHalf + 20;
    doc.fontSize(8).fillColor(PURPLE).font('Helvetica-Bold').text('TILL', toX, parterY);
    doc.fontSize(10).fillColor(DARK_TEXT).font('Helvetica-Bold').text(inv.influencer_namn || '', toX, parterY + 14);
    doc.fontSize(9).fillColor(GRAY_TEXT).font('Helvetica');
    doc.text(`@${inv.kanalnamn || ''}`, toX, parterY + 28);
    if (inv.kontakt_epost) doc.text(inv.kontakt_epost, toX, parterY + 41);
    if (inv.referral_kod) doc.text(`Referral-kod: ${inv.referral_kod}`, toX, parterY + 54);

    doc.y = parterY + 75;

    // === FAKTURARADER (tabell) ===
    const tableY = doc.y;
    const cols = [pw * 0.45, pw * 0.15, pw * 0.15, pw * 0.25];

    // Header
    drawTableRow(doc, tableY, lx, cols, ['Beskrivning', 'Antal', 'á Pris', 'Belopp'], {
      bg: DARK_PURPLE, textColor: WHITE, bold: true, height: 28,
    });

    let ty = tableY + 28;

    // Rad 1: Videos
    drawTableRow(doc, ty, lx, cols, [
      'Publicerade videos',
      `${inv.videos_count || 0} st`,
      '300 SEK',
      `${(inv.video_amount_sek || 0).toLocaleString()} SEK`,
    ], { bg: LIGHT_GRAY, height: 28 });
    ty += 28;

    // Rad 2: Signups
    drawTableRow(doc, ty, lx, cols, [
      `Signups via referral-kod${inv.referral_kod ? ' (' + inv.referral_kod + ')' : ''}`,
      `${inv.signups_count || 0} st`,
      '10 SEK',
      `${(inv.signup_amount_sek || 0).toLocaleString()} SEK`,
    ], { bg: WHITE, height: 28 });
    ty += 28;

    // Totalrad
    drawTableRow(doc, ty, lx, cols, [
      '', '', 'TOTALT',
      `${(inv.total_amount_sek || 0).toLocaleString()} SEK`,
    ], { bg: LIGHT_PURPLE, bold: true, height: 32, textColor: DARK_PURPLE });
    ty += 32;

    // Ram runt hela tabellen
    doc.rect(lx, tableY, cols.reduce((a, b) => a + b), ty - tableY)
      .strokeColor(BORDER_GRAY).lineWidth(0.5).stroke();

    doc.y = ty + 20;

    // === BETALNINGSINFO ===
    doc.fontSize(11).fillColor(DARK_PURPLE).font('Helvetica-Bold')
      .text('Betalningsinformation');
    doc.moveDown(0.3);

    const payInfoY = doc.y;
    const payCol1 = 140;

    const payRows = [
      ['Betalningsvillkor', '30 dagar netto'],
      ['Förfallodatum', inv.due_date || 'Ej angivet'],
      ['Att betala', `${(inv.total_amount_sek || 0).toLocaleString()} SEK`],
    ];

    for (let i = 0; i < payRows.length; i++) {
      const ry = payInfoY + i * 20;
      doc.fontSize(9).fillColor(GRAY_TEXT).font('Helvetica')
        .text(payRows[i][0], lx, ry, { width: payCol1 });
      doc.fontSize(9).fillColor(DARK_TEXT).font(i === 2 ? 'Helvetica-Bold' : 'Helvetica')
        .text(payRows[i][1], lx + payCol1, ry);
    }

    doc.y = payInfoY + payRows.length * 20 + 16;

    // === PERIOD ===
    if (inv.period_from || inv.period_to) {
      doc.fontSize(9).fillColor(GRAY_TEXT).font('Helvetica')
        .text(`Faktureringsperiod: ${(inv.period_from || '').split('T')[0]} — ${(inv.period_to || '').split('T')[0]}`);
      doc.moveDown(0.5);
    }

    // === NOTERINGAR ===
    if (inv.notes) {
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor(GRAY_TEXT).font('Helvetica-Bold')
        .text('Noteringar:');
      doc.fontSize(9).fillColor(GRAY_TEXT).font('Helvetica')
        .text(inv.notes, { width: pw });
    }

    // === FOOTER ===
    doc.moveDown(3);
    const footerY = Math.max(doc.y, doc.page.height - doc.page.margins.bottom - 40);
    doc.moveTo(lx, footerY).lineTo(lx + pw, footerY)
      .strokeColor(BORDER_GRAY).lineWidth(0.5).stroke();

    doc.fontSize(8).fillColor(GRAY_TEXT).font('Helvetica')
      .text(
        `RankLeague  •  rankleague.com  •  Faktura ${inv.faktura_nr}  •  Genererat ${new Date().toLocaleDateString('sv-SE')}`,
        lx, footerY + 8,
        { width: pw, align: 'center' }
      );

    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}


function drawTableRow(doc, y, x, colWidths, cells, opts = {}) {
  const h = opts.height || 26;

  if (opts.bg) {
    doc.rect(x, y, colWidths.reduce((a, b) => a + b), h).fill(opts.bg);
  }

  let cx = x;
  for (let i = 0; i < cells.length; i++) {
    const isAmount = i === cells.length - 1;
    doc.fontSize(9)
      .fillColor(opts.textColor || DARK_TEXT)
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .text(cells[i] || '', cx + 10, y + (h - 10) / 2, {
        width: colWidths[i] - 20,
        height: h,
        align: isAmount ? 'right' : 'left',
        ellipsis: true,
      });
    cx += colWidths[i];
  }

  // Kolumn-linjer
  cx = x;
  for (let i = 0; i < colWidths.length; i++) {
    doc.moveTo(cx, y).lineTo(cx, y + h)
      .strokeColor(BORDER_GRAY).lineWidth(0.3).stroke();
    cx += colWidths[i];
  }
  doc.moveTo(cx, y).lineTo(cx, y + h).strokeColor(BORDER_GRAY).lineWidth(0.3).stroke();
}
