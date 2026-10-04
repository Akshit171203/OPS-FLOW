/**
 * The OpsFlow mark: an "O" ring with a signal dot sitting in a gap in its upper right, the way an
 * alert breaks into an otherwise closed loop. White glyph on an accent tile; the tile follows the
 * accent tokens, so it is violet in the app and blue on the sign-in screen.
 */
export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: size * 0.3 }}
      className={`relative grid shrink-0 place-items-center bg-gradient-to-br from-accent-600 to-accent-700 shadow-[inset_0_1px_0_rgb(255_255_255/0.28),0_8px_22px_-8px_var(--color-accent-600)] ${className}`}
    >
      <svg viewBox="0 0 32 32" width={size * 0.88} height={size * 0.88} fill="none">
        <path
          d="M23.78 16.21 A8.4 8.4 0 1 1 15.99 8.42"
          stroke="#fff"
          strokeWidth="3.8"
          strokeLinecap="round"
        />
        <circle cx="22.19" cy="10.01" r="2.9" fill="#fff" />
      </svg>
    </span>
  );
}
