/**
 * Drawn, never typed: the "×" character sits above the centre of its em box and
 * leans left inside a square button, so every close affordance looked nudged.
 * A path centred on the viewBox lands the same in any font.
 */
export function CloseGlyph() {
  return (
    <svg aria-hidden="true" className="close-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" />
    </svg>
  );
}
