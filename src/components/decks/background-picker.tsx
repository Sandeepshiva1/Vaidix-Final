'use client';

// ════════════════════════════════════════════════════════════════════════════
// BackgroundPicker — compact per-deck background colour control.
// The swatch opens the native colour picker; "Reset" clears the override so
// the slide falls back to the active theme's default background. Stores/emits a
// bare 6-char hex (no '#') to match the API + DB (`DeckForgeJob.backgroundHex`).
// Shared by the legacy deck editor and the studio so both surfaces behave the
// same regardless of which one the faculty opens.
// ════════════════════════════════════════════════════════════════════════════

export function BackgroundPicker({
  value,
  themeDefault,
  onChange,
  onReset,
}: {
  /** Current override hex (no '#'), or null when using the theme default. */
  value: string | null;
  /** The active theme's default bg (CSS hex with '#') — shown when no override. */
  themeDefault: string;
  /** Emits a bare 6-char hex (no '#'). */
  onChange: (hex: string) => void;
  /** Clears the override. */
  onReset: () => void;
}) {
  const current = value ? `#${value}` : themeDefault;
  return (
    <div className="flex items-center gap-1.5" title="Slide background colour">
      <label
        className="relative inline-flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border/60"
        aria-label="Pick slide background colour"
      >
        <span className="absolute inset-0" style={{ background: current }} />
        <input
          type="color"
          // Native colour inputs only accept #rrggbb; rgba/var themes fall back
          // to black as the picker's starting value but never overwrite state
          // until the user actually picks.
          value={/^#[0-9a-fA-F]{6}$/.test(current) ? current : '#000000'}
          onChange={(e) => onChange(e.target.value.replace('#', '').toLowerCase())}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      {value && (
        <button
          type="button"
          onClick={onReset}
          className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          title="Reset background to theme default"
        >
          Reset
        </button>
      )}
    </div>
  );
}
