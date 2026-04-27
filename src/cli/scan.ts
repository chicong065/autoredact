import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'

import { DEFAULT_VALUE_PATTERNS } from '@/engine/patterns'
import { walk } from '@/engine/walk'
import type { LeakInfo } from '@/types'

/**
 * Options that control a single scan pass over a file or stream.
 *
 * @internal
 */
export type ScanOptions = {
  /** Per line format. `auto` tries JSON parse first then falls back to text. */
  mode: 'auto' | 'jsonl' | 'text'
  /** Extra sensitive key phrases added on top of the engine defaults. */
  extraPhrases: ReadonlyArray<ReadonlyArray<string>>
  /** Extra value shape regex patterns added on top of the engine defaults. */
  extraPatterns: ReadonlyArray<RegExp>
  /** Whether to run the value shape scan. */
  valueShapes: boolean
}

/**
 * A single leak the scanner found, decorated with the file label and line
 * number that produced it.
 *
 * @internal
 */
export type FileLeak = LeakInfo & { file: string; line: number }

/**
 * Result of scanning one file or stream. Aggregated across all files in
 * the CLI entry point before report rendering.
 *
 * @internal
 */
export type ScanResult = {
  /** Display label for this source (the file path, or `<stdin>`). */
  file: string
  /** Number of non empty lines processed. */
  lines: number
  /** Number of lines skipped because parse failed in `jsonl` mode. */
  skipped: number
  /** Every leak found, in encounter order. */
  leaks: FileLeak[]
}

/**
 * Outcome of attempting to parse a single input line as JSON. The three
 * variants exhaust every possible path through the per line dispatch.
 */
type ParseAttempt = { kind: 'parsed'; value: unknown } | { kind: 'parseFailedFallToText' } | { kind: 'parseFailedSkip' }

/**
 * Scan a file path on disk for leaks. Streams the file line by line via
 * `node:readline` over a `node:fs` read stream so multi gigabyte files
 * never load entirely into memory.
 *
 * @internal
 */
export async function scanFile(filePath: string, options: ScanOptions): Promise<ScanResult> {
  const fileStream = createReadStream(filePath, { encoding: 'utf8' })
  return scanStream(fileStream, filePath, options)
}

/**
 * Scan an arbitrary `Readable` stream for leaks. Used directly for
 * stdin and indirectly for files (via {@link scanFile}).
 *
 * @internal
 */
export async function scanStream(input: Readable, label: string, options: ScanOptions): Promise<ScanResult> {
  const result: ScanResult = { file: label, lines: 0, skipped: 0, leaks: [] }
  const reader = createInterface({ input, crlfDelay: Infinity })
  let lineNumber = 0
  for await (const rawLine of reader) {
    lineNumber++
    if (rawLine.length === 0) continue
    processLine({ line: rawLine, lineNumber, label, result, options })
  }
  return result
}

/**
 * Bundle of inputs threaded into {@link processLine}. Single object so
 * the function signature stays at one parameter and a future addition
 * does not lengthen a positional list.
 */
type LineProcessingInput = {
  line: string
  lineNumber: number
  label: string
  result: ScanResult
  options: ScanOptions
}

/**
 * Process one line of input. Classifies the line via {@link tryParseLine}
 * then dispatches to the structured walker, the text only pattern scan,
 * or the skip counter based on the classification.
 */
function processLine(input: LineProcessingInput): void {
  const { line, lineNumber, label, result, options } = input
  result.lines++

  const attempt = tryParseLine(line, options.mode)

  switch (attempt.kind) {
    case 'parsed':
      runStructuredScan({
        parsed: attempt.value,
        lineNumber,
        label,
        result,
        options,
      })
      return
    case 'parseFailedSkip':
      result.skipped++
      return
    case 'parseFailedFallToText':
      if (!options.valueShapes) return
      runTextPatternScan({
        line,
        lineNumber,
        label,
        patterns: [...DEFAULT_VALUE_PATTERNS, ...options.extraPatterns],
        result,
      })
      return
  }
}

/**
 * Attempt to parse a line as JSON, returning a tagged union that
 * captures every outcome. Pure, no side effects, easy to test in
 * isolation.
 */
function tryParseLine(line: string, mode: ScanOptions['mode']): ParseAttempt {
  if (mode === 'text') return { kind: 'parseFailedFallToText' }
  try {
    return { kind: 'parsed', value: JSON.parse(line) }
  } catch {
    return mode === 'jsonl' ? { kind: 'parseFailedSkip' } : { kind: 'parseFailedFallToText' }
  }
}

/**
 * Bundle of inputs threaded into {@link runStructuredScan}.
 */
type StructuredScanInput = {
  parsed: unknown
  lineNumber: number
  label: string
  result: ScanResult
  options: ScanOptions
}

/**
 * Run the engine walker over a parsed JSON value, collecting every leak
 * into the in flight scan result. The walker handles cycles, depth
 * limits, error serialization, and value shape scrubbing internally.
 */
function runStructuredScan(input: StructuredScanInput): void {
  const { parsed, lineNumber, label, result, options } = input
  walk(
    parsed,
    {
      extraPhrases: options.extraPhrases,
      extraValuePatterns: options.extraPatterns,
      valueShapes: options.valueShapes,
    },
    {
      onLeak: (info) => {
        result.leaks.push({ ...info, file: label, line: lineNumber })
      },
    }
  )
}

/**
 * Bundle of inputs threaded into {@link runTextPatternScan}.
 */
type TextScanInput = {
  line: string
  lineNumber: number
  label: string
  patterns: ReadonlyArray<RegExp>
  result: ScanResult
}

/**
 * Run every value pattern over a single line and append every match to
 * the result. Used in plain text mode (and as the auto mode fallback)
 * where there are no JSON keys to match against.
 *
 * Each pattern carries the `g` flag, so `pattern.exec` advances
 * `lastIndex` between calls. The `lastIndex` reset before the loop
 * neutralizes any state left by an earlier `.test()` call. The defensive
 * advance after a zero width match would only trigger for a user
 * supplied pattern with optional groups.
 */
function runTextPatternScan(input: TextScanInput): void {
  const { line, lineNumber, label, patterns, result } = input
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null = pattern.exec(line)
    while (match !== null) {
      result.leaks.push({
        file: label,
        line: lineNumber,
        path: '<line>',
        kind: 'value',
        matched: match[0],
        reason: 'pattern',
      })
      if (match.index === pattern.lastIndex) {
        pattern.lastIndex++
      }
      match = pattern.exec(line)
    }
  }
}
