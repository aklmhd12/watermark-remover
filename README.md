# Authorized Multi-Brand PDF Watermark Remover

A static GitHub Pages-ready browser application for cleaning watermark text from PDF archives that you own or are authorized to modify.

## Configured owned brands

The current build automatically checks for text/domain watermark patterns associated with:

- `tamilguru.lk`
- `pastpapers.wiki`
- `e-kalvi.com`
- `alevelapi.com`
- `gurupiyasa.guru`

It also includes common supplied phrase variations such as:

- `More Past Papers at tamilguru.lk`
- `Past Papers Wiki`
- `Downloaded from Past Papers Wiki`
- `www.PastPapers.Wiki`
- `www.AlevelAPI.com`
- `www.GuruPiyasa.guru`
- `Sri Lanka Biggest Past Paper Collection`

## Workflow

1. User uploads a PDF.
2. Processing starts automatically.
3. The app scans PDF page content streams for the allowlisted watermark text/domain patterns.
4. Matching PDF text-show operations are removed.
5. The cleaned PDF is scanned again for verification.
6. Download is enabled only when the configured text watermark matches are gone.
7. The original uploaded filename is used for download.

No year/subject/language fields are required.

## What is NOT added

The tool does not add:

- a new watermark;
- a footer;
- a logo;
- a page number;
- Almate branding inside the PDF;
- a renamed filename.

## Quality behavior

Pages are not rasterized. The app edits matching PDF text operations inside the original PDF structure and saves a new PDF with object streams enabled.

This avoids converting the exam paper into screenshots and preserves the original page quality.

## Important limitation: image/baked-in watermarks

This conservative build targets watermark **text that exists as separate PDF text/content-stream operations**.

If a logo or watermark is permanently baked into a scanned page image, removing it requires a different image-restoration method and may affect underlying text or diagrams. This project intentionally does not perform destructive pixel erasing automatically.

If a source uses a separate embedded logo/image XObject, a source-specific signature can be added after testing a real PDF from that source.

## GitHub Pages hosting

1. Create a new public GitHub repository.
2. Extract this ZIP on your phone or computer.
3. Upload the extracted files to the repository root.
4. Commit to `main`.
5. Open **Settings > Pages**.
6. Select **Deploy from a branch**.
7. Select `main` and `/(root)`.
8. Save.

Repository root should look like:

```text
index.html
styles.css
app.js
README.md
404.html
.nojekyll
assets/
  logo.png
```

## Runtime

The app is browser-only and does not require:

- Python;
- PHP;
- Node.js server;
- database;
- API key.

It loads `pdf-lib` 1.17.1 from jsDelivr and processes the uploaded PDF locally in the user's browser.

## Adding another owned brand

Edit the `CONFIG.targets` array near the top of `app.js` and add a new object with:

- a unique `id`;
- a display `label`;
- exact domain/text variants in `terms`;
- optional known custom-font hex signatures in `hexSignatures`.

Use precise domain/branding phrases rather than broad words to reduce false matches.
