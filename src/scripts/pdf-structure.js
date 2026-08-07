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
 *   | { type: 'img', page: number, id: string, caption?: Run[],
 *       composite?: true, mergedCount?: number }
 *                             // composite/mergedCount mark an image that's
 *                             // actually a flattened screenshot standing in
 *                             // for that many originally-separate, tightly
 *                             // clustered small images — see
 *                             // flattenCompositeImages()
 *   | { type: 'table', page: number, rows: Run[][][], header: boolean,
 *       caption?: Run[] }
 *                             // rows[r][c] is cell (r, c)'s runs; empty when
 *                             // that row has nothing in that column
 *   | { type: 'list', page: number, ordered: boolean, items: Run[][] }
 *                             // items[i] is list item i's runs
 *
 * Every block above also carries a bounding box on its own page — x0, y0,
 * width, height, all in PDF points, page-relative (origin bottom-left, same
 * as the PDF's own coordinate space; y0 is the *top* edge, and larger y0
 * means higher up the page, so the box spans y0 down to y0 - height). For
 * text blocks (h1/h2/h3/p/list) this is the tight box around every line
 * that ended up in the block, not a per-glyph measurement — close enough
 * for overlap testing, not for typesetting. It exists so a caller (the
 * review UI's manual "flatten to image" tool) can place a new block among
 * its page's existing ones and tell which ones an arbitrary rectangle
 * overlaps — it is not used by extractDocument() itself.
 *
 * Every block above may also carry `confidence: 'low'` plus a human-readable
 * `confidenceReason` when the classification that produced it was borderline
 * (a heading right at the size threshold, a blockquote right at the indent
 * threshold, a single-row table, an image whose on-page size had to be
 * guessed, a list with only one detected item) — a hint for the review UI to
 * point the user at, not a hard signal.
 *
 * Run = { text: string, bold: boolean, italic: boolean }
 *
 * Assumes a born-digital PDF. Per-page column detection (see detectColumns)
 * handles single- and 2-column layouts, reading the left column fully
 * before the right one; 3+ column layouts aren't detected and fall back to
 * being read as one wide column.
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

  // --- multi-column reading order ------------------------------------
  // Detect a 2-column layout per page (academic papers, magazines) and
  // read the whole left column before the right one, instead of the raw
  // left-to-right stream order that garbles interleaved columns.
  multiColumn: true,
  // Minimum number of text items on a page before column detection even
  // runs — too few items to say anything meaningful about a gutter.
  minColumnItems: 40,
  // Minimum gutter width, in multiples of the page's own median glyph
  // size, to count as a real column gap rather than ordinary word/sentence
  // spacing or a ragged paragraph edge.
  columnGapEm: 1.6,
  // Share of the page's total characters allowed to cross the candidate
  // gutter before it's rejected — tolerates a handful of full-width
  // titles/rules crossing an otherwise real column boundary.
  columnGutterToleranceFrac: 0.02,
  // Each side of a candidate gutter must hold at least this share of the
  // page's characters, or a stray marginal note could look like a column.
  minColumnContentFrac: 0.15,

  // --- lists -----------------------------------------------------------
  // Recognise a leading bullet/number marker on a new paragraph's first
  // line and emit a real <ul>/<ol> instead of a plain paragraph.
  detectLists: true,

  // --- captions ----------------------------------------------------------
  // Fold a short "Figure N: ..." / "Table N: ..." paragraph immediately
  // before or after an image/table into that block's caption, instead of
  // leaving it as an unrelated paragraph next to it.
  detectCaptions: true,
  // A candidate caption longer than this many characters is treated as an
  // ordinary paragraph that just happens to start with "Figure"/"Table" —
  // real captions are normally a sentence or two.
  maxCaptionChars: 220,

  // --- composite image detection ----------------------------------------
  // Charts/diagrams built from many small embedded images (bar segments,
  // icons, sprite pieces) otherwise survive as that many disconnected <img>
  // blocks with no visual relationship in the EPUB. When a page has a tight
  // cluster of them, render just that cluster's combined area as one flat
  // screenshot instead — same idea as the review UI's manual region-capture
  // tool, just automatic. Deliberately mild: it only ever acts on clusters
  // of *already-extracted small images*, never on text or on vector
  // line-art directly, so the failure mode is "a chart still comes out as
  // pieces" rather than "a caption got swallowed into a screenshot."
  detectCompositeImages: true,
  // Fewer than this many images in a cluster is left alone — two adjacent
  // but unrelated images (e.g. two photos placed side by side) is a common,
  // entirely legitimate layout and shouldn't get fused. Only enforced at the
  // shipped default gap; past that, the user has explicitly turned up
  // aggressiveness, so a plain adjacent pair is allowed to merge too — see
  // flattenCompositeImages().
  compositeMinImages: 3,
  // Images within this many PDF points of each other's box are considered
  // part of the same cluster. Exposed in the review UI as a "grouping
  // aggressiveness" slider — raise it when a chart's fragments are spaced
  // out enough that they're being left as separate images; lower it if
  // unrelated images that merely happen to sit near each other are getting
  // fused together.
  compositeClusterGapPt: 20,
  // Margin added around a cluster's combined box before rendering, so thin
  // connecting strokes (axis lines, borders) just outside the images' own
  // boxes aren't cut off at the edge. The union of the *images'* own boxes
  // is otherwise all the crop rectangle is built from — axis lines, tick
  // labels, legends and borders are usually drawn as vector graphics or
  // text, not raster images, so they sit outside that union entirely and
  // this margin is what keeps them in frame. flattenCompositeImages() scales
  // this up further at higher compositeClusterGapPt, since a wider gap
  // tolerance implies the surrounding decoration is likely spaced out too.
  compositeMarginPt: 4,
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
      if (l.kind === 'img') continue;
      l.dropped = isRunningText(l, p, drop, opt);
      if (l.dropped) dropped.push({ page: p.number, text: l.text });
    }
    const before = blocks.length;
    const stats = {
      page: p.number,
      lines: p.lines.filter((l) => l.kind !== 'img').length,
      images: p.lines.filter((l) => l.kind === 'img').length,
    };
    blocks.push(...buildBlocks(p.lines, bodySize, p.number, opt, trace, stats, p.width));
    stats.blocks = blocks.length - before;
    pageStats.push(stats);
  }

  const merge = { hyphenJoins: countHyphenJoins(trace), pageMerges: 0, headingMerges: 0 };
  let merged = mergeAcrossPages(blocks, merge);
  merged = mergeHeadings(merged, opt, merge);
  merged = mergeLists(merged, opt, merge);
  merged = associateCaptions(merged, opt, merge);
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
    compositesFormed: blocks.filter((b) => b.composite).length,
    hyphenJoins: merge.hyphenJoins,
    pageBoundaryMerges: merge.pageMerges,
    headingMerges: merge.headingMerges || 0,
    listsFound: byType.list || 0,
    captionsFound: merge.captionsFound || 0,
    flagged: blocks.filter((b) => b.confidence === 'low').length,
  };
}

function sizeHistogram(pages) {
  const hist = new Map();
  for (const p of pages) {
    for (const l of p.lines) {
      if (l.kind === 'img') continue;
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
  let images = await readImages(page, number, imageStore, imageLog, opt);
  if (opt.detectCompositeImages) {
    images = await flattenCompositeImages(page, number, images, imageStore, imageLog, opt);
  }
  // Composite figures grown by growRegionToContent() may have pulled in
  // real text (axis labels, captions) as pixels inside the screenshot —
  // drop the matching text items below so they don't also appear as a
  // separate, redundant block right next to the figure.
  const claimBoxes = images.filter((im) => im.claimBox).map((im) => im.claimBox);
  const insideClaim = (x, y) => claimBoxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.yBottom && y <= b.yTop);

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
    if (claimBoxes.length && insideClaim(t[4], t[5])) continue;

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

  // Column detection runs on the raw items, before any line-clustering —
  // two columns sharing a baseline would otherwise get fused into one
  // garbled row before we ever got the chance to tell them apart.
  const cols = detectColumns(items, opt);
  const entries = groupIntoLines(items, images, opt, cols);
  return { number, height, width, lines: entries };
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

/* ------------------------------------------------------------------ */
/* multi-column reading order                                          */
/* ------------------------------------------------------------------ */

/**
 * Looks for a persistent vertical gutter splitting the page's text into two
 * side-by-side columns (academic papers, magazines, newsletters). Detection
 * runs on raw item spans, not lines — a coincidental shared baseline between
 * the two columns would otherwise fuse them into one row before there's any
 * chance to tell them apart (PDF generators lay out each column's text
 * separately, so an individual item's own span essentially never straddles
 * a real gutter, unlike a *line* built by naively clustering same-baseline
 * items from both columns together).
 *
 * A candidate gutter must be wide (>= columnGapEm of the page's own type
 * size — well past ordinary word/sentence spacing), must have real content
 * on both sides (>= minColumnContentFrac of the page's characters each),
 * and only a small share of characters (columnGutterToleranceFrac) may
 * cross it — a handful of full-width titles or rules crossing through
 * don't disqualify an otherwise real column gutter.
 *
 * Returns null for a single-column (or undetectable) page.
 */
function detectColumns(items, opt) {
  if (!opt.multiColumn || items.length < opt.minColumnItems) return null;

  const size = median(items.map((i) => i.size)) || 10;
  const minGutter = size * opt.columnGapEm;

  const left = Math.min(...items.map((i) => i.x));
  const right = Math.max(...items.map((i) => i.x + i.w));
  const contentWidth = right - left;
  if (contentWidth < minGutter * 4) return null;

  const totalChars = items.reduce((s, i) => s + i.text.length, 0);
  if (!totalChars) return null;

  const spans = items.map((i) => [i.x, i.x + i.w, i.text.length]).sort((a, b) => a[0] - b[0]);

  const scanFrom = left + contentWidth * 0.2;
  const scanTo = right - contentWidth * 0.2 - minGutter;
  const step = Math.max(2, minGutter / 6);

  let best = null;
  for (let gx0 = scanFrom; gx0 <= scanTo; gx0 += step) {
    const gx1 = gx0 + minGutter;
    let intruding = 0, leftChars = 0, rightChars = 0;
    for (const [x0, x1, len] of spans) {
      if (x1 <= gx0) leftChars += len;
      else if (x0 >= gx1) rightChars += len;
      else intruding += len;
    }
    if (intruding / totalChars > opt.columnGutterToleranceFrac) continue;
    const leftFrac = leftChars / totalChars, rightFrac = rightChars / totalChars;
    if (leftFrac < opt.minColumnContentFrac || rightFrac < opt.minColumnContentFrac) continue;

    const balance = Math.min(leftFrac, rightFrac);
    if (!best || balance > best.balance) best = { gx0, gx1, balance };
  }

  return best ? { x0: best.gx0, x1: best.gx1 } : null;
}

/** Which side of the gutter a span sits on ('span' = crosses it). */
function classifyColumn(x0, x1, cols) {
  if (!cols) return 'L';
  if (x1 <= cols.x0) return 'L';
  if (x0 >= cols.x1) return 'R';
  return 'span';
}

/** Cluster one column's items into visual rows by baseline. */
function clusterRows(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  let cur = null;

  for (const it of sorted) {
    const tol = Math.max(1.5, it.size * 0.45);
    if (cur && Math.abs(cur.y - it.y) <= tol) {
      cur.items.push(it);
      cur.y = (cur.y * (cur.items.length - 1) + it.y) / cur.items.length;
    } else {
      cur = { y: it.y, items: [it] };
      rows.push(cur);
    }
  }
  return rows;
}

/**
 * Interleaves left-column, right-column and full-width rows (text or image
 * markers, anything with a `.y`) back into one reading-order sequence: every
 * row sitting above a given full-width row is read left column top-to-bottom
 * then right column top-to-bottom, the full-width row is read, and so on
 * down the page. Whatever remains below the last full-width row (or the
 * whole page, if there wasn't one) is flushed the same way at the end.
 */
function mergeColumnRows(leftRows, rightRows, spanRows) {
  const byY = (a, b) => b.y - a.y;
  leftRows.sort(byY); rightRows.sort(byY); spanRows.sort(byY);

  const out = [];
  let li = 0, ri = 0;
  for (const s of spanRows) {
    while (li < leftRows.length && leftRows[li].y >= s.y) out.push(leftRows[li++]);
    while (ri < rightRows.length && rightRows[ri].y >= s.y) out.push(rightRows[ri++]);
    out.push(s);
  }
  while (li < leftRows.length) out.push(leftRows[li++]);
  while (ri < rightRows.length) out.push(rightRows[ri++]);
  return out;
}

/**
 * Clusters raw text items into visual lines and, when `cols` says the page
 * is multi-column, reorders them (and the page's images) into left-column-
 * then-right-column reading order. Returns one flat, already-ordered array
 * mixing finished line objects (`kind: 'text'`) and image markers
 * (`kind: 'img'`) — buildBlocks walks it directly with no further y-sorting.
 */
function groupIntoLines(items, images, opt, cols) {
  const imgRow = (img) => ({ y: img.y, kind: 'img', img, col: classifyColumn(img.x, img.x + (img.dispW || 0), cols) });

  if (!cols) {
    const rows = clusterRows(items).map((r) => finishLine({ ...r, col: 'L' }, opt));
    const imgs = images.map(imgRow);
    return [...rows, ...imgs].sort((a, b) => b.y - a.y);
  }

  const left = [], right = [], span = [];
  for (const it of items) {
    const cls = classifyColumn(it.x, it.x + it.w, cols);
    (cls === 'L' ? left : cls === 'R' ? right : span).push(it);
  }

  const leftRows = clusterRows(left).map((r) => finishLine({ ...r, col: 'L' }, opt));
  const rightRows = clusterRows(right).map((r) => finishLine({ ...r, col: 'R' }, opt));
  const spanRows = clusterRows(span).map((r) => finishLine({ ...r, col: 'span' }, opt));

  for (const img of images) {
    const row = imgRow(img);
    (row.col === 'L' ? leftRows : row.col === 'R' ? rightRows : spanRows).push(row);
  }

  return mergeColumnRows(leftRows, rightRows, spanRows);
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
    kind: 'text',
    col: line.col,
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
        x: ctm[4],
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
          id, y: h.y, x: h.x, natW: known.width, natH: known.height,
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
        id, y: h.y, x: h.x, natW: encoded.width, natH: encoded.height,
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

/* ------------------------------------------------------------------ */
/* composite image detection                                           */
/* ------------------------------------------------------------------ */

/**
 * Greedy proximity clustering: two images join the same cluster when their
 * boxes are within `gapPt` of each other (already-overlapping counts too).
 * O(n^2) box comparisons, fine at per-page image counts.
 */
function clusterImageBoxes(images, gapPt) {
  const boxes = images.map((im) => ({
    im, x0: im.x, x1: im.x + im.dispW, yTop: im.y, yBottom: im.y - im.dispH,
  }));
  const parent = boxes.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const near = (a, b) =>
    a.x0 - gapPt < b.x1 && a.x1 + gapPt > b.x0 &&
    a.yBottom - gapPt < b.yTop && a.yTop + gapPt > b.yBottom;

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (near(boxes[i], boxes[j])) union(i, j);
    }
  }

  const groups = new Map();
  boxes.forEach((box, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(box);
  });
  return [...groups.values()];
}

/**
 * Renders just one rectangle of the page — the same idea as the review UI's
 * manual region-capture tool (render the whole page at a resolution scaled
 * to the target size, then crop), just triggered automatically instead of
 * by a user drag. PNG, not JPEG: these are exactly the sharp-line/text
 * regions JPEG artifacting would blur.
 */
async function renderPageRegion(page, x0, yBottom, x1, yTop) {
  const widthPt = Math.max(1, x1 - x0);

  const targetPx = 1400;
  const renderScale = Math.min(4, Math.max(1.5, targetPx / widthPt));
  const vp = page.getViewport({ scale: renderScale });

  const full = new OffscreenCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  await page.render({ canvasContext: full.getContext('2d'), viewport: vp }).promise;

  // convertToViewportPoint (not a plain x/pageWidth fraction) because it
  // accounts for the page's own crop box origin and rotation — a PDF whose
  // CropBox is narrower than its MediaBox (common in web-page-to-PDF
  // exports, which often trim side margins) has a nonzero horizontal
  // origin that a naive fraction silently ignores, shifting/cropping the
  // capture along just that axis.
  const [cx0, cyTop] = vp.convertToViewportPoint(x0, yTop);
  const [cx1, cyBottom] = vp.convertToViewportPoint(x1, yBottom);

  const sx = Math.round(Math.min(cx0, cx1)), sy = Math.round(Math.min(cyTop, cyBottom));
  const sw = Math.max(1, Math.round(Math.abs(cx1 - cx0)));
  const sh = Math.max(1, Math.round(Math.abs(cyBottom - cyTop)));

  const crop = new OffscreenCanvas(sw, sh);
  crop.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);

  const blob = await crop.convertToBlob({ type: 'image/png' });
  return { blob, mime: 'image/png', width: sw, height: sh };
}

/**
 * Renders a generous area around a raster-image cluster's box, then trims
 * it back down to the actual visual content by scanning rendered pixels
 * outward from the known box in all four directions, treating near-white as
 * background. A run of background short enough to plausibly be normal
 * letter/axis spacing doesn't stop the growth — it bridges through and
 * keeps looking — so a chart's axis lines, tick labels, curve, legend, or a
 * photo's decorative frame/border all get pulled in too, even though none
 * of them are raster images the clustering step above ever sees. This is
 * why it works on pixels instead of trying to parse PDF path/text geometry:
 * it doesn't need to know what kind of object drew the ink, only that it's
 * there. The bridging tolerance and the outer search radius both scale with
 * compositeClusterGapPt, so the same "aggressiveness" slider that controls
 * raster-fragment clustering also controls how far this is willing to
 * reach — and the search radius is a hard cap either way, so a very high
 * tolerance still can't run away into unrelated content far down the page.
 */
async function growRegionToContent(page, x0, yBottom, x1, yTop, opt) {
  const pageViewport = page.getViewport({ scale: 1 });
  const pageWidth = pageViewport.width;
  const pageHeight = pageViewport.height;

  const searchPt = Math.max(80, opt.compositeClusterGapPt * 4);
  const sx0 = Math.max(0, x0 - searchPt);
  const sx1 = Math.min(pageWidth, x1 + searchPt);
  const syTop = Math.min(pageHeight, yTop + searchPt);
  const syBottom = Math.max(0, yBottom - searchPt);

  const widthPt = Math.max(1, sx1 - sx0);
  const targetPx = 1800;
  const renderScale = Math.min(4, Math.max(1.5, targetPx / widthPt));
  const vp = page.getViewport({ scale: renderScale });

  const full = new OffscreenCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx2d = full.getContext('2d', { willReadFrequently: true });
  await page.render({ canvasContext: ctx2d, viewport: vp }).promise;

  const [rx0, ryTop] = vp.convertToViewportPoint(sx0, syTop);
  const [rx1, ryBottom] = vp.convertToViewportPoint(sx1, syBottom);
  const [bx0, byTop] = vp.convertToViewportPoint(x0, yTop);
  const [bx1, byBottom] = vp.convertToViewportPoint(x1, yBottom);

  const left = Math.max(0, Math.round(Math.min(rx0, rx1)));
  const right = Math.min(full.width, Math.round(Math.max(rx0, rx1)));
  const top = Math.max(0, Math.round(Math.min(ryTop, ryBottom)));
  const bottom = Math.min(full.height, Math.round(Math.max(ryTop, ryBottom)));
  const regionW = right - left, regionH = bottom - top;
  if (regionW < 2 || regionH < 2) return renderPageRegion(page, x0, yBottom, x1, yTop);

  const data = ctx2d.getImageData(left, top, regionW, regionH).data;
  // Near-white counts as background; anything else (ink, fills, photos) doesn't.
  const isBackground = (px, py) => {
    const i = (py * regionW + px) * 4;
    const a = data[i + 3];
    return a < 8 || (data[i] > 246 && data[i + 1] > 246 && data[i + 2] > 246);
  };
  const rowHasInk = (py, xFrom, xTo) => {
    const from = Math.max(0, xFrom), to = Math.min(regionW, xTo);
    for (let px = from; px < to; px++) if (!isBackground(px, py)) return true;
    return false;
  };
  const colHasInk = (px, yFrom, yTo) => {
    const from = Math.max(0, yFrom), to = Math.min(regionH, yTo);
    for (let py = from; py < to; py++) if (!isBackground(px, py)) return true;
    return false;
  };

  let bl = Math.round(Math.min(bx0, bx1)) - left, br = Math.round(Math.max(bx0, bx1)) - left;
  let bt = Math.round(Math.min(byTop, byBottom)) - top, bb = Math.round(Math.max(byTop, byBottom)) - top;
  bl = Math.max(0, Math.min(bl, regionW)); br = Math.max(0, Math.min(br, regionW));
  bt = Math.max(0, Math.min(bt, regionH)); bb = Math.max(0, Math.min(bb, regionH));

  const tolerancePx = Math.max(4, Math.round((opt.compositeClusterGapPt / 2) * renderScale));
  // Walks outward from `start` in steps of `dir` (-1 or +1), extending
  // `edge` to the last position where `test` found ink, and giving up once
  // a run of `tolerancePx` consecutive blank positions is crossed without
  // finding more.
  const growDir = (test, start, dir, limit) => {
    let edge = start, blankRun = 0;
    for (let p = start + dir; dir > 0 ? p < limit : p >= limit; p += dir) {
      if (test(p)) {
        blankRun++;
        if (blankRun > tolerancePx) break;
      } else {
        edge = p;
        blankRun = 0;
      }
    }
    return edge;
  };

  bt = growDir((py) => !rowHasInk(py, bl, br), bt, -1, 0);
  bb = growDir((py) => !rowHasInk(py, bl, br), bb, 1, regionH);
  bl = growDir((px) => !colHasInk(px, bt, bb), bl, -1, 0);
  br = growDir((px) => !colHasInk(px, bt, bb), br, 1, regionW);
  // Second pass: the vertical range widened above may expose ink the first
  // horizontal scan missed, and vice versa.
  bt = growDir((py) => !rowHasInk(py, bl, br), bt, -1, 0);
  bb = growDir((py) => !rowHasInk(py, bl, br), bb, 1, regionH);

  const padPx = Math.max(2, Math.round(opt.compositeMarginPt * renderScale));
  const cropLeft = Math.max(0, bl - padPx), cropTop = Math.max(0, bt - padPx);
  const cropRight = Math.min(regionW, br + padPx), cropBottom = Math.min(regionH, bb + padPx);
  const sw = Math.max(1, cropRight - cropLeft), sh = Math.max(1, cropBottom - cropTop);

  const crop = new OffscreenCanvas(sw, sh);
  crop.getContext('2d').drawImage(full, left + cropLeft, top + cropTop, sw, sh, 0, 0, sw, sh);
  const blob = await crop.convertToBlob({ type: 'image/png' });

  // Report the grown box back in PDF-point space too (via the same
  // viewport's inverse transform, so it stays correct under rotation), so
  // the caller can record accurate placement/size and exclude any text that
  // landed inside it.
  const [gx0, gyTop] = vp.convertToPdfPoint(left + cropLeft, top + cropTop);
  const [gx1, gyBottom] = vp.convertToPdfPoint(left + cropRight, top + cropBottom);
  return {
    blob, mime: 'image/png', width: sw, height: sh,
    x0: Math.min(gx0, gx1), x1: Math.max(gx0, gx1),
    yTop: Math.max(gyTop, gyBottom), yBottom: Math.min(gyTop, gyBottom),
  };
}

/**
 * Replaces tightly-clustered groups of small extracted images (>= compositeMinImages,
 * within compositeClusterGapPt of each other) with one flattened screenshot of
 * their combined area. Images not in a qualifying cluster pass through
 * untouched — this only ever acts on image-to-image proximity, never on
 * text, so the worst case is a chart that still comes out as pieces, not a
 * paragraph accidentally swallowed into a screenshot.
 */
async function flattenCompositeImages(page, pageNo, images, store, log, opt) {
  // Past the shipped default gap, the user has explicitly turned up
  // aggressiveness via the review UI's slider — relax the minimum cluster
  // size to match, so a plain adjacent pair merges too, not just 3+-piece
  // clusters.
  const minImages = opt.compositeClusterGapPt > DEFAULTS.compositeClusterGapPt
    ? Math.min(2, opt.compositeMinImages)
    : opt.compositeMinImages;
  if (images.length < minImages) return images;

  // `estimated` images fell back to their raw intrinsic pixel size because
  // the CTM had no real scale to read (see readImages) — their x/y/dispW/
  // dispH don't reliably describe where they actually sit on the page, so
  // clustering them in would corrupt the cluster's bounding box (and can
  // drag a real cluster's crop toward a near-blank region). Left untouched,
  // never merged, same as a too-small cluster.
  const clusterable = images.filter((im) => !im.estimated);
  const unclusterable = images.filter((im) => im.estimated);
  if (clusterable.length < minImages) return images;

  const pageViewport = page.getViewport({ scale: 1 });
  const pageWidth = pageViewport.width;
  const pageHeight = pageViewport.height;
  const clusters = clusterImageBoxes(clusterable, opt.compositeClusterGapPt);
  const out = [...unclusterable];
  let n = 0;

  for (const cluster of clusters) {
    if (cluster.length < minImages) {
      out.push(...cluster.map((c) => c.im));
      continue;
    }

    // A small starting box — clamped to the page — around just the raster
    // fragments themselves; growRegionToContent() does the real work of
    // extending it out to whatever surrounding ink (axis lines, labels,
    // curves, a photo's border) actually belongs with it.
    const margin = opt.compositeMarginPt;
    const x0 = Math.max(0, Math.min(...cluster.map((c) => c.x0)) - margin);
    const x1 = Math.min(pageWidth, Math.max(...cluster.map((c) => c.x1)) + margin);
    const yTop = Math.min(pageHeight, Math.max(...cluster.map((c) => c.yTop)) + margin);
    const yBottom = Math.max(0, Math.min(...cluster.map((c) => c.yBottom)) - margin);

    try {
      const shot = await growRegionToContent(page, x0, yBottom, x1, yTop, opt);
      // pageNo is part of the id because `store` is one Map shared across
      // every page in the document — without it, page 2's first composite
      // and page 7's first composite would both be "img_composite_1" and
      // the later page's write would silently clobber the earlier page's
      // entry in the shared store.
      const id = `img_composite_p${pageNo}_${++n}`;
      store.set(id, { blob: shot.blob, mime: shot.mime, width: shot.width, height: shot.height });
      const gx0 = shot.x0 ?? x0, gx1 = shot.x1 ?? x1;
      const gyTop = shot.yTop ?? yTop, gyBottom = shot.yBottom ?? yBottom;
      out.push({
        id, x: gx0, y: gyTop, dispW: gx1 - gx0, dispH: gyTop - gyBottom,
        natW: shot.width, natH: shot.height, estimated: false,
        composite: true, mergedCount: cluster.length,
        // Consulted by readPage() to drop text lines that fell inside this
        // box — they're now baked into the screenshot's pixels, so keeping
        // them as separate blocks would show them twice.
        claimBox: { x0: gx0, x1: gx1, yTop: gyTop, yBottom: gyBottom },
      });
      log.push({
        page: pageNo, objId: '(composite)', kept: true,
        reason: `merged ${cluster.length} clustered images into one flattened figure`,
        display: `${Math.round(gx1 - gx0)}x${Math.round(gyTop - gyBottom)}pt`,
      });
    } catch (e) {
      // Rendering failed for this cluster specifically — fall back to the
      // original separate images rather than losing them.
      out.push(...cluster.map((c) => c.im));
      log.push({ page: pageNo, objId: '(composite)', kept: false, reason: `error: ${e.message}` });
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
      // Extend the bounding box down and, if the wrapped line is wider on
      // either side, sideways too — a centred two-line title is often wider
      // on its second line than its first.
      const x1 = Math.max(prev.x0 + prev.width, b.x0 + b.width);
      const yBottom = Math.min(prev.y0 - prev.height, b.y0 - b.height);
      prev.x0 = Math.min(prev.x0, b.x0);
      prev.width = round2(x1 - prev.x0);
      prev.height = round2(prev.y0 - yBottom);
      prev._y = b._y;
      st.headingMerges = (st.headingMerges || 0) + 1;
      continue;
    }
    out.push(b);
  }
  return out;
}

/**
 * Folds consecutive marker-led paragraphs (see matchListMarker/stripListMarker
 * in buildBlocks) into a single { type: 'list' } block. Runs unconditionally
 * over every list-marked paragraph, even a lone one with no neighbours — its
 * marker was already stripped from the text, so it must become a one-item
 * list rather than an ordinary paragraph silently missing its bullet.
 */
function mergeLists(blocks, opt, st = {}) {
  if (!opt.detectLists) return blocks;
  const out = [];

  for (const b of blocks) {
    if (b.type !== 'p' || !b.list) { out.push(b); continue; }

    const prev = last(out);
    if (prev?.type === 'list' && prev.ordered === (b.list === 'ordered')) {
      prev.items.push(b.runs);
      const x1 = Math.max(prev.x0 + prev.width, b.x0 + b.width);
      const yBottom = Math.min(prev.y0 - prev.height, b.y0 - b.height);
      prev.x0 = Math.min(prev.x0, b.x0);
      prev.width = round2(x1 - prev.x0);
      prev.height = round2(prev.y0 - yBottom);
      st.listMerges = (st.listMerges || 0) + 1;
    } else {
      out.push({
        type: 'list', page: b.page,
        x0: b.x0, y0: b.y0, width: b.width, height: b.height,
        ordered: b.list === 'ordered', items: [b.runs],
      });
    }
  }

  // A "list" of one item is the weakest possible signal — the marker match
  // could just as easily have been an ordinary sentence starting "1) ...".
  for (const b of out) {
    if (b.type === 'list' && b.items.length === 1) {
      b.confidence = 'low';
      b.confidenceReason = 'only one item detected — this might not actually be a list';
    }
  }
  return out;
}

const CAPTION_LEAD = /^(figure|fig\.?|table)\s*\.?\s*\d*\s*[:.\-–—]?\s*/i;

function isCaptionCandidate(b, opt) {
  if (!b || b.type !== 'p') return false;
  const t = text(b).trim();
  if (!t || t.length > opt.maxCaptionChars) return false;
  return CAPTION_LEAD.test(t);
}

/**
 * Folds a short "Figure N: ..." / "Table N: ..." paragraph into the
 * image/table it's describing. The paragraph immediately *after* the figure
 * is checked first (the common convention), falling back to the one right
 * before it (e.g. a table introduced by its own caption line above it).
 */
function associateCaptions(blocks, opt, st = {}) {
  if (!opt.detectCaptions) return blocks;
  const out = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== 'img' && b.type !== 'table') { out.push(b); continue; }

    const after = blocks[i + 1];
    if (isCaptionCandidate(after, opt)) {
      b.caption = after.runs;
      i++;   // consume it — never pushed as its own paragraph
      st.captionsFound = (st.captionsFound || 0) + 1;
    } else if (isCaptionCandidate(out.at(-1), opt)) {
      b.caption = out.pop().runs;
      st.captionsFound = (st.captionsFound || 0) + 1;
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
      if (b.caption) b.caption = tidy(b.caption);
      continue;
    }
    if (b.type === 'list') {
      b.items = b.items.map(tidy);
      continue;
    }
    if (b.type === 'img') {
      if (b.caption) b.caption = tidy(b.caption);
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
      if (l.kind === 'img') continue;
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
      if (l.kind === 'img') continue;
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

function buildBlocks(entries, bodySize, pageNo, opt, trace = [], stats = {}, pageWidth = 0) {
  const blocks = [];
  const textKept = entries.filter((e) => e.kind === 'text' && !e.dropped && e.text);

  // Margins and leading are measured per page, per column — a multi-column
  // page's right column starts at a completely different x than the left
  // one, and averaging them together would break indent/blockquote math for
  // both. Single-column pages have exactly one bucket ('L'), so this is a
  // no-op there — identical to the old page-wide computation.
  const colNames = [...new Set(textKept.map((l) => l.col))];
  const marginByCol = new Map(colNames.map((c) => [c, pageLeftEdge(textKept.filter((l) => l.col === c))]));
  const widthByCol = new Map(colNames.map((c) => {
    const ls = textKept.filter((l) => l.col === c);
    const w = ls.length ? Math.max(...ls.map((l) => l.x1)) - Math.min(...ls.map((l) => l.x0)) : pageWidth * 0.8;
    return [c, w];
  }));
  const fallbackMargin = pageLeftEdge(textKept);
  const fallbackWidth = textKept.length
    ? Math.max(...textKept.map((l) => l.x1)) - Math.min(...textKept.map((l) => l.x0))
    : pageWidth * 0.8;
  const marginFor = (col) => marginByCol.get(col) ?? fallbackMargin;
  // Width of the text column, used to express image widths as a proportion
  // of the measure rather than as absolute points — EPUB is reflowable, so
  // "this figure filled 60% of the column" survives any screen size.
  const widthFor = (col) => widthByCol.get(col) ?? fallbackWidth;

  // Gaps are only measured between consecutive lines in the *same* column —
  // at a column transition, y jumps back up the page, and that's not a real
  // vertical gap.
  const gaps = [];
  for (let i = 1; i < textKept.length; i++) {
    if (textKept[i - 1].col !== textKept[i].col) continue;
    const g = textKept[i - 1].y - textKept[i].y;
    if (g > 0) gaps.push(g);
  }
  const lineGap = median(gaps) || bodySize * 1.2;

  stats.leftMargin = round2(fallbackMargin);
  stats.lineGap = round2(lineGap);
  stats.contentWidth = round2(fallbackWidth);
  stats.columns = colNames.length || 1;

  let para = null;
  const flush = () => {
    if (!para) return;
    // The paragraph's left edge is its body lines, not its first line — that
    // way a classic first-line indent resolves to an indent of zero, while a
    // block whose every line is inset keeps its offset.
    const leftMargin = marginFor(para._col);
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
      // Close to either edge of the accepted range, this could as easily be
      // an ordinary paragraph (just under threshold) or a caption/aside that
      // overshot the ceiling — worth a second look either way.
      if (em - threshold < 0.3 || opt.maxBlockIndentEm - em < 0.3) {
        para.confidence = 'low';
        para.confidenceReason = `indent of ${em.toFixed(1)}em is right at the blockquote threshold`;
      }
    }
    // _x1/_yBottom tracked the running extent as lines were appended (see
    // the main loop below); turn that into the public width/height box now
    // that the paragraph is complete. Stripped by stripInternal otherwise.
    para.width = round2(para._x1 - para.x0);
    para.height = round2(para.y0 - para._yBottom);
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

  let prevKept = null;

  // entries already carries text lines and images in final reading order —
  // left column top-to-bottom, then right column top-to-bottom, with any
  // full-width rows or images interleaved at the point they actually break
  // the columns (see groupIntoLines/mergeColumnRows) — so this loop just
  // walks it once, with no further y-based lookahead needed.
  for (const e of entries) {
    if (e.kind === 'img') {
      flush();
      flushTable();
      const im = e.img;
      const contentWidth = widthFor(e.col);
      // width/height are the on-page display size in PDF points; widthPct is
      // that as a share of the text column, which is what the EPUB uses.
      const pct = im.estimated || !(contentWidth > 0)
        ? null
        : Math.max(5, Math.min(100, Math.round((im.dispW / contentWidth) * 100)));
      blocks.push({
        type: 'img', page: pageNo, id: im.id,
        x0: round2(im.x), y0: round2(im.y),
        width: Math.round(im.dispW), height: Math.round(im.dispH),
        naturalWidth: im.natW, naturalHeight: im.natH,
        widthPct: pct,
        ...(im.composite ? { composite: true, mergedCount: im.mergedCount } : {}),
        ...(im.estimated ? {
          confidence: 'low',
          confidenceReason: "on-page size couldn't be read from the PDF (identity transform) — using the image's raw pixel size as a guess",
        } : {}),
      });
      trace.push({
        page: pageNo, y: round2(im.y), decision: 'image', reason: im.id,
        text: `[${Math.round(im.dispW)}x${Math.round(im.dispH)}pt` +
              ` · ${im.natW}x${im.natH}px${pct ? ` · ${pct}%` : ''}]`,
      });
      continue;
    }

    let l = e;
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
      col: l.col,
    };

    if (l.dropped) {
      rec.decision = 'dropped';
      rec.reason = 'running head/foot';
      trace.push(rec);
      continue;
    }
    if (!l.text) continue;

    const leftMargin = marginFor(l.col);
    const sameCol = prevKept && prevKept.col === l.col;
    const gap = sameCol ? prevKept.y - l.y : 0;
    rec.gap = round2(gap);
    rec.gapRatio = round2(gap / lineGap);
    rec.indentEm = round2((l.x0 - leftMargin) / bodySize);
    rec.bold = l.allBold || undefined;

    const heading = headingLevel(l, bodySize, opt);
    if (heading) {
      flush();
      flushTable();
      const conf = headingConfidence(l, bodySize, heading, opt);
      blocks.push({
        type: heading, page: pageNo, runs: l.runs,
        x0: round2(l.x0), y0: round2(l.y), width: round2(l.x1 - l.x0), height: round2(l.size),
        _size: l.size, _y: l.y, _lineGap: lineGap,
        ...(conf.low ? { confidence: 'low', confidenceReason: conf.reason } : {}),
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

    // Five independent break signals — record which one actually fired.
    // Indent and outdent are measured against the current paragraph's own
    // left edge, so entering or leaving an indented block always splits.
    const tol = bodySize * opt.indentEm;
    const ref = para ? para._bodyX : leftMargin;
    let reason = '';
    if (!para) reason = 'first line';
    else if (para._col !== l.col) reason = 'column change';
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
      // constant. With no real previous line to measure against (page top,
      // or a column change), there's nothing to measure, so assume an
      // ordinary single-line gap.
      const gapRatio = sameCol ? rec.gapRatio : 1;
      para = {
        type: 'p', page: pageNo, runs: [], size: l.size,
        x0: round2(l.x0), y0: round2(l.y), _x1: l.x1, _yBottom: l.y - l.size,
        _bodyX: l.x0, _lines: 0, _col: l.col, gapRatio,
      };
      rec.decision = 'para:new';
      rec.reason = reason;

      const marker = opt.detectLists ? matchListMarker(l.text) : null;
      if (marker) {
        para.list = marker.kind;
        rec.reason += ` · list:${marker.kind}`;
        l = stripListMarker(l, marker.length);
      }
    } else {
      rec.decision = 'para:continue';
    }

    rec.dehyphenated = appendLineToParagraph(para, l);
    para._lines++;
    // From the second line on, the leftmost body line defines the edge.
    if (para._lines > 1) para._bodyX = Math.min(para._bodyX, l.x0);
    // Bounding box grows to cover every line, not just the body/first one —
    // this is for overlap testing (see the Block doc comment), where a
    // block's full visual extent matters more than its text-flow margin.
    para.x0 = Math.min(para.x0, l.x0);
    para._x1 = Math.max(para._x1, l.x1);
    para._yBottom = l.y - l.size;
    rec.paraIndentEm = round2((para._bodyX - leftMargin) / bodySize);
    trace.push(rec);
    prevKept = l;
  }

  flush();
  flushTable();
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

  const first = table.rows[0], lastRow = table.rows.at(-1);
  const tblX0 = round2(Math.min(...table.rows.map((r) => r.x0)));
  const tblX1 = round2(Math.max(...table.rows.map((r) => r.x1)));
  const tblY0 = round2(first?.y ?? 0);
  const tblYBottom = (lastRow?.y ?? 0) - (lastRow?.size ?? 0);

  return {
    type: 'table', page: table.page, rows,
    x0: tblX0, y0: tblY0, width: round2(tblX1 - tblX0), height: round2(tblY0 - tblYBottom),
    // A header styled distinctly from its data (all-bold) is common enough
    // in born-digital tables to be worth rendering as <th>.
    header: table.rows[0]?.allBold || false,
    // A single row is the weakest possible table signal — it could just as
    // easily be one line with unusually wide word spacing.
    ...(table.rows.length === 1 ? {
      confidence: 'low',
      confidenceReason: 'only one row detected — this might be wide word spacing rather than a real table',
    } : {}),
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

/**
 * Judges how solid a heading call was: the size-based path is only as
 * confident as its margin above the level it matched, and the all-bold
 * same-size fallback (headingLevel's last case, no size signal at all) is
 * always worth a second look.
 */
function headingConfidence(line, bodySize, heading, opt) {
  const ratio = line.size / bodySize;
  if (ratio < opt.h3) {
    return { low: true, reason: 'same size as body text — flagged only because the whole line is bold' };
  }
  const threshold = { h1: opt.h1, h2: opt.h2, h3: opt.h3 }[heading];
  const margin = ratio - threshold;
  if (margin < 0.08) {
    return { low: true, reason: `font size is only ${ratio.toFixed(2)}x body, just above the ${heading} threshold (${threshold}x)` };
  }
  return { low: false };
}

/* ------------------------------------------------------------------ */
/* list markers                                                        */
/* ------------------------------------------------------------------ */

// Bullet glyphs plus the two ASCII characters commonly used as bullets by
// tools that typeset lists with a plain marker (Pandoc, LaTeX itemize with
// \textbullet substitutes, etc.) — deliberately excludes en/em dash, which
// are far more likely to be dialogue punctuation than a list marker.
// Ordered markers are digits only ("1.", "1)", "(1)") — letter/roman-numeral
// markers ("a.", "i.") are skipped to avoid mistaking an initial or a
// sentence starting with a single capitalised letter for a list.
const LIST_MARKER = /^(?:([•◦▪‣●○∙·]|[-*])|(\(?\d{1,3}[.)]))\s+/;

function matchListMarker(text) {
  const m = LIST_MARKER.exec(text);
  if (!m) return null;
  return { kind: m[2] ? 'ordered' : 'bullet', length: m[0].length };
}

/** Removes the first `n` characters of a line's marker, across runs if needed. */
function stripListMarker(line, n) {
  const out = [];
  let remaining = n;
  for (const r of line.runs) {
    if (remaining <= 0) { out.push(r); continue; }
    if (r.text.length <= remaining) { remaining -= r.text.length; continue; }
    out.push({ ...r, text: r.text.slice(remaining) });
    remaining = 0;
  }
  return { ...line, runs: out, text: line.text.slice(n) };
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
      !b.list &&   // a genuine new list item never continues the block before it
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
