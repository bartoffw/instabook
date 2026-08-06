import * as pdfjsLib from '../scripts/pdf.min.mjs';
import { extractDocument } from '../scripts/pdf-structure.js';
import { buildEpub, paraMarginEm } from '../scripts/epub-writer.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('scripts/pdf.worker.min.mjs');

// Fixed paragraph spacing — the test bench's tunable-thresholds sidebar is
// debug tooling and isn't exposed here; extractDocument() runs with its own
// built-in defaults.
const PARA_SPACING_FACTOR = 1;

const PARA_GAP_FACTOR_KEY = 'instabookPdfParaGapFactor';

const $ = (id) => document.getElementById(id);
let buffer = null, result = null, objectUrls = [], viewerDoc = null, sourceName = '';
let extractionToken = 0, paraGapDebounce = null;

// Manual edits: block deletion, tracked by index into result.blocks.
// Both stacks hold indices — each entry means "this index's deleted state
// was toggled"; undo/redo just replays the toggle without recording it.
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

  sourceName = (entry.filename || '').replace(/\.pdf$/i, '');
  $('status').textContent = `${entry.filename || 'document.pdf'} — parsing…`;

  // Restore the last-used paragraph factor (same Storage helper the popup
  // uses for its settings) before the first extraction runs, so it applies
  // immediately instead of needing a slider nudge.
  const storedParaGapFactor = await Storage.getStoredGlobalValue(PARA_GAP_FACTOR_KEY, +$('para-gap-factor').value);
  $('para-gap-factor').value = storedParaGapFactor;
  $('para-gap-value').textContent = (+storedParaGapFactor).toFixed(2);

  // The stored payload is a plain number array (chrome.storage.local is
  // JSON-serialized, not structured-clone, so a raw ArrayBuffer wouldn't
  // survive the round trip) — reconstitute it into a real ArrayBuffer.
  buffer = new Uint8Array(entry.buffer).buffer;

  await buildViewer(buffer.slice(0));
  await runExtraction();
}

function showError() {
  $('status').textContent = '';
  $('error-content').hidden = false;
  $('preview').hidden = true;
  $('convert-btn').disabled = true;
}

/* ---------------- extraction ---------------- */

// Re-parsing (not just re-rendering) is needed whenever paraGapFactor changes,
// since it drives extractDocument()'s own paragraph-break decisions. Dragging
// the slider can fire faster than a full parse completes, so each run carries
// a token and discards its result if a newer run has since started.
async function runExtraction() {
  const token = ++extractionToken;
  const paraGapFactor = +$('para-gap-factor').value;
  const t0 = performance.now();
  $('convert-btn').disabled = true;
  try {
    // getDocument detaches whatever it's given, so both consumers get a copy.
    const parsed = await extractDocument(buffer.slice(0), { paraGapFactor });
    if (token !== extractionToken) return;   // superseded by a later slider move

    result = parsed;
    // PDF metadata title wins; falling back to "Untitled" when the PDF simply
    // has none is a worse default than the file the user actually picked.
    result.meta.title = result.meta.title || sourceName || 'Untitled';
    deleted = new Set();
    undoStack = [];
    redoStack = [];
    updateHistoryButtons();
    renderParsed();
    const s = result.diagnostics.summary;
    $('status').textContent =
      `${result.diagnostics.pages} pages · ${s.blocks} blocks · ${s.imagesKept}/${s.imageOps} images · ` +
      `${Math.round(performance.now() - t0)} ms`;
    $('convert-btn').disabled = false;
  } catch (err) {
    if (token !== extractionToken) return;
    console.error(err);
    $('status').textContent = `error: ${err.message}`;
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

const TYPE_LABEL = { img: 'image', table: 'table', h1: 'heading', h2: 'heading', h3: 'heading', p: 'paragraph' };

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
      return `<div class="blk" data-page="${b.page}">${delBtn}<figure>
        <img src="${url}" alt=""${dims} style="${style}">
        <figcaption>${b.id} · display ${b.width}×${b.height}pt ·
        intrinsic ${b.naturalWidth}×${b.naturalHeight}px
        ${b.widthPct ? `· ${b.widthPct}%` : '· est.'}</figcaption></figure></div>`;
    }

    if (b.type === 'table') {
      const row = (cells, tag) =>
        `<tr>${cells.map((runs) => `<${tag}>${renderRuns(runs)}</${tag}>`).join('')}</tr>`;
      const body = b.header
        ? `<thead>${row(b.rows[0], 'th')}</thead><tbody>` +
          b.rows.slice(1).map((r) => row(r, 'td')).join('') + `</tbody>`
        : `<tbody>${b.rows.map((r) => row(r, 'td')).join('')}</tbody>`;
      return `<div class="blk" data-page="${b.page}">${delBtn}<table>${body}</table></div>`;
    }

    const inner = renderRuns(b.runs);
    let tag = b.type, close = b.type;
    if (b.type === 'p' && b.indent) {
      tag = `p class="ind" style="margin-left:${b.indent}em"`; close = 'p';
    } else if (b.type === 'p') {
      const em = paraMarginEm(b.gapRatio ?? 1, PARA_SPACING_FACTOR);
      tag = `p style="margin-top:${em}em"`; close = 'p';
    }
    return `<div class="blk" data-page="${b.page}">${delBtn}<${tag}>${inner}</${close}></div>`;
  }).join('');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

window.addEventListener('unload', () => {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
});
