# SkinPact Deliverables

- `4-SkinPact.pdf` — final 14-page A4 report, generated from the HTML below.
- `4-SkinPact.pptx` — final 12-slide presentation deck (speaker notes included).
- `skinpact-experiment-report.html` — standalone report source; open in a browser and use **Print / Save PDF** (A4).
- `assets/` — report figures and public-source screenshots.

Team-member names, the contribution table, and individual percentages are intentionally
not included in the report or slides. The course submission system collects the 360°
peer evaluation and individual division of labour separately.

## Image and price sources

- **CS2 item images and USD prices**: Steam Community Market search API, app ID 730,
  accessed 2026-11-07. The report samples:
  - Glock-18 | Water Elemental (Field-Tested): $21.79, 258 listings
  - AK-47 | Redline (Field-Tested): $32.13, 1,224 listings
  - AWP | Asiimov (Field-Tested): $127.42, 170 listings
  - M4A1-S | Printstream (Factory New): $479.83, 32 listings
- **Steam Community Market screenshot**: public listing page for AK-47 | Redline
  (Field-Tested), accessed 2026-11-07. The screenshot is the localized HKD view;
  the report's item cards use the USD API values.
- **BUFF163 screenshot**: public official announcement “BUFF手续费下调公告”
  (`https://buff.163.com/news/87397`), accessed 2026-11-07. Seller fee 2.5% → 1.5%;
  withdrawal fee 1%.
- **YouPin898 screenshot**: public market page (`https://www.youpin898.com/market`),
  accessed 2026-11-07. Listings are in CNY; seller fee 1% is cited from SteamDB
  (last verified 2026-07-01).

Screenshots are of public pages and contain no account data. Trademarks remain with
their owners. Prices move; the report uses the source-linked rates and API values,
not OCR from the screenshots.

## Submission checklist

Required upload names for this four-person team:

- `4-SkinPact.pdf` — written report.
- `4-SkinPact.pptx` — presentation slides.
- `4-SkinPact-video.txt` — contains the primary unlisted video URL and a backup URL.
- Code — public repository `https://github.com/identity411/dapps`; commit and push the final docs/code before submitting.

Still to do:

- [ ] Upload the video and create `4-SkinPact-video.txt`.
- [ ] Commit and push the final report, slides, README, and code changes.
- [ ] Verify the repository link opens in an incognito window.
- [ ] Verify every uploaded link opens without a course-account login.

### Regenerate the PDF

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox \
  --no-pdf-header-footer \
  --print-to-pdf="$PWD/reports/4-SkinPact.pdf" \
  "file://$PWD/reports/skinpact-experiment-report.html"
```

Do not submit the HTML as the report, and do not include the old `*-draft.*`
files in the upload.
