'use client';

// ════════════════════════════════════════════════════════════════════════════
// FaithfulSlide — PowerPoint-like in-place editor for a VERBATIM-imported deck.
// Renders the rasterised ORIGINAL slide image and lays editable text boxes over
// it at the exact positions of the original PPTX shapes (see SlideOverlay). The
// deck looks identical to the upload; clicking any text edits it in place.
//
// Fidelity trick: a box's overlay text is TRANSPARENT until you focus/edit it,
// so an untouched slide is pixel-identical to the original image (its own baked
// text shows through). On focus the box paints its fill (or white) to mask the
// baked text and reveals the editable text in its real colour. Edited boxes
// stay masked so your new text reads cleanly.
// ════════════════════════════════════════════════════════════════════════════

import { useLayoutEffect, useRef, useState } from 'react';
import type { OverlayBox, SlideOverlay } from '@/lib/deck-overlay';
import { cn } from '@/lib/utils';

export function FaithfulSlide({
  imageUrl,
  overlay,
  editable = false,
  onBoxChange,
}: {
  imageUrl: string;
  overlay: SlideOverlay;
  /** When false, the slide is view-only (e.g. thumbnails / present). */
  editable?: boolean;
  /** Commit the new text for one box (by slotId). */
  onBoxChange?: (slotId: string, text: string) => void;
}) {
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ aspectRatio: '16 / 9', containerType: 'size', background: '#fff' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ objectFit: 'contain' }}
        draggable={false}
      />
      {overlay.boxes.map((b) => (
        <OverlayTextBox
          key={b.slotId}
          box={b}
          editable={editable}
          onCommit={(text) => onBoxChange?.(b.slotId, text)}
        />
      ))}
    </div>
  );
}

function OverlayTextBox({
  box,
  editable,
  onCommit,
}: {
  box: OverlayBox;
  editable: boolean;
  onCommit: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  // "edited" survives blur so the masked, re-rendered text keeps covering the
  // baked-in original (which no longer matches).
  const [edited, setEdited] = useState(false);

  // Sync DOM ← prop only while not focused (never fight the caret).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || el === document.activeElement) return;
    if (el.innerText !== box.text) el.innerText = box.text;
  }, [box.text]);

  const masked = focused || edited;
  const align =
    box.align === 'ctr' ? 'center' : box.align === 'r' ? 'right' : box.align === 'just' ? 'justify' : 'left';
  const justify = box.valign === 'ctr' ? 'center' : box.valign === 'b' ? 'flex-end' : 'flex-start';
  const maskBg = box.fillHex ? `#${box.fillHex}` : '#ffffff';
  const textColor = masked ? (box.colorHex ? `#${box.colorHex}` : '#111111') : 'transparent';

  return (
    <div
      className={cn(
        'absolute flex flex-col transition-[outline,box-shadow]',
        editable && 'hover:outline hover:outline-2 hover:outline-sky-400/50',
      )}
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
        justifyContent: justify,
        overflow: 'hidden',
        background: masked ? maskBg : 'transparent',
        boxSizing: 'border-box',
        padding: '0.3%',
      }}
    >
      <div
        ref={ref}
        contentEditable={editable}
        suppressContentEditableWarning
        spellCheck
        onFocus={() => setFocused(true)}
        onInput={() => { if (!edited) setEdited(true); }}
        onBlur={(e) => {
          setFocused(false);
          const text = (e.currentTarget.innerText ?? '').replace(/\n$/, '');
          if (text !== box.text) {
            setEdited(true);
            onCommit(text);
          } else if (!text.trim()) {
            setEdited(false);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.currentTarget.innerText = box.text;
            e.currentTarget.blur();
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        style={{
          outline: 'none',
          cursor: editable ? 'text' : 'default',
          color: textColor,
          caretColor: box.colorHex ? `#${box.colorHex}` : '#111111',
          fontWeight: box.bold ? 700 : 400,
          fontStyle: box.italic ? 'italic' : 'normal',
          textAlign: align,
          fontSize: box.fontPct ? `${box.fontPct * 100}cqh` : '3cqh',
          lineHeight: 1.15,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          width: '100%',
        }}
      />
    </div>
  );
}
