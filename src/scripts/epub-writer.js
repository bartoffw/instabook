/**
 * epub-writer.js
 *
 * Packages the output of extractDocument() into a valid EPUB 3 blob.
 *
 *   const blob = await buildEpub({ meta, blocks, images });
 *
 * Zips via the global JSZip (loaded as a classic script elsewhere on the
 * page) rather than a bundled zip library, since JSZip is already vendored
 * and used by this extension's other EPUB writer (scripts/epub.js).
 */

const NS = 'http://www.w3.org/1999/xhtml';

export async function buildEpub({ meta, blocks, images }, opts = {}) {
  const uid = opts.identifier || `urn:uuid:${crypto.randomUUID()}`;
  // 'percent' scales each figure to the share of the text column it occupied
  // in the PDF; 'pt' emits absolute widths; 'none' lets every image fill the
  // column. Percent is the right default for reflowable text.
  const sizing = opts.imageSizing ?? 'percent';
  const paraSpacingFactor = opts.paraSpacingFactor ?? 1;
  const chapters = splitIntoChapters(blocks, opts.maxBlocksPerChapter ?? 400);
  // Headings become in-document anchors (not file splits) so the nav can be
  // a full h1/h2/h3 outline while the book stays one continuous read; images
  // and tables get anchors too so the figures/tables list can jump to them.
  const { headings, figures } = assignAnchors(chapters);
  const hasLoi = figures.length > 0;

  const zip = new JSZip();
  // MUST be the first entry added and MUST be stored, not deflated — EPUB
  // readers check this to identify the file without unzipping everything.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER);
  zip.file('OEBPS/style.css', opts.css ?? CSS);

  const used = new Set();
  chapters.forEach((ch, i) => {
    zip.file(`OEBPS/ch${pad(i)}.xhtml`,
      renderChapter(ch, meta, images, used, sizing, paraSpacingFactor));
  });

  for (const [id, img] of images) {
    if (!used.has(id)) continue;                  // drop unreferenced images
    // Already-compressed JPEG/PNG data — store rather than re-deflate.
    zip.file(`OEBPS/images/${id}.${ext(img.mime)}`, img.blob, { compression: 'STORE' });
  }

  if (hasLoi) zip.file('OEBPS/loi.xhtml', renderLoi(figures, meta));
  zip.file('OEBPS/nav.xhtml', renderNav(headings, hasLoi, meta, chapters));
  zip.file('OEBPS/content.opf', renderOpf(meta, chapters, images, used, uid, hasLoi));

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
  });
}

/* ------------------------------------------------------------------ */
/* chapter splitting                                                   */
/* ------------------------------------------------------------------ */

function splitIntoChapters(blocks, maxBlocks) {
  // The whole book is kept as a single logical chapter — headings no longer
  // force a file break, only maxBlocks does, purely so one XHTML file can't
  // grow pathologically large on a very long document. The nav's outline
  // (built from every h1/h2/h3, see assignAnchors/renderNav) is what gives
  // readers chapter-level navigation now, not file boundaries.
  const chapters = [];
  let cur = { title: null, blocks: [] };

  for (const b of blocks) {
    if (cur.blocks.length >= maxBlocks) {
      chapters.push(cur);
      cur = { title: null, blocks: [] };
    }
    if (!cur.title && (b.type === 'h1' || b.type === 'h2')) cur.title = plain(b);
    cur.blocks.push(b);
  }
  if (cur.blocks.length) chapters.push(cur);

  return chapters.map((c, i) => ({ ...c, title: c.title || `Section ${i + 1}` }));
}

/**
 * Walks the (already file-split) chapters in order and stamps an in-document
 * anchor id onto every heading, image and table block, mutating them in
 * place — renderBlock/renderTable pick these up to emit id="...". Returns
 * the flat lists renderNav()/renderLoi() build their pages from.
 */
function assignAnchors(chapters) {
  const headings = [];
  const figures = [];
  let hN = 0, imgN = 0, tblN = 0;

  chapters.forEach((ch, ci) => {
    const file = `ch${pad(ci)}.xhtml`;
    for (const b of ch.blocks) {
      if (b.type === 'h1' || b.type === 'h2' || b.type === 'h3') {
        b.anchor = `h${hN++}`;
        headings.push({ level: b.type, title: plain(b).trim() || '(untitled)', file, anchor: b.anchor });
      } else if (b.type === 'img') {
        b.anchor = `f${++imgN}`;
        figures.push({ file, anchor: b.anchor, label: captionLabel(b, `Figure ${imgN}`), page: b.page });
      } else if (b.type === 'table') {
        b.anchor = `t${++tblN}`;
        figures.push({ file, anchor: b.anchor, label: captionLabel(b, `Table ${tblN}`), page: b.page });
      }
    }
  });

  return { headings, figures };
}

/* ------------------------------------------------------------------ */
/* XHTML rendering                                                     */
/* ------------------------------------------------------------------ */

function renderChapter(ch, meta, images, used, sizing, paraSpacingFactor) {
  const body = ch.blocks.map((b) => renderBlock(b, images, used, sizing, paraSpacingFactor))
    .filter(Boolean).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="${NS}" xml:lang="${esc(meta.language)}" lang="${esc(meta.language)}">
<head><meta charset="utf-8"/><title>${esc(ch.title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body></html>`;
}

function renderBlock(b, images, used, sizing, paraSpacingFactor) {
  const idAttr = b.anchor ? ` id="${b.anchor}"` : '';
  if (b.type === 'img') {
    const img = images.get(b.id);
    if (!img) return '';
    used.add(b.id);
    const caption = b.caption ? `<figcaption>${b.caption.map(renderRun).join('')}</figcaption>` : '';
    return `<figure class="img"${idAttr}><img src="images/${b.id}.${ext(img.mime)}" alt=""` +
           `${imgAttrs(b, sizing)}/>${caption}</figure>`;
  }
  if (b.type === 'table') return renderTable(b, idAttr);
  if (b.type === 'list') {
    const tag = b.ordered ? 'ol' : 'ul';
    const items = b.items.map((runs) => `<li>${runs.map(renderRun).join('')}</li>`).join('');
    return items ? `<${tag}${idAttr}>${items}</${tag}>` : '';
  }
  const inner = b.runs.map(renderRun).join('');
  if (!inner.trim()) return '';
  if (b.type === 'p' && b.indent) {
    // An indented block keeps its offset; the first-line indent is dropped
    // since the whole paragraph is already set in from the margin.
    return `<p class="ind" style="margin-left:${b.indent}em">${inner}</p>`;
  }
  if (b.type === 'p') {
    // gapRatio carries the source PDF's actual vertical gap before this
    // paragraph, so the EPUB reproduces its rhythm instead of a flat gap.
    const em = paraMarginEm(b.gapRatio ?? 1, paraSpacingFactor);
    return `<p style="margin-top:${em}em">${inner}</p>`;
  }
  return `<${b.type}${idAttr}>${inner}</${b.type}>`;
}

function renderTable(b, idAttr = '') {
  const cell = (tag) => (runs) => `<${tag}>${runs.map(renderRun).join('')}</${tag}>`;
  const row = (runs, tag) => `<tr>${runs.map(cell(tag)).join('')}</tr>`;
  // <caption> must be the table's first child per the HTML content model.
  const caption = b.caption ? `<caption>${b.caption.map(renderRun).join('')}</caption>` : '';

  if (b.header) {
    const [head, ...body] = b.rows;
    return `<table${idAttr}>${caption}<thead>${row(head, 'th')}</thead><tbody>` +
           body.map((r) => row(r, 'td')).join('') + `</tbody></table>`;
  }
  return `<table${idAttr}>${caption}<tbody>${b.rows.map((r) => row(r, 'td')).join('')}</tbody></table>`;
}

/**
 * The width/height attributes carry the *display* aspect ratio, not the
 * intrinsic one. This matters for images the PDF stretched: a 277x1 source
 * shown at 208x23 must render 23 units tall, and `height: auto` alone would
 * fall back to the 277:1 intrinsic ratio and draw a 1px sliver. Browsers and
 * EPUB readers derive the box ratio from these attributes, and the inline
 * aspect-ratio repeats it for engines that ignore them.
 * PDF points convert to CSS px at 96/72.
 */
function imgAttrs(b, sizing) {
  const pxW = b.width ? Math.round(b.width * 4 / 3) : 0;
  const pxH = b.height ? Math.round(b.height * 4 / 3) : 0;
  const attrs = pxW && pxH ? ` width="${pxW}" height="${pxH}"` : '';

  const style = [];
  if (pxW && pxH) style.push(`aspect-ratio:${pxW}/${pxH}`);
  if (sizing === 'percent' && b.widthPct) style.push(`width:${b.widthPct}%`);
  else if (sizing === 'pt' && pxW) style.push(`width:${pxW}px`);

  return attrs + (style.length ? ` style="${style.join(';')}"` : '');
}

function renderRun(r) {
  let t = esc(r.text);
  if (r.italic) t = `<em>${t}</em>`;
  if (r.bold) t = `<strong>${t}</strong>`;
  return t;
}

const HEADING_RANK = { h1: 1, h2: 2, h3: 3 };

/** Nests a flat, document-order heading list into an h1>h2>h3 tree. */
function buildTocTree(headings) {
  const root = { children: [] };
  const stack = [{ level: 0, node: root }];

  for (const h of headings) {
    const level = HEADING_RANK[h.level];
    while (stack.length > 1 && stack.at(-1).level >= level) stack.pop();
    const node = { title: h.title, href: `${h.file}#${h.anchor}`, children: [] };
    stack.at(-1).node.children.push(node);
    stack.push({ level, node });
  }
  return root.children;
}

function renderNavItems(nodes) {
  return nodes.map((n) =>
    `<li><a href="${esc(n.href)}">${esc(n.title)}</a>${n.children.length ? renderNavList(n.children) : ''}</li>`
  ).join('\n');
}

function renderNavList(nodes) {
  return `<ol>\n${renderNavItems(nodes)}\n</ol>`;
}

function renderNav(headings, hasLoi, meta, chapters) {
  // No headings at all (rare — a document with no detected structure) still
  // needs one entry, or the toc nav's <ol> would be empty, which readers and
  // epubcheck both treat as invalid.
  const treeItems = headings.length
    ? renderNavItems(buildTocTree(headings))
    : `<li><a href="ch${pad(0)}.xhtml">${esc(meta.title || chapters[0]?.title || 'Start')}</a></li>`;
  const loiItem = hasLoi ? `<li><a href="loi.xhtml">Figures &amp; Tables</a></li>` : '';

  const landmarks = hasLoi
    ? `\n<nav epub:type="landmarks" id="landmarks" hidden="">\n<ol><li><a epub:type="loi" href="loi.xhtml">Figures &amp; Tables</a></li></ol>\n</nav>`
    : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="${NS}" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(meta.language)}">
<head><meta charset="utf-8"/><title>Contents</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${treeItems}${loiItem}
</ol></nav>${landmarks}
</body></html>`;
}

function renderLoi(figures, meta) {
  const items = figures
    .map((f) => `<li><a href="${esc(f.file)}#${esc(f.anchor)}">${esc(f.label)}${f.page ? ` — page ${f.page}` : ''}</a></li>`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="${NS}" xml:lang="${esc(meta.language)}" lang="${esc(meta.language)}">
<head><meta charset="utf-8"/><title>Figures &amp; Tables</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<h1>Figures &amp; Tables</h1>
<ol>
${items}
</ol>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* OPF                                                                 */
/* ------------------------------------------------------------------ */

function renderOpf(meta, chapters, images, used, uid, hasLoi) {
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...chapters.map((_, i) =>
      `<item id="ch${pad(i)}" href="ch${pad(i)}.xhtml" media-type="application/xhtml+xml"/>`),
    ...(hasLoi ? ['<item id="loi" href="loi.xhtml" media-type="application/xhtml+xml"/>'] : []),
    ...[...images].filter(([id]) => used.has(id)).map(([id, img]) =>
      `<item id="${id}" href="images/${id}.${ext(img.mime)}" media-type="${img.mime}"/>`),
  ].join('\n    ');

  const spine = [
    ...chapters.map((_, i) => `<itemref idref="ch${pad(i)}"/>`),
    ...(hasLoi ? ['<itemref idref="loi"/>'] : []),
  ].join('\n    ');

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${esc(uid)}</dc:identifier>
    <dc:title>${esc(meta.title)}</dc:title>
    <dc:creator>${esc(meta.author)}</dc:creator>
    <dc:language>${esc(meta.language)}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>`;
}

/* ------------------------------------------------------------------ */

const CONTAINER = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const LINE_HEIGHT = 1.45;

// gapRatio is the source paragraph's vertical gap as a multiple of the
// page's median line gap (see pdf-structure.js) — 1 means "about as far
// from what precedes it as any two ordinary lines". paraSpacingFactor scales
// that into quarter-line-heights (so the factor-1 default reads as a subtle
// step up, not a full blank line), which LINE_HEIGHT then converts to em.
// Exported so callers rendering their own preview of the EPUB output (e.g.
// the converter page) can match this exactly instead of duplicating the
// formula.
export function paraMarginEm(gapRatio, paraSpacingFactor) {
  return +(Math.max(0, gapRatio) * paraSpacingFactor * LINE_HEIGHT / 4).toFixed(3);
}

const CSS = `body { margin: 0 5%; line-height: ${LINE_HEIGHT}; }
h1, h2, h3 { line-height: 1.2; page-break-after: avoid; }
h1 { margin: 1.4em 0 0.6em; }
h2 { margin: 1.2em 0 0.5em; }
h3 { margin: 1em 0 0.4em; }
body > h1:first-child, body > h2:first-child, body > h3:first-child { margin-top: 0; }
p { margin: 0; text-indent: 1.2em; text-align: justify; }
h1 + p, h2 + p, h3 + p, figure + p, table + p { text-indent: 0; }
p.ind { text-indent: 0; margin: 0.5em 0; }
p.ind + p.ind { margin-top: 0; }
figure.img { margin: 1em 0; text-align: center; page-break-inside: avoid; }
figure.img img { max-width: 100%; height: auto; }
figure.img figcaption { font-size: 0.85em; text-align: center; }
table { width: 100%; margin: 1em 0; border-collapse: collapse; font-size: 0.9em; }
th, td { border: 1px solid; padding: 0.3em 0.6em; text-align: left; vertical-align: top; }
th { font-weight: bold; }
table caption { font-size: 0.85em; margin-bottom: 0.4em; caption-side: top; }
ul, ol { margin: 0.8em 0; padding-left: 1.6em; }
li { margin: 0.3em 0; }
h1 + ul, h1 + ol, h2 + ul, h2 + ol, h3 + ul, h3 + ol, figure + ul, figure + ol, table + ul, table + ol { margin-top: 0.4em; }`;

const pad = (i) => String(i).padStart(4, '0');
const ext = (mime) => (mime === 'image/png' ? 'png' : 'jpg');
const plain = (b) => (b.runs || []).map((r) => r.text).join('').trim();

// Prefers the block's own caption text for the figures/tables list, falling
// back to the generic "Figure N" label when it has none; long captions are
// clipped so the list stays scannable.
function captionLabel(b, fallback) {
  if (!b.caption) return fallback;
  const t = plain({ runs: b.caption });
  if (!t) return fallback;
  return t.length > 90 ? t.slice(0, 89) + '…' : t;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
