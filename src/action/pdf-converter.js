import * as pdfjsLib from '../scripts/pdf.min.mjs';
import { extractDocument } from '../scripts/pdf-structure.js';
import { buildEpub, paraMarginEm } from '../scripts/epub-writer.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('scripts/pdf.worker.min.mjs');

// Fixed paragraph spacing — the test bench's tunable-thresholds sidebar is
// debug tooling and isn't exposed here; extractDocument() runs with its own
// built-in defaults.
const PARA_SPACING_FACTOR = 1;

const PARA_GAP_FACTOR_KEY = 'instabookPdfParaGapFactor';
const COMPOSITE_GAP_PT_KEY = 'instabookPdfCompositeGapPt';

const $ = (id) => document.getElementById(id);
let buffer = null, result = null, objectUrls = [], viewerDoc = null, sourceName = '', fileName = '';
let extractionToken = 0, paraGapDebounce = null, compositeGapDebounce = null, lastError = null, manualImgCounter = 0;

// Manual edits: block deletion, tracked by index into result.blocks.
// Both stacks hold indices — each entry means "this index's deleted state
// was toggled"; undo/redo just replays the toggle without recording it.
//
// Inserting a manually-captured image block (see the region-selection
// section below) shifts every later index by one — insertBlockAt() is the
// only thing allowed to splice into result.blocks, specifically so it can
// keep these two stacks (and `deleted`) in sync with that shift.
let deleted = new Set(), undoStack = [], redoStack = [];

function toggleDeleted(i, record = true) {
  if (deleted.has(i)) deleted.delete(i); else deleted.add(i);
  if (record) { undoStack.push(i); redoStack = []; }
  renderParsed();
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('undo').disabled = !undoStack.length;
  $('redo').disabled = !redoStack.length;
}

$('undo').addEventListener('click', () => {
  if (!undoStack.length) return;
  const i = undoStack.pop();
  toggleDeleted(i, false);
  redoStack.push(i);
  updateHistoryButtons();
});

$('redo').addEventListener('click', () => {
  if (!redoStack.length) return;
  const i = redoStack.pop();
  toggleDeleted(i, false);
  undoStack.push(i);
  updateHistoryButtons();
});

/** Splices a new block in, shifting every tracked index >= idx by one. */
function insertBlockAt(idx, block) {
  result.blocks.splice(idx, 0, block);
  const bump = (i) => (i >= idx ? i + 1 : i);
  deleted = new Set([...deleted].map(bump));
  undoStack = undoStack.map(bump);
  redoStack = redoStack.map(bump);
}

/**
 * Where a new block at vertical position y0 (PDF points, page-relative,
 * larger = higher up — see pdf-structure.js's Block doc comment) belongs
 * among pageNo's existing blocks: right before the first one that's either
 * on a later page, or on the same page but already below y0. Falls back to
 * "end of pageNo's blocks" when y0 is unknown or nothing on the page has a
 * position to compare against.
 */
function pageInsertIndex(pageNo, y0) {
  const blocks = result.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.page > pageNo) return i;
    if (b.page === pageNo && Number.isFinite(y0) && Number.isFinite(b.y0) && b.y0 < y0) return i;
  }
  return blocks.length;
}

const rectsOverlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.yBottom < b.yTop && a.yTop > b.yBottom;

/** Every block (any type) carries x0/y0/width/height — see pdf-structure.js's Block doc comment. */
function blockRect(b) {
  if (![b.x0, b.y0, b.width, b.height].every(Number.isFinite)) return null;
  return { x0: b.x0, x1: b.x0 + b.width, yTop: b.y0, yBottom: b.y0 - b.height };
}

/* ---------------- entry point: pull the PDF handed off by the popup --- */

init();

async function init() {
  const key = new URLSearchParams(location.search).get('key');
  if (!key) { showError(); return; }

  let entry;
  try {
    const stored = await browser.storage.local.get(key);
    entry = stored[key];
    await browser.storage.local.remove(key);
  } catch (err) {
    console.error(err);
  }

  if (!entry || !entry.buffer) { showError(); return; }

  fileName = entry.filename || '';
  sourceName = fileName.replace(/\.pdf$/i, '');
  $('status').textContent = `${entry.filename || 'document.pdf'} — parsing…`;
  updateFeedbackLink();

  // Restore the last-used paragraph factor (same Storage helper the popup
  // uses for its settings) before the first extraction runs, so it applies
  // immediately instead of needing a slider nudge.
  const storedParaGapFactor = await Storage.getStoredGlobalValue(PARA_GAP_FACTOR_KEY, +$('para-gap-factor').value);
  $('para-gap-factor').value = storedParaGapFactor;
  $('para-gap-value').textContent = (+storedParaGapFactor).toFixed(2);

  const storedCompositeGapPt = await Storage.getStoredGlobalValue(COMPOSITE_GAP_PT_KEY, +$('composite-gap-factor').value);
  $('composite-gap-factor').value = storedCompositeGapPt;
  $('composite-gap-value').textContent = `${(+storedCompositeGapPt).toFixed(0)}pt`;

  // The stored payload is a plain number array (chrome.storage.local is
  // JSON-serialized, not structured-clone, so a raw ArrayBuffer wouldn't
  // survive the round trip) — reconstitute it into a real ArrayBuffer.
  buffer = new Uint8Array(entry.buffer).buffer;

  await buildViewer(buffer.slice(0));
  $('select-region-btn').disabled = false;
  await runExtraction();
}

function showError() {
  $('status').textContent = '';
  $('error-content').hidden = false;
  $('preview').hidden = true;
  $('convert-btn').disabled = true;
  updateFeedbackLink();
}

/* ---------------- extraction ---------------- */

// Re-parsing (not just re-rendering) is needed whenever paraGapFactor changes,
// since it drives extractDocument()'s own paragraph-break decisions. Dragging
// the slider can fire faster than a full parse completes, so each run carries
// a token and discards its result if a newer run has since started.
async function runExtraction() {
  const token = ++extractionToken;
  const paraGapFactor = +$('para-gap-factor').value;
  const detectCompositeImages = $('composite-detect').checked;
  const compositeClusterGapPt = +$('composite-gap-factor').value;
  const t0 = performance.now();
  $('convert-btn').disabled = true;

  // Manually-captured region screenshots (see the region-selection section
  // below) aren't part of the PDF parse — extractDocument() knows nothing
  // about them, so a re-parse would otherwise silently drop them.
  const manualBlocks = result ? result.blocks.filter((b) => b.manual) : [];
  const manualImages = result ? manualBlocks.map((b) => [b.id, result.images.get(b.id)]) : [];

  try {
    // getDocument detaches whatever it's given, so both consumers get a copy.
    const parsed = await extractDocument(buffer.slice(0), { paraGapFactor, detectCompositeImages, compositeClusterGapPt });
    if (token !== extractionToken) return;   // superseded by a later slider move

    result = parsed;
    lastError = null;
    // PDF metadata title wins; falling back to "Untitled" when the PDF simply
    // has none is a worse default than the file the user actually picked.
    result.meta.title = result.meta.title || sourceName || 'Untitled';
    deleted = new Set();
    undoStack = [];
    redoStack = [];

    for (const [id, img] of manualImages) if (img) result.images.set(id, img);
    for (const b of manualBlocks) insertBlockAt(pageInsertIndex(b.page, b.y0), b);

    updateHistoryButtons();
    renderParsed();
    const s = result.diagnostics.summary;
    const flagged = result.blocks.filter((b) => b.confidence === 'low').length;
    $('status').textContent =
      `${result.diagnostics.pages} pages · ${s.blocks} blocks · ${s.imagesKept}/${s.imageOps} images · ` +
      `${Math.round(performance.now() - t0)} ms` +
      (flagged ? ` · ⚠ ${flagged} flagged for review` : '');
    $('convert-btn').disabled = false;
    $('diag-btn').disabled = false;
    if (!$('diag-overlay').hidden) renderDiagnostics();
    updateFeedbackLink();
  } catch (err) {
    if (token !== extractionToken) return;
    console.error(err);
    $('status').textContent = `error: ${err.message}`;
    lastError = err;
    updateFeedbackLink();
  }
}

$('para-gap-factor').addEventListener('input', (e) => {
  const value = +e.target.value;
  $('para-gap-value').textContent = value.toFixed(2);
  // Debounced so a full re-parse (and the storage write) only happens once
  // the user pauses, not on every pixel of drag — extraction is cheap but
  // not instant on big PDFs.
  clearTimeout(paraGapDebounce);
  paraGapDebounce = setTimeout(() => {
    Storage.storeGlobalValue(PARA_GAP_FACTOR_KEY, value);
    if (buffer) runExtraction();
  }, 250);
});

$('composite-detect').addEventListener('change', (e) => {
  $('composite-gap-factor').disabled = !e.target.checked;
  $('composite-gap-label').classList.toggle('disabled', !e.target.checked);
  if (buffer) runExtraction();
});
$('composite-gap-factor').disabled = !$('composite-detect').checked;
$('composite-gap-label').classList.toggle('disabled', !$('composite-detect').checked);

$('composite-gap-factor').addEventListener('input', (e) => {
  const value = +e.target.value;
  $('composite-gap-value').textContent = `${value}pt`;
  // Debounced the same way as the paragraph-factor slider — a full re-parse
  // shouldn't fire on every pixel of drag.
  clearTimeout(compositeGapDebounce);
  compositeGapDebounce = setTimeout(() => {
    Storage.storeGlobalValue(COMPOSITE_GAP_PT_KEY, value);
    if (buffer) runExtraction();
  }, 250);
});

$('convert-btn').addEventListener('click', async () => {
  if (!result) return;
  btnLoading(true);
  try {
    const blocks = result.blocks.filter((_, i) => !deleted.has(i));
    const blob = await buildEpub({ ...result, blocks }, { paraSpacingFactor: PARA_SPACING_FACTOR });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (sourceName || result.meta.title || 'book').replace(/[^\w\-]+/g, '_') + '.epub';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (err) {
    console.error(err);
    $('status').textContent = `error: ${err.message}`;
    lastError = err;
    updateFeedbackLink();
  }
  btnLoading(false);
});

function btnLoading(isLoading) {
  $('convert-spinner').classList.toggle('visually-hidden', !isLoading);
  $('convert-btn').disabled = isLoading;
}

/* ---------------- PDF viewer pane ---------------- */

// root: null tracks intersection against the browser viewport regardless of
// which ancestor (#page-body, here) actually owns the scrolling.
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) renderPdfPage(e.target);
}, { root: null, rootMargin: '600px 0px' });

async function buildViewer(data) {
  if (viewerDoc) { try { await viewerDoc.destroy(); } catch {} viewerDoc = null; }
  $('pdfpane').innerHTML = '';

  viewerDoc = await pdfjsLib.getDocument({ data }).promise;
  const vp1 = (await viewerDoc.getPage(1)).getViewport({ scale: 1 });
  $('pdfinfo').textContent = `${viewerDoc.numPages} pages · ` +
    `${Math.round(vp1.width)}×${Math.round(vp1.height)}pt`;

  const frag = document.createDocumentFragment();
  for (let n = 1; n <= viewerDoc.numPages; n++) {
    const d = document.createElement('div');
    d.className = 'pdfpage';
    d.dataset.page = n;
    d.style.aspectRatio = `${vp1.width} / ${vp1.height}`;   // placeholder height
    d.innerHTML = `<span class="pno">${n}</span>`;
    frag.appendChild(d);
    io.observe(d);
  }
  $('pdfpane').appendChild(frag);
}

async function renderPdfPage(div) {
  if (div.dataset.rendered) return;
  div.dataset.rendered = '1';
  const n = +div.dataset.page;
  try {
    const page = await viewerDoc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const cssWidth = div.clientWidth || 400;
    const vp = page.getViewport({ scale: cssWidth / base.width });
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    div.style.aspectRatio = `${vp.width} / ${vp.height}`;

    await page.render({
      canvasContext: canvas.getContext('2d'),
      viewport: vp,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    }).promise;

    div.querySelector('canvas')?.remove();
    div.appendChild(canvas);
    page.cleanup();
  } catch (e) {
    div.dataset.rendered = '';
    console.warn('page render failed', n, e);
  }
}

$('toggleside').addEventListener('click', () => {
  const single = $('preview').classList.toggle('single');
  $('toggleside').textContent = single ? 'show PDF' : 'hide PDF';
});

/* ---------------- manual "flatten to image" region selection ---------------- */
// For charts/diagrams the automatic extractor mangles (composed of many
// small vector paths or overlapping images), this lets the user drag a
// rectangle over the original PDF page and drop in one flattened screenshot
// of that region instead — same rendering pipeline pdf.js already uses for
// the preview pane, just at a higher resolution and cropped to the selection.

let selecting = null;       // in-progress drag: { pageDiv, pageNo, startX, startY, rectEl, last }
let pendingCapture = null;  // finished drag awaiting Add/Cancel: { pageDiv, pageNo, fx0..fy1, rectEl, toolbarEl }

$('select-region-btn').addEventListener('click', () => {
  const active = $('select-region-btn').classList.toggle('active');
  $('pdfpane').classList.toggle('selecting', active);
  if (!active) cancelSelection();
});

$('pdfpane').addEventListener('mousedown', (e) => {
  if (e.target.closest('.select-confirm')) return;   // let the Add/Cancel buttons handle their own click
  if (!$('select-region-btn').classList.contains('active')) return;
  const pageDiv = e.target.closest('.pdfpage');
  if (!pageDiv || !pageDiv.querySelector('canvas')) return;
  cancelSelection();   // starting a new drag discards any pending confirm
  e.preventDefault();

  const box = pageDiv.getBoundingClientRect();
  const startX = clamp(e.clientX - box.left, 0, pageDiv.clientWidth);
  const startY = clamp(e.clientY - box.top, 0, pageDiv.clientHeight);
  const rectEl = document.createElement('div');
  rectEl.className = 'select-rect';
  pageDiv.appendChild(rectEl);
  selecting = { pageDiv, pageNo: +pageDiv.dataset.page, startX, startY, rectEl, last: null };
  updateSelectRect(startX, startY);
});

document.addEventListener('mousemove', (e) => {
  if (!selecting) return;
  const box = selecting.pageDiv.getBoundingClientRect();
  const x = clamp(e.clientX - box.left, 0, selecting.pageDiv.clientWidth);
  const y = clamp(e.clientY - box.top, 0, selecting.pageDiv.clientHeight);
  updateSelectRect(x, y);
});

document.addEventListener('mouseup', () => {
  if (selecting) finishSelectDrag();
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function updateSelectRect(curX, curY) {
  const { startX, startY, rectEl } = selecting;
  const x = Math.min(startX, curX), y = Math.min(startY, curY);
  const w = Math.abs(curX - startX), h = Math.abs(curY - startY);
  rectEl.style.left = `${x}px`;
  rectEl.style.top = `${y}px`;
  rectEl.style.width = `${w}px`;
  rectEl.style.height = `${h}px`;
  selecting.last = { x, y, w, h };
}

function finishSelectDrag() {
  const { pageDiv, pageNo, rectEl, last } = selecting;
  selecting = null;

  if (!last || last.w < 12 || last.h < 12) {
    rectEl.remove();
    return;
  }

  const toolbarEl = document.createElement('div');
  toolbarEl.className = 'select-confirm';
  toolbarEl.style.left = `${last.x + last.w}px`;
  toolbarEl.style.top = `${last.y + last.h}px`;
  toolbarEl.innerHTML =
    '<button type="button" class="btn btn-primary btn-sm" data-act="add">Add as image</button>' +
    '<button type="button" class="btn btn-default btn-sm" data-act="cancel">Cancel</button>';
  pageDiv.appendChild(toolbarEl);

  pendingCapture = {
    pageDiv, pageNo, rectEl, toolbarEl,
    fx0: last.x / pageDiv.clientWidth,
    fy0: last.y / pageDiv.clientHeight,
    fx1: (last.x + last.w) / pageDiv.clientWidth,
    fy1: (last.y + last.h) / pageDiv.clientHeight,
  };
  toolbarEl.querySelector('[data-act="cancel"]').addEventListener('click', cancelSelection);
  toolbarEl.querySelector('[data-act="add"]').addEventListener('click', confirmSelection);
}

function cancelSelection() {
  if (selecting) { selecting.rectEl.remove(); selecting = null; }
  if (pendingCapture) {
    pendingCapture.rectEl.remove();
    pendingCapture.toolbarEl.remove();
    pendingCapture = null;
  }
}

async function confirmSelection() {
  const cap = pendingCapture;
  if (!cap) return;
  cap.toolbarEl.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  cap.toolbarEl.querySelector('[data-act="add"]').textContent = 'Capturing…';

  try {
    const shot = await captureRegion(cap.pageNo, cap.fx0, cap.fy0, cap.fx1, cap.fy1);
    const id = `manual_${++manualImgCounter}`;
    result.images.set(id, { blob: shot.blob, mime: shot.mime, width: shot.width, height: shot.height });

    // Same rectangle as what got rendered, in the page's own PDF-point space
    // (y flips here: fy0/fy1 are top-down canvas fractions, PDF points are
    // bottom-up) — used both to place the new block among its neighbours and
    // to find every existing block (image, stray text, whatever) it covers.
    const selRect = {
      x0: shot.x0Pt, x1: shot.x0Pt + shot.widthPt,
      yTop: shot.yTopPt, yBottom: shot.yTopPt - shot.heightPt,
    };

    // Anything already on this page whose box the selection overlaps —
    // scattered chart fragments, axis-label text, the lot — is superseded
    // by the screenshot, so it's soft-deleted the same way the × button
    // would (reversible via Undo/restore if this over-reaches on real text
    // that merely brushes the edge of the selection).
    let replaced = 0;
    result.blocks.forEach((b, i) => {
      if (b.manual || b.page !== cap.pageNo || deleted.has(i)) return;
      const blkRect = blockRect(b);
      if (!blkRect || !rectsOverlap(selRect, blkRect)) return;
      deleted.add(i);
      undoStack.push(i);
      replaced++;
    });
    if (replaced) redoStack = [];

    insertBlockAt(pageInsertIndex(cap.pageNo, selRect.yTop), {
      type: 'img', page: cap.pageNo, x0: selRect.x0, y0: selRect.yTop,
      width: Math.round(shot.widthPt), height: Math.round(shot.heightPt),
      naturalWidth: shot.width, naturalHeight: shot.height,
      widthPct: Math.max(10, Math.min(100, Math.round((shot.widthPt / shot.pageWidthPt) * 100))),
      manual: true, id,
    });
    renderParsed();
    updateHistoryButtons();
    $('status').textContent = replaced
      ? `Added the captured region and replaced ${replaced} overlapping block${replaced > 1 ? 's' : ''}.`
      : 'Added the captured region.';
  } catch (err) {
    console.error(err);
    $('status').textContent = `error capturing region: ${err.message}`;
  }

  cap.rectEl.remove();
  cap.toolbarEl.remove();
  pendingCapture = null;
}

/**
 * Renders the whole page at a resolution scaled to the selection (small
 * selections still come out legible, huge ones don't balloon into an
 * enormous file) and crops out just the selected fraction — simpler and
 * more robust than trying to clip pdf.js's own render to a sub-rectangle.
 * Always PNG: these are typically small, text/line-heavy regions (charts,
 * diagrams) where JPEG artifacting would blur exactly the detail this
 * feature exists to preserve.
 */
async function captureRegion(pageNo, fx0, fy0, fx1, fy1) {
  const page = await viewerDoc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const widthPt = (fx1 - fx0) * base.width;
  const heightPt = (fy1 - fy0) * base.height;

  const targetPx = 1400;
  const renderScale = Math.min(4, Math.max(1.5, targetPx / Math.max(1, widthPt)));
  const vp = page.getViewport({ scale: renderScale });

  const full = new OffscreenCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  await page.render({ canvasContext: full.getContext('2d'), viewport: vp }).promise;
  page.cleanup();

  const sx = Math.round(fx0 * vp.width), sy = Math.round(fy0 * vp.height);
  const sw = Math.max(1, Math.round((fx1 - fx0) * vp.width));
  const sh = Math.max(1, Math.round((fy1 - fy0) * vp.height));

  const crop = new OffscreenCanvas(sw, sh);
  crop.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);

  const blob = await crop.convertToBlob({ type: 'image/png' });
  return {
    blob, mime: 'image/png', width: sw, height: sh, widthPt, heightPt, pageWidthPt: base.width,
    x0Pt: fx0 * base.width, yTopPt: base.height * (1 - fy0),
  };
}

// Click a parsed block to bring its source page into view; click its ×/↺
// to delete or restore it instead (takes precedence over the page jump).
$('parsed').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) { toggleDeleted(+del.dataset.del); return; }

  const blk = e.target.closest('[data-page]');
  if (!blk) return;
  const target = $('pdfpane').querySelector(`.pdfpage[data-page="${blk.dataset.page}"]`);
  if (!target) return;
  $('pdfpane').querySelectorAll('.pdfpage.current').forEach((d) => d.classList.remove('current'));
  target.classList.add('current');
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---------------- parsed-output rendering ---------------- */

function renderRuns(runs) {
  return runs.map((r) => {
    let t = esc(r.text);
    if (r.italic) t = `<em>${t}</em>`;
    if (r.bold) t = `<strong>${t}</strong>`;
    return t;
  }).join('');
}

const TYPE_LABEL = {
  img: 'image', table: 'table', h1: 'heading', h2: 'heading', h3: 'heading', p: 'paragraph', list: 'list',
};

function renderParsed() {
  // Every call rebuilds the whole list (including <img> tags), so the
  // previous batch of object URLs must be revoked first or they leak on
  // every delete/undo/redo click.
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = [];

  $('parsed').innerHTML = result.blocks.map((b, i) => {
    if (deleted.has(i)) {
      return `<div class="blk deleted" data-page="${b.page}">` +
        `<button class="del" data-del="${i}" title="Restore">↺ restore ${esc(TYPE_LABEL[b.type] || b.type)}</button></div>`;
    }
    const delBtn = `<button class="del" data-del="${i}" title="Delete">×</button>`;
    // Low-confidence blocks (borderline heading/indent threshold, single-row
    // table, guessed image size, one-item list — see pdf-structure.js) get a
    // dashed outline and a hover badge explaining why, so review attention
    // goes where the parser itself was least sure.
    const flagCls = b.confidence === 'low' ? ' flagged' : '';
    const flagBadge = b.confidence === 'low'
      ? `<span class="flag" title="${esc(b.confidenceReason || 'Low-confidence — worth checking')}">⚠</span>`
      : '';

    if (b.type === 'img') {
      const img = result.images.get(b.id);
      if (!img) return '';
      const url = URL.createObjectURL(img.blob);
      objectUrls.push(url);
      // Width AND height come from the display size: a stretched source
      // (e.g. 277x1 shown at 208x23) must not fall back to its own ratio.
      const pxW = Math.round(b.width * 4 / 3), pxH = Math.round(b.height * 4 / 3);
      const dims = pxW && pxH ? ` width="${pxW}" height="${pxH}"` : '';
      const style = [pxW && pxH ? `aspect-ratio:${pxW}/${pxH}` : '',
                     b.widthPct ? `width:${b.widthPct}%` : ''].filter(Boolean).join(';');
      const caption = b.caption ? `<figcaption class="real-caption">${renderRuns(b.caption)}</figcaption>` : '';
      return `<div class="blk${flagCls}" data-page="${b.page}">${delBtn}${flagBadge}<figure>
        <img src="${url}" alt=""${dims} style="${style}">
        ${caption}
        <figcaption>${b.id} · display ${b.width}×${b.height}pt ·
        intrinsic ${b.naturalWidth}×${b.naturalHeight}px
        ${b.widthPct ? `· ${b.widthPct}%` : '· est.'}
        ${b.composite ? `· merged from ${b.mergedCount} fragments` : ''}</figcaption></figure></div>`;
    }

    if (b.type === 'table') {
      const row = (cells, tag) =>
        `<tr>${cells.map((runs) => `<${tag}>${renderRuns(runs)}</${tag}>`).join('')}</tr>`;
      const caption = b.caption ? `<caption>${renderRuns(b.caption)}</caption>` : '';
      const body = b.header
        ? `<thead>${row(b.rows[0], 'th')}</thead><tbody>` +
          b.rows.slice(1).map((r) => row(r, 'td')).join('') + `</tbody>`
        : `<tbody>${b.rows.map((r) => row(r, 'td')).join('')}</tbody>`;
      return `<div class="blk${flagCls}" data-page="${b.page}">${delBtn}${flagBadge}<table>${caption}${body}</table></div>`;
    }

    if (b.type === 'list') {
      const tag = b.ordered ? 'ol' : 'ul';
      const items = b.items.map((runs) => `<li>${renderRuns(runs)}</li>`).join('');
      return `<div class="blk${flagCls}" data-page="${b.page}">${delBtn}${flagBadge}<${tag}>${items}</${tag}></div>`;
    }

    const inner = renderRuns(b.runs);
    let tag = b.type, close = b.type;
    if (b.type === 'p' && b.indent) {
      tag = `p class="ind" style="margin-left:${b.indent}em"`; close = 'p';
    } else if (b.type === 'p') {
      const em = paraMarginEm(b.gapRatio ?? 1, PARA_SPACING_FACTOR);
      tag = `p style="margin-top:${em}em"`; close = 'p';
    }
    return `<div class="blk${flagCls}" data-page="${b.page}">${delBtn}${flagBadge}<${tag}>${inner}</${close}></div>`;
  }).join('');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

window.addEventListener('unload', () => {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
});

/* ---------------- diagnostics overlay ---------------- */
// Surfaces extractDocument()'s diagnostics (per-line trace, per-page stats,
// image log, dropped running heads/feet) so it's possible to see *why* the
// parser made a given call without opening devtools.

$('diag-btn').addEventListener('click', () => {
  if (!result) return;
  renderDiagnostics();
  $('diag-overlay').hidden = false;
});
$('diag-close').addEventListener('click', closeDiagnostics);
$('diag-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'diag-overlay') closeDiagnostics();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('diag-overlay').hidden) closeDiagnostics();
});
document.querySelectorAll('.diag-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diag-tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.diag-view').forEach((v) => { v.hidden = v.id !== `diag-${btn.dataset.tab}`; });
  });
});
$('diag-page').addEventListener('change', renderDiagTrace);
$('diag-filter').addEventListener('change', renderDiagTrace);

function closeDiagnostics() {
  $('diag-overlay').hidden = true;
}

function renderDiagnostics() {
  const d = result.diagnostics;
  const s = d.summary;
  $('diag-summary-line').textContent =
    `${d.pages} pages · body size ${d.bodySize}pt · ${s.blocks} blocks ` +
    `(${Object.entries(s.byType).map(([t, n]) => `${n} ${t}`).join(', ')}) · ` +
    `${s.chars} chars · median paragraph ${s.medianParagraphChars} chars · ` +
    `${s.hyphenJoins} hyphen joins · ${s.pageBoundaryMerges} page-boundary merges · ` +
    `${s.headingMerges} heading merges · ${s.captionsFound} captions matched · ` +
    `${s.compositesFormed} composite figures formed · ${s.flagged} flagged for review`;

  renderDiagPageSelect();
  renderDiagFilterSelect();
  renderDiagTrace();
  renderDiagPages();
  renderDiagImages();
  renderDiagDropped();
}

function renderDiagPageSelect() {
  const sel = $('diag-page');
  const prev = sel.value;
  const pages = result.diagnostics.pageStats.map((p) => p.page);
  sel.innerHTML = pages.map((p) => `<option value="${p}">page ${p}</option>`).join('');
  sel.value = pages.includes(+prev) ? prev : String(pages[0] ?? 1);
}

function renderDiagFilterSelect() {
  const sel = $('diag-filter');
  const prev = sel.value;
  const decisions = [...new Set(result.diagnostics.trace.map((t) => t.decision))].sort();
  sel.innerHTML = '<option value="">All decisions</option>' +
    decisions.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
  sel.value = decisions.includes(prev) ? prev : '';
}

function renderDiagTrace() {
  const page = +$('diag-page').value || 1;
  const filter = $('diag-filter').value;
  const rows = result.diagnostics.trace.filter((t) => t.page === page && (!filter || t.decision === filter));
  const stats = result.diagnostics.pageStats.find((p) => p.page === page);
  $('diag-page-info').textContent = stats
    ? `${stats.columns > 1 ? `${stats.columns} columns · ` : ''}${stats.lines} lines · ${stats.images} images · ` +
      `${stats.blocks} blocks · margin ${stats.leftMargin}pt · line gap ${stats.lineGap}pt · width ${stats.contentWidth}pt`
    : '';

  $('diag-rows').innerHTML = rows.map((t) => `
    <tr data-decision="${esc(t.decision)}">
      <td>${t.y}</td>
      <td>${t.x0}</td>
      <td>${t.size}</td>
      <td>${esc(t.col ?? '')}</td>
      <td class="decision">${esc(t.decision)}</td>
      <td>${esc(t.reason || '')}</td>
      <td>${esc(t.text || '')}</td>
    </tr>`).join('');
}

function renderDiagPages() {
  $('diag-pages-rows').innerHTML = result.diagnostics.pageStats.map((p) => `
    <tr>
      <td>${p.page}</td>
      <td>${p.columns || 1}</td>
      <td>${p.lines}</td>
      <td>${p.images}</td>
      <td>${p.blocks}</td>
      <td>${p.leftMargin}</td>
      <td>${p.lineGap}</td>
      <td>${p.contentWidth}</td>
    </tr>`).join('');
}

function renderDiagImages() {
  $('diag-images-rows').innerHTML = result.diagnostics.imageLog.map((im) => `
    <tr>
      <td>${im.page}</td>
      <td>${im.kept ? '✓' : '—'}</td>
      <td>${esc(im.display || im.intrinsic || '')}</td>
      <td>${esc(im.reason || '')}</td>
    </tr>`).join('');
}

function renderDiagDropped() {
  $('diag-dropped-rows').innerHTML = result.diagnostics.dropped.map((d) => `
    <tr><td>${d.page}</td><td>${esc(d.text)}</td></tr>`).join('');
}

/* ---------------- feedback link ---------------- */
// Keeps the "report on GitHub" link's pre-filled issue in sync with what
// we actually know at any given point — just the filename before parsing,
// full diagnostics once extraction succeeds, or the error if it didn't.
// GitHub's new-issue endpoint only takes title/body/labels as query
// params — there's no way to attach the PDF itself through a link (and no
// way to reach it anyway, since the file lives only in this tab, never
// uploaded anywhere) — so the body just leaves a spot to drag it in once
// the user is on the issue page.
const GITHUB_ISSUE_URL = 'https://github.com/bartoffw/instabook/issues/new';

function buildFeedbackBody() {
  const lines = [
    'Describe what went wrong with this PDF (replace this line):',
    '',
    '<-- drag & drop the PDF file here, if you\'re able to share it -->',
    '',
    '--- debug info ---',
    `Extension version: ${browser.runtime.getManifest().version}`,
    `File: ${fileName || sourceName || '(unknown)'}`,
  ];

  if (lastError) {
    lines.push(`Error: ${lastError.message || lastError}`);
  } else if (result) {
    const d = result.diagnostics, s = d.summary;
    const multiCol = d.pageStats.filter((p) => p.columns > 1).length;
    lines.push(
      `Pages: ${d.pages}`,
      `Body font size: ${d.bodySize}pt`,
      `Blocks: ${s.blocks} (${Object.entries(s.byType).map(([t, n]) => `${n} ${t}`).join(', ')})`,
      `Images kept: ${s.imagesKept}/${s.imageOps} · composite figures formed: ${s.compositesFormed}`,
      `Multi-column pages: ${multiCol}/${d.pageStats.length}`,
      `Hyphen joins: ${s.hyphenJoins} · page-boundary merges: ${s.pageBoundaryMerges} · heading merges: ${s.headingMerges}`,
      `Captions matched: ${s.captionsFound} · flagged for review: ${s.flagged}`,
    );
  }

  return lines.join('\n');
}

function updateFeedbackLink() {
  const params = new URLSearchParams({
    labels: 'bug',
    title: `[${browser.runtime.getManifest().version}] PDF conversion issue` + (sourceName ? `: ${sourceName}` : ''),
    body: buildFeedbackBody(),
  });
  $('feedback-link').href = `${GITHUB_ISSUE_URL}?${params.toString()}`;
}

updateFeedbackLink();
