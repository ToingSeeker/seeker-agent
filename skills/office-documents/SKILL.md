---
name: office-documents
description: Create and edit Word (.docx) and Excel (.xlsx) files: reports, letters, templates, and spreadsheets with live formulas and formatting; verify by reopening. Use for "make a Word doc", "edit this docx", "build a spreadsheet", "fix this Excel file", "export to xlsx".
---

# Office Documents (.docx and .xlsx)

## When to use

The user wants a Word document or Excel workbook as the deliverable, or needs an existing one read, edited or repaired. If they only need the data, a CSV or Markdown answer may serve better; ask if unclear.

## Gather first

- Purpose and audience: a template others will reuse, a one-off report, a model people will change inputs in?
- Existing files to start from (a house template preserves styles, headers, numbering and page setup far better than recreating them).
- For spreadsheets: which cells are inputs, which are calculated, currency/locale, and whether the file will be opened in Excel, LibreOffice, or Google Sheets.

## Check the toolbox

Probe: `python3 -c "import docx, openpyxl"` (python-docx, openpyxl), also `pandas`, `xlsxwriter`, and `command -v soffice libreoffice pandoc`. In a Node project, check for packages like `docx` or `exceljs`. Install only with the user's agreement, preferably into a virtual environment.

- python-docx: edit and create .docx with styles, tables, headers, images.
- pandoc: Markdown → .docx quickly, optionally with `--reference-doc` for styling.
- openpyxl: read and write .xlsx including formulas, styles, validation, conditional formats.
- xlsxwriter: write-only, good for new workbooks with charts; cannot edit existing files.
- LibreOffice headless: convert formats and recalculate formulas (`soffice --headless --convert-to`).

## Word procedure

1. Open and inspect: list paragraphs with their style names, tables, sections, headers/footers. Understand the structure before changing it.
2. Use named styles (Heading 1, Normal, a table style) rather than direct formatting, so the document stays consistent and the navigation pane and table of contents work.
3. When editing text, be aware that a visible phrase may be split across several runs. Replace at run level carefully, or rebuild the paragraph while keeping its style, so formatting is not lost.
4. Preserve what you do not touch: comments, tracked changes, fields, numbering. If a library cannot round-trip a feature (some cannot keep complex content controls or embedded objects), say so before saving over the user's file.
5. Tables: set header rows to repeat, keep column widths sensible, avoid nested tables.
6. Save to a new filename unless told to overwrite.

## Excel procedure

1. Inspect every sheet: dimensions, header rows, merged cells, named ranges, existing formulas, data validation. Load once with formulas and once with cached values (openpyxl `data_only=True`) to see both.
2. Keep calculations live. Write `=SUM(B2:B20)` rather than a number computed in Python, so the workbook still works when inputs change. Compute in code only when the user wants a static export.
3. Separate inputs from calculations: clearly marked input cells (often a distinct fill), formulas elsewhere, and no hard-coded constants buried inside formulas. Put assumptions in labelled cells and reference them.
4. Use absolute and relative references deliberately; check that copied formulas point where intended.
5. Apply number formats (currency, percent, dates) instead of rounding values. Freeze header panes and set column widths so it is readable on open.
6. Formulas written by openpyxl have no cached results until a spreadsheet app recalculates. If the values matter (for verification or for viewers that do not recalc), recalculate with headless LibreOffice and read the results back.
7. Check for errors after recalculation: scan all cells for `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#N/A`. Zero errors is the bar unless an error is intentional and labelled.

## Verify by reopening

- Reopen the saved file with the same library and confirm content, styles and formulas are present.
- Where possible, convert to PDF with LibreOffice and render a page to an image to see the layout as a reader would.
- For spreadsheets, test one input change and confirm dependent cells move.

## Pitfalls

- pandas `to_excel` overwrites the whole file and drops formatting; do not use it to edit an existing styled workbook.
- Dates: Excel stores serial numbers; check the 1900/1904 base and timezone assumptions when reading.
- Leading zeros (IDs, postcodes, phone numbers) vanish if written as numbers; write them as text.
- Large merged-cell layouts break sorting and filtering; avoid creating them.
- Macros (.xlsm/.docm) are lost if saved as .xlsx/.docx. Never add macros unasked.

## Deliver

Lead with the file path and what it contains. Report what was verified (reopened, recalculated, zero formula errors, rendered preview) and what was not (for example, appearance in a specific Office version, or features the library could not preserve).
