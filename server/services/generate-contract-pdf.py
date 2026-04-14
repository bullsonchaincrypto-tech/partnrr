#!/usr/bin/env python3
"""
Genererar en professionell kontrakts-PDF för RankLeague influencer-avtal.
Anropas med JSON via stdin, skriver PDF till angiven output-sökväg.

Användning:
  echo '{"output_path": "kontrakt.pdf", ...}' | python3 generate-contract-pdf.py
"""

import json
import sys
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)


# Färger
PURPLE = HexColor('#7c3aed')
DARK_PURPLE = HexColor('#5b21b6')
LIGHT_PURPLE = HexColor('#ede9fe')
DARK_BG = HexColor('#1f2937')
GRAY_TEXT = HexColor('#6b7280')
DARK_TEXT = HexColor('#111827')
WHITE = HexColor('#ffffff')
LIGHT_GRAY = HexColor('#f3f4f6')
BORDER_GRAY = HexColor('#d1d5db')


def build_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        'ContractTitle',
        parent=styles['Title'],
        fontSize=22,
        textColor=DARK_TEXT,
        spaceAfter=6,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold',
    ))

    styles.add(ParagraphStyle(
        'ContractSubtitle',
        parent=styles['Normal'],
        fontSize=11,
        textColor=GRAY_TEXT,
        spaceAfter=20,
        alignment=TA_CENTER,
        fontName='Helvetica',
    ))

    styles.add(ParagraphStyle(
        'SectionHeader',
        parent=styles['Heading2'],
        fontSize=13,
        textColor=DARK_PURPLE,
        spaceBefore=16,
        spaceAfter=8,
        fontName='Helvetica-Bold',
        borderPadding=(0, 0, 4, 0),
    ))

    styles.add(ParagraphStyle(
        'BodyText2',
        parent=styles['Normal'],
        fontSize=10,
        textColor=DARK_TEXT,
        spaceAfter=6,
        fontName='Helvetica',
        leading=14,
    ))

    styles.add(ParagraphStyle(
        'BulletItem',
        parent=styles['Normal'],
        fontSize=10,
        textColor=DARK_TEXT,
        spaceAfter=4,
        fontName='Helvetica',
        leftIndent=16,
        leading=14,
    ))

    styles.add(ParagraphStyle(
        'SmallGray',
        parent=styles['Normal'],
        fontSize=8,
        textColor=GRAY_TEXT,
        fontName='Helvetica',
    ))

    styles.add(ParagraphStyle(
        'SignatureLine',
        parent=styles['Normal'],
        fontSize=10,
        textColor=DARK_TEXT,
        fontName='Helvetica',
        spaceBefore=30,
        spaceAfter=4,
    ))

    return styles


def generate_pdf(data):
    output_path = data['output_path']
    styles = build_styles()

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
        leftMargin=2.5 * cm,
        rightMargin=2.5 * cm,
    )

    story = []

    # === HEADER ===
    story.append(Paragraph("RANKLEAGUE", ParagraphStyle(
        'Brand', parent=styles['Normal'],
        fontSize=10, textColor=PURPLE, fontName='Helvetica-Bold',
        alignment=TA_CENTER, spaceAfter=4,
    )))

    story.append(Paragraph("SAMARBETSAVTAL", styles['ContractTitle']))

    subtitle = f"Mellan {data.get('foretag_namn', 'Foretag')} och {data.get('influencer_namn', 'Influencer')}"
    story.append(Paragraph(subtitle, styles['ContractSubtitle']))

    # Linje
    story.append(HRFlowable(
        width="100%", thickness=2, color=PURPLE,
        spaceBefore=0, spaceAfter=16
    ))

    # === AVTALSPARTER (tabell) ===
    story.append(Paragraph("1. Avtalsparter", styles['SectionHeader']))

    parter_data = [
        ['', 'Uppdragsgivare', 'Influencer'],
        ['Namn', data.get('foretag_namn', ''), data.get('influencer_namn', '')],
        ['Kontaktperson', data.get('kontaktperson', ''), ''],
        ['E-post', data.get('foretag_epost', ''), data.get('influencer_epost', '')],
        ['Kanal', '', f"@{data.get('kanalnamn', '')} ({data.get('plattform', '')})"],
        ['Referral-kod', '', data.get('referral_kod', '')],
    ]

    parter_table = Table(parter_data, colWidths=[80, 190, 190])
    parter_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PURPLE),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0, 1), (0, -1), DARK_PURPLE),
        ('BACKGROUND', (0, 1), (-1, -1), LIGHT_GRAY),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER_GRAY),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(parter_table)
    story.append(Spacer(1, 12))

    # === UPPDRAGSBESKRIVNING ===
    story.append(Paragraph("2. Uppdragsbeskrivning", styles['SectionHeader']))
    story.append(Paragraph(
        f"Influencern ska producera och publicera videoinnehall pa {data.get('plattform', 'sin kanal')} "
        f"dar {data.get('foretag_namn', 'Uppdragsgivaren')}s tjanst RankLeague (rankleague.com) presenteras "
        f"och marknadsf\u00f6rs mot influencerns publik.",
        styles['BodyText2']
    ))

    # === ERSÄTTNING ===
    story.append(Paragraph("3. Ersattning", styles['SectionHeader']))

    ersattning_data = [
        ['Typ', 'Belopp', 'Detaljer'],
        ['Fast ersattning per video', f"{data.get('per_video_sek', 300)} SEK", f"Max {data.get('videos_required', 5)} videos"],
        ['Provision per signup', f"{data.get('per_signup_sek', 10)} SEK", f"Via referral-kod: {data.get('referral_kod', '')}"],
        ['Max fast ersattning', f"{data.get('per_video_sek', 300) * data.get('videos_required', 5)} SEK", f"{data.get('videos_required', 5)} videos x {data.get('per_video_sek', 300)} SEK"],
    ]

    ers_table = Table(ersattning_data, colWidths=[160, 120, 180])
    ers_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), DARK_PURPLE),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('BACKGROUND', (0, 1), (-1, -1), LIGHT_PURPLE),
        ('ALIGN', (1, 1), (1, -1), 'CENTER'),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER_GRAY),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(ers_table)
    story.append(Spacer(1, 12))

    # === KRAV ===
    story.append(Paragraph("4. Krav pa innehall", styles['SectionHeader']))
    krav = [
        "Varje video <b>MASTE</b> innehalla en tydlig och stark call-to-action (CTA) som uppmanar tittarna att registrera sig pa RankLeague via influencerns referral-lank eller referral-kod.",
        "CTA:n ska vara verbal (sags hogt i videon) och visuell (visas pa skarmen).",
        "Influencern ska namnge RankLeague och kort forklara tjanstens varde.",
        f"Referral-koden <b>{data.get('referral_kod', '')}</b> eller referral-lanken ska vara tydligt synlig i videon och i videobeskrivningen.",
        "Innehallet far inte strida mot svensk lag eller RankLeagues varderingar.",
    ]
    for k in krav:
        story.append(Paragraph(f"\u2022  {k}", styles['BulletItem']))

    # === RAPPORTERING ===
    story.append(Paragraph("5. Rapportering", styles['SectionHeader']))
    story.append(Paragraph(
        "Influencern ska inom <b>7 dagar</b> efter varje publicerad video dela foljande statistik med Uppdragsgivaren:",
        styles['BodyText2']
    ))
    rapport_items = [
        "Antal visningar",
        "Antal klick pa referral-lank (om tillgangligt)",
        "Skarmbild pa videostatistik fran plattformens analys",
    ]
    for item in rapport_items:
        story.append(Paragraph(f"\u2022  {item}", styles['BulletItem']))

    # === AVTALSTID ===
    story.append(Paragraph("6. Avtalstid", styles['SectionHeader']))

    avtalstid = data.get('avtalstid_dagar', 30)
    datum_text = data.get('datum', datetime.now().strftime('%Y-%m-%d'))

    story.append(Paragraph(
        f"Avtalet galler i <b>{avtalstid} dagar</b> fran och med signeringsdatum. "
        f"Om inget annat overenskommits upph\u00f6r avtalet automatiskt efter avtalstiden.",
        styles['BodyText2']
    ))

    if data.get('expires_at'):
        story.append(Paragraph(
            f"Utgangsdatum: <b>{data['expires_at'][:10]}</b>",
            styles['BodyText2']
        ))

    # === BETALNINGSVILLKOR ===
    story.append(Paragraph("7. Betalningsvillkor", styles['SectionHeader']))
    story.append(Paragraph(
        "Utbetalning sker inom 30 dagar efter att influencern levererat statistik for respektive video. "
        "Provisionsersattning (signups) utbetalas manadsvis baserat pa data fran RankLeagues system.",
        styles['BodyText2']
    ))

    # === SIGNERING ===
    story.append(Spacer(1, 24))
    story.append(HRFlowable(width="100%", thickness=1, color=BORDER_GRAY, spaceBefore=8, spaceAfter=16))

    story.append(Paragraph("Signering", styles['SectionHeader']))
    story.append(Paragraph(
        f"Genom att signera detta avtal godkanner bada parter ovanstaende villkor.",
        styles['BodyText2']
    ))
    story.append(Paragraph(
        f"Datum: {datum_text}",
        styles['BodyText2']
    ))

    story.append(Spacer(1, 20))

    # Signerings-rader
    sig_data = [
        [
            f"Uppdragsgivare:\n{data.get('foretag_namn', '')}\n{data.get('kontaktperson', '')}",
            f"Influencer:\n{data.get('influencer_namn', '')}\n@{data.get('kanalnamn', '')}",
        ],
        ['', ''],
        ['____________________________', '____________________________'],
        ['Underskrift', 'Underskrift'],
    ]

    sig_table = Table(sig_data, colWidths=[220, 220])
    sig_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, 1), 10),
        ('FONTSIZE', (0, 2), (-1, -1), 9),
        ('TEXTCOLOR', (0, 0), (-1, -1), DARK_TEXT),
        ('TEXTCOLOR', (0, 3), (-1, 3), GRAY_TEXT),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(sig_table)

    # Footer
    story.append(Spacer(1, 24))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER_GRAY, spaceBefore=8, spaceAfter=8))
    story.append(Paragraph(
        f"Genererat via SparkCollab.se \u2022 {datum_text}",
        ParagraphStyle('Footer', parent=styles['Normal'],
                       fontSize=8, textColor=GRAY_TEXT, alignment=TA_CENTER)
    ))

    # Bygg PDF
    doc.build(story)
    return output_path


if __name__ == '__main__':
    data = json.loads(sys.stdin.read())
    path = generate_pdf(data)
    print(json.dumps({"status": "ok", "path": path}))
