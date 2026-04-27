import type { FileLeak, ScanResult } from '@/cli/scan'
import { ANSI_COLORS, applyColor } from '@/internal/ansi'

/**
 * Options controlling how {@link renderHuman} formats its output.
 *
 * @internal
 */
export type RenderOptions = {
  /** When true, omit the summary line at the end. */
  quiet: boolean
  /** When true, wrap level columns in ANSI color codes. */
  color: boolean
}

/**
 * Width of the location column (file path plus line number). Wider than
 * any realistic path most of the time, but the renderer pads to it
 * regardless so columns stay aligned.
 */
const LOCATION_COLUMN_WIDTH = 28

/**
 * Width of the path column (the dotted path inside the structured
 * record, or the literal `<line>` for plain text matches).
 */
const PATH_COLUMN_WIDTH = 28

/**
 * Width of the kind label column. `KEY` and `VALUE` both fit in five.
 */
const KIND_COLUMN_WIDTH = 5

/**
 * Maximum length of a `matched` substring shown in a value row before
 * the renderer truncates with a trailing ellipsis.
 */
const MATCHED_DISPLAY_LIMIT = 40

/**
 * Render a human readable, columnar leak report.
 *
 * Format per leak row:
 *
 *     <file>:<line>       <path>                KIND   reason
 *
 * Followed by a single summary line:
 *
 *     N leaks in M lines, F file(s), U unique path(s)
 *
 * @internal
 */
export function renderHuman(results: ReadonlyArray<ScanResult>, options: RenderOptions): string {
  const leakRows = results.flatMap((result) => result.leaks.map((leak) => formatLeakRow(leak, options.color)))

  if (options.quiet) return leakRows.join('\n')

  const summary = formatSummaryLine(results)
  if (leakRows.length === 0) return summary
  return [...leakRows, '', summary].join('\n')
}

/**
 * Format a single leak as one human readable row.
 */
function formatLeakRow(leak: FileLeak, useColor: boolean): string {
  const location = `${leak.file}:${leak.line}`.padEnd(LOCATION_COLUMN_WIDTH)
  const paddedPath = leak.path.padEnd(PATH_COLUMN_WIDTH)
  const kindLabel = leak.kind.toUpperCase().padEnd(KIND_COLUMN_WIDTH)
  const reasonText =
    leak.kind === 'key' ? `phrase=${leak.matched}` : `shape=${truncateForDisplay(leak.matched, MATCHED_DISPLAY_LIMIT)}`
  const dimmedLocation = applyColor(ANSI_COLORS.dim, location, useColor)
  const coloredKind = applyColor(ANSI_COLORS.red, kindLabel, useColor)
  return `${dimmedLocation} ${paddedPath} ${coloredKind}  ${reasonText}`
}

/**
 * Format the trailing summary line shown in non quiet mode.
 */
function formatSummaryLine(results: ReadonlyArray<ScanResult>): string {
  const totalLeaks = sumBy(results, (result) => result.leaks.length)
  const totalLines = sumBy(results, (result) => result.lines)
  const fileCount = results.length
  const uniquePathCount = new Set(results.flatMap((result) => result.leaks.map((leak) => leak.path))).size

  const fileWord = fileCount === 1 ? 'file' : 'files'
  const pathWord = uniquePathCount === 1 ? 'path' : 'paths'
  return `${totalLeaks} leaks in ${totalLines} lines, ${fileCount} ${fileWord}, ${uniquePathCount} unique ${pathWord}`
}

/**
 * Sum a numeric projection over an array. Tiny helper that replaces a
 * verbose `reduce` call with a single named call site.
 */
function sumBy<Item>(items: ReadonlyArray<Item>, project: (item: Item) => number): number {
  let total = 0
  for (const item of items) total += project(item)
  return total
}

/**
 * Truncate a string for display, appending the Unicode ellipsis when the
 * source exceeds the limit.
 */
function truncateForDisplay(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

/**
 * Render the documented stable JSON report. The schema is versioned
 * via the `schemaVersion` field so consumers can detect breaking
 * changes between releases.
 *
 * @internal
 */
export function renderJson(results: ReadonlyArray<ScanResult>): string {
  const allLeaks = results.flatMap((result) => result.leaks)
  const totalSkipped = sumBy(results, (result) => result.skipped)
  const uniquePathCount = new Set(allLeaks.map((leak) => leak.path)).size

  return JSON.stringify({
    schemaVersion: 1,
    scanned: results.map((result) => ({ file: result.file, lines: result.lines })),
    leaks: allLeaks,
    summary: {
      total: allLeaks.length,
      uniquePaths: uniquePathCount,
      files: results.length,
      skipped: totalSkipped,
    },
  })
}
