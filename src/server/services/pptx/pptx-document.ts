// ════════════════════════════════════════════════════════════════════════════
// PptxDocument — read/edit/write a .pptx archive in place
// ════════════════════════════════════════════════════════════════════════════
// A .pptx is a ZIP containing XML. To preserve the faculty's institutional
// template, we must crack open the ZIP, modify only the text nodes the AI
// wants to change, then re-zip without disturbing any other byte.
//
// This module owns BOTH read and write surfaces so the AI's edits stay
// bound to the exact XML location we read them from (via slotId). Pure
// Gemini extraction would lose those coordinates.
//
// Architecture:
//   - fromBuffer()  : open .pptx Buffer → parsed XML trees per slide
//   - slides()      : enumerate slides with text-bearing shapes + slotIds
//   - patchText()   : mutate a single <a:t> node's text by slotId
//   - cloneSlide()  : duplicate a slide (Phase 2C)
//   - removeSlide() : drop a slide from the deck (Phase 2C)
//   - toBuffer()    : serialize parsed state back to a .pptx Buffer
//
// Phase 2A.1 ships: fromBuffer, slides, toBuffer (round-trip safe).
// patchText / slide ops follow in 2B / 2C.

import PizZip from 'pizzip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

// ─── fast-xml-parser options ────────────────────────────────────────────────
// preserveOrder is non-negotiable here: XML element order in .pptx files
// affects how PowerPoint renders the deck. A canonical-form re-serialize
// would corrupt animations / z-order / rels indexing.

const PARSE_OPTS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Keep attribute values as strings — pptx uses string-form numbers in many
  // places (sz="4400", b="1") and round-trip must reproduce them verbatim.
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  // .pptx XML is namespace-rich (p:, a:, r:, ...). Keep the prefixes intact;
  // PowerPoint will refuse to open a file where they've been stripped.
  removeNSPrefix: false,
} as const;

const BUILD_OPTS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Self-closing tags where the original had them — pptx is sensitive to
  // how empty elements are written (some readers tolerate either, some don't).
  suppressEmptyNode: true,
  // No pretty-printing — PowerPoint's own files are mostly minified.
  format: false,
} as const;

// ─── Public types ───────────────────────────────────────────────────────────

export interface PptxShape {
  /**
   * Stable identifier for this text-bearing shape. Format:
   *   `s${slideIndex}.sp${shapeIndex}`
   * AI receives this in extraction → returns edits keyed to the same slotId →
   * writer locates the exact XML node.
   */
  slotId: string;
  /** Concatenated plain text of all paragraphs/runs inside the shape. */
  text: string;
  /** True if this shape is a title placeholder (per the pptx schema). */
  isTitle: boolean;
  /**
   * The raw `<p:ph type="...">` placeholder type for this shape, or null when
   * the shape is not a placeholder (a freeform text box). Lets callers tell a
   * content placeholder apart from deck "chrome" — slide number (`sldNum`),
   * footer (`ftr`), date (`dt`) — which must never be mistaken for a title.
   */
  phType: string | null;
  /** Paragraph count — useful for AI to know "this is a 6-bullet list". */
  paragraphCount: number;
  /**
   * The shape's bounding box in EMU (English Metric Units, 914400 per inch) as
   * read from `<p:spPr><a:xfrm>`, or null when the shape inherits its geometry
   * from a layout/master placeholder (no explicit frame on the slide). Backs
   * the faithful editable overlay — null shapes can't be positioned.
   */
  frameEmu: { x: number; y: number; cx: number; cy: number } | null;
  /** Shape solid-fill colour (6-char hex, no '#'), or null. Used to mask the
   *  baked-in text under an editable overlay box. */
  fillHex: string | null;
  /** First-run font colour (hex, no '#'), or null (inherits theme/placeholder). */
  colorHex: string | null;
  /** First-run font size in points (e.g. 18), or null when inherited. */
  fontSizePt: number | null;
  /** First-run bold / italic flags. */
  bold: boolean;
  italic: boolean;
  /** Paragraph horizontal alignment, or null (defaults to left). */
  align: 'l' | 'ctr' | 'r' | 'just' | null;
  /** Body vertical anchor, or null (defaults to top). */
  valign: 't' | 'ctr' | 'b' | null;
}

/** Placeholder types that are deck chrome, not authored content. */
export const CHROME_PH_TYPES: ReadonlySet<string> = new Set(['sldNum', 'ftr', 'dt']);

export interface PptxSlide {
  /** 1-based slide order. */
  index: number;
  /** Path inside the ZIP, e.g. "ppt/slides/slide1.xml". */
  xmlPath: string;
  /** Text-bearing shapes only (pictures / charts excluded). */
  shapes: PptxShape[];
  /** Count of embedded images on this slide (informational). */
  imageCount: number;
}

export class PptxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PptxParseError';
  }
}

// ─── Internal types ─────────────────────────────────────────────────────────

// preserveOrder mode returns arrays of single-key objects:
//   [ { 'p:sp': [...children] }, ... ]
// Attributes live under a ':@' key on the same object.
// We type this loosely because the schema is recursive and varies per element.
type XmlNode = Record<string, unknown>;
type XmlTree = XmlNode[];

interface DocState {
  zip: PizZip;
  /** path inside zip → parsed XML tree. Only slide XMLs are tracked here. */
  slideXmlByPath: Map<string, XmlTree>;
  /** Parsed `ppt/presentation.xml` — owns the slide order via `<p:sldIdLst>`. */
  presentationXml: XmlTree;
  /** Parsed `ppt/_rels/presentation.xml.rels` — slide rels live here. */
  presentationRels: XmlTree;
  /** Parsed `[Content_Types].xml` — must register an Override per slide file. */
  contentTypes: XmlTree;
  /** Marks XML files that were mutated, so toBuffer only rebuilds those. */
  dirty: Set<string>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const SLIDE_PATH_RE = /^ppt\/slides\/slide(\d+)\.xml$/;

function slideNumFromPath(path: string): number {
  const m = path.match(SLIDE_PATH_RE);
  if (!m) throw new PptxParseError(`Not a slide path: ${path}`);
  return parseInt(m[1], 10);
}

/** Get the (only) tag key on a preserveOrder node, or null if it's a text leaf. */
function tagOf(node: XmlNode): string | null {
  for (const k of Object.keys(node)) {
    if (k === ':@' || k === '#text') continue;
    return k;
  }
  return null;
}

/** Get the children array under a node's tag, or empty if leaf. */
function childrenOf(node: XmlNode): XmlTree {
  const tag = tagOf(node);
  if (!tag) return [];
  const v = node[tag];
  return Array.isArray(v) ? (v as XmlTree) : [];
}

/** Read `#text` value from a leaf node, or '' if none. */
function leafText(node: XmlNode): string {
  if (typeof node['#text'] === 'string') return node['#text'];
  return '';
}

/** Walk a tree depth-first, yielding every node whose tag === target. */
function* findAll(tree: XmlTree, target: string): Generator<XmlNode> {
  for (const node of tree) {
    if (tagOf(node) === target) yield node;
    yield* findAll(childrenOf(node), target);
  }
}

/** Find the first descendant node with the given tag (or null). */
function findFirst(tree: XmlTree, target: string): XmlNode | null {
  for (const n of findAll(tree, target)) return n;
  return null;
}

/**
 * Extract the concatenated text content of a `<p:txBody>` node by walking
 * its <a:p> paragraphs and joining the <a:t> runs within each.
 */
function readTxBodyText(txBody: XmlNode): { text: string; paragraphCount: number } {
  const paragraphs = childrenOf(txBody).filter((c) => tagOf(c) === 'a:p');
  const parts: string[] = [];
  for (const p of paragraphs) {
    const runs = childrenOf(p);
    const line: string[] = [];
    for (const r of runs) {
      const t = tagOf(r);
      if (t === 'a:r') {
        // <a:r> contains <a:rPr> and <a:t>
        for (const rChild of childrenOf(r)) {
          if (tagOf(rChild) === 'a:t') {
            const tText = childrenOf(rChild).map(leafText).join('');
            line.push(tText);
          }
        }
      } else if (t === 'a:fld') {
        // Field run — text is also under <a:t>
        for (const rChild of childrenOf(r)) {
          if (tagOf(rChild) === 'a:t') {
            line.push(childrenOf(rChild).map(leafText).join(''));
          }
        }
      } else if (t === 'a:br') {
        line.push('\n');
      }
    }
    parts.push(line.join(''));
  }
  return { text: parts.join('\n'), paragraphCount: paragraphs.length };
}

/**
 * Determine whether a `<p:sp>` shape is a title placeholder.
 * Layout: <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/>
 */
function shapeIsTitle(sp: XmlNode): boolean {
  const phType = shapePlaceholderType(sp);
  return phType === 'title' || phType === 'ctrTitle';
}

/**
 * Read the `<p:ph type="...">` placeholder type for a `<p:sp>` shape.
 * Layout: <p:sp><p:nvSpPr><p:nvPr><p:ph type="..."/>
 * Returns the type string (e.g. 'title', 'body', 'sldNum'), '' for a bare
 * `<p:ph/>` (which PowerPoint treats as a body placeholder), or null when the
 * shape carries no placeholder at all (a plain freeform text box).
 */
function shapePlaceholderType(sp: XmlNode): string | null {
  const nvSpPr = findFirst(childrenOf(sp), 'p:nvSpPr');
  if (!nvSpPr) return null;
  const nvPr = findFirst(childrenOf(nvSpPr), 'p:nvPr');
  if (!nvPr) return null;
  const ph = findFirst(childrenOf(nvPr), 'p:ph');
  if (!ph) return null;
  return (ph[':@'] as Record<string, string> | undefined)?.['@_type'] ?? '';
}

/** Read a node's attribute map (the preserveOrder ':@' bag). */
function attrsOf(node: XmlNode | undefined): Record<string, string> {
  return ((node?.[':@'] as Record<string, string> | undefined) ?? {});
}

/** Direct child of `node` with the given tag (non-recursive), or undefined. */
function directChild(node: XmlNode, tag: string): XmlNode | undefined {
  return childrenOf(node).find((c) => tagOf(c) === tag);
}

/** Read the shape bounding box from `<p:spPr><a:xfrm>`, in EMU, or null. */
function shapeFrameEmu(sp: XmlNode): PptxShape['frameEmu'] {
  const xfrm = findFirst(childrenOf(sp), 'a:xfrm');
  if (!xfrm) return null;
  const off = directChild(xfrm, 'a:off');
  const ext = directChild(xfrm, 'a:ext');
  const oa = attrsOf(off);
  const ea = attrsOf(ext);
  const x = parseInt(oa['@_x'], 10);
  const y = parseInt(oa['@_y'], 10);
  const cx = parseInt(ea['@_cx'], 10);
  const cy = parseInt(ea['@_cy'], 10);
  if (![x, y, cx, cy].every(Number.isFinite)) return null;
  if (cx <= 0 || cy <= 0) return null;
  return { x, y, cx, cy };
}

/** First `<a:srgbClr val="RRGGBB">` directly under a solidFill node, or null. */
function solidFillHex(container: XmlNode | undefined): string | null {
  if (!container) return null;
  const solid = directChild(container, 'a:solidFill');
  if (!solid) return null;
  const srgb = directChild(solid, 'a:srgbClr');
  const val = attrsOf(srgb)['@_val'];
  return val ? val.toLowerCase() : null;
}

/** Extract text style (fill, font colour/size, bold/italic, alignment) for the
 *  faithful overlay. All best-effort — any missing piece is left null/false. */
function shapeStyle(sp: XmlNode, txBody: XmlNode): Omit<PptxShape, 'slotId' | 'text' | 'isTitle' | 'phType' | 'paragraphCount' | 'frameEmu'> {
  const spPr = directChild(sp, 'p:spPr');
  const fillHex = solidFillHex(spPr);

  const bodyPr = directChild(txBody, 'a:bodyPr');
  const anchor = attrsOf(bodyPr)['@_anchor'];
  const valign = anchor === 'ctr' || anchor === 'b' || anchor === 't' ? anchor : null;

  const firstP = directChild(txBody, 'a:p');
  const pPr = firstP ? directChild(firstP, 'a:pPr') : undefined;
  const algn = attrsOf(pPr)['@_algn'];
  const align = algn === 'ctr' || algn === 'r' || algn === 'just' || algn === 'l' ? algn : null;

  const firstR = firstP ? directChild(firstP, 'a:r') : undefined;
  const rPr = firstR ? directChild(firstR, 'a:rPr') : undefined;
  const ra = attrsOf(rPr);
  const sz = parseInt(ra['@_sz'], 10);
  const fontSizePt = Number.isFinite(sz) ? sz / 100 : null;
  const bold = ra['@_b'] === '1';
  const italic = ra['@_i'] === '1';
  const colorHex = solidFillHex(rPr);

  return { fillHex, colorHex, fontSizePt, bold, italic, align, valign };
}

/**
 * Extract all text-bearing shapes from one slide's XML tree.
 * Slot IDs are assigned in shape-tree document order — stable across
 * read→write so the writer can resolve them later.
 */
function extractShapes(slideXml: XmlTree, slideIndex: number): PptxShape[] {
  const spTree = findFirst(slideXml, 'p:spTree');
  if (!spTree) return [];

  const shapes: PptxShape[] = [];
  let shapeIdx = 0;
  for (const node of childrenOf(spTree)) {
    if (tagOf(node) !== 'p:sp') continue;
    const txBody = findFirst(childrenOf(node), 'p:txBody');
    if (!txBody) continue; // shape without a text body — skip
    const { text, paragraphCount } = readTxBodyText(txBody);
    shapes.push({
      slotId: `s${slideIndex}.sp${shapeIdx}`,
      text,
      isTitle: shapeIsTitle(node),
      phType: shapePlaceholderType(node),
      paragraphCount,
      frameEmu: shapeFrameEmu(node),
      ...shapeStyle(node, txBody),
    });
    shapeIdx++;
  }
  return shapes;
}

function countImages(slideXml: XmlTree): number {
  let n = 0;
  for (const _ of findAll(slideXml, 'p:pic')) n++;
  return n;
}

// ─── Package-level helpers (presentation.xml / rels / Content_Types) ──────

/**
 * Find the actual document root element in a parsed XML tree, skipping any
 * <?xml?> declaration that fast-xml-parser keeps at position 0. Returns null
 * if no matching element is found.
 */
function findRoot(tree: XmlTree, tagName: string): XmlNode | null {
  for (const node of tree) {
    if (tagOf(node) === tagName) return node;
  }
  return null;
}

/**
 * Resolve the ordered list of slide ZIP paths by walking <p:sldIdLst> in
 * presentation.xml, mapping each <p:sldId>'s r:id through presentation.rels
 * to its Target, then normalizing to the ZIP-absolute path.
 *
 * The order of <p:sldIdLst> children IS the visual slide order — file names
 * are historical and may be out of sequence after reorder / clone / remove.
 */
function resolveSlidePathsInOrder(presentationXml: XmlTree, presentationRels: XmlTree): string[] {
  const sldIdLst = findSldIdLst(presentationXml);
  if (!sldIdLst) return [];

  // Build rId → target map from presentation.rels
  const rIdToTarget = new Map<string, string>();
  for (const root of presentationRels) {
    for (const rel of childrenOf(root)) {
      if (tagOf(rel) !== 'Relationship') continue;
      const attrs = rel[':@'] as Record<string, string> | undefined;
      const id = attrs?.['@_Id'];
      const target = attrs?.['@_Target'];
      const type = attrs?.['@_Type'];
      if (id && target && type?.endsWith('/slide')) {
        rIdToTarget.set(id, target);
      }
    }
  }

  const ordered: string[] = [];
  for (const child of childrenOf(sldIdLst)) {
    if (tagOf(child) !== 'p:sldId') continue;
    const rId = (child[':@'] as Record<string, string> | undefined)?.['@_r:id'];
    if (!rId) continue;
    const target = rIdToTarget.get(rId);
    if (!target) continue;
    // presentation.rels Targets are relative to ppt/_rels/presentation.xml,
    // i.e. relative to ppt/. So "slides/slide3.xml" → "ppt/slides/slide3.xml".
    ordered.push(`ppt/${target.replace(/^\.\.\//, '')}`);
  }
  return ordered;
}

/** Find the <p:sldIdLst> node inside presentation.xml's root. */
function findSldIdLst(presentationXml: XmlTree): XmlNode | null {
  // Root is <p:presentation> with <p:sldIdLst> as a direct child.
  for (const root of presentationXml) {
    if (tagOf(root) === 'p:presentation') {
      for (const c of childrenOf(root)) {
        if (tagOf(c) === 'p:sldIdLst') return c;
      }
    }
  }
  // Fallback: search anywhere in the tree.
  return findFirst(presentationXml, 'p:sldIdLst');
}

// ─── Writer helpers ─────────────────────────────────────────────────────────

const SLOT_ID_RE = /^s(\d+)\.sp(\d+)$/;

function parseSlotId(slotId: string): { slideIndex: number; shapeIndex: number } {
  const m = slotId.match(SLOT_ID_RE);
  if (!m) throw new PptxParseError(`Bad slotId format: ${slotId} (expected s{N}.sp{M})`);
  return { slideIndex: parseInt(m[1], 10), shapeIndex: parseInt(m[2], 10) };
}

/**
 * Find the Nth <p:sp> child under <p:spTree> that has a <p:txBody>. Skips
 * non-text shapes (pictures, charts, group shapes) so the index matches
 * what extractShapes() emitted at read time.
 */
function findShapeByIndex(slideXml: XmlTree, shapeIndex: number): XmlNode | null {
  const spTree = findFirst(slideXml, 'p:spTree');
  if (!spTree) return null;
  let count = 0;
  for (const node of childrenOf(spTree)) {
    if (tagOf(node) !== 'p:sp') continue;
    const txBody = findFirst(childrenOf(node), 'p:txBody');
    if (!txBody) continue;
    if (count === shapeIndex) return node;
    count++;
  }
  return null;
}

/**
 * Snapshot the structural <a:pPr> from the first existing paragraph (if any)
 * so we can clone it onto every new paragraph. Returns null if no template
 * is available — the writer will then emit paragraphs without <a:pPr>.
 */
function captureParagraphTemplate(txBody: XmlNode): XmlNode | null {
  const firstP = childrenOf(txBody).find((c) => tagOf(c) === 'a:p');
  if (!firstP) return null;
  const pPr = childrenOf(firstP).find((c) => tagOf(c) === 'a:pPr');
  return pPr ?? null;
}

/**
 * Snapshot the structural <a:rPr> from the first existing run (if any) so
 * we can clone it onto every new run. Falls back to null if absent — the
 * writer then emits bare <a:r><a:t>...</a:t></a:r>.
 */
function captureRunTemplate(txBody: XmlNode): XmlNode | null {
  for (const p of childrenOf(txBody)) {
    if (tagOf(p) !== 'a:p') continue;
    for (const r of childrenOf(p)) {
      if (tagOf(r) !== 'a:r') continue;
      const rPr = childrenOf(r).find((c) => tagOf(c) === 'a:rPr');
      if (rPr) return rPr;
    }
  }
  return null;
}

/** Deep-clone a node (preserveOrder structure) so we can paste it elsewhere
 *  without aliasing. JSON round-trip is safe because all values are strings/
 *  numbers/objects/arrays — no functions or non-cloneable refs in the tree. */
function cloneNode<T>(node: T): T {
  return JSON.parse(JSON.stringify(node)) as T;
}

/**
 * Rebuild the children of <p:txBody> with the new text content. The
 * <a:bodyPr> and <a:lstStyle> children (if present) are preserved at the
 * front; existing <a:p> paragraphs are replaced with newly-built ones using
 * the captured templates.
 */
function replaceTxBodyText(txBody: XmlNode, newText: string): void {
  const tag = tagOf(txBody);
  if (!tag) throw new PptxParseError('replaceTxBodyText called on a non-element node');

  const pPrTemplate = captureParagraphTemplate(txBody);
  const rPrTemplate = captureRunTemplate(txBody);

  // Preserve everything that ISN'T <a:p>: <a:bodyPr>, <a:lstStyle>, etc.
  const preserved = childrenOf(txBody).filter((c) => tagOf(c) !== 'a:p');

  const lines = newText.split('\n');
  const newParagraphs: XmlNode[] = lines.map((line) => buildParagraph(line, pPrTemplate, rPrTemplate));

  // Mutate in place — txBody[tag] is the children array.
  (txBody as Record<string, XmlNode[]>)[tag] = [...preserved, ...newParagraphs];
}

/**
 * Build a single <a:p> node for the given line, optionally inheriting
 * <a:pPr> and <a:rPr> from captured templates. preserveOrder format:
 *
 *   { "a:p": [ {"a:pPr": [...], ":@": {...}}, {"a:r": [...]} ] }
 */
function buildParagraph(text: string, pPrTemplate: XmlNode | null, rPrTemplate: XmlNode | null): XmlNode {
  const pChildren: XmlNode[] = [];
  if (pPrTemplate) pChildren.push(cloneNode(pPrTemplate));

  const rChildren: XmlNode[] = [];
  if (rPrTemplate) rChildren.push(cloneNode(rPrTemplate));
  // <a:t>{text}</a:t> — text content lives in a child #text node in preserveOrder mode.
  rChildren.push({ 'a:t': [{ '#text': text }] });

  pChildren.push({ 'a:r': rChildren });
  return { 'a:p': pChildren };
}

// ─── Public document API ────────────────────────────────────────────────────

export class PptxDocument {
  private state: DocState;

  private constructor(state: DocState) {
    this.state = state;
  }

  /**
   * Open a .pptx Buffer and parse its slide XMLs into memory.
   * Throws PptxParseError if the buffer isn't a valid .pptx structure.
   */
  static fromBuffer(buf: Buffer): PptxDocument {
    let zip: PizZip;
    try {
      zip = new PizZip(buf);
    } catch (e) {
      throw new PptxParseError(`Not a valid ZIP archive: ${(e as Error).message}`);
    }

    const parser = new XMLParser(PARSE_OPTS);

    // Package-level files we need to mutate for slide ops.
    const presentationXmlStr = zip.file('ppt/presentation.xml')?.asText();
    if (!presentationXmlStr) {
      throw new PptxParseError('Not a valid .pptx: missing ppt/presentation.xml');
    }
    const presentationXml = parser.parse(presentationXmlStr) as XmlTree;

    const presentationRelsStr = zip.file('ppt/_rels/presentation.xml.rels')?.asText();
    if (!presentationRelsStr) {
      throw new PptxParseError('Not a valid .pptx: missing ppt/_rels/presentation.xml.rels');
    }
    const presentationRels = parser.parse(presentationRelsStr) as XmlTree;

    const contentTypesStr = zip.file('[Content_Types].xml')?.asText();
    if (!contentTypesStr) {
      throw new PptxParseError('Not a valid .pptx: missing [Content_Types].xml');
    }
    const contentTypes = parser.parse(contentTypesStr) as XmlTree;

    // Slide XMLs — load in <p:sldIdLst> order, not filename order. Reorder /
    // clone / remove operations only touch sldIdLst + rels; filenames stay
    // historical (slide6.xml may end up at position 2). Honoring sldIdLst on
    // re-parse is what makes the round-trip after reorder work.
    const slideXmlByPath = new Map<string, XmlTree>();
    const orderedPaths = resolveSlidePathsInOrder(presentationXml, presentationRels);
    if (orderedPaths.length === 0) {
      throw new PptxParseError('Not a valid .pptx: <p:sldIdLst> empty or unresolvable');
    }
    for (const path of orderedPaths) {
      const file = zip.file(path);
      if (!file) {
        throw new PptxParseError(`<p:sldIdLst> references ${path} but it's missing from the ZIP`);
      }
      slideXmlByPath.set(path, parser.parse(file.asText()) as XmlTree);
    }

    return new PptxDocument({
      zip,
      slideXmlByPath,
      presentationXml,
      presentationRels,
      contentTypes,
      dirty: new Set(),
    });
  }

  /** Slide canvas size in EMU from `<p:sldSz>`; defaults to 16:9 widescreen. */
  slideSize(): { cx: number; cy: number } {
    const sldSz = findFirst(this.state.presentationXml, 'p:sldSz');
    const a = (sldSz?.[':@'] as Record<string, string> | undefined) ?? {};
    const cx = parseInt(a['@_cx'], 10);
    const cy = parseInt(a['@_cy'], 10);
    return {
      cx: Number.isFinite(cx) && cx > 0 ? cx : 12192000,
      cy: Number.isFinite(cy) && cy > 0 ? cy : 6858000,
    };
  }

  /** Enumerate slides in presentation order with text-bearing shape metadata. */
  slides(): PptxSlide[] {
    const result: PptxSlide[] = [];
    let i = 0;
    for (const [path, xml] of this.state.slideXmlByPath) {
      i++;
      result.push({
        index: i,
        xmlPath: path,
        shapes: extractShapes(xml, i),
        imageCount: countImages(xml),
      });
    }
    return result;
  }

  /**
   * Return the concatenated speaker-notes text for the slide at the given
   * 1-based display index, or `''` when the slide has no notes part.
   *
   * .pptx stores speaker notes in a sibling part `ppt/notesSlides/notesSlideM.xml`
   * (the file index `M` is decoupled from the slide's own filename) reached
   * via the per-slide rels file `ppt/slides/_rels/slideN.xml.rels` under
   * `Type="...relationships/notesSlide"`. We resolve through the rels, parse
   * the notes XML, and walk every `<p:txBody>` — joining every paragraph's
   * runs into `\n`-separated lines.
   *
   * Returns `''` (not null) when:
   *   - the slide has no notesSlide rel,
   *   - the rel target is missing from the ZIP,
   *   - the notes body is empty,
   *   - parsing fails for any reason.
   *
   * Throws PptxParseError only when slideIndex is out of range.
   */
  notes(slideIndex: number): string {
    const paths = Array.from(this.state.slideXmlByPath.keys());
    if (slideIndex < 1 || slideIndex > paths.length) {
      throw new PptxParseError(
        `notes: slide index ${slideIndex} out of range 1..${paths.length}`,
      );
    }
    const slidePath = paths[slideIndex - 1]; // e.g. "ppt/slides/slide3.xml"
    const relsPath = slidePath.replace(/\/(slide\d+\.xml)$/, '/_rels/$1.rels');
    const relsContent = this.state.zip.file(relsPath)?.asText();
    if (!relsContent) return '';

    let notesTarget: string | null = null;
    try {
      const parser = new XMLParser(PARSE_OPTS);
      const relsTree = parser.parse(relsContent) as XmlTree;
      const relsRoot = findRoot(relsTree, 'Relationships');
      if (!relsRoot) return '';
      for (const child of childrenOf(relsRoot)) {
        if (tagOf(child) !== 'Relationship') continue;
        const attrs = child[':@'] as Record<string, string> | undefined;
        const type = attrs?.['@_Type'];
        if (type?.endsWith('/notesSlide')) {
          notesTarget = attrs?.['@_Target'] ?? null;
          break;
        }
      }
    } catch {
      return '';
    }
    if (!notesTarget) return '';

    // Target is relative to ppt/slides/_rels/slideN.xml.rels, i.e. relative
    // to ppt/slides/. Typical values: "../notesSlides/notesSlide3.xml".
    const normalised = notesTarget.startsWith('../')
      ? `ppt/${notesTarget.slice(3)}`
      : `ppt/slides/${notesTarget}`;
    const notesXmlStr = this.state.zip.file(normalised)?.asText();
    if (!notesXmlStr) return '';

    try {
      const parser = new XMLParser(PARSE_OPTS);
      const notesTree = parser.parse(notesXmlStr) as XmlTree;
      const spTree = findFirst(notesTree, 'p:spTree');
      if (!spTree) return '';
      const collected: string[] = [];
      for (const node of childrenOf(spTree)) {
        if (tagOf(node) !== 'p:sp') continue;
        const txBody = findFirst(childrenOf(node), 'p:txBody');
        if (!txBody) continue;
        // Notes placeholders include the slide-number placeholder ("3") — we
        // can't reliably tell it apart from real notes via XML alone, so we
        // include everything; the slide-number footer is usually short and
        // doesn't pollute the prompt. Real-world test on faculty decks
        // confirms this is acceptable.
        const { text } = readTxBodyText(txBody);
        if (text.trim().length > 0) collected.push(text);
      }
      // Collapse to a single string. AI consumers split or trim as needed.
      return collected.join('\n').trim();
    } catch {
      return '';
    }
  }

  /**
   * Reorder slides. `newOrder` is an array of *current 1-based slide indexes*
   * in the desired new order. Throws if the array isn't a permutation.
   *
   * Example: a 3-slide deck with newOrder = [3, 1, 2] makes the last slide
   * the new first, original first becomes second, original second becomes third.
   */
  reorderSlides(newOrder: number[]): void {
    const currentPaths = Array.from(this.state.slideXmlByPath.keys());
    if (newOrder.length !== currentPaths.length) {
      throw new PptxParseError(
        `reorderSlides: newOrder length ${newOrder.length} ≠ slide count ${currentPaths.length}`,
      );
    }
    const seen = new Set<number>();
    for (const idx of newOrder) {
      if (idx < 1 || idx > currentPaths.length || seen.has(idx)) {
        throw new PptxParseError(`reorderSlides: invalid index ${idx} (must be a permutation of 1..${currentPaths.length})`);
      }
      seen.add(idx);
    }

    // Rebuild slideXmlByPath in the new order (Map iteration = insertion order).
    const reorderedPaths = newOrder.map((i) => currentPaths[i - 1]);
    const newMap = new Map<string, XmlTree>();
    for (const p of reorderedPaths) {
      newMap.set(p, this.state.slideXmlByPath.get(p)!);
    }
    this.state.slideXmlByPath = newMap;

    // Reorder the <p:sldId> children inside <p:sldIdLst> the same way.
    const sldIdLst = findSldIdLst(this.state.presentationXml);
    if (!sldIdLst) throw new PptxParseError('reorderSlides: no <p:sldIdLst> in presentation.xml');
    const tag = tagOf(sldIdLst)!;
    const sldIdNodes = (sldIdLst as Record<string, XmlNode[]>)[tag].filter((c) => tagOf(c) === 'p:sldId');
    const otherNodes = (sldIdLst as Record<string, XmlNode[]>)[tag].filter((c) => tagOf(c) !== 'p:sldId');
    const reorderedSldIds = newOrder.map((i) => sldIdNodes[i - 1]);
    (sldIdLst as Record<string, XmlNode[]>)[tag] = [...otherNodes, ...reorderedSldIds];

    this.state.dirty.add('ppt/presentation.xml');
  }

  /**
   * Remove a slide by current 1-based index. Deletes its XML + rels from
   * the ZIP and clears it from presentation.xml / content_types / package rels.
   */
  removeSlide(slideIndex: number): void {
    const paths = Array.from(this.state.slideXmlByPath.keys());
    if (slideIndex < 1 || slideIndex > paths.length) {
      throw new PptxParseError(`removeSlide: index ${slideIndex} out of range 1..${paths.length}`);
    }
    const removedPath = paths[slideIndex - 1];

    // 1) Remove from slideXmlByPath
    this.state.slideXmlByPath.delete(removedPath);

    // 2) Remove from ZIP entries (slide xml + its rels)
    this.state.zip.remove(removedPath);
    const relsPath = removedPath.replace(/\/(slide\d+\.xml)$/, '/_rels/$1.rels');
    if (this.state.zip.file(relsPath)) this.state.zip.remove(relsPath);

    // 3) Remove the <p:sldId> entry from presentation.xml (and capture its rId
    //    so we can clean up presentation.rels next).
    const sldIdLst = findSldIdLst(this.state.presentationXml);
    if (!sldIdLst) throw new PptxParseError('removeSlide: no <p:sldIdLst>');
    const tag = tagOf(sldIdLst)!;
    const allChildren = (sldIdLst as Record<string, XmlNode[]>)[tag];
    const sldIdNodes = allChildren.filter((c) => tagOf(c) === 'p:sldId');
    const removedSldId = sldIdNodes[slideIndex - 1];
    const removedRId = ((removedSldId[':@'] as Record<string, string> | undefined)?.['@_r:id']) ?? null;
    (sldIdLst as Record<string, XmlNode[]>)[tag] = allChildren.filter((c) => c !== removedSldId);
    this.state.dirty.add('ppt/presentation.xml');

    // 4) Remove the matching <Relationship> from presentation.rels.
    //    Skip the <?xml?> declaration at presentationRels[0] — the real
    //    <Relationships> root is found by tag name.
    if (removedRId) {
      const relsRoot = findRoot(this.state.presentationRels, 'Relationships');
      if (relsRoot) {
        const rels = (relsRoot as Record<string, XmlNode[]>)['Relationships'];
        (relsRoot as Record<string, XmlNode[]>)['Relationships'] = rels.filter(
          (r) =>
            ((r[':@'] as Record<string, string> | undefined)?.['@_Id']) !== removedRId,
        );
        this.state.dirty.add('ppt/_rels/presentation.xml.rels');
      }
    }

    // 5) Remove the <Override> for this slide from [Content_Types].xml.
    const ctRoot = findRoot(this.state.contentTypes, 'Types');
    if (ctRoot) {
      const partName = `/${removedPath}`;
      const items = (ctRoot as Record<string, XmlNode[]>)['Types'];
      (ctRoot as Record<string, XmlNode[]>)['Types'] = items.filter(
        (n) =>
          !(
            tagOf(n) === 'Override' &&
            ((n[':@'] as Record<string, string> | undefined)?.['@_PartName']) === partName
          ),
      );
      this.state.dirty.add('[Content_Types].xml');
    }
  }

  /**
   * Clone slide at `sourceIndex` (1-based) and insert the copy at the end.
   * Returns the 1-based index of the new slide. Useful when the AI wants
   * to add a new slide that inherits the source's layout and theme — the
   * new slide is a deep copy, including its rels, so all references to
   * layouts / masters / images point at the same shared assets.
   */
  cloneSlide(sourceIndex: number): number {
    const paths = Array.from(this.state.slideXmlByPath.keys());
    if (sourceIndex < 1 || sourceIndex > paths.length) {
      throw new PptxParseError(`cloneSlide: index ${sourceIndex} out of range 1..${paths.length}`);
    }
    const sourcePath = paths[sourceIndex - 1];

    // 1) Pick a fresh slide filename (slide{maxN+1}.xml) — must be unique
    //    across ALL slide files in the ZIP (current + historical positions).
    const allSlidePaths = Object.keys(this.state.zip.files).filter((p) => SLIDE_PATH_RE.test(p));
    const maxN = Math.max(0, ...allSlidePaths.map(slideNumFromPath));
    const newN = maxN + 1;
    const newPath = `ppt/slides/slide${newN}.xml`;
    const newRelsPath = `ppt/slides/_rels/slide${newN}.xml.rels`;

    // 2) Deep-copy the source slide's XML tree and its rels file.
    const sourceTree = this.state.slideXmlByPath.get(sourcePath)!;
    const clonedTree = cloneNode(sourceTree);
    this.state.slideXmlByPath.set(newPath, clonedTree);

    const sourceRelsPath = sourcePath.replace(/\/(slide\d+\.xml)$/, '/_rels/$1.rels');
    const sourceRelsContent = this.state.zip.file(sourceRelsPath)?.asText();
    if (sourceRelsContent) {
      this.state.zip.file(newRelsPath, sourceRelsContent);
    }
    // The slide XML itself will be written by toBuffer (it's in dirty).
    this.state.dirty.add(newPath);

    // 3) Add a fresh <Relationship Id="rIdN" Target="slides/slideN.xml"/> to
    //    presentation.rels. Skip the <?xml?> declaration at [0] — locate the
    //    actual <Relationships> root by tag name.
    const relsRoot = findRoot(this.state.presentationRels, 'Relationships');
    if (!relsRoot) throw new PptxParseError('cloneSlide: missing <Relationships> root in presentation.rels');
    const existingRels = (relsRoot as Record<string, XmlNode[]>)['Relationships'];
    const maxRId = Math.max(
      0,
      ...existingRels
        .map((r) => ((r[':@'] as Record<string, string> | undefined)?.['@_Id']) ?? '')
        .map((id) => parseInt(id.replace(/^rId/, ''), 10))
        .filter((n) => !isNaN(n)),
    );
    const newRId = `rId${maxRId + 1}`;
    existingRels.push({
      Relationship: [],
      ':@': {
        '@_Id': newRId,
        '@_Type': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
        '@_Target': `slides/slide${newN}.xml`,
      },
    } as XmlNode);
    this.state.dirty.add('ppt/_rels/presentation.xml.rels');

    // 4) Add a <p:sldId> entry to <p:sldIdLst> with a fresh id (must be > 256
    //    and unique across the deck). Append at end so the new slide is last.
    const sldIdLst = findSldIdLst(this.state.presentationXml);
    if (!sldIdLst) throw new PptxParseError('cloneSlide: no <p:sldIdLst>');
    const sldTag = tagOf(sldIdLst)!;
    const sldChildren = (sldIdLst as Record<string, XmlNode[]>)[sldTag];
    const existingIds = sldChildren
      .filter((c) => tagOf(c) === 'p:sldId')
      .map((c) => parseInt(((c[':@'] as Record<string, string> | undefined)?.['@_id']) ?? '0', 10));
    const newSldId = Math.max(256, ...existingIds) + 1;
    sldChildren.push({
      'p:sldId': [],
      ':@': {
        '@_id': String(newSldId),
        '@_r:id': newRId,
      },
    } as XmlNode);
    this.state.dirty.add('ppt/presentation.xml');

    // 5) Register the new slide in [Content_Types].xml. Locate the <Types>
    //    root by tag name (skipping <?xml?> declaration).
    const ctRoot = findRoot(this.state.contentTypes, 'Types');
    if (!ctRoot) throw new PptxParseError('cloneSlide: missing <Types> root in [Content_Types].xml');
    (ctRoot as Record<string, XmlNode[]>)['Types'].push({
      Override: [],
      ':@': {
        '@_PartName': `/${newPath}`,
        '@_ContentType': 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
      },
    } as XmlNode);
    this.state.dirty.add('[Content_Types].xml');

    return this.state.slideXmlByPath.size;
  }

  /**
   * Replace the text content of a single text-bearing shape identified by
   * slotId. Format and structure preservation rules:
   *
   *   • The shape's <p:txBody> wrapper (with <a:bodyPr>, <a:lstStyle>) is
   *     left intact.
   *   • The FIRST paragraph's <a:pPr> is captured as the template — its
   *     bullet markers, indentation, alignment, line spacing all carry
   *     forward to every new paragraph.
   *   • The FIRST run's <a:rPr> is captured as the template — font face,
   *     size, color, bold/italic, language all carry forward to every
   *     new run.
   *   • newText is split on \n. Each line becomes its own <a:p>; multi-style
   *     runs within a line are NOT preserved (v1 collapses to single style).
   *
   * Throws PptxParseError if slotId is unknown.
   */
  patchText(slotId: string, newText: string): void {
    const { slideIndex, shapeIndex } = parseSlotId(slotId);
    // Resolve via current Map order — after clone/remove/reorder ops, slide
    // file numbers (slide5.xml) no longer match display positions, but the
    // Map's insertion order is always kept in sync with <p:sldIdLst>.
    const paths = Array.from(this.state.slideXmlByPath.keys());
    if (slideIndex < 1 || slideIndex > paths.length) {
      throw new PptxParseError(`slotId ${slotId} → slide ${slideIndex} out of range 1..${paths.length}`);
    }
    const path = paths[slideIndex - 1];
    const tree = this.state.slideXmlByPath.get(path);
    if (!tree) {
      throw new PptxParseError(`slotId ${slotId} → no such slide path: ${path}`);
    }
    const sp = findShapeByIndex(tree, shapeIndex);
    if (!sp) {
      throw new PptxParseError(`slotId ${slotId} → shape index ${shapeIndex} not found on slide ${slideIndex}`);
    }
    const txBody = findFirst(childrenOf(sp), 'p:txBody');
    if (!txBody) {
      throw new PptxParseError(`slotId ${slotId} → shape has no <p:txBody>`);
    }
    replaceTxBodyText(txBody, newText);
    this.state.dirty.add(path);
  }

  /**
   * Serialize current in-memory state back to a .pptx Buffer. Slides that
   * haven't been mutated round-trip byte-equal (give or take fast-xml's
   * normalization of whitespace inside tags).
   */
  toBuffer(): Buffer {
    const builder = new XMLBuilder(BUILD_OPTS);

    // Slide XMLs — re-serialize every parsed slide. fast-xml-parser produces
    // deterministic output so unmutated slides round-trip stably.
    for (const [path, xml] of this.state.slideXmlByPath) {
      const built = builder.build(xml) as string;
      this.state.zip.file(path, built);
    }

    // Package files — only re-serialize when something dirtied them.
    if (this.state.dirty.has('ppt/presentation.xml')) {
      this.state.zip.file('ppt/presentation.xml', builder.build(this.state.presentationXml) as string);
    }
    if (this.state.dirty.has('ppt/_rels/presentation.xml.rels')) {
      this.state.zip.file(
        'ppt/_rels/presentation.xml.rels',
        builder.build(this.state.presentationRels) as string,
      );
    }
    if (this.state.dirty.has('[Content_Types].xml')) {
      this.state.zip.file('[Content_Types].xml', builder.build(this.state.contentTypes) as string);
    }

    return this.state.zip.generate({ type: 'nodebuffer' });
  }
}
