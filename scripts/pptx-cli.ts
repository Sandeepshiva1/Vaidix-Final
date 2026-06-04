// ════════════════════════════════════════════════════════════════════════════
// PPTX CLI — manual smoke-test surface for the Phase 2 parser
// ════════════════════════════════════════════════════════════════════════════
// Lets you throw any real .pptx file (LVPEI deck, third-party, etc.) at
// PptxDocument without wiring it into the wizard. Open the output .pptx in
// PowerPoint / Keynote / LibreOffice to verify formatting was preserved.
//
// Usage (all paths can be relative):
//
//   npm run pptx -- inspect <input.pptx>
//   npm run pptx -- patch   <input.pptx> <slotId> <"new text"> <output.pptx>
//   npm run pptx -- clone   <input.pptx> <slideIndex> <output.pptx>
//   npm run pptx -- remove  <input.pptx> <slideIndex> <output.pptx>
//   npm run pptx -- reorder <input.pptx> <comma,separated,1-based> <output.pptx>
//
// Examples:
//
//   npm run pptx -- inspect ./fixtures/glaucoma.pptx
//   npm run pptx -- patch ./fixtures/glaucoma.pptx s2.sp0 "POAG Management — 2024" ./out.pptx
//   npm run pptx -- clone ./fixtures/glaucoma.pptx 3 ./out.pptx
//   npm run pptx -- reorder ./fixtures/glaucoma.pptx 3,1,2 ./out.pptx

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PptxDocument } from '@/server/services/pptx/pptx-document';

function usage(): never {
  console.error(`
PPTX CLI — manual smoke-test for the Phase 2 parser

Commands:
  inspect <input.pptx>
      Dump the slide list with shape slot IDs + text content.

  patch <input.pptx> <slotId> "<new text>" <output.pptx>
      Replace one shape's text. Use \\n in the text for new lines.

  clone <input.pptx> <slideIndex> <output.pptx>
      Duplicate a slide at the end of the deck.

  remove <input.pptx> <slideIndex> <output.pptx>
      Drop a slide.

  reorder <input.pptx> <comma,separated,indexes> <output.pptx>
      Reorder slides. Example: 3,1,2 makes slide 3 the new first.
`);
  process.exit(2);
}

async function load(path: string): Promise<{ doc: PptxDocument; abs: string }> {
  const abs = resolve(path);
  const buf = await readFile(abs);
  return { doc: PptxDocument.fromBuffer(buf), abs };
}

async function save(doc: PptxDocument, path: string): Promise<string> {
  const abs = resolve(path);
  await writeFile(abs, doc.toBuffer());
  return abs;
}

function truncate(s: string, n = 80): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function printSlides(doc: PptxDocument): void {
  const slides = doc.slides();
  console.log(`\n📊 ${slides.length} slide${slides.length === 1 ? '' : 's'}\n`);
  for (const s of slides) {
    console.log(`──── Slide ${s.index} ─────────────────────────────────────────────────────`);
    console.log(`   xmlPath: ${s.xmlPath}`);
    console.log(`   images:  ${s.imageCount}`);
    if (s.shapes.length === 0) {
      console.log(`   shapes:  (none with text)`);
    } else {
      for (const sh of s.shapes) {
        const tag = sh.isTitle ? '[TITLE]' : '       ';
        const oneLine = sh.text.replace(/\n/g, ' / ');
        console.log(`   ${tag} ${sh.slotId.padEnd(8)} (${sh.paragraphCount}p) ${truncate(oneLine, 100)}`);
      }
    }
  }
  console.log('');
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) usage();

  switch (command) {
    case 'inspect': {
      const [input] = rest;
      if (!input) usage();
      const { doc, abs } = await load(input);
      console.log(`📄 ${abs}`);
      printSlides(doc);
      break;
    }

    case 'patch': {
      const [input, slotId, newText, output] = rest;
      if (!input || !slotId || newText === undefined || !output) usage();
      const { doc } = await load(input);
      // Interpret literal "\n" in shell arg as a real newline.
      const decoded = newText.replace(/\\n/g, '\n');
      doc.patchText(slotId, decoded);
      const outAbs = await save(doc, output);
      console.log(`✅ patched slot ${slotId} → ${outAbs}`);
      printSlides(doc);
      break;
    }

    case 'clone': {
      const [input, idxStr, output] = rest;
      if (!input || !idxStr || !output) usage();
      const { doc } = await load(input);
      const newIdx = doc.cloneSlide(parseInt(idxStr, 10));
      const outAbs = await save(doc, output);
      console.log(`✅ cloned slide ${idxStr} → new position ${newIdx} → ${outAbs}`);
      printSlides(doc);
      break;
    }

    case 'remove': {
      const [input, idxStr, output] = rest;
      if (!input || !idxStr || !output) usage();
      const { doc } = await load(input);
      doc.removeSlide(parseInt(idxStr, 10));
      const outAbs = await save(doc, output);
      console.log(`✅ removed slide ${idxStr} → ${outAbs}`);
      printSlides(doc);
      break;
    }

    case 'reorder': {
      const [input, csv, output] = rest;
      if (!input || !csv || !output) usage();
      const order = csv.split(',').map((x) => parseInt(x.trim(), 10));
      const { doc } = await load(input);
      doc.reorderSlides(order);
      const outAbs = await save(doc, output);
      console.log(`✅ reordered to [${order.join(', ')}] → ${outAbs}`);
      printSlides(doc);
      break;
    }

    default:
      usage();
  }
}

main().catch((err) => {
  console.error('Error:', (err as Error).message);
  process.exit(1);
});
