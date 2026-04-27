#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { renderHuman, renderJson } from '@/cli/format'
import { parseFlags } from '@/cli/parse-flags'
import type { ParsedFlags } from '@/cli/parse-flags'
import { scanFile, scanStream } from '@/cli/scan'
import type { ScanOptions, ScanResult } from '@/cli/scan'
import { detectColorSupport } from '@/internal/ansi'

/**
 * Help banner printed for `--help`. Kept in sync with the flag table in
 * `parse-flags.ts`. The first line is the synopsis.
 */
const HELP_BANNER = `autoredact-scan, find leaked secrets in log files

Usage:
  autoredact-scan [options] [file...]
  cat app.log | autoredact-scan [options]

Options:
  --json                   Emit JSON report instead of human readable
  --quiet                  Print only leak lines (no summary)
  --strict                 Exit 1 if any leak found
  --mode <auto|jsonl|text> Force per line format (default: auto)
  --phrase <a,b,...>       Add sensitive phrase, repeatable
  --pattern <regex>        Add value shape regex such as /AB[0-9]+/i, repeatable
  --no-value-shapes        Disable value shape scan
  -h, --help               Print this help
  -v, --version            Print version

Exit codes:
  0  success (or leaks found in non strict mode)
  1  leaks found AND --strict was set
  2  usage error
`

/**
 * Version string printed for `--version`. Kept literally in source so
 * the CLI does not need to read `package.json` at runtime, which would
 * pull a Node specific I/O dependency into the bundle.
 */
const CLI_VERSION = 'autoredact-scan v0.1.0'

/**
 * Exit code 0, success or leaks found in non strict mode.
 */
const EXIT_OK = 0

/**
 * Exit code 1, leaks found and strict mode was requested.
 */
const EXIT_LEAKS_IN_STRICT_MODE = 1

/**
 * Exit code 2, usage error (bad flag, missing value, file not readable).
 */
const EXIT_USAGE_ERROR = 2

/**
 * Stdin substitute marker for the file argument list. A single dash on
 * its own is the conventional "read from stdin" signal across CLIs.
 */
const STDIN_FILE_TOKEN = '-'

/**
 * Display label used for stdin in scan results.
 */
const STDIN_DISPLAY_LABEL = '<stdin>'

/**
 * Translate parsed CLI flags into the {@link ScanOptions} shape that
 * the scanner consumes.
 */
function flagsToScanOptions(flags: ParsedFlags): ScanOptions {
  return {
    mode: flags.mode,
    extraPhrases: flags.phrases,
    extraPatterns: flags.patterns,
    valueShapes: flags.valueShapes,
  }
}

/**
 * Run the scan over every input source named in `flags`. If no file
 * argument was supplied, read from stdin. A literal `-` in the file
 * list is also treated as stdin.
 */
async function runScans(flags: ParsedFlags, options: ScanOptions): Promise<ScanResult[]> {
  if (flags.files.length === 0) {
    return [await scanStream(process.stdin, STDIN_DISPLAY_LABEL, options)]
  }

  // Files are scanned sequentially on purpose. Output order must match the
  // order the user listed files, and each scan streams a potentially huge
  // file, so running them in parallel via `Promise.all` would multiply
  // memory pressure with no payoff.
  const results: ScanResult[] = []
  for (const filePath of flags.files) {
    results.push(await scanOneSource(filePath, options))
  }
  return results
}

/**
 * Scan a single source path, dispatching to stdin handling for the
 * conventional `-` token and to {@link scanFile} otherwise.
 */
async function scanOneSource(filePath: string, options: ScanOptions): Promise<ScanResult> {
  if (filePath === STDIN_FILE_TOKEN) {
    return scanStream(process.stdin, STDIN_DISPLAY_LABEL, options)
  }
  await assertReadableFile(filePath)
  return scanFile(filePath, options)
}

/**
 * Verify that a file path exists and points at a regular file. Throws a
 * descriptive `Error` for the CLI entry to convert into an exit code 2
 * usage error.
 *
 * The two concerns (cannot stat the path, can stat but it is not a
 * regular file) are kept in separate code paths to avoid the brittle
 * pattern of catching the stat error and re inspecting its message.
 */
async function assertReadableFile(filePath: string): Promise<void> {
  let stats: Awaited<ReturnType<typeof stat>>
  try {
    stats = await stat(filePath)
  } catch {
    throw new Error(`cannot read: ${filePath}`)
  }
  if (!stats.isFile()) {
    throw new Error(`not a regular file: ${filePath}`)
  }
}

/**
 * Compute the exit code for a finished scan. Strict mode plus any leak
 * yields 1, every other case yields 0.
 */
function computeExitCode(strict: boolean, results: ReadonlyArray<ScanResult>): number {
  if (!strict) return EXIT_OK
  const totalLeaks = results.reduce((accumulator, result) => accumulator + result.leaks.length, 0)
  return totalLeaks > 0 ? EXIT_LEAKS_IN_STRICT_MODE : EXIT_OK
}

/**
 * Reduce an unknown caught value to a single line description suitable
 * for stderr. Anything thrown can be a non Error (a string, a number, a
 * frozen object), so the cast based shorthand `(error as Error).message`
 * is unsafe. The `instanceof` guard reads the message only when the
 * thrown value is an actual Error and falls back to `String(...)`
 * otherwise.
 */
function describeError(caughtValue: unknown): string {
  if (caughtValue instanceof Error) return caughtValue.message
  return String(caughtValue)
}

/**
 * CLI entry. Parses argv, dispatches help and version, runs the scans,
 * renders the report, returns an exit code. All errors are caught and
 * mapped to exit code 2 with a stderr message.
 *
 * Returns the intended exit code rather than calling `process.exit`
 * directly so the function is testable in isolation.
 *
 * @internal
 */
export async function main(argv: ReadonlyArray<string>): Promise<number> {
  let flags: ParsedFlags
  try {
    flags = parseFlags(argv)
  } catch (parseError) {
    process.stderr.write(`autoredact-scan: ${describeError(parseError)}\n`)
    return EXIT_USAGE_ERROR
  }

  if (flags.help) {
    process.stdout.write(HELP_BANNER)
    return EXIT_OK
  }
  if (flags.version) {
    process.stdout.write(`${CLI_VERSION}\n`)
    return EXIT_OK
  }

  let results: ScanResult[]
  try {
    results = await runScans(flags, flagsToScanOptions(flags))
  } catch (scanError) {
    process.stderr.write(`autoredact-scan: ${describeError(scanError)}\n`)
    return EXIT_USAGE_ERROR
  }

  const renderedOutput = flags.json
    ? renderJson(results)
    : renderHuman(results, { quiet: flags.quiet, color: detectColorSupport() })

  process.stdout.write(renderedOutput + '\n')

  return computeExitCode(flags.strict, results)
}

/**
 * Run the CLI when this file is the process entry, not when imported.
 *
 * The naive form `import.meta.url === \`file://${process.argv[1]}\`` breaks
 * in three real scenarios that matter for a published bin: Windows paths
 * use backslashes and a drive letter so the constructed string is not a
 * valid `file://` URL, package managers install bin entries as symlinks
 * (so `import.meta.url` resolves through to the real file while
 * `process.argv[1]` keeps the symlink path), and any path containing
 * spaces or unicode is left unencoded.
 *
 * Comparing the resolved real paths sidesteps every one of those.
 */
function isProcessEntry(): boolean {
  const argvScript = process.argv[1]
  if (!argvScript) return false
  try {
    const thisModulePath = realpathSync(fileURLToPath(import.meta.url))
    const invokedScriptPath = realpathSync(argvScript)
    return thisModulePath === invokedScriptPath
  } catch {
    return false
  }
}

if (isProcessEntry()) {
  main(process.argv.slice(2)).then(
    (exitCode) => process.exit(exitCode),
    (uncaughtError) => {
      process.stderr.write(`autoredact-scan: ${describeError(uncaughtError)}\n`)
      process.exit(EXIT_USAGE_ERROR)
    }
  )
}
