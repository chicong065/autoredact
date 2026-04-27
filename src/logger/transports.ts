import { ANSI_COLORS, applyColor, detectColorSupport } from '@/internal/ansi'
import type { Bindings, EmittableLevel, Transport } from '@/types'

/**
 * Width that the level label is padded to in pretty output, derived from
 * the longest level name. Recomputing whenever a new level is added keeps
 * the message column aligned without needing to update a magic number.
 */
const LEVEL_LABEL_WIDTH = Math.max(
  'trace'.length,
  'debug'.length,
  'info'.length,
  'warn'.length,
  'error'.length,
  'fatal'.length
)

/**
 * Map from log level to its preferred ANSI color in pretty output.
 *
 * Typed as `Record<EmittableLevel, string>` so the compiler enforces a
 * color for every emittable level. A future level addition fails the
 * typecheck rather than silently rendering uncolored.
 */
const LEVEL_COLORS: Record<EmittableLevel, string> = {
  trace: ANSI_COLORS.dim,
  debug: ANSI_COLORS.cyan,
  info: ANSI_COLORS.green,
  warn: ANSI_COLORS.yellow,
  error: ANSI_COLORS.red,
  fatal: ANSI_COLORS.magenta,
}

/**
 * Cached result of {@link detectColorSupport}. Color support is determined
 * once at module load and reused for every log call to avoid touching
 * `process.stdout` on the hot path.
 */
const COLOR_SUPPORTED = detectColorSupport()

/**
 * Default JSON transport. Writes the serialized log line via `console.log`,
 * which works in Node (stdout), browsers (devtools), edge runtimes, and
 * worker threads.
 */
export const jsonTransport: Transport = (line) => {
  console.log(line)
}

/**
 * Human readable transport for development. Renders, in order:
 *
 * 1. A dimmed `HH:MM:SS` slice extracted from the record's ISO timestamp.
 * 2. A colored level label (uppercased and padded to the longest level).
 * 3. The optional message string.
 * 4. Any remaining fields as a compact JSON tail (only when there are any).
 *
 * Color is auto enabled when `process.stdout.isTTY` is true and `NO_COLOR`
 * is unset, or when `FORCE_COLOR` is set. In browsers, non TTY pipes, or
 * when `NO_COLOR` is set, the output is plain ASCII without escapes.
 */
export const prettyTransport: Transport = (_line, record) => {
  const { time, level, msg, ...remainingFields } = record
  const colorCode = LEVEL_COLORS[level]
  const timeSlice = typeof time === 'string' ? time.slice(11, 19) : ''
  const dimmedTime = applyColor(ANSI_COLORS.dim, timeSlice, COLOR_SUPPORTED)
  const coloredLevel = applyColor(colorCode, level.toUpperCase().padEnd(LEVEL_LABEL_WIDTH), COLOR_SUPPORTED)
  const renderedHead = `${dimmedTime} ${coloredLevel} ${msg ?? ''}`
  if (Object.keys(remainingFields).length === 0) {
    console.log(renderedHead)
  } else {
    console.log(renderedHead, JSON.stringify(remainingFields))
  }
}

/**
 * Resolve the user supplied transport option to an actual transport
 * function.
 *
 * * `'json'` (or `undefined`) returns {@link jsonTransport}.
 * * `'pretty'` returns {@link prettyTransport}.
 * * A function passes through unchanged for custom destinations.
 *
 * The `TBindings` parameter threads the calling logger's binding shape
 * back through to the returned transport. Default transports do not
 * inspect bindings, so they are assignable to any `Transport<TBindings>`
 * via the standard contravariance of function arguments.
 *
 * @typeParam TBindings - Static binding shape of the calling logger.
 */
export function resolveTransport<TBindings extends Bindings = Bindings>(
  transport: 'json' | 'pretty' | Transport<TBindings> | undefined
): Transport<TBindings> {
  if (typeof transport === 'function') return transport
  if (transport === 'pretty') return prettyTransport as Transport<TBindings>
  return jsonTransport as Transport<TBindings>
}
