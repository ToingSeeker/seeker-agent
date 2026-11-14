---
name: pdf-documents
description: Read, extract text/tables from, merge, split, rotate, fill forms in, and create PDFs (from Markdown, HTML or code) using whatever tools are installed. Use for "extract this PDF", "merge these PDFs", "fill this form", "make a PDF of this report", "convert markdown to PDF".
---

# PDF Documents

## When to use

Any task where a PDF is the input or the output: pulling text or tables out, combining or splitting files, filling form fields, stamping or rotating pages, or producing a polished PDF from Markdown, HTML or generated content.

Not for: editing the original source of a document that also exists as .docx or .xlsx (edit the source, then re-export), or scanning paper (OCR is covered below only as a fallback).

## Gather first

- The exact files and what the user wants out of them (all text? one table? pages 3–7?).
- For output: page size (A4 vs Letter), orientation, fonts, whether links/bookmarks/table of contents matter, and where to save.
- Whether the PDF is sensitive. Keep processing local; do not upload to online converters without asking.

## Check the toolbox before choosing

Probe, do not assume. Run quick checks such as `command -v pdftotext qpdf pdftk mutool pandoc wkhtmltopdf weasyprint gs tesseract`, and `python3 -c "import pypdf"` (also try `pdfplumber`, `fitz` for PyMuPDF, `reportlab`). Look for a headless browser (Chrome/Chromium, or Node with Playwright/Puppeteer already in the project). Pick the lightest tool that does the job; install something new only with the user's agreement, and prefer a project-local or virtual-environment install.

Typical fits:
- Text extraction: `pdftotext -layout`, pdfplumber, or PyMuPDF.
- Tables: pdfplumber's table finder; camelot or tabula if present. Expect to tune.
- Merge/split/rotate/reorder: qpdf, pypdf, or pdftk.
- Forms: pypdf (AcroForm fields) or PyMuPDF widgets.
- Creation from Markdown: pandoc (needs a PDF engine), or Markdown → HTML → headless browser print.
- Creation from HTML: headless Chrome `--print-to-pdf`, Playwright `page.pdf()`, or WeasyPrint.
- Programmatic layout (invoices, labels): reportlab.
- Scanned pages: tesseract or `ocrmypdf` if installed.

## Procedure

### Reading and extracting
1. Inspect first: page count, whether text is selectable (empty extraction usually means a scan), encryption, and whether it has form fields.
2. Extract a small sample (one or two pages) and look at it before processing the whole file. Column layouts, headers and footers, and hyphenation often scramble order.
3. For tables, extract to CSV, then compare a few rows against the rendered page. Fix merged cells and split rows deliberately rather than guessing.
4. If it is a scan, say so, offer OCR, and flag that OCR output needs checking (digits and names especially).

### Merging, splitting, page operations
1. Write outputs to new files; never overwrite the originals unless asked.
2. Confirm page ranges in the user's terms (1-based) and convert carefully for 0-based libraries.
3. After the operation, re-open the output and check page count and order, and spot-check that bookmarks/links survived if they matter.

### Filling forms
1. List the fields with their names, types and allowed values (checkbox "on" values vary per form).
2. Map the user's data to field names explicitly; ask about anything ambiguous rather than guessing.
3. Fill, set the need-appearances flag or regenerate appearances so viewers show the values, and flatten only if asked (flattening is irreversible).
4. Re-read the filled fields from the output to confirm.

### Creating PDFs
1. Get the content right in its source format first (Markdown/HTML). Treat the PDF as a build artefact.
2. Use a print stylesheet for HTML: `@page` size and margins, `page-break-inside: avoid` on tables and figures, and readable body type (rule of thumb: 10–12 pt).
3. Embed or reference fonts that exist on the machine; missing fonts silently fall back. Check characters outside basic Latin (accents, CJK, currency symbols).
4. Make long documents navigable: headings become bookmarks with pandoc or Chrome's outline option; include a table of contents if asked.
5. Render, then verify by extracting text back out and by rendering one or two pages to an image (`pdftoppm -png -r 80`, or PyMuPDF) and viewing them. Look for clipped tables, orphaned headings, blank trailing pages and broken images.

## Pitfalls

- Extraction order is not reading order. Always eyeball a sample.
- Encrypted PDFs: an owner password may block edits even when the file opens. Do not try to break passwords on documents the user does not own.
- Redaction means removing content, not drawing a black box over it. If asked to redact, delete the underlying text and verify by extracting text from the output.
- Large scans balloon in size; compress with Ghostscript or qpdf only if asked, and check legibility afterwards.
- Do not claim a PDF "looks right" without rendering it.

## Deliver

Lead with the output path(s) and a one-line result (e.g. "merged 4 files, 37 pages"). State which tool was used, what you checked (page count, extracted text, rendered page images), and anything you could not verify, such as OCR accuracy or fidelity in a specific viewer.
