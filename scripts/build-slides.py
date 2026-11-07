#!/usr/bin/env python3
"""
Build the SkinPact presentation deck.

Usage:
    python3 scripts/build-slides.py

Output:
    reports/SkinPact-Slides-draft.pptx

The deck is deliberately slide-first: one claim per slide, short text,
large visuals, and speaker notes carrying the experiment detail. It reuses
the report's figures and public-source screenshots.
"""
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "reports" / "assets"
OUT = ROOT / "reports" / "SkinPact-Slides-draft.pptx"

# Palette
INK = RGBColor(0x12, 0x18, 0x21)
INK_SOFT = RGBColor(0x33, 0x41, 0x55)
MUTED = RGBColor(0x66, 0x74, 0x84)
FAINT = RGBColor(0x8B, 0x98, 0xA8)
LINE = RGBColor(0xD9, 0xE1, 0xE9)
PAPER = RGBColor(0xF7, 0xF8, 0xFA)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
STEEL = RGBColor(0x17, 0x5C, 0x86)
STEEL_DEEP = RGBColor(0x0E, 0x3F, 0x5C)
STEEL_SOFT = RGBColor(0xE8, 0xF1, 0xF7)
AMBER = RGBColor(0xB4, 0x53, 0x09)
AMBER_SOFT = RGBColor(0xFD, 0xF3, 0xE7)
RED = RGBColor(0xB4, 0x23, 0x18)
RED_SOFT = RGBColor(0xFD, 0xEC, 0xEA)
GREEN = RGBColor(0x1F, 0x7A, 0x5A)
GREEN_SOFT = RGBColor(0xE9, 0xF5, 0xEF)
DARK = RGBColor(0x0B, 0x1B, 0x27)
DARK_LINE = RGBColor(0x2B, 0x46, 0x5A)
DARK_MUTED = RGBColor(0x9D, 0xB2, 0xC2)

TITLE_FONT = "Georgia"
BODY_FONT = "Arial"
MONO_FONT = "Courier New"

W, H = 13.333, 7.5


def rgb(value: str) -> RGBColor:
    value = value.lstrip("#")
    return RGBColor(int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


def set_bg(slide, color: RGBColor) -> None:
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color


def text(
    slide,
    value: str,
    x: float,
    y: float,
    w: float,
    h: float,
    size: float = 16,
    color: RGBColor = INK,
    *,
    bold: bool = False,
    italic: bool = False,
    font: str = BODY_FONT,
    align=PP_ALIGN.LEFT,
    anchor=MSO_ANCHOR.TOP,
    spacing: float = 1.0,
):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = 0
    tf.margin_right = 0
    tf.margin_top = 0
    tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    p = tf.paragraphs[0]
    p.alignment = align
    p.line_spacing = spacing
    run = p.add_run()
    run.text = value
    run.font.name = font
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color
    return box


def bullets(
    slide,
    items,
    x: float,
    y: float,
    w: float,
    h: float,
    size: float = 16,
    color: RGBColor = INK_SOFT,
    *,
    gap: float = 9,
    lead_color: RGBColor = INK,
):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = 0
    tf.margin_right = 0
    tf.margin_top = 0
    tf.margin_bottom = 0
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(gap)
        p.line_spacing = 1.08
        if isinstance(item, tuple):
            lead, rest = item
            r1 = p.add_run()
            r1.text = f"•  {lead}"
            r1.font.name = BODY_FONT
            r1.font.size = Pt(size)
            r1.font.bold = True
            r1.font.color.rgb = lead_color
            r2 = p.add_run()
            r2.text = f" {rest}"
            r2.font.name = BODY_FONT
            r2.font.size = Pt(size)
            r2.font.color.rgb = color
        else:
            r = p.add_run()
            r.text = f"•  {item}"
            r.font.name = BODY_FONT
            r.font.size = Pt(size)
            r.font.color.rgb = color
    return box


def rect(
    slide,
    x: float,
    y: float,
    w: float,
    h: float,
    fill: RGBColor,
    line: RGBColor | None = None,
    *,
    rounded: bool = False,
    line_width: float = 0.8,
):
    shape_type = MSO_SHAPE.ROUNDED_RECTANGLE if rounded else MSO_SHAPE.RECTANGLE
    shape = slide.shapes.add_shape(shape_type, Inches(x), Inches(y), Inches(w), Inches(h))
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        shape.line.width = Pt(line_width)
    if rounded:
        try:
            shape.adjustments[0] = 0.06
        except Exception:
            pass
    return shape


def hline(slide, x1: float, y1: float, x2: float, color: RGBColor = LINE, width: float = 1.0):
    line = slide.shapes.add_connector(
        MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y1)
    )
    line.line.color.rgb = color
    line.line.width = Pt(width)


def picture(slide, path: Path, x: float, y: float, w: float, h: float):
    with Image.open(path) as im:
        iw, ih = im.size
    scale = min(w / iw, h / ih)
    nw, nh = iw * scale, ih * scale
    left = x + (w - nw) / 2
    top = y + (h - nh) / 2
    return slide.shapes.add_picture(str(path), Inches(left), Inches(top), Inches(nw), Inches(nh))


def header(slide, kicker: str, title: str, *, dark: bool = False):
    kicker_color = DARK_MUTED if dark else STEEL
    title_color = WHITE if dark else INK
    line_color = DARK_LINE if dark else LINE
    text(slide, kicker.upper(), 0.65, 0.38, 10.5, 0.24, 9.5, kicker_color, bold=True, font=MONO_FONT)
    text(slide, title, 0.65, 0.72, 12.0, 0.72, 30, title_color, bold=True, font=TITLE_FONT)
    hline(slide, 0.65, 1.52, 12.68, line_color, 1)


def footer(slide, number: int, *, dark: bool = False):
    color = DARK_MUTED if dark else FAINT
    line_color = DARK_LINE if dark else LINE
    hline(slide, 0.65, 7.03, 12.68, line_color, 0.8)
    text(slide, "SKINPACT · TESTNET ONLY", 0.65, 7.1, 5.5, 0.18, 8, color, font=MONO_FONT)
    text(slide, f"{number:02d} / 12", 11.9, 7.1, 0.78, 0.18, 8, color, font=MONO_FONT, align=PP_ALIGN.RIGHT)


def notes(slide, value: str):
    slide.notes_slide.notes_text_frame.text = value


def label(slide, value: str, x: float, y: float, w: float, color: RGBColor = MUTED):
    text(slide, value.upper(), x, y, w, 0.18, 8.5, color, bold=True, font=MONO_FONT)


def build():
    prs = Presentation()
    prs.slide_width = Inches(W)
    prs.slide_height = Inches(H)
    blank = prs.slide_layouts[6]

    # ---------------------------------------------------------------- Slide 1
    slide = prs.slides.add_slide(blank)
    set_bg(slide, DARK)
    text(slide, "EXPERIMENT ANALYSIS REPORT · 35%", 0.75, 0.65, 7.0, 0.25, 10, DARK_MUTED, bold=True, font=MONO_FONT)
    text(slide, "SkinPact", 0.72, 1.12, 6.4, 1.1, 66, WHITE, bold=True, font=TITLE_FONT)
    text(slide, "Escrow for CS2 skin trades — without custodying the item or the login.", 0.75, 2.32, 6.1, 1.2, 21, DARK_MUTED, font=TITLE_FONT, spacing=1.06)
    text(slide, "Final project · 2026-11-07", 0.75, 4.12, 5.6, 0.25, 11, DARK_MUTED, font=MONO_FONT)
    text(slide, "Team SkinPact · Sepolia testnet only", 0.75, 4.42, 5.8, 0.25, 11, DARK_MUTED, font=MONO_FONT)

    cards = [
        ("skin-glock-water-elemental.png", "Glock-18", "$21.79", "Water Elemental · FT"),
        ("skin-ak47-redline.png", "AK-47", "$32.13", "Redline · FT"),
        ("skin-awp-asiimov.png", "AWP", "$127.42", "Asiimov · FT"),
        ("skin-m4a1s-printstream.png", "M4A1-S", "$479.83", "Printstream · FN"),
    ]
    positions = [(7.55, 1.1), (10.15, 1.1), (7.55, 3.6), (10.15, 3.6)]
    for (filename, name, price, sub), (x, y) in zip(cards, positions):
        rect(slide, x, y, 2.35, 2.05, WHITE, None, rounded=True)
        picture(slide, ASSETS / filename, x + 0.12, y + 0.1, 2.11, 1.25)
        text(slide, name, x + 0.14, y + 1.4, 1.1, 0.2, 11, INK, bold=True)
        text(slide, price, x + 1.3, y + 1.34, 0.9, 0.3, 18, STEEL_DEEP, font=TITLE_FONT, align=PP_ALIGN.RIGHT)
        text(slide, sub, x + 0.14, y + 1.7, 2.05, 0.2, 8.5, MUTED)
    text(slide, "CS2 items and Steam Market prices · 2026-11-07", 7.55, 5.85, 5.0, 0.2, 8.5, DARK_MUTED, font=MONO_FONT)
    footer(slide, 1, dark=True)
    notes(
        slide,
        "Opening: SkinPact is a testnet escrow for CS2 skin trades. It separates the item transfer, "
        "which happens inside Steam, from the value transfer, which happens in a smart contract. "
        "The four items on the right are real Steam Community Market listings sampled on 2026-11-07; "
        "the prices are context, not the experiment's test-ETH amount. Everything is testnet-only."
    )

    # ---------------------------------------------------------------- Slide 2
    slide = prs.slides.add_slide(blank)
    header(slide, "01 / The problem", "A $127 skin still has a trust problem.")
    bullets(
        slide,
        [
            ("Steam fee.", "15% seller fee: 5% Steam + 10% CS2 game fee. A $127.42 AWP pays $19.11."),
            ("Delivery is off-chain.", "The seller sends a Steam offer; the buyer accepts in Steam Guard. No atomic swap."),
            ("Someone goes first.", "Pay first and risk non-delivery; deliver first and risk non-payment."),
            ("The hard part is not the fee.", "It is who holds the item when the other side disappears."),
        ],
        0.7,
        1.9,
        6.3,
        4.3,
        16.5,
    )
    rect(slide, 7.35, 1.75, 5.3, 4.55, PAPER, LINE, rounded=True)
    picture(slide, ASSETS / "skin-awp-asiimov.png", 7.65, 2.0, 4.7, 2.55)
    text(slide, "AWP | Asiimov · Field-Tested", 7.65, 4.72, 3.2, 0.22, 11, INK, bold=True)
    text(slide, "$127.42", 10.55, 4.62, 1.7, 0.4, 26, STEEL_DEEP, font=TITLE_FONT, align=PP_ALIGN.RIGHT)
    text(slide, "Steam fee 15% = $19.11", 7.65, 5.0, 3.0, 0.22, 11, AMBER, bold=True)
    text(slide, "Steam Community Market, USD, 2026-11-07", 7.65, 5.98, 4.7, 0.2, 8.5, MUTED, font=MONO_FONT)
    text(slide, "The problem is the trust gap, not just the fee.", 0.7, 6.25, 6.2, 0.3, 15, STEEL, bold=True, font=TITLE_FONT)
    footer(slide, 2)
    notes(
        slide,
        "Steam's seller fee is 15% for CS2 (5% Steam transaction fee plus 10% game fee), sourced from "
        "SteamDB and dated 2026-11-07. The AWP is a real listing at $127.42, so the fee is $19.11. "
        "The delivery is asynchronous and off-chain: the seller sends, the buyer accepts in Steam Guard. "
        "SkinPact starts from this trust gap, not from a claim that fees are irrelevant."
    )

    # ---------------------------------------------------------------- Slide 3
    slide = prs.slides.add_slide(blank)
    header(slide, "02 / Market landscape", "Lower fees do not remove custody risk.")
    text(slide, "Seller fee", 0.72, 1.85, 2.0, 0.2, 9.5, MUTED, bold=True, font=MONO_FONT)
    fee_rows = [("Steam Community Market", "15%", STEEL), ("BUFF163", "1.5%", AMBER), ("YouPin898", "1%", GREEN)]
    for i, (name, fee, color) in enumerate(fee_rows):
        y = 2.2 + i * 0.75
        text(slide, name, 0.72, y, 3.7, 0.28, 14, INK, bold=True)
        text(slide, fee, 4.35, y - 0.04, 1.0, 0.35, 22, color, bold=True, font=TITLE_FONT, align=PP_ALIGN.RIGHT)
    text(slide, "1.5% and 1% are real, but they are seller fees.", 0.72, 4.55, 5.7, 0.28, 14, INK_SOFT)
    text(slide, "The operator still holds the item, the account, or the dispute process.", 0.72, 4.88, 5.7, 0.55, 14, INK_SOFT)
    text(slide, "Sources: SteamDB, BUFF official announcement, SteamDB YouPin · 2026-11-07", 0.72, 6.45, 5.8, 0.2, 8, MUTED, font=MONO_FONT)

    rect(slide, 7.0, 1.75, 5.65, 1.65, WHITE, LINE)
    picture(slide, ASSETS / "buff-fee-crop.png", 7.08, 1.83, 5.5, 1.45)
    text(slide, "BUFF163 official fee announcement: 2.5% → 1.5%", 7.0, 3.46, 5.5, 0.2, 9.5, MUTED)
    rect(slide, 7.0, 3.78, 5.65, 2.55, WHITE, LINE)
    picture(slide, ASSETS / "youpin-market-crop.png", 7.08, 3.86, 5.5, 2.38)
    text(slide, "YouPin898 public market: CNY listings", 7.0, 6.3, 5.5, 0.2, 9.5, MUTED)
    footer(slide, 3)
    notes(
        slide,
        "Competitor rates: Steam 15%, BUFF's official announcement 1.5% (2.5% before, withdrawal 1%), "
        "YouPin 1% (SteamDB last verified 2026-07-01). The screenshots are public pages and show no account data. "
        "The point is not that 1.5% is fake; it is that lower fees still leave a custodian and a delivery dispute. "
        "SkinPact's differentiator is the escrow and dispute design, not a race to zero fees."
    )

    # ---------------------------------------------------------------- Slide 4
    slide = prs.slides.add_slide(blank)
    header(slide, "03 / Solution", "Escrow around an off-chain delivery rail.")
    rect(slide, 0.55, 1.7, 7.85, 4.9, WHITE, LINE)
    picture(slide, ASSETS / "architecture.png", 0.68, 1.82, 7.6, 4.65)
    bullets(
        slide,
        [
            ("Buyer funds escrow.", "Seller locks a bond; neither side can unilaterally take both."),
            ("Seller sends the Steam offer.", "The helper observes Steam; the contract never claims to verify it."),
            ("No owner, no upgrade.", "The arbiter is the only privileged role, and only on Disputed orders."),
        ],
        8.7,
        1.9,
        4.0,
        4.2,
        13.5,
        gap=14,
    )
    text(slide, "Contract moves value · helper sees Steam · Relay stores the encrypted Trade URL", 8.7, 5.8, 4.0, 0.55, 9.5, MUTED, font=MONO_FONT)
    footer(slide, 4)
    notes(
        slide,
        "Roles: buyer, seller, arbiter, Relay, and the seller-local helper. The contract is the only component "
        "that moves escrow; it has no owner and no upgrade path. The helper runs on the seller's machine, holds "
        "the Steam session, and observes the offer. The Relay stores the buyer Trade URL encrypted and can "
        "decrypt it at runtime; that is a disclosed trust boundary. Steam remains the delivery system of record."
    )

    # ---------------------------------------------------------------- Slide 5
    slide = prs.slides.add_slide(blank)
    header(slide, "04 / Lifecycle", "Every non-terminal state has an exit.")
    rect(slide, 0.55, 1.7, 7.7, 4.9, WHITE, LINE)
    picture(slide, ASSETS / "state-machine.png", 0.68, 1.8, 7.45, 4.7)
    bullets(
        slide,
        [
            ("Happy path.", "Active → Funded → OfferSent → ClaimPending → Completed."),
            ("Liveness.", "Anyone can expireOrder or finalizeClaim after the deadline."),
            ("Fast path.", "Buyer confirmReceipt settles Funded, OfferSent, or ClaimPending."),
            ("Dispute.", "OpenDispute freezes settlement; only the arbiter resolves."),
        ],
        8.6,
        1.9,
        4.1,
        4.2,
        13.5,
        gap=13,
    )
    footer(slide, 5)
    notes(
        slide,
        "Nine enum values, eight live states plus None. The happy path is create, buy, mark, claim, finalize; "
        "the buyer can confirm directly from Funded, OfferSent, or ClaimPending. A dispute from OfferSent or "
        "ClaimPending moves the listing to Disputed; only the arbiter can settle it. expireOrder and "
        "finalizeClaim are permissionless, so a stuck counterparty cannot lock escrow forever."
    )

    # ---------------------------------------------------------------- Slide 6
    slide = prs.slides.add_slide(blank)
    header(slide, "05 / Safety", "Safety is in the exit paths.")
    cards = [
        ("Bond", "Seller locks max(price / 10, 0.001 ETH). A fake listing has skin in the game.", AMBER, AMBER_SOFT),
        ("Pull payments", "Settlement credits balances; withdraw() zeroes the credit before the call.", STEEL, STEEL_SOFT),
        ("Challenge window", "300 s on Sepolia. The buyer can dispute a claim before it finalizes.", GREEN, GREEN_SOFT),
        ("Arbiter", "Only Disputed orders; immutable address. The single trusted role.", RED, RED_SOFT),
    ]
    positions = [(0.7, 1.75), (6.75, 1.75), (0.7, 3.85), (6.75, 3.85)]
    for (name, body, color, soft), (x, y) in zip(cards, positions):
        rect(slide, x, y, 5.85, 1.85, soft, LINE, rounded=True)
        rect(slide, x, y, 0.08, 1.85, color, None)
        text(slide, name, x + 0.28, y + 0.2, 5.2, 0.28, 17, color, bold=True, font=TITLE_FONT)
        text(slide, body, x + 0.28, y + 0.62, 5.2, 1.0, 12.5, INK_SOFT, spacing=1.08)
    text(slide, "No owner · no upgrade path · no arbitrary withdrawal", 0.7, 6.0, 8.4, 0.35, 17, STEEL_DEEP, bold=True, font=TITLE_FONT)
    text(slide, "The contract can only move funds through the coded state machine.", 0.7, 6.35, 10.8, 0.25, 11, MUTED)
    footer(slide, 6)
    notes(
        slide,
        "Four mechanisms carry the safety story. The bond is proportional to price with a minimum; pull payments "
        "avoid pushing ETH during settlement and are guarded by ReentrancyGuard; the challenge window gives the "
        "buyer time to dispute a claim; the arbiter is the only privileged role and only on Disputed listings. "
        "The contract has no owner, no upgrade path, and no emergency withdrawal. The residual trust in the "
        "arbiter is disclosed, not hidden."
    )

    # ---------------------------------------------------------------- Slide 7
    slide = prs.slides.add_slide(blank)
    header(slide, "06 / Demo", "Sepolia: verified, funded, exercised.")
    steps = [
        ("Seller scans QR", "helper pairs; wallet binds to SteamID64"),
        ("Seller lists", "bond locked; buyer saves account"),
        ("Buyer pays", "price enters escrow"),
        ("Helper sends offer", "seller marks the offer hash"),
        ("Buyer accepts / confirms", "Steam Guard; or seller claims"),
    ]
    for i, (title, sub) in enumerate(steps):
        y = 1.78 + i * 0.82
        rect(slide, 0.8, y, 0.42, 0.42, STEEL if i < 4 else GREEN, None, rounded=True)
        text(slide, str(i + 1), 0.8, y + 0.07, 0.42, 0.2, 10, WHITE, bold=True, align=PP_ALIGN.CENTER)
        text(slide, title, 1.42, y - 0.02, 4.5, 0.25, 13.5, INK, bold=True)
        text(slide, sub, 1.42, y + 0.25, 4.6, 0.2, 10.5, MUTED)

    rect(slide, 7.15, 1.75, 5.5, 4.6, PAPER, LINE, rounded=True)
    label(slide, "Sepolia evidence", 7.4, 1.95, 2.0)
    text(slide, "0x2Ffca056…460eF", 7.4, 2.2, 4.9, 0.28, 15, STEEL_DEEP, bold=True, font=MONO_FONT)
    text(slide, "Chain 11155111 · verified Exact Match", 7.4, 2.55, 4.9, 0.22, 10.5, INK_SOFT)
    text(slide, "22 Sepolia txs · 15 gas rows", 7.4, 2.85, 4.9, 0.22, 10.5, INK_SOFT)
    text(slide, "11 original smoke + completion smoke for claim / finalize / expire / withdraw", 7.4, 3.15, 4.9, 0.45, 9.5, MUTED)
    picture(slide, ASSETS / "qr-sepolia.png", 7.4, 3.8, 1.45, 1.45)
    text(slide, "Scan to\nEtherscan", 8.95, 3.95, 1.5, 0.5, 9, MUTED, font=MONO_FONT)
    text(slide, "Real Steam acceptance is a manual exit check.", 7.4, 5.55, 4.9, 0.22, 9.5, AMBER, bold=True)
    text(slide, "Automated E2E Steam transport is mocked.", 7.4, 5.82, 4.9, 0.22, 9.5, AMBER, bold=True)
    footer(slide, 7)
    notes(
        slide,
        "Demo path: seller QR login and helper pairing, listing with bond, buyer saves an account and pays, "
        "helper sends the Steam offer, seller marks it, buyer accepts in Steam Guard and confirms; alternatively "
        "the seller claims and anyone finalizes after the challenge. Sepolia evidence: verified contract, 22 "
        "transactions across the original and completion smokes, 15 gas rows. The automated E2E mocks Steam; "
        "the real acceptance is a manual exit check and must be labelled as such in the video."
    )

    # ---------------------------------------------------------------- Slide 8
    slide = prs.slides.add_slide(blank)
    header(slide, "07 / E1 · Gas", "One trade is four transactions — not one fee.")
    rect(slide, 0.5, 1.65, 7.55, 5.1, WHITE, LINE)
    picture(slide, ROOT / "experiments" / "e1" / "gas-by-operation.png", 0.62, 1.78, 7.3, 4.85)
    text(slide, "10 gwei · ETH $3,000 · Sepolia gasUsed", 0.7, 6.78, 5.0, 0.2, 8.5, MUTED, font=MONO_FONT)
    text(slide, "$35.20", 8.35, 1.7, 4.2, 0.75, 50, STEEL_DEEP, bold=True, font=TITLE_FONT)
    text(slide, "happy path, total network fee", 8.4, 2.45, 4.3, 0.25, 11, MUTED)
    rows = [
        ("Seller", "$28.94", "createListing + markOfferSent"),
        ("Buyer", "$6.25", "buy + confirmReceipt"),
        ("Withdraw", "+$1.29", "optional seller payout"),
    ]
    for i, (who, amount, what) in enumerate(rows):
        y = 2.92 + i * 0.82
        text(slide, who, 8.4, y, 1.2, 0.25, 13, INK, bold=True)
        text(slide, amount, 9.7, y - 0.05, 1.3, 0.35, 19, STEEL_DEEP, bold=True, font=TITLE_FONT)
        text(slide, what, 8.4, y + 0.28, 4.2, 0.22, 9.5, MUTED)
    text(slide, "Design choice: every state on-chain for auditability.", 8.4, 5.1, 4.3, 0.22, 10.5, STEEL, bold=True)
    text(slide, "v2: off-chain listing/mark; fund + settle (4 → 2 txs).", 8.4, 5.36, 4.3, 0.22, 9.5, MUTED, bold=True)
    text(slide, "Gas is paid to the network by each sender; SkinPact takes no fee.", 8.4, 5.68, 4.3, 0.35, 10, INK_SOFT, bold=True)
    text(slide, "Sepolia actually charged 16–19 wei ≈ $0.00000006.", 8.4, 6.15, 4.3, 0.22, 9.5, AMBER, bold=True)
    text(slide, "$35.20 is an L1-like scenario, not the testnet bill.", 8.4, 6.42, 4.3, 0.22, 9.5, AMBER, bold=True)
    footer(slide, 8)
    notes(
        slide,
        "This is the number from the report: 1,173,272 gas times 10 gwei times $3,000/ETH, about $35.20. It is "
        "four transactions, not one fee: the seller pays about $28.94 for createListing and markOfferSent; the "
        "buyer pays about $6.25 for buy and confirmReceipt. Withdraw adds about $1.29. Gas goes to the network, "
        "not to SkinPact: the contract has no fee function. On Sepolia the observed gas price was 16–19 wei, so the "
        "actual testnet bill was around $0.00000006; the $35.20 is a conservative L1 scenario. A pre-Amsterdam "
        "gas schedule, like local Osaka, would put the same flow near $11.24 at 10 gwei. The four-transaction "
        "flow is a deliberate auditability choice: every state transition is on-chain. Production NFT order "
        "books (Seaport, 0x) keep listings off-chain and settle only fulfillment, while centralized CS2 markets "
        "use an internal ledger and Steam bots with no chain gas. A v2 could move listing and mark off-chain and "
        "keep only fund + settlement, about $6.25 plus bond at the same assumptions."
    )

    # ---------------------------------------------------------------- Slide 9
    slide = prs.slides.add_slide(blank)
    header(slide, "08 / E1 · Economics", "Zero platform fee is not zero cost.")
    rect(slide, 0.5, 1.65, 7.45, 5.1, WHITE, LINE)
    picture(slide, ROOT / "experiments" / "e1" / "fee-breakeven.png", 0.62, 1.78, 7.2, 4.8)
    text(slide, "Break-even item price · gas / fee rate", 0.7, 6.78, 5.5, 0.2, 8.5, MUTED, font=MONO_FONT)
    text(slide, "1%", 8.35, 1.78, 1.0, 0.3, 13, GREEN, bold=True, font=TITLE_FONT)
    text(slide, "$3,520", 9.3, 1.68, 3.2, 0.55, 30, GREEN, bold=True, font=TITLE_FONT, align=PP_ALIGN.RIGHT)
    text(slide, "2.5%", 8.35, 2.6, 1.2, 0.3, 13, AMBER, bold=True, font=TITLE_FONT)
    text(slide, "$1,408", 9.3, 2.5, 3.2, 0.55, 30, AMBER, bold=True, font=TITLE_FONT, align=PP_ALIGN.RIGHT)
    text(slide, "5%", 8.35, 3.42, 1.0, 0.3, 13, RED, bold=True, font=TITLE_FONT)
    text(slide, "$704", 9.3, 3.32, 3.2, 0.55, 30, RED, bold=True, font=TITLE_FONT, align=PP_ALIGN.RIGHT)
    text(slide, "At 10 gwei and $3,000/ETH, gas only beats the fee above these item prices.", 8.35, 4.22, 4.3, 0.7, 12, INK_SOFT)
    text(slide, "Cheap skins are uneconomic on L1.", 8.35, 5.05, 4.3, 0.3, 17, STEEL_DEEP, bold=True, font=TITLE_FONT)
    text(slide, "L2 / stablecoin settlement is the next design step; stablecoin alone does not reduce gas.", 8.35, 5.45, 4.3, 0.75, 10.5, MUTED)
    footer(slide, 9)
    notes(
        slide,
        "The happy-path gas is $35.20 at 10 gwei and $3,000/ETH. To beat a 1% fee, the item must be worth more "
        "than about $3,520; at 2.5% the break-even is $1,408; at 5% it is $704. The local Osaka gas schedule is "
        "lower (about $11.24 at 10 gwei), but Sepolia is the observed deployment environment. This is why the "
        "report says zero platform fee is not zero cost and why low-priced CS2 skins would need an L2 or a "
        "stablecoin-based settlement path. A stablecoin changes the unit of account, not the ETH gas price."
    )

    # ---------------------------------------------------------------- Slide 10
    slide = prs.slides.add_slide(blank)
    header(slide, "09 / E2 · Security", "No high-severity code bug — trust still remains.")
    stats = [("67", "automated tests"), ("99", "E2E checks"), ("0", "Slither High/Medium"), ("100%", "line coverage")]
    for i, (number, label_text) in enumerate(stats):
        x = 0.7 + i * 3.12
        rect(slide, x, 1.72, 2.85, 1.18, PAPER, LINE, rounded=True)
        text(slide, number, x + 0.18, 1.84, 1.2, 0.45, 26, STEEL_DEEP, bold=True, font=TITLE_FONT)
        text(slide, label_text, x + 0.18, 2.35, 2.5, 0.22, 9.5, MUTED)
    findings = [
        ("F-01", "Steam delivery cannot be verified on-chain.", "Medium · arbiter reviews off-chain evidence", AMBER),
        ("F-02", "The arbiter is a single immutable EOA.", "Medium · key loss disables disputes", AMBER),
        ("F-03", "Trade URL is a bearer secret the Relay can decrypt.", "High impact / accepted · Relay host trust", RED),
    ]
    for i, (fid, title, sub, color) in enumerate(findings):
        y = 3.35 + i * 0.98
        rect(slide, 0.7, y, 11.95, 0.82, WHITE, LINE, rounded=True)
        rect(slide, 0.7, y, 0.07, 0.82, color, None)
        text(slide, fid, 0.95, y + 0.16, 0.8, 0.22, 11, color, bold=True, font=MONO_FONT)
        text(slide, title, 1.85, y + 0.12, 6.6, 0.26, 12.5, INK, bold=True)
        text(slide, sub, 1.85, y + 0.42, 9.8, 0.22, 9.5, MUTED)
    text(slide, "The residual risk is trust, not a missing check.", 0.7, 6.42, 8.5, 0.3, 15, STEEL_DEEP, bold=True, font=TITLE_FONT)
    footer(slide, 10)
    notes(
        slide,
        "E2 built a 42-scenario threat model and exercised it with 67 automated tests, 99 local E2E checks, "
        "Slither 0.11.6 and coverage. Slither found zero High/Medium findings and five informational results; "
        "coverage is 100% of statements, functions and lines, 87.5% of branches. The code-level result is no "
        "exploitable authorization, reentrancy, double-settlement or Trade URL access-control defect in the "
        "tested scope. The three findings on screen are the honest residual trust: Steam is unverifiable, the "
        "arbiter is a single key, and the Relay can decrypt the buyer's bearer URL."
    )

    # ---------------------------------------------------------------- Slide 11
    slide = prs.slides.add_slide(blank)
    header(slide, "10 / Limits", "What this does not prove.")
    limits = [
        ("Steam is off-chain", "The contract records hashes and observations; it cannot prove delivery."),
        ("One arbiter", "A single immutable EOA decides disputes; key loss or abuse is the trust point."),
        ("Trade URL secret", "The Relay can decrypt it; the buyer must still accept the offer."),
        ("No user study", "E3 was not conducted; usability evidence is manual E2E and a real-Steam exit check."),
    ]
    positions = [(0.7, 1.75), (6.75, 1.75), (0.7, 3.65), (6.75, 3.65)]
    for (title, body), (x, y) in zip(limits, positions):
        rect(slide, x, y, 5.8, 1.62, PAPER, LINE, rounded=True)
        text(slide, title, x + 0.25, y + 0.18, 5.2, 0.28, 14.5, STEEL_DEEP, bold=True, font=TITLE_FONT)
        text(slide, body, x + 0.25, y + 0.56, 5.2, 0.8, 10.8, INK_SOFT, spacing=1.06)
    rect(slide, 0.7, 5.65, 11.95, 0.72, AMBER_SOFT, None, rounded=True)
    text(slide, "Testnet only  ·  test ETH has no value  ·  automated Steam transport is mocked", 0.95, 5.83, 11.4, 0.3, 12.5, AMBER, bold=True)
    footer(slide, 11)
    notes(
        slide,
        "Be explicit about what the project does not claim. Steam delivery is unverifiable on-chain; the arbiter "
        "is a single immutable EOA; the Relay can decrypt the buyer Trade URL; and no formal usability study was "
        "conducted. The automated E2E uses a mocked Steam transport, while the real-Steam acceptance was a manual "
        "exit check. Everything is testnet-only and test ETH has no value. These limitations are in the report and "
        "must also be repeated in the video."
    )

    # ---------------------------------------------------------------- Slide 12
    slide = prs.slides.add_slide(blank)
    header(slide, "11 / Next", "What would make this real.")
    bullets(
        slide,
        [
            ("Compress the flow.", "Move listing/mark off-chain; keep fund + settle (4 → 2 txs), or settle on an L2."),
            ("Harden arbitration.", "Multi-sig or policy-bound arbiter; evidence-read API; documented chain of custody."),
            ("Improve the UX.", "Helper-token revocation, challenge notifications, and a real usability study."),
        ],
        0.7,
        1.85,
        7.3,
        4.2,
        15,
        gap=16,
    )
    text(slide, "Thank you. Questions?", 0.7, 5.55, 6.5, 0.45, 25, STEEL_DEEP, bold=True, font=TITLE_FONT)
    text(slide, "github.com/identity411/dapps", 0.7, 6.1, 6.0, 0.25, 10.5, MUTED, font=MONO_FONT)
    picture(slide, ASSETS / "qr-repo.png", 9.4, 1.75, 1.35, 1.35)
    text(slide, "Repo", 9.42, 3.15, 1.3, 0.2, 8.5, MUTED, font=MONO_FONT, align=PP_ALIGN.CENTER)
    picture(slide, ASSETS / "qr-sepolia.png", 11.15, 1.75, 1.35, 1.35)
    text(slide, "Sepolia", 11.17, 3.15, 1.3, 0.2, 8.5, MUTED, font=MONO_FONT, align=PP_ALIGN.CENTER)
    text(slide, "SkinPact · testnet prototype · 2026-11-07", 9.2, 3.65, 3.3, 0.2, 8, MUTED, font=MONO_FONT)
    footer(slide, 12)
    notes(
        slide,
        "Close with the honest next steps: compress the four-transaction flow to two (off-chain signed listing and "
        "mark; on-chain fund + settle) or move to an L2, which also fixes the low-price economics; a harder "
        "arbitration design (multi-sig or policy-bound, with an evidence API); and UX work including helper-token "
        "revocation, challenge notifications and a real usability study. Repo and verified Sepolia contract are "
        "in the QR codes. Invite questions about the gas experiment, the trust model, or the demo."
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(OUT)
    print(f"Saved {OUT} with {len(prs.slides)} slides")


if __name__ == "__main__":
    build()
