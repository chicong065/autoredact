import { luhnValid } from '@/engine/luhn'
import { DEFAULT_PHRASES, DEFAULT_VALUE_PATTERNS } from '@/engine/patterns'
import { tokenize } from '@/engine/tokenize'
import type { LeakInfo, RedactOptions } from '@/types'

/**
 * Marker emitted in place of a sub tree once nesting depth exceeds the
 * configured `maxDepth`. The exact form is searchable in any log aggregator.
 */
const TRUNCATED_DEPTH_MARKER = '[TRUNCATED:DEPTH]'

/**
 * Suffix appended to a string truncated at `maxStringLen`.
 */
const TRUNCATED_STRING_SUFFIX = '…[TRUNCATED]'

/**
 * Value emitted in place of an object reference already visited on the
 * current walk path.
 */
const CIRCULAR_MARKER = '[CIRCULAR]'

/**
 * Value emitted in place of a property whose getter threw during access.
 */
const GETTER_THREW_MARKER = '[GETTER_THREW]'

/**
 * Default replacement for redacted fields when `RedactOptions.censor` is
 * not set.
 */
const DEFAULT_CENSOR = '[REDACTED]'

/**
 * Default cap on object or array nesting depth. Past this depth the walker
 * emits {@link TRUNCATED_DEPTH_MARKER}.
 */
const DEFAULT_MAX_DEPTH = 8

/**
 * Default cap on string length before truncation. Past this length the
 * walker truncates and appends {@link TRUNCATED_STRING_SUFFIX}.
 */
const DEFAULT_MAX_STRING_LEN = 8192

/**
 * Test whether a key matches any phrase in the supplied deny list.
 *
 * Tokenizes the key with the same rules used elsewhere in the engine, then
 * checks whether any phrase appears as consecutive segments anywhere in the
 * tokenized output. The check is positional, so `userApiKey` matches the
 * phrase `['api', 'key']` because the segments `['user', 'api', 'key']`
 * contain that pair as a contiguous window.
 *
 * Returns `false` for an empty key (no segments to match against) and for
 * an empty phrase list (nothing to match).
 *
 * @example
 * ```ts
 * isSensitiveKey('userApiKey')                        // true (uses DEFAULT_PHRASES)
 * isSensitiveKey('userApiKey', [['api', 'key']])      // true
 * isSensitiveKey('apiSomethingKey', [['api', 'key']]) // false (segments not consecutive)
 * isSensitiveKey('tokenizer', [['token']])            // false (one segment, not 'token')
 * ```
 *
 * @param key - The candidate key, will be tokenized internally.
 * @param phrases - Deny list, each phrase is an ordered token sequence.
 *   Defaults to {@link DEFAULT_PHRASES} when omitted.
 * @returns `true` when any phrase appears as consecutive tokens of the key.
 */
export function isSensitiveKey(key: string, phrases: ReadonlyArray<ReadonlyArray<string>> = DEFAULT_PHRASES): boolean {
  const segments = tokenize(key)
  if (segments.length === 0) return false
  return phrases.some((phrase) => phraseAppearsInSegments(segments, phrase))
}

/**
 * Slide a phrase over every viable starting offset in the segments and
 * return `true` if any window matches. Returns `false` for an empty phrase
 * or for a phrase longer than the segments array.
 */
function phraseAppearsInSegments(segments: ReadonlyArray<string>, phrase: ReadonlyArray<string>): boolean {
  if (phrase.length === 0 || phrase.length > segments.length) return false
  const lastViableStart = segments.length - phrase.length
  for (let startIndex = 0; startIndex <= lastViableStart; startIndex++) {
    if (phraseMatchesAt(segments, phrase, startIndex)) return true
  }
  return false
}

/**
 * Check whether the phrase appears at exactly the given starting offset in
 * the segments, comparing position by position over a slice of length
 * `phrase.length` starting at `startIndex`.
 *
 * @remarks
 * Precondition. `startIndex + phrase.length` does not exceed
 * `segments.length`. The caller (`phraseAppearsInSegments`) enforces this
 * through the loop bound on `lastViableStart`, so this helper does no
 * bounds checking of its own.
 */
function phraseMatchesAt(segments: ReadonlyArray<string>, phrase: ReadonlyArray<string>, startIndex: number): boolean {
  for (let phraseIndex = 0; phraseIndex < phrase.length; phraseIndex++) {
    if (segments[startIndex + phraseIndex] !== phrase[phraseIndex]) return false
  }
  return true
}

/**
 * Match runs of digits separated by optional spaces or dashes, of total
 * length 13 to 19 digits. Coarse first pass for credit card detection,
 * before the Luhn checksum confirms which matches are actually card numbers.
 */
const CARD_LIKE_DIGIT_RUN = /\b(?:\d[\s-]?){12,18}\d\b/g

/**
 * Options for {@link scrubString}.
 */
export type ScrubStringOptions = {
  /** String to scrub. */
  text: string
  /** Replacement string for every match. */
  censor: string
  /** Value shape regex list, each pattern carries the `g` flag. */
  patterns: ReadonlyArray<RegExp>
  /**
   * Optional callback invoked once per replacement, used by the walker to
   * surface `LeakInfo` events to the CLI scanner.
   */
  onMatch?: (match: string, reason: 'pattern' | 'luhn') => void
}

/**
 * Replace every match of every provided value pattern with the censor
 * string, then do a second pass that finds digit sequences shaped like
 * credit cards and redacts only the ones that also pass the Luhn checksum.
 * This keeps innocent digit runs (order ids, invoice numbers, request ids)
 * intact.
 *
 * Each entry in `patterns` is expected to carry the `g` flag, as
 * `String.prototype.replace` requires the global flag to replace every
 * occurrence. The `lastIndex` of each pattern is reset to 0 before use to
 * neutralize any state left by an earlier `.test()` call.
 *
 * @returns A new string with every match replaced by the censor.
 */
export function scrubString({ text, censor, patterns, onMatch }: ScrubStringOptions): string {
  let scrubbed = text
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    scrubbed = scrubbed.replace(pattern, (match) => {
      onMatch?.(match, 'pattern')
      return censor
    })
  }
  scrubbed = scrubbed.replace(CARD_LIKE_DIGIT_RUN, (match) => {
    const digitsOnly = match.replace(/\D/g, '')
    if (luhnValid(digitsOnly)) {
      onMatch?.(match, 'luhn')
      return censor
    }
    return match
  })
  return scrubbed
}

/**
 * Internal shape of redaction options after defaults are filled in. Held
 * as an immutable bundle through every recursive call so defaults are
 * computed once per top level call rather than once per node.
 */
type ResolvedRedactOptions = {
  phrases: ReadonlyArray<ReadonlyArray<string>>
  allow: Set<string>
  censor: string
  valueShapes: boolean
  maxDepth: number
  maxStringLen: number
  valuePatterns: ReadonlyArray<RegExp>
}

/**
 * Optional hooks consumed by the walker. The CLI scanner provides `onLeak`
 * to collect detection metadata. The logger surface omits hooks entirely.
 */
type WalkHooks = {
  onLeak?: (info: LeakInfo) => void
}

/**
 * Bundle threaded through every recursive call. The first three fields
 * (`options`, `hooks`, `ancestors`) are stable for the entire walk. The
 * `path` and `depth` change per node, but they live on the same bundle so
 * every helper has a single second argument rather than a long positional
 * list.
 *
 * @remarks
 * Recursive helpers spread the bundle and override only the fields that
 * change, for example `{ ...context, path: childPath, depth: depth + 1 }`.
 *
 * The `ancestors` set tracks objects on the current recursion path only.
 * Each call into `walkObject` adds to it and removes on exit (try/finally).
 * That way a shared object reachable through two sibling fields is walked
 * twice rather than collapsing the second visit to `[CIRCULAR]`, while a
 * true cycle still terminates because the cycle's source is on the path.
 */
type WalkContext = {
  options: ResolvedRedactOptions
  hooks: WalkHooks
  ancestors: Set<object>
  path: string
  depth: number
}

/**
 * Coerce a user supplied regex into one that carries the `g` flag.
 *
 * `String.prototype.replace` only replaces every match when the regex is
 * global. A user pattern without `g` would silently scrub only the first
 * occurrence, which weakens redaction without warning. Returns the input
 * unchanged when it already has `g`.
 */
function ensureGlobalFlag(pattern: RegExp): RegExp {
  if (pattern.flags.includes('g')) return pattern
  return new RegExp(pattern.source, `${pattern.flags}g`)
}

/**
 * Resolve raw `RedactOptions` to a fully populated immutable bundle.
 *
 * Public because the CLI scanner shares the same defaulting logic and
 * forwards the resolved options into its own scan loop.
 */
export function resolveRedactOptions(options?: RedactOptions): ResolvedRedactOptions {
  const phrases = options?.phrases ?? [...DEFAULT_PHRASES, ...(options?.extraPhrases ?? [])]
  const valuePatterns = options?.extraValuePatterns
    ? [...DEFAULT_VALUE_PATTERNS, ...options.extraValuePatterns.map(ensureGlobalFlag)]
    : DEFAULT_VALUE_PATTERNS
  return {
    phrases,
    allow: new Set(options?.allow ?? []),
    censor: options?.censor ?? DEFAULT_CENSOR,
    valueShapes: options?.valueShapes ?? true,
    maxDepth: options?.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxStringLen: options?.maxStringLen ?? DEFAULT_MAX_STRING_LEN,
    valuePatterns,
  }
}

/**
 * Walk a value tree, building a fresh redacted copy. The caller's input
 * tree is never mutated.
 *
 * Pass `hooks.onLeak` to receive per redaction metadata (path, matched
 * substring, reason). The logger does not pass hooks. The CLI scanner
 * passes `onLeak` to populate its leak report.
 *
 * @param value - Root of the tree to redact.
 * @param options - Optional `RedactOptions` overriding any defaults.
 * @param hooks - Optional walker hooks, used by the CLI for `onLeak`.
 * @returns A fresh redacted value tree.
 */
export function walk(value: unknown, options?: RedactOptions, hooks?: WalkHooks): unknown {
  const context: WalkContext = {
    options: resolveRedactOptions(options),
    hooks: hooks ?? {},
    ancestors: new Set<object>(),
    path: '',
    depth: 0,
  }
  return walkValue(value, context)
}

/**
 * Append a key segment to a dotted path. When the parent is the root
 * (empty string), the segment becomes the path itself rather than carrying
 * a leading dot.
 */
function appendField(parentPath: string, fieldName: string): string {
  return parentPath ? `${parentPath}.${fieldName}` : fieldName
}

/**
 * Append a bracket indexed segment to a path. Used when descending into
 * arrays, sets, and the `errors` array of an `AggregateError`.
 */
function appendIndex(parentPath: string, index: number): string {
  return `${parentPath}[${index}]`
}

/**
 * Dispatch a single value to the right handler based on its runtime type.
 */
function walkValue(value: unknown, context: WalkContext): unknown {
  if (context.depth > context.options.maxDepth) return TRUNCATED_DEPTH_MARKER
  if (value === null) return null
  if (value === undefined) return undefined

  const valueType = typeof value
  if (valueType === 'string') return walkString(value as string, context)
  if (valueType === 'number' || valueType === 'boolean') return value
  if (valueType === 'bigint') return `${(value as bigint).toString()}n`
  if (valueType === 'symbol') return (value as symbol).toString()
  if (valueType === 'function') {
    const functionName = (value as { name?: string }).name || 'anonymous'
    return `[Function:${functionName}]`
  }

  if (value instanceof ArrayBuffer) {
    return `[ArrayBuffer:${value.byteLength}b]`
  }
  if (ArrayBuffer.isView(value)) {
    const viewName = (value as { constructor: { name: string } }).constructor.name
    return `[${viewName}:${(value as ArrayBufferView).byteLength}b]`
  }

  if (valueType === 'object') {
    return walkObject(value as object, context)
  }

  return value
}

/**
 * Scrub credential shapes (when enabled) and then truncate to `maxStringLen`.
 *
 * Scrubbing happens before truncation on purpose. If a credential straddles
 * the truncation boundary, scrubbing first replaces the whole match with the
 * censor, so the truncated output cannot leak a partial secret. Scrubbing a
 * value much longer than `maxStringLen` is acceptable because the matches
 * are bounded by the regex set, not the input length.
 */
function walkString(text: string, context: WalkContext): string {
  const scrubbed = context.options.valueShapes
    ? scrubString({
        text,
        censor: context.options.censor,
        patterns: context.options.valuePatterns,
        onMatch: (match, reason) => {
          context.hooks.onLeak?.({ path: context.path, kind: 'value', matched: match, reason })
        },
      })
    : text
  if (scrubbed.length <= context.options.maxStringLen) return scrubbed
  return scrubbed.slice(0, context.options.maxStringLen) + TRUNCATED_STRING_SUFFIX
}

/**
 * Dispatch an object to the right specialized walker (`Date`, `RegExp`,
 * `Map`, `Set`, `Error`, `Array`, plain object). Cycle detection happens
 * before specialization so every subtree path is protected.
 *
 * The `ancestors` set tracks the current recursion path only. The source
 * is added before descending and removed on exit, so a shared object that
 * appears in two sibling positions is walked twice rather than collapsing
 * the second visit to `[CIRCULAR]`. A true cycle still terminates because
 * the cycle's source is on the path when it is encountered again.
 */
function walkObject(source: object, context: WalkContext): unknown {
  if (context.ancestors.has(source)) return CIRCULAR_MARKER
  context.ancestors.add(source)
  try {
    if (source instanceof Date) return source.toISOString()
    if (source instanceof RegExp) return source.toString()
    if (source instanceof Map) return walkMap(source, context)
    if (source instanceof Set) return walkSet(source, context)
    if (source instanceof Error) return walkError(source, context)
    if (Array.isArray(source)) return walkArray(source, context)
    return walkPlainObject(source, context)
  } finally {
    context.ancestors.delete(source)
  }
}

/**
 * Convert a `Map` to a plain object, stringifying keys and walking values
 * through the same key match pipeline used for plain objects.
 */
function walkMap(source: Map<unknown, unknown>, context: WalkContext): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [mapKey, mapValue] of source.entries()) {
    const stringKey = String(mapKey)
    output[stringKey] = redactValueAtKey(
      { key: stringKey, value: mapValue },
      { ...context, path: appendField(context.path, stringKey) }
    )
  }
  return output
}

/**
 * Convert a `Set` to an array of walked values.
 */
function walkSet(source: Set<unknown>, context: WalkContext): unknown[] {
  return Array.from(source).map((entry, index) =>
    walkValue(entry, {
      ...context,
      path: appendIndex(context.path, index),
      depth: context.depth + 1,
    })
  )
}

/**
 * Walk every entry of an array, indexing the path with bracket notation.
 */
function walkArray(source: ReadonlyArray<unknown>, context: WalkContext): unknown[] {
  return source.map((entry, index) =>
    walkValue(entry, {
      ...context,
      path: appendIndex(context.path, index),
      depth: context.depth + 1,
    })
  )
}

/**
 * Walk every own enumerable property of a plain object. Property access is
 * wrapped in a try block so a throwing getter cannot crash the walker.
 */
function walkPlainObject(source: object, context: WalkContext): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const entryKey of Object.keys(source)) {
    let entryValue: unknown
    try {
      entryValue = (source as Record<string, unknown>)[entryKey]
    } catch {
      output[entryKey] = GETTER_THREW_MARKER
      continue
    }
    output[entryKey] = redactValueAtKey(
      { key: entryKey, value: entryValue },
      { ...context, path: appendField(context.path, entryKey) }
    )
  }
  return output
}

/**
 * Serialize an `Error` including its `cause` chain and any `AggregateError`
 * inner errors. Own enumerable properties pass through the same key and
 * value redaction pipeline as a plain object, so a custom Error subclass
 * with a `token` property gets its token redacted just like any other key.
 */
function walkError(source: Error, context: WalkContext): Record<string, unknown> {
  const output: Record<string, unknown> = {
    name: source.name,
    message: walkString(source.message ?? '', { ...context, path: appendField(context.path, 'message') }),
  }
  if (typeof source.stack === 'string') {
    output.stack = walkString(source.stack, { ...context, path: appendField(context.path, 'stack') })
  }
  if ('cause' in source && source.cause !== undefined) {
    output.cause = walkValue(source.cause, {
      ...context,
      path: appendField(context.path, 'cause'),
      depth: context.depth + 1,
    })
  }
  if (typeof AggregateError !== 'undefined' && source instanceof AggregateError) {
    const errorsBasePath = appendField(context.path, 'errors')
    output.errors = source.errors.map((nested, index) =>
      walkValue(nested, {
        ...context,
        path: appendIndex(errorsBasePath, index),
        depth: context.depth + 1,
      })
    )
  }
  for (const propertyName of Object.getOwnPropertyNames(source)) {
    if (
      propertyName === 'name' ||
      propertyName === 'message' ||
      propertyName === 'stack' ||
      propertyName === 'cause' ||
      propertyName === 'errors'
    )
      continue
    let propertyValue: unknown
    try {
      propertyValue = (source as unknown as Record<string, unknown>)[propertyName]
    } catch {
      output[propertyName] = GETTER_THREW_MARKER
      continue
    }
    output[propertyName] = redactValueAtKey(
      { key: propertyName, value: propertyValue },
      { ...context, path: appendField(context.path, propertyName) }
    )
  }
  return output
}

/**
 * Apply key based redaction at a single object entry.
 *
 * If the path is in the allow list, the value passes through untouched.
 * If the key tokenizes to a sensitive phrase (and the value is neither
 * `null` nor `undefined`), the value is replaced with the censor. Otherwise
 * the value is walked normally with the depth incremented.
 */
function redactValueAtKey(entry: { key: string; value: unknown }, context: WalkContext): unknown {
  const { options, hooks, path, depth } = context
  const { key, value } = entry

  if (options.allow.has(path)) return value

  if (value !== undefined && value !== null && isSensitiveKey(key, options.phrases)) {
    hooks.onLeak?.({
      path,
      kind: 'key',
      matched: key,
      reason: 'phrase',
    })
    return options.censor
  }

  return walkValue(value, { ...context, depth: depth + 1 })
}

/**
 * Redact a value tree using the default rules plus any caller supplied
 * overrides. Public, hook free wrapper around {@link walk} and the one
 * re-exported from the package entry point.
 *
 * Use it for one off redaction outside the logger surface, for example
 * before passing a payload to a third party error reporter.
 *
 * @example
 * ```ts
 * sentry.captureException(error, { extra: redact(payload) })
 * ```
 *
 * @param value - Root of the tree to redact.
 * @param options - Optional `RedactOptions` overriding any defaults.
 * @returns A fresh redacted value tree.
 */
export function redact(value: unknown, options?: RedactOptions): unknown {
  const hooks: WalkHooks | undefined = options?.onLeak ? { onLeak: options.onLeak } : undefined
  return walk(value, options, hooks)
}
