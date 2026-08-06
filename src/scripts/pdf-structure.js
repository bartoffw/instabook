/**
 * pdf-structure.js
 *
 * Turns a PDF into an ordered list of semantic blocks suitable for EPUB.
 *
 *   extractDocument(data, opts) -> {
 *     meta:   { title, author, language },
 *     blocks: Block[],
 *     images: Map<string, { blob, mime, width, height }>,
 *     diagnostics: { pages, bodySize, dropped, sizes, imageLog }
 *   }
 *
 * Block =
 *   | { type: 'h1'|'h2'|'h3'|'p', page: number, runs: Run[],
 *       gapRatio?: number }   // 'p' only — vertical gap before it, in
 *                             // multiples of the page's median line gap
 *   | { type: 'img', page: number, id: string, width: number, height: number }
 *   | { type: 'table', page: number, rows: Run[][][], header: boolean }
 *                             // rows[r][c] is cell (r, c)'s runs; empty when
 *                             // that row has nothing in that column
 *
 * Run = { text: string, bold: boolean, italic: boolean }
 *
 * Assumes a born-digital, predominantly single-column PDF.
 */

import * as pdfjsLib from './pdf.min.mjs';

const DEFAULTS = {
  // Fraction of page height at top/bottom treated as running head/foot zone.
  marginBand: 0.07,
  // Text appearing in that zone on at least this share of pages is dropped.
  repeatRatio: 0.25,
  // Vertical gap (in multiples of the running median line gap) that forces
  // a paragraph break.
  paraGapFactor: 0.5,
  // First-line indent (in ems) that signals a new paragraph. Measured against
  // the *current paragraph's* left edge, not the page margin, so an indented
  // block always breaks away from the unindented text above it.
  indentEm: 0.8,
  // A line further left than the current paragraph also ends it — this is a
  // block of indented text returning to the margin.
  splitOnOutdent: true,
  // Preserve the indentation of indented blocks (quotes, nested text) in the
  // output rather than flattening them to the margin.
  blockIndent: true,
  // How far a *single-line* paragraph's body must sit from the margin to
  // count as an indented block. Above a typographic first-line indent
  // (~0.8-1.5em) so ordinary paragraphs aren't treated as quotes. Once a
  // paragraph has wrapped, indentEm is used instead — a wrap that didn't
  // collapse back toward the margin is already good evidence of a real
  // block indent, however small.
  minBlockIndentEm: 2.0,
  // Upper bound past which an offset is no longer a plausible blockquote —
  // it's something like a right-aligned total or caption that happens to
  // sit far from the margin. Rendered as margin-left, an offset like that
  // would push the whole line off the page instead of just failing to
  // preserve its position, so it's worth a generous but real ceiling.
  maxBlockIndentEm: 12,
  // Heading thresholds, relative to the modal body font size.
  h1: 1.55,
  h2: 1.28,
  h3: 1.12,
  // Join consecutive headings of the same level into one — a wrapped title
  // arrives as two lines and would otherwise become two <h1> elements.
  mergeHeadings: true,
  // How far apart two heading lines can sit and still count as one title,
  // in multiples of the page's median line gap.
  headingGapFactor: 1.9,
  // Smallest image kept, in PDF units (~px at 72dpi) on the shorter side.
  minImagePx: 32,
  // Images longer than this ratio are rules/borders, not illustrations.
  maxAspect: 25,
  // Re-encode images whose display aspect ratio differs from their intrinsic
  // one, so the file itself carries the right shape. A barcode stored 277x1
  // and stretched to 208x23pt on the page ships as 277x31 rather than relying
  // on CSS — many EPUB readers ignore aspect-ratio and width/height hints and
  // would draw a 1px sliver.
  rescaleToDisplay: true,
  // How far the two ratios may diverge before rescaling kicks in.
  aspectTolerance: 0.05,
  // Upper bound on either axis after rescaling.
  maxImagePx: 2400,
  // Keep everything the operator list paints, ignoring the two filters above
  // and including stencil masks. The filters still run and their verdict is
  // recorded in diagnostics.imageLog, so you can see what *would* have gone.
  // Set false once you've confirmed extraction works.
  keepAllImages: true,
  // Lines containing this many wide internal gaps are treated as table rows.
  // A single such gap is already a strong signal on its own — ordinary prose
  // essentially never produces one, since pdf.js only reports a large
  // positional jump when the PDF itself explicitly repositioned the text
  // (tab-stop alignment: forms, key/value pairs, tables, TOC leaders) — so 1
  // catches common 2-column "label   value" layouts that 2 would miss.
  tableGaps: 1,
  // Set true to keep 1-bit stencil masks (usually bullets and logos).
  keepMasks: false,

  // --- inline formatting cleanup -----------------------------------
  // Remove the markup artefacts created by stitching lines together:
  // whitespace trapped inside <strong>/<em>, mid-word run fragments from
  // font subsetting, and soft-hyphen / zero-width line-break hints.
  tidyInline: true,
  // Collapse runs of spaces left behind by justified text.
  collapseSpaces: true,
  // Formatted fragments this short are un-formatted, but only when glued
  // mid-word to a neighbour — a standalone italic "x" is left alone.
  minRunChars: 2,
  // Nuclear option: discard all bold/italic and emit plain paragraphs.
  dropInlineFormatting: false,
};

const IDENTITY = [1, 0, 0, 1, 0, 0];

/* ------------------------------------------------------------------ */
/* entry point                                                         */
/* ------------------------------------------------------------------ */

export async function extractDocument(data, userOpts = {}) {
  const opt = { ...DEFAULTS, ...userOpts };
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;

  const meta = await readMeta(doc);
  const images = new Map();
  const imageLog = [];
  const pages = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    pages.push(await readPage(page, n, images, imageLog, opt));
    page.cleanup();
  }

  const bodySize = modalFontSize(pages);
  const drop = findRepeatedRunningText(pages, opt);

  const blocks = [];
  const dropped = [];
  const trace = [];
  const pageStats = [];

  for (const p of pages) {
    for (const l of p.lines) {
      l.dropped = isRunningText(l, p, drop, opt);
      if (l.dropped) dropped.push({ page: p.number, text: l.text });
    }
    const before = blocks.length;
    const stats = { page: p.number, lines: p.lines.length, images: p.images.length };
    blocks.push(...buildBlocks(p.lines, p.images, bodySize, p.number, opt, trace, stats, p.width));
    stats.blocks = blocks.length - before;
    pageStats.push(stats);
  }

  const merge = { hyphenJoins: countHyphenJoins(trace), pageMerges: 0, headingMerges: 0 };
  let merged = mergeAcrossPages(blocks, merge);
  merged = mergeHeadings(merged, opt, merge);
  const tidy = tidyBlocks(merged, opt);
  stripInternal(merged);

  const diagnostics = {
    pages: doc.numPages,
    bodySize,
    dropped,
    sizes: sizeHistogram(pages),
    imageLog,
    trace,
    pageStats,
    tidy,
    summary: summarise(merged, images, imageLog, trace, merge, bodySize),
  };

  return { meta, blocks: merged, images, diagnostics };
}

const countHyphenJoins = (trace) => trace.filter((t) => t.dehyphenated).length;

function summarise(blocks, images, imageLog, trace, merge, bodySize) {
  const byType = {};
  let chars = 0;
  const paraLens = [];
  for (const b of blocks) {
    byType[b.type] = (byType[b.type] || 0) + 1;
    if (b.runs) {
      const n = b.runs.reduce((s, r) => s + r.text.length, 0);
      chars += n;
      if (b.type === 'p') paraLens.push(n);
    }
  }
  const byDecision = {};
  for (const t of trace) byDecision[t.decision] = (byDecision[t.decision] || 0) + 1;

  const byReason = {};
  for (const t of trace) {
    if (t.decision !== 'para:new') continue;
    byReason[t.reason] = (byReason[t.reason] || 0) + 1;
  }

  return {
    bodySize,
    blocks: blocks.length,
    byType,
    byDecision,
    newParagraphReasons: byReason,
    chars,
    medianParagraphChars: Math.round(median(paraLens)),
    shortParagraphs: paraLens.filter((n) => n < 45).length,   // over-splitting signal
    longParagraphs: paraLens.filter((n) => n > 2500).length,  // under-splitting signal
    imagesKept: images.size,
    imageOps: imageLog.length,
    hyphenJoins: merge.hyphenJoins,
    pageBoundaryMerges: merge.pageMerges,
    headingMerges: merge.headingMerges || 0,
  };
}

function sizeHistogram(pages) {
  const hist = new Map();
  for (const p of pages) {
    for (const l of p.lines) {
      const k = Math.round(l.size * 2) / 2;
      const e = hist.get(k) || { size: k, chars: 0, lines: 0, sample: l.text };
      e.chars += l.text.length;
      e.lines += 1;
      hist.set(k, e);
    }
  }
  return [...hist.values()].sort((a, b) => b.size - a.size);
}

/* ------------------------------------------------------------------ */
/* metadata                                                            */
/* ------------------------------------------------------------------ */

// title is left blank when the PDF has none — extractDocument() has no
// notion of a source filename to fall back to, so that decision belongs to
// the caller, not here.
async function readMeta(doc) {
  let info = {};
  try {
    ({ info } = await doc.getMetadata());
  } catch { /* some PDFs have no info dict */ }
  return {
    title: (info.Title || '').trim(),
    author: (info.Author || '').trim() || 'Unknown',
    language: (info.Language || 'en').trim(),
  };
}

/* ------------------------------------------------------------------ */
/* per-page reading: text items -> lines, plus images                  */
/* ------------------------------------------------------------------ */

async function readPage(page, number, imageStore, imageLog, opt) {
  const viewport = page.getViewport({ scale: 1 });
  const height = viewport.height;
  const width = viewport.width;

  // Images first: getOperatorList() forces the worker to resolve fonts into
  // commonObjs, which is what makes bold/italic detection work below.
  const images = await readImages(page, number, imageStore, imageLog, opt);

  const content = await page.getTextContent({ disableNormalization: false });
  const items = [];

  for (const it of content.items) {
    if (it.type === 'beginMarkedContent') continue;
    // pdf.js sometimes represents a gap it judged too wide to fold into the
    // neighbouring run as its own item — str: " " with width set to the
    // *entire* gap — rather than a positional gap between two real items.
    // Dropping it here (not just the empty-string case) means our own gap
    // math sees the real distance between the two items it separates.
    if (!it.str.trim()) continue;
    const t = it.transform;
    const size = Math.hypot(t[2], t[3]) || it.height || 0;
    if (size === 0) continue;

    const style = describeFont(page, it.fontName, content.styles);
    items.push({
      text: it.str,
      x: t[4],
      y: t[5],
      w: it.width,
      size,
      bold: style.bold,
      italic: style.italic,
    });
  }

  const lines = groupIntoLines(items, opt);
  return { number, height, width, lines, images };
}

/**
 * pdf.js exposes the real font (with its PostScript name) via commonObjs
 * once the page has been parsed. That's the only reliable source of
 * bold/italic; textContent.styles often reports a generic family.
 */
function describeFont(page, fontName, styles) {
  let name = '';
  try {
    if (page.commonObjs.has(fontName)) {
      const f = page.commonObjs.get(fontName);
      name = f?.name || f?.loadedName || '';
      if (typeof f?.bold === 'boolean' || typeof f?.italic === 'boolean') {
        return { bold: !!f.bold, italic: !!f.italic };
      }
    }
  } catch { /* not resolved yet */ }
  if (!name) name = styles?.[fontName]?.fontFamily || fontName || '';

  return {
    bold: /bold|black|heavy|semib|demi|[-,_]bd\b/i.test(name),
    italic: /italic|oblique|[-,_]it\b/i.test(name),
  };
}

/** Cluster text items into visual lines by baseline, then sort left-to-right. */
function groupIntoLines(items, opt) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  let cur = null;

  for (const it of sorted) {
    const tol = Math.max(1.5, it.size * 0.45);
    if (cur && Math.abs(cur.y - it.y) <= tol) {
      cur.items.push(it);
      cur.y = (cur.y * (cur.items.length - 1) + it.y) / cur.items.length;
    } else {
      cur = { y: it.y, items: [it] };
      lines.push(cur);
    }
  }

  return lines.map((l) => finishLine(l, opt));
}

function finishLine(line, opt) {
  const items = line.items.sort((a, b) => a.x - b.x);
  const size = median(items.map((i) => i.size));
  // A wide gap is either a space pdf.js didn't emit, or a table column —
  // split there so a run of them can later be read back as table cells.
  const cells = splitIntoCells(items, size);

  const runs = [];
  cells.forEach((c, i) => {
    if (i > 0) appendRun(runs, ' ', last(c.runs)?.bold, last(c.runs)?.italic);
    for (const r of c.runs) appendRun(runs, r.text, r.bold, r.italic);
  });

  const text = runs.map((r) => r.text).join('');
  const tabular = cells.length - 1 >= opt.tableGaps;
  return {
    y: line.y,
    x0: items[0].x,
    x1: items.at(-1).x + items.at(-1).w,
    size,
    runs: trimRuns(runs),
    text: text.trim(),
    tabular,
    // Only kept for tabular lines — buildBlocks reads these back to lay out
    // a table's columns once a run of consecutive tabular lines ends.
    cells: tabular ? cells : undefined,
    allBold: items.every((i) => i.bold),
    // Diagnostics only (trace) — how many raw text items pdf.js reported for
    // this line before any gap-based splitting, and how many cells that
    // split into. A pdf.js version that merges same-line runs internally
    // would show itemCount collapsing toward 1 even when cellCount doesn't.
    itemCount: items.length,
    cellCount: cells.length,
  };
}

/** Break a line's items into column-like chunks wherever a wide gap sits. */
function splitIntoCells(items, size) {
  const cells = [];
  let cur = null;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const prev = items[i - 1];
    const gap = prev ? it.x - (prev.x + prev.w) : Infinity;

    if (gap > size * 1.6) cur = null;
    if (!cur) {
      cur = { x0: it.x, runs: [] };
      cells.push(cur);
    } else if (gap > size * 0.18 && !/\s$/.test(last(cur.runs)?.text ?? '')) {
      appendRun(cur.runs, ' ', prev.bold, prev.italic);
    }
    appendRun(cur.runs, it.text, it.bold, it.italic);
  }

  for (const c of cells) c.runs = trimRuns(c.runs);
  return cells;
}

function appendRun(runs, text, bold, italic) {
  const prev = last(runs);
  if (prev && prev.bold === bold && prev.italic === italic) prev.text += text;
  else runs.push({ text, bold, italic });
}

function trimRuns(runs) {
  const out = runs.map((r) => ({ ...r }));
  if (out.length) out[0].text = out[0].text.replace(/^\s+/, '');
  if (out.length) out.at(-1).text = out.at(-1).text.replace(/\s+$/, '');
  return out.filter((r) => r.text.length);
}

/* ------------------------------------------------------------------ */
/* images                                                              */
/* ------------------------------------------------------------------ */

/**
 * Walks the operator list keeping a full CTM stack, so images drawn inside
 * Form XObjects (very common — anything placed by InDesign or LaTeX's
 * graphicx) get their real on-page size rather than an identity matrix.
 */
async function readImages(page, pageNo, store, log, opt) {
  const OPS = pdfjsLib.OPS;
  const ops = await page.getOperatorList();

  const hits = [];
  let ctm = IDENTITY.slice();
  const stack = [];

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];

    if (fn === OPS.save) {
      stack.push(ctm.slice());
    } else if (fn === OPS.restore) {
      ctm = stack.pop() || IDENTITY.slice();
    } else if (fn === OPS.transform) {
      ctm = matMul(args, ctm);
    } else if (fn === OPS.paintFormXObjectBegin) {
      // args[0] is the form's own matrix — this is the one that was missing.
      stack.push(ctm.slice());
      if (Array.isArray(args[0]) && args[0].length === 6) ctm = matMul(args[0], ctm);
    } else if (fn === OPS.paintFormXObjectEnd) {
      ctm = stack.pop() || IDENTITY.slice();
    } else if (fn === OPS.beginGroup) {
      stack.push(ctm.slice());
    } else if (fn === OPS.endGroup) {
      ctm = stack.pop() || IDENTITY.slice();
    } else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintImageXObjectRepeat ||
      fn === OPS.paintInlineImageXObject ||
      ((opt.keepMasks || opt.keepAllImages) && fn === OPS.paintImageMaskXObject)
    ) {
      // paintImageXObject passes an object id; the inline/mask variants pass
      // the decoded image straight through.
      const a0 = args[0];
      hits.push({
        objId: typeof a0 === 'string' ? a0 : null,
        inline: typeof a0 === 'string' ? null : a0,
        ctm: ctm.slice(),
        y: ctm[5],
      });
    }
  }

  const out = [];
  const seen = new Map();     // objId -> stored image id, avoids re-encoding

  for (const h of hits) {
    const entry = { page: pageNo, objId: h.objId || '(inline)', kept: false, reason: '' };
    try {
      // The CTM scale factors are the on-page size in PDF units (points).
      const sx = Math.hypot(h.ctm[0], h.ctm[1]);
      const sy = Math.hypot(h.ctm[2], h.ctm[3]);
      const usable = sx > 1.01 || sy > 1.01;

      const cacheKey = h.objId && `${h.objId}@${Math.round(sx)}x${Math.round(sy)}`;
      if (cacheKey && seen.has(cacheKey)) {
        const id = seen.get(cacheKey);
        const known = store.get(id);
        const w = usable ? sx : known.width;
        const ht = usable ? sy : known.height;
        out.push({
          id, y: h.y, natW: known.width, natH: known.height,
          dispW: round2(w), dispH: round2(ht), estimated: !usable,
        });
        entry.kept = true;
        entry.reason = 'reused';
        entry.display = `${Math.round(w)}x${Math.round(ht)}`;
        log.push(entry);
        continue;
      }

      const raw = h.inline ?? (await resolveObj(page, h.objId));
      if (!raw) { entry.reason = 'object never resolved'; log.push(entry); continue; }

      const iw = raw.width || raw.bitmap?.width || 0;
      const ih = raw.height || raw.bitmap?.height || 0;
      entry.intrinsic = `${iw}x${ih}`;
      if (!iw || !ih) { entry.reason = 'no dimensions'; log.push(entry); continue; }

      // Fall back to intrinsic pixels when the CTM is still identity, and
      // flag it so downstream code knows the figure isn't a real page size.
      const w = usable ? sx : iw;
      const ht = usable ? sy : ih;
      entry.display = `${Math.round(w)}x${Math.round(ht)}${usable ? '' : ' (intrinsic)'}`;

      // Run the filters either way so the log stays informative, but only
      // act on the verdict when we're not in keep-everything mode.
      let verdict = '';
      if (Math.min(w, ht) < opt.minImagePx) verdict = 'below minImagePx';
      else if (Math.max(w, ht) / Math.max(1, Math.min(w, ht)) > opt.maxAspect) {
        verdict = 'rule/border aspect ratio';
      }
      if (verdict) {
        if (!opt.keepAllImages) { entry.reason = verdict; log.push(entry); continue; }
        entry.reason = `kept anyway (would drop: ${verdict})`;
      }

      const target = displayTarget(iw, ih, w, ht, opt);
      const encoded = await encodeImage(raw, opt, target);
      if (!encoded) { entry.reason = 'could not encode'; log.push(entry); continue; }
      if (encoded.rescaled) {
        entry.reason = (entry.reason ? entry.reason + '; ' : '') +
          `rescaled ${iw}x${ih} -> ${encoded.width}x${encoded.height}`;
      }

      const id = `img_${store.size}`;
      store.set(id, encoded);
      if (cacheKey) seen.set(cacheKey, id);
      out.push({
        id, y: h.y, natW: encoded.width, natH: encoded.height,
        dispW: round2(w), dispH: round2(ht), estimated: !usable,
      });
      entry.kept = true;
      log.push(entry);
    } catch (e) {
      entry.reason = `error: ${e.message}`;
      log.push(entry);
    }
  }
  return out;
}

/**
 * page.objs resolves asynchronously. After getOperatorList() the object is
 * usually already settled, so try the synchronous read before waiting.
 */
function resolveObj(page, objId, timeoutMs = 15000) {
  if (!objId) return Promise.resolve(null);
  const bag = objId.startsWith('g_') ? page.commonObjs : page.objs;

  try {
    if (typeof bag.has === 'function' && bag.has(objId)) {
      return Promise.resolve(bag.get(objId));
    }
  } catch { /* fall through to the async path */ }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      bag.get(objId, (v) => { clearTimeout(timer); finish(v); });
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/**
 * Decides the pixel dimensions to store an image at. Returns null when the
 * intrinsic ratio already matches how the page draws it.
 *
 * The axis with more detail is preserved and the other is derived from the
 * display ratio, so a 277x1 barcode stretched to 208x23pt becomes 277x31 —
 * upsampled vertically, but that's exactly what the PDF renders.
 */
function displayTarget(iw, ih, dispW, dispH, opt) {
  if (!opt.rescaleToDisplay || !dispW || !dispH || !iw || !ih) return null;

  const displayRatio = dispW / dispH;
  const intrinsicRatio = iw / ih;
  if (Math.abs(Math.log(displayRatio / intrinsicRatio)) <= opt.aspectTolerance) return null;

  // Preserve whichever axis carries more detail: derive height from width if
  // that gives at least the intrinsic height, otherwise derive width from
  // height. Compare before rounding, or a 1px axis clamps to itself.
  const heightFromWidth = iw / displayRatio;
  let w, h;
  if (heightFromWidth >= ih) {
    w = iw;
    h = Math.max(1, Math.round(heightFromWidth));
  } else {
    w = Math.max(1, Math.round(ih * displayRatio));
    h = ih;
  }

  const cap = opt.maxImagePx || 2400;
  const over = Math.max(w, h) / cap;
  if (over > 1) { w = Math.max(1, Math.round(w / over)); h = Math.max(1, Math.round(h / over)); }

  return w === iw && h === ih ? null : { w, h };
}

/** pdf.js hands back either an ImageBitmap or raw pixel data. */
async function encodeImage(img, opt = {}, target = null) {
  const width = img.width || img.bitmap?.width;
  const height = img.height || img.bitmap?.height;
  if (!width || !height) return null;

  let canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: false });

  let hasAlpha = false;
  if (img.bitmap) {
    ctx.drawImage(img.bitmap, 0, 0);
  } else if (img.data) {
    const { imageData, alpha } = toImageData(img, width, height);
    if (!imageData) return null;
    ctx.putImageData(imageData, 0, 0);
    hasAlpha = alpha;
  } else {
    return null;
  }

  // Resample onto the display aspect ratio so the stored file needs no CSS
  // help to draw at the right shape.
  let rescaled = false;
  if (target && (target.w !== width || target.h !== height)) {
    const out = new OffscreenCanvas(target.w, target.h);
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(canvas, 0, 0, target.w, target.h);
    canvas = out;
    rescaled = true;
  }

  const mime = hasAlpha ? 'image/png' : 'image/jpeg';
  const blob = await canvas.convertToBlob({ type: mime, quality: 0.82 });
  if (!blob) return null;
  if (blob.size < 64 && !opt.keepAllImages) return null;   // empty/blank tile
  return { blob, mime, width: canvas.width, height: canvas.height, rescaled };
}

function toImageData(img, width, height) {
  const { data } = img;
  const K = pdfjsLib.ImageKind || {};
  const out = new ImageData(width, height);
  const px = out.data;

  // Some producers omit `kind`; infer it from bytes-per-pixel instead.
  const bpp = data.length / (width * height);
  const kind = img.kind ??
    (bpp >= 4 ? K.RGBA_32BPP : bpp >= 3 ? K.RGB_24BPP : bpp >= 1 ? -1 : K.GRAYSCALE_1BPP);

  if (kind === K.RGBA_32BPP) {
    px.set(data.subarray(0, px.length));
    let alpha = false;
    for (let j = 3; j < px.length; j += 4) if (px[j] !== 255) { alpha = true; break; }
    return { imageData: out, alpha };
  }

  if (kind === K.RGB_24BPP) {
    for (let i = 0, j = 0; j < px.length; i += 3, j += 4) {
      px[j] = data[i]; px[j + 1] = data[i + 1]; px[j + 2] = data[i + 2]; px[j + 3] = 255;
    }
    return { imageData: out, alpha: false };
  }

  if (kind === -1) {                       // 8-bit grayscale
    for (let i = 0, j = 0; j < px.length; i++, j += 4) {
      px[j] = px[j + 1] = px[j + 2] = data[i]; px[j + 3] = 255;
    }
    return { imageData: out, alpha: false };
  }

  if (kind === K.GRAYSCALE_1BPP) {
    const rowBytes = (width + 7) >> 3;
    for (let y = 0, j = 0; y < height; y++) {
      for (let x = 0; x < width; x++, j += 4) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = bit ? 0 : 255;           // 1bpp masks are inverted
        px[j] = px[j + 1] = px[j + 2] = v; px[j + 3] = 255;
      }
    }
    return { imageData: out, alpha: false };
  }

  return { imageData: null, alpha: false };
}

function matMul(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

const HEADINGS = new Set(['h1', 'h2', 'h3']);

/**
 * A title that wrapped onto a second line arrives as two headings of the
 * same level. Join them when they sit on the same page, at the same size,
 * one line apart — two headings separated by a real gap stay separate.
 */
function mergeHeadings(blocks, opt, st = {}) {
  if (!opt.mergeHeadings) return blocks;
  const out = [];

  for (const b of blocks) {
    const prev = last(out);
    const joinable =
      prev && HEADINGS.has(b.type) && prev.type === b.type &&
      prev.page === b.page &&
      Number.isFinite(prev._y) && Number.isFinite(b._y) &&
      Math.abs((prev._size ?? 0) - (b._size ?? 0)) < 0.6 &&
      prev._y - b._y > 0 &&
      prev._y - b._y <= (b._lineGap || b._size || 0) * opt.headingGapFactor;

    if (joinable) {
      if (concatRuns(prev.runs, b.runs)) st.headingDehyphenated = (st.headingDehyphenated || 0) + 1;
      prev._y = b._y;
      st.headingMerges = (st.headingMerges || 0) + 1;
      continue;
    }
    out.push(b);
  }
  return out;
}

/** Append one run list onto another, undoing hyphenation at the seam. */
function concatRuns(target, runs) {
  if (!runs.length) return false;
  let dehyphenated = false;
  const prev = last(target);

  if (prev) {
    const m = prev.text.match(/([A-Za-zÀ-ÿ])[-‐­]$/);
    if (m && /[a-zà-ÿ]/.test(runs[0].text[0] || '')) {
      prev.text = prev.text.slice(0, -1);
      dehyphenated = true;
    } else if (!/\s$/.test(prev.text)) {
      prev.text += ' ';
    }
  }
  for (const r of runs) appendRun(target, r.text, r.bold, r.italic);
  return dehyphenated;
}

/** Drop the internal bookkeeping fields before handing blocks to the caller. */
function stripInternal(blocks) {
  for (const b of blocks) for (const k of Object.keys(b)) if (k[0] === '_') delete b[k];
  return blocks;
}

/* ------------------------------------------------------------------ */
/* inline formatting cleanup                                           */
/* ------------------------------------------------------------------ */

// Line-break hints and invisible characters that should never survive into
// reflowable text: soft hyphen, zero-width space/non-joiner/joiner, BOM.
const INVISIBLE = /[\u00AD\u200B\u200C\u200D\uFEFF]/g;
// Hard breaks and separators that a PDF may have embedded mid-paragraph.
const BREAKS = /[\r\n\t\v\f\u2028\u2029]+/g;

function tidyBlocks(blocks, opt) {
  const st = {
    invisibleStripped: 0, breaksFlattened: 0, spacesCollapsed: 0,
    whitespaceLifted: 0, fragmentsCleared: 0, runsMerged: 0, runsBefore: 0, runsAfter: 0,
  };
  if (!opt.tidyInline && !opt.dropInlineFormatting) return { ...st, skipped: true };

  const tidy = (runs) => {
    st.runsBefore += runs.length;
    const out = opt.dropInlineFormatting ? flatten(runs, opt, st) : tidyRuns(runs, opt, st);
    st.runsAfter += out.length;
    return out;
  };

  for (const b of blocks) {
    if (b.type === 'table') {
      b.rows = b.rows.map((row) => row.map(tidy));
      continue;
    }
    if (!b.runs) continue;
    b.runs = tidy(b.runs);
  }
  return st;
}

function scrub(text, opt, st) {
  let t = text;
  const a = t.length; t = t.replace(INVISIBLE, ''); st.invisibleStripped += a - t.length;
  const b = t.length; t = t.replace(BREAKS, ' '); st.breaksFlattened += b - t.length ? 1 : 0;
  t = t.replace(/\u00A0/g, ' ');                       // nbsp from justification
  if (opt.collapseSpaces) {
    const c = t.length; t = t.replace(/ {2,}/g, ' '); st.spacesCollapsed += c - t.length;
  }
  return t;
}

function flatten(runs, opt, st) {
  const text = scrub(runs.map((r) => r.text).join(''), opt, st).trim();
  return text ? [{ text, bold: false, italic: false }] : [];
}

function tidyRuns(runs, opt, st) {
  let out = runs
    .map((r) => ({ ...r, text: scrub(r.text, opt, st) }))
    .filter((r) => r.text.length);

  // A run of pure whitespace carries no meaningful emphasis.
  for (const r of out) if (!r.text.trim()) { r.bold = false; r.italic = false; }

  out = liftWhitespace(out, st);
  clearGluedFragments(out, opt, st);
  absorbInterstitialSpace(out, st);

  // Re-merge neighbours that now agree — this is what turns
  // "<em>word</em> <em>continues</em>" into "<em>word continues</em>".
  const merged = [];
  for (const r of out) {
    const l = last(merged);
    if (l && l.bold === r.bold && l.italic === r.italic) { l.text += r.text; st.runsMerged++; }
    else merged.push({ ...r });
  }

  if (merged.length) {
    merged[0].text = merged[0].text.replace(/^\s+/, '');
    merged.at(-1).text = merged.at(-1).text.replace(/\s+$/, '');
  }
  return merged.filter((r) => r.text.length);
}

/**
 * Whitespace at the edge of an emphasised run is an artefact of where the
 * line happened to break, not intended emphasis. Move it outside the tag.
 */
function liftWhitespace(runs, st) {
  const out = [];
  for (const r of runs) {
    if (!(r.bold || r.italic)) { out.push(r); continue; }
    const [, lead, core, trail] = r.text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (lead) { out.push({ text: lead, bold: false, italic: false }); st.whitespaceLifted++; }
    if (core) out.push({ ...r, text: core });
    if (trail) { out.push({ text: trail, bold: false, italic: false }); st.whitespaceLifted++; }
  }
  return out;
}

/**
 * A space between two identically emphasised runs was a line break, not a
 * gap in the emphasis. Pull it back in so the two halves can re-merge into
 * one tag instead of "<em>word</em> <em>continues</em>".
 */
function absorbInterstitialSpace(runs, st) {
  for (let i = 1; i < runs.length - 1; i++) {
    const r = runs[i], p = runs[i - 1], n = runs[i + 1];
    if (r.text.trim() || r.bold || r.italic) continue;      // not bare whitespace
    if (p.bold !== n.bold || p.italic !== n.italic) continue;
    if (!(p.bold || p.italic)) continue;                    // both plain already
    r.bold = p.bold; r.italic = p.italic;
    st.whitespaceLifted--;                                  // undo the earlier lift
  }
}

/**
 * Font subsetting often flips the weight flag for a character or two in the
 * middle of a word, giving "<strong>w</strong>ord". Only clears fragments
 * glued to a neighbour, so a standalone italic variable stays italic.
 */
function clearGluedFragments(runs, opt, st) {
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i], p = runs[i - 1], n = runs[i + 1];
    if (!(r.bold || r.italic)) continue;
    if (r.text.trim().length > opt.minRunChars) continue;

    const gluedLeft = p && !/\s$/.test(p.text);
    const gluedRight = n && !/^\s/.test(n.text);
    if (!gluedLeft && !gluedRight) continue;             // standalone word

    // Only if the surrounding text disagrees — otherwise it's real emphasis.
    const neighbourFormatted =
      (p && (p.bold || p.italic)) || (n && (n.bold || n.italic));
    if (neighbourFormatted) continue;

    r.bold = false; r.italic = false; st.fragmentsCleared++;
  }
}

/* ------------------------------------------------------------------ */
/* running heads / feet                                                */
/* ------------------------------------------------------------------ */

function findRepeatedRunningText(pages, opt) {
  const seen = new Map();
  for (const p of pages) {
    const band = p.height * opt.marginBand;
    for (const l of p.lines) {
      if (l.y > band && l.y < p.height - band) continue;
      const key = normalise(l.text);
      if (!key) continue;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key).add(p.number);
    }
  }
  const threshold = Math.max(2, pages.length * opt.repeatRatio);
  return new Set(
    [...seen.entries()].filter(([, ps]) => ps.size >= threshold).map(([k]) => k)
  );
}

/** Digits collapse to # so "Page 12" and "Page 13" count as the same head. */
function normalise(s) {
  return s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isRunningText(line, page, drop, opt) {
  const band = page.height * opt.marginBand;
  const inBand = line.y <= band || line.y >= page.height - band;
  if (!inBand) return false;
  if (/^[\s\-–—|]*\d{1,4}[\s\-–—|]*$/.test(line.text)) return true;  // bare page no.
  return drop.has(normalise(line.text));
}

/* ------------------------------------------------------------------ */
/* lines -> blocks                                                     */
/* ------------------------------------------------------------------ */

function modalFontSize(pages) {
  const hist = new Map();
  for (const p of pages) {
    for (const l of p.lines) {
      const k = Math.round(l.size * 2) / 2;
      hist.set(k, (hist.get(k) || 0) + l.text.length);
    }
  }
  let best = 12, bestN = -1;
  for (const [k, n] of hist) if (n > bestN) { best = k; bestN = n; }
  return best;
}

function pageLeftEdge(lines) {
  if (!lines.length) return 0;
  const buckets = new Map();
  for (const l of lines) {
    const k = Math.round(l.x0 / 2) * 2;
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }
  const need = Math.max(2, lines.length * 0.12);
  const common = [...buckets.entries()].filter(([, n]) => n >= need).map(([k]) => k);
  return common.length ? Math.min(...common) : Math.min(...lines.map((l) => l.x0));
}

function buildBlocks(lines, images, bodySize, pageNo, opt, trace = [], stats = {}, pageWidth = 0) {
  const blocks = [];
  const kept = lines.filter((l) => !l.dropped && l.text);

  // Margins and leading are measured per page — a document with varying
  // leading would otherwise fall apart under one global threshold.
  // The page's left edge is the leftmost x0 that recurs often enough to be a
  // margin rather than an outlier. A median would drift rightwards on pages
  // dominated by an indented block.
  const leftMargin = pageLeftEdge(kept);
  const gaps = [];
  for (let i = 1; i < kept.length; i++) gaps.push(kept[i - 1].y - kept[i].y);
  const lineGap = median(gaps.filter((g) => g > 0)) || bodySize * 1.2;

  stats.leftMargin = round2(leftMargin);
  stats.lineGap = round2(lineGap);

  // Width of the text column, used to express image widths as a proportion
  // of the measure rather than as absolute points — EPUB is reflowable, so
  // "this figure filled 60% of the column" survives any screen size.
  const contentWidth = kept.length
    ? Math.max(...kept.map((l) => l.x1)) - Math.min(...kept.map((l) => l.x0))
    : pageWidth * 0.8;
  stats.contentWidth = round2(contentWidth);

  let para = null;
  const flush = () => {
    if (!para) return;
    // The paragraph's left edge is its body lines, not its first line — that
    // way a classic first-line indent resolves to an indent of zero, while a
    // block whose every line is inset keeps its offset.
    const em = (para._bodyX - leftMargin) / bodySize;
    // A single line's offset is ambiguous — it could be a genuine quote or
    // just a typographic first-line indent with nothing yet to compare it
    // to — so it needs to clear the conservative minBlockIndentEm bar. Once
    // a paragraph has wrapped, a first-line indent would already have
    // collapsed _bodyX back toward the margin (see above); an offset that
    // *survived* a wrap is real evidence of a uniformly indented block, so
    // it only needs to clear the smaller per-line indent threshold.
    const threshold = para._lines > 1 ? opt.indentEm : opt.minBlockIndentEm;
    if (opt.blockIndent && em >= threshold && em <= opt.maxBlockIndentEm) {
      para.indent = Math.round(em * 10) / 10;
    }
    blocks.push(para);
    para = null;
  };

  // Consecutive tabular lines accumulate here until something that isn't
  // one of them ends the run, at which point their columns are inferred.
  let table = null;
  const flushTable = () => {
    if (!table) return;
    blocks.push(buildTableBlock(table));
    table = null;
  };

  // Images are placed by vertical position, interleaved with the text flow.
  const pending = [...images].sort((a, b) => b.y - a.y);
  const emitImagesAbove = (y) => {
    while (pending.length && pending[0].y >= y) {
      const im = pending.shift();
      flush();
      flushTable();
      // width/height are the on-page display size in PDF points; widthPct is
      // that as a share of the text column, which is what the EPUB uses.
      const pct = im.estimated || !(contentWidth > 0)
        ? null
        : Math.max(5, Math.min(100, Math.round((im.dispW / contentWidth) * 100)));
      blocks.push({
        type: 'img', page: pageNo, id: im.id,
        width: Math.round(im.dispW), height: Math.round(im.dispH),
        naturalWidth: im.natW, naturalHeight: im.natH,
        widthPct: pct,
      });
      trace.push({
        page: pageNo, y: round2(im.y), decision: 'image', reason: im.id,
        text: `[${Math.round(im.dispW)}x${Math.round(im.dispH)}pt` +
              ` · ${im.natW}x${im.natH}px${pct ? ` · ${pct}%` : ''}]`,
      });
    }
  };

  let prevKept = null;

  for (const l of lines) {
    const rec = {
      page: pageNo,
      y: round2(l.y),
      x0: round2(l.x0),
      size: round2(l.size),
      sizeRatio: round2(l.size / bodySize),
      items: l.itemCount,
      cells: l.cellCount,
      text: l.text.slice(0, 160),
      decision: '',
      reason: '',
    };

    if (l.dropped) {
      rec.decision = 'dropped';
      rec.reason = 'running head/foot';
      trace.push(rec);
      continue;
    }
    if (!l.text) continue;

    emitImagesAbove(l.y);

    const gap = prevKept ? prevKept.y - l.y : 0;
    rec.gap = round2(gap);
    rec.gapRatio = round2(gap / lineGap);
    rec.indentEm = round2((l.x0 - leftMargin) / bodySize);
    rec.bold = l.allBold || undefined;

    const heading = headingLevel(l, bodySize, opt);
    if (heading) {
      flush();
      flushTable();
      blocks.push({
        type: heading, page: pageNo, runs: l.runs,
        _size: l.size, _y: l.y, _lineGap: lineGap,
      });
      rec.decision = `heading:${heading}`;
      rec.reason = l.size / bodySize >= opt.h3
        ? `size ${rec.sizeRatio}x body`
        : 'all-bold short line';
      trace.push(rec);
      prevKept = l;
      continue;
    }

    if (l.tabular) {
      flush();
      if (!table) table = { page: pageNo, rows: [] };
      table.rows.push(l);
      rec.decision = 'table-row';
      rec.reason = `>=${opt.tableGaps} wide column gaps`;
      trace.push(rec);
      prevKept = l;
      continue;
    }
    flushTable();

    // Four independent break signals — record which one actually fired.
    // Indent and outdent are measured against the current paragraph's own
    // left edge, so entering or leaving an indented block always splits.
    const tol = bodySize * opt.indentEm;
    const ref = para ? para._bodyX : leftMargin;
    let reason = '';
    if (!para) reason = 'first line';
    else if (prevKept?.tabular) reason = 'follows table row';
    else if (gap > lineGap * opt.paraGapFactor) reason = `gap ${rec.gapRatio}x lineGap`;
    else if (l.x0 > ref + tol) reason = `indent +${round2((l.x0 - ref) / bodySize)}em`;
    else if (opt.splitOnOutdent && l.x0 < ref - tol) {
      // On a paragraph's second line, moving left is normally just the body
      // catching up after a first-line indent — only a block-sized step back
      // means we've actually left an indented passage.
      const back = (ref - l.x0) / bodySize;
      const limit = para._lines === 1 ? Math.max(opt.indentEm, opt.minBlockIndentEm) : opt.indentEm;
      if (back > limit) reason = `outdent -${round2(back)}em`;
    }
    if (!reason && para && Math.abs(l.size - para.size) > 0.6) reason = 'font size change';

    if (reason) {
      flush();
      // How far this paragraph sits from what precedes it, in multiples of
      // the page's median line gap — carried through to the EPUB so its
      // rendered spacing can reflect the source layout instead of a flat
      // constant. With no real previous line to measure against (page top),
      // there's nothing to measure, so assume an ordinary single-line gap.
      const gapRatio = prevKept ? rec.gapRatio : 1;
      para = { type: 'p', page: pageNo, runs: [], size: l.size, _bodyX: l.x0, _lines: 0, gapRatio };
      rec.decision = 'para:new';
      rec.reason = reason;
    } else {
      rec.decision = 'para:continue';
    }

    rec.dehyphenated = appendLineToParagraph(para, l);
    para._lines++;
    // From the second line on, the leftmost body line defines the edge.
    if (para._lines > 1) para._bodyX = Math.min(para._bodyX, l.x0);
    rec.paraIndentEm = round2((para._bodyX - leftMargin) / bodySize);
    trace.push(rec);
    prevKept = l;
  }

  flush();
  flushTable();
  emitImagesAbove(-Infinity);   // anything below the last line of text
  return blocks.map(({ size, ...b }) => b);
}

/**
 * Turns a run of tabular lines into a table block. Column positions aren't
 * known up front — a row's cells only mark where *that row's* wide gaps
 * were — so columns are inferred by clustering every cell's left edge
 * across all rows and treating each cluster as one column.
 */
function buildTableBlock(table) {
  const allCells = table.rows.flatMap((r) => r.cells);
  const size = median(table.rows.map((r) => r.size)) || 10;
  const colX = clusterColumns(allCells.map((c) => c.x0), size);

  const rows = table.rows.map((r) => {
    const row = colX.map(() => []);
    for (const c of r.cells) {
      const i = nearestColumn(colX, c.x0);
      // Two cells landing in the same column (an overly coarse cluster, or
      // a genuinely merged cell) are joined rather than one overwriting
      // the other.
      row[i] = row[i].length ? [...row[i], { text: ' ' }, ...c.runs] : c.runs;
    }
    return row;
  });

  return {
    type: 'table', page: table.page, rows,
    // A header styled distinctly from its data (all-bold) is common enough
    // in born-digital tables to be worth rendering as <th>.
    header: table.rows[0]?.allBold || false,
  };
}

/** Greedily group nearby x-positions into columns, left to right. */
function clusterColumns(xs, size) {
  const tol = size * 1.5;
  const sorted = [...xs].sort((a, b) => a - b);
  const cols = [];
  for (const x of sorted) {
    if (!cols.length || x - cols.at(-1) > tol) cols.push(x);
  }
  return cols;
}

function nearestColumn(cols, x) {
  let best = 0, bestDist = Infinity;
  cols.forEach((c, i) => {
    const d = Math.abs(c - x);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

function headingLevel(line, bodySize, opt) {
  const ratio = line.size / bodySize;
  const short = line.text.length < 90;
  if (!short) return null;
  if (ratio >= opt.h1) return 'h1';
  if (ratio >= opt.h2) return 'h2';
  if (ratio >= opt.h3) return 'h3';
  // Same size but fully bold and short: treat as a minor heading.
  if (line.allBold && ratio >= 0.98 && line.text.length < 60) return 'h3';
  return null;
}

/** Join a line onto a paragraph, undoing hyphenation at line breaks. */
/** Join a line onto a paragraph, undoing hyphenation at the line break. */
function appendLineToParagraph(para, line) {
  return concatRuns(para.runs, line.runs);
}

/** A paragraph broken by a page boundary should become one paragraph. */
function mergeAcrossPages(blocks, merge = {}) {
  const out = [];
  for (const b of blocks) {
    const prev = last(out);
    if (
      b.type === 'p' && prev?.type === 'p' && prev.page !== b.page &&
      (prev.indent || 0) === (b.indent || 0) &&
      !/[.!?:;»”"']\s*$/.test(text(prev)) &&
      /^[a-zà-ÿ,;)]/.test(text(b))
    ) {
      const p = last(prev.runs);
      if (p && !/\s$/.test(p.text)) p.text += ' ';
      for (const r of b.runs) appendRun(prev.runs, r.text, r.bold, r.italic);
      merge.pageMerges = (merge.pageMerges || 0) + 1;
      continue;
    }
    out.push(b);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const last = (a) => (a && a.length ? a[a.length - 1] : undefined);
const text = (b) => (b.runs || []).map((r) => r.text).join('');

function median(xs) {
  const a = xs.filter(Number.isFinite).sort((p, q) => p - q);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
