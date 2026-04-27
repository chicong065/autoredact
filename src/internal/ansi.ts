/**
 * ANSI escape codes used by every colored surface in the package, the
 * pretty logger transport and the CLI human renderer. Centralizing the
 * codes prevents the two surfaces from drifting on what `red` or `dim`
 * actually emit.
 *
 * Source code constants (string literals containing ANSI sequences) are
 * exempt from the project writing convention against the ASCII hyphen.
 *
 * @internal
 */
export const ANSI_COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
} as const

/**
 * Detect whether ANSI color output is appropriate for the current process.
 *
 * Browsers and other non Node runtimes return `false` because there is no
 * `process` object at all. Node returns `true` when stdout is a TTY and
 * `NO_COLOR` is unset, or when `FORCE_COLOR` is set, matching the de facto
 * convention shared by chalk, supports color, and friends.
 *
 * @internal
 */
export function detectColorSupport(): boolean {
  if (typeof process === 'undefined') return false
  const environment = (process as { env?: Record<string, string | undefined> }).env ?? {}
  if (environment.NO_COLOR) return false
  if (environment.FORCE_COLOR) return true
  return Boolean((process as { stdout?: { isTTY?: boolean } }).stdout?.isTTY)
}

/**
 * Wrap a string in an ANSI color escape and reset, but only when
 * `useColor` is true. In a non TTY pipe or browser, return the text
 * unchanged so output stays free of garbled escape sequences.
 *
 * @internal
 */
export function applyColor(colorCode: string, text: string, useColor: boolean): string {
  return useColor ? `${colorCode}${text}${ANSI_COLORS.reset}` : text
}
