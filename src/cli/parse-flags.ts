/**
 * Result of parsing the `autoredact-scan` argument vector. Every field
 * has a documented default that {@link parseFlags} fills in even when
 * the argument vector is empty.
 *
 * @internal
 */
export type ParsedFlags = {
  /** Positional file arguments, in input order. */
  files: string[]
  /** Emit a JSON report instead of the human readable form. */
  json: boolean
  /** Suppress the summary, print only the leak lines. */
  quiet: boolean
  /** Exit with code 1 when any leak is found. */
  strict: boolean
  /** Per line format. `auto` tries JSON parse first then falls back to text. */
  mode: 'auto' | 'jsonl' | 'text'
  /** Extra sensitive key phrases supplied via repeated `--phrase` flags. */
  phrases: string[][]
  /** Extra value shape regex patterns supplied via repeated `--pattern` flags. */
  patterns: RegExp[]
  /** Whether to run the value shape scan. Defaults to true. */
  valueShapes: boolean
  /** Print the help banner and exit. */
  help: boolean
  /** Print the version string and exit. */
  version: boolean
}

/**
 * Match a slash delimited regex literal of the form `/source/flags`.
 */
const REGEX_LITERAL_FORM = /^\/(.+)\/([gimsuy]*)$/

/**
 * Build a fresh `ParsedFlags` populated with documented defaults.
 */
function createDefaultParsedFlags(): ParsedFlags {
  return {
    files: [],
    json: false,
    quiet: false,
    strict: false,
    mode: 'auto',
    phrases: [],
    patterns: [],
    valueShapes: true,
    help: false,
    version: false,
  }
}

/**
 * Behavior shared by every flag definition in the dispatch table. A flag
 * is either a boolean toggle or a flag that consumes a single value.
 * Both kinds carry an `apply` function that mutates the in flight result.
 */
type FlagBehavior =
  | { kind: 'boolean'; apply: (result: ParsedFlags) => void }
  | { kind: 'value'; apply: (result: ParsedFlags, value: string) => void }

/**
 * One row in the flag dispatch table. Lists every accepted alias for the
 * flag plus its behavior. Aliases let `-h` and `--help` share a single
 * `apply` function rather than duplicating logic across two switch arms.
 */
type FlagDefinition = {
  names: ReadonlyArray<string>
} & FlagBehavior

/**
 * Compile a `--pattern` argument value into a global flagged `RegExp`.
 *
 * Accepts either a slash delimited literal (`/abc/i`) or a bare source
 * string (`abc`). The `g` flag is always added so the resulting regex
 * works with `String.prototype.replace` over multiple matches.
 */
function compilePatternFlag(rawPattern: string): RegExp {
  const literalMatch = REGEX_LITERAL_FORM.exec(rawPattern)
  if (literalMatch) {
    const source = literalMatch[1]!
    const userFlags = literalMatch[2] ?? ''
    const flags = userFlags.includes('g') ? userFlags : `${userFlags}g`
    return new RegExp(source, flags)
  }
  return new RegExp(rawPattern, 'g')
}

/**
 * Parse a `--phrase` argument value into a token list. Splits on commas,
 * trims whitespace, and drops empty tokens produced by trailing or
 * doubled commas.
 */
function parsePhraseValue(rawPhrase: string): string[] {
  return rawPhrase
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
}

/**
 * Validate a `--mode` argument value, narrowing the input to the
 * literal union accepted by {@link ParsedFlags.mode}.
 */
function parseModeValue(rawMode: string): ParsedFlags['mode'] {
  if (rawMode !== 'auto' && rawMode !== 'jsonl' && rawMode !== 'text') {
    throw new Error(`--mode must be auto, jsonl, or text, got ${rawMode}`)
  }
  return rawMode
}

/**
 * Dispatch table for every supported flag. Adding a new flag means adding
 * one row here, no changes to {@link parseFlags} itself.
 */
const FLAG_DEFINITIONS: ReadonlyArray<FlagDefinition> = [
  {
    names: ['-h', '--help'],
    kind: 'boolean',
    apply: (result) => {
      result.help = true
    },
  },
  {
    names: ['-v', '--version'],
    kind: 'boolean',
    apply: (result) => {
      result.version = true
    },
  },
  {
    names: ['--json'],
    kind: 'boolean',
    apply: (result) => {
      result.json = true
    },
  },
  {
    names: ['--quiet'],
    kind: 'boolean',
    apply: (result) => {
      result.quiet = true
    },
  },
  {
    names: ['--strict'],
    kind: 'boolean',
    apply: (result) => {
      result.strict = true
    },
  },
  {
    names: ['--no-value-shapes'],
    kind: 'boolean',
    apply: (result) => {
      result.valueShapes = false
    },
  },
  {
    names: ['--mode'],
    kind: 'value',
    apply: (result, value) => {
      result.mode = parseModeValue(value)
    },
  },
  {
    names: ['--phrase'],
    kind: 'value',
    apply: (result, value) => {
      result.phrases.push(parsePhraseValue(value))
    },
  },
  {
    names: ['--pattern'],
    kind: 'value',
    apply: (result, value) => {
      result.patterns.push(compilePatternFlag(value))
    },
  },
]

/**
 * Lookup map keyed by every alias of every flag. Built once at module
 * load so flag dispatch is O(1) per argument.
 */
const FLAG_LOOKUP: ReadonlyMap<string, FlagDefinition> = new Map(
  FLAG_DEFINITIONS.flatMap((definition) => definition.names.map((name) => [name, definition] as const))
)

/**
 * Stateful reader over the argument vector. Encapsulates the cursor so
 * {@link parseFlags} never directly manipulates an index, and so the
 * `--mode value` form can pull a follow up token without exposing the
 * cursor to a flag handler.
 */
class ArgumentReader {
  #cursor = 0

  constructor(private readonly argv: ReadonlyArray<string>) {}

  hasNext(): boolean {
    return this.#cursor < this.argv.length
  }

  takeNext(): string {
    const value = this.argv[this.#cursor]
    if (value === undefined) {
      throw new Error('argument reader exhausted')
    }
    this.#cursor++
    return value
  }

  takeRemaining(): string[] {
    const remaining = this.argv.slice(this.#cursor)
    this.#cursor = this.argv.length
    return remaining
  }
}

/**
 * Split an argument like `--mode=text` into the flag name and its inline
 * value. For arguments without an `=`, the inline value is undefined and
 * the value, if any, comes from the next position in the reader.
 */
function splitFlagAndInlineValue(argument: string): {
  flagName: string
  inlineValue: string | undefined
} {
  const equalsIndex = argument.indexOf('=')
  if (equalsIndex === -1) {
    return { flagName: argument, inlineValue: undefined }
  }
  return {
    flagName: argument.slice(0, equalsIndex),
    inlineValue: argument.slice(equalsIndex + 1),
  }
}

/**
 * Resolve the value for a `value` kind flag. Prefer the inline form
 * (`--mode=text`), fall back to the next argument in the reader
 * (`--mode text`), or throw a descriptive error if nothing follows.
 */
function resolveValueForFlag(flagName: string, inlineValue: string | undefined, reader: ArgumentReader): string {
  if (inlineValue !== undefined) return inlineValue
  if (!reader.hasNext()) {
    throw new Error(`flag ${flagName} requires a value`)
  }
  return reader.takeNext()
}

/**
 * Apply one flag argument to the in flight result. Looks the flag up in
 * {@link FLAG_LOOKUP} and dispatches by kind. Throws on unknown flags.
 */
function applyFlagArgument(argument: string, reader: ArgumentReader, result: ParsedFlags): void {
  const { flagName, inlineValue } = splitFlagAndInlineValue(argument)
  const definition = FLAG_LOOKUP.get(flagName)
  if (definition === undefined) {
    throw new Error(`unknown flag: ${flagName}`)
  }

  if (definition.kind === 'boolean') {
    definition.apply(result)
    return
  }

  const value = resolveValueForFlag(flagName, inlineValue, reader)
  definition.apply(result, value)
}

/**
 * Parse a CLI argument vector into a normalized {@link ParsedFlags}
 * record. Hand rolled because the project carries zero runtime
 * dependencies, so commander, yargs, and meow are all out of scope.
 *
 * Supported forms:
 *
 * * Boolean flags, `--json`, `--quiet`, `--strict`, `--no-value-shapes`,
 *   `-h`, `--help`, `-v`, `--version`.
 * * Single value flags, `--mode auto` or `--mode=auto`.
 * * Repeatable flags, `--phrase a,b`, `--phrase c` (each occurrence appends).
 * * Repeatable regex flags, `--pattern /abc/i`, `--pattern xyz`.
 * * The double dash terminator stops flag parsing, every remaining
 *   argument becomes a positional file.
 *
 * Throws `Error` for unknown flags, missing required values, and
 * malformed `--mode` values. The CLI entry catches these throws and
 * exits with code 2.
 *
 * @param argv - The argument vector, typically `process.argv.slice(2)`.
 * @returns The normalized record.
 *
 * @internal
 */
export function parseFlags(argv: ReadonlyArray<string>): ParsedFlags {
  const result = createDefaultParsedFlags()
  const reader = new ArgumentReader(argv)

  while (reader.hasNext()) {
    const argument = reader.takeNext()

    if (argument === '--') {
      result.files.push(...reader.takeRemaining())
      return result
    }

    // The bare `-` is the conventional stdin token, not a flag. It must
    // bypass the flag dispatch and land in `result.files` so `scanOneSource`
    // can route it to `process.stdin`. Without this guard the flag lookup
    // throws `unknown flag: -`.
    if (argument === '-' || !argument.startsWith('-')) {
      result.files.push(argument)
      continue
    }

    applyFlagArgument(argument, reader, result)
  }

  return result
}
