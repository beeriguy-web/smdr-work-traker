# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repository contains a single self-contained HTML file, `index.html`, implementing an internal work-order form ("טופס הזמנת עבודה פנימית") for שמדר טכנולוגיות בע"מ (Shmadar Technologies Ltd.), an Israeli company. The UI is entirely in Hebrew and right-to-left (`dir="rtl" lang="he"`).

There is no build system, package manager, bundler, or test suite — the entire app is one HTML file with inline `<style>` and `<script>` blocks, loading Bootstrap 5.3.2 (RTL build) from a CDN. There is nothing to install or compile.

## Running / testing changes

- Open `index.html` directly in a browser (or serve it with any static file server, e.g. `python3 -m http.server`) — there is no dev server, no `npm install`, and no test command.
- There is no linter or automated test suite configured. Verify changes manually in a browser: fill out the form, and exercise "PDF" and "שלח במייל" (send email).
- When testing the PDF flow, note that `downloadPDF()` opens a new browser window/tab and calls `window.print()` — popup blockers can suppress this.

## Architecture

Everything lives in `index.html`, organized top to bottom as:

1. **`<style>`** — all CSS, including a `@media print` block that hides interactive chrome (toolbar, buttons, hints) and forces color backgrounds when printing/exporting to PDF.
2. **Markup** — a fixed toolbar, then a single `.form-card` containing the work-order form: meta row (to/from/date), client & site fields, dynamic contacts list, work details, items table, free-text description, and an approval section with an HTML5 canvas signature pad.
3. **`<script>`** — all application logic, in roughly this order:
   - **Signature pad**: mouse/touch drawing on `#sig-canvas`; `getSignatureDataUrl()` returns `null` if the canvas is still blank (compared against a fresh blank canvas) so an empty signature isn't embedded in output.
   - **`CONTACTS_DB`** (index.html:437): a large hardcoded JS object mapping client/company names (Hebrew) to arrays of `{n: name, e: email, p: phone}` contact records. This is the data source for both the client-name and per-contact autocomplete dropdowns (`onClientInput`, `onContactInput`). It is a single very long line — when reading or grepping this file, target specific line ranges or use `Grep` rather than reading the whole file at once.
   - **Multi-contact management**: `formContacts` array (max 5 entries) backs dynamically rendered contact rows (`renderContacts`, `addContact`, `removeContact`); `syncContactsFromDOM`/`collectContacts` read current values back out of the DOM before adding/removing rows or switching client (since inputs are re-rendered via `innerHTML`).
   - **Items table**: `addRow()`/`removeRow()` manage table rows for line items (description, quantity, notes); `collectRows()` reads them back for PDF/email output. Row numbering is recomputed from `tbody.rows.length`.
   - **`newForm()`**: resets all fields to defaults (including re-adding 6 blank item rows and clearing the signature) after a `confirm()` prompt.
   - **`duplicateForm()`/`applyDuplicateIfAny()`**: "צור עותק" (create a copy) in the toolbar. Since there's no backend/storage, duplication works by serializing all current field values (meta, client/site, contacts, item rows, description — signature intentionally excluded) into `localStorage` under `wo_duplicate`, then opening the same page in a new tab via `window.open`. On load, `applyDuplicateIfAny()` (called at the bottom of the script) checks for that key, consumes it (removes it immediately so a manual refresh doesn't reapply it), and repopulates the new tab's form to match.
   - **PDF export** (`buildPdfHTML`, `downloadPDF`): builds a standalone print-friendly HTML document as a string (mirroring the on-screen form's content but with inline styles, since it's rendered in a separate `window.open('', '_blank')` document), writes it via `document.write`, and triggers `window.print()` after a short delay. Note the `sp()` helper replaces regular spaces with non-breaking spaces (` `) in dynamic text — this works around `html2canvas`/print rendering collapsing spaces.
   - **Email export** (`buildEmailBody`, `sendEmail`): builds a plain-text summary and opens a `mailto:` link addressed to `gal@smdrtech.co.il` (the PDF itself is not attached automatically — the mailto body tells the recipient to expect the PDF as a separate manual attachment).
   - **`copyLink()`**: copies the current page URL (stripped of query params) to the clipboard so the blank form can be shared with other employees.

## Key conventions

- Keep all user-facing strings in Hebrew, RTL-correct, and consistent with the existing tone/terminology (e.g. "מספר עבודה", "מועד אספקה").
- Preserve the `PR<number>/@` format for work order numbers (`wnum()`), and `DD/MM/YYYY` formatting for dates (`fmtDate()`), which are used in both the printed PDF and the email subject line.
- When editing the PDF template (`buildPdfHTML`), remember it's a fully separate inline-styled document (not reusing the page's CSS classes) — any style changes made to the on-screen form must be mirrored there manually if they should also appear in the printed/PDF output.
- `CONTACTS_DB` is real customer/contact data (names, phone numbers, emails). Treat edits to it carefully and avoid introducing malformed JSON, since a syntax error there breaks the entire script.
