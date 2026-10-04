import { GLYPH, WORDMARK } from './logoPaths';

/** The OpsFlow wordmark. Drawn with `currentColor`, so it is dark on light screens and light on dark ones. */
export function LogoWordmark({
  height = 26,
  className = '',
}: {
  height?: number;
  className?: string;
}) {
  const [, , w, h] = WORDMARK.viewBox.split(' ').map(Number) as [number, number, number, number];
  return (
    <svg
      role="img"
      aria-label="OpsFlow"
      viewBox={WORDMARK.viewBox}
      width={(height * w) / h}
      height={height}
      className={className}
      fill="currentColor"
    >
      <path d={WORDMARK.d} fillRule="evenodd" />
    </svg>
  );
}

/** Just the custom "F", for places that need a compact mark. */
export function LogoGlyph({
  height = 24,
  className = '',
}: {
  height?: number;
  className?: string;
}) {
  const [, , w, h] = GLYPH.viewBox.split(' ').map(Number) as [number, number, number, number];
  return (
    <svg
      aria-hidden="true"
      viewBox={GLYPH.viewBox}
      width={(height * w) / h}
      height={height}
      className={className}
      fill="currentColor"
    >
      <path d={GLYPH.d} fillRule="evenodd" />
    </svg>
  );
}
