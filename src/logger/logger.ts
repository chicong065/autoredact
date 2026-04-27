import { walk } from '@/engine/walk'
import { parseArgs } from '@/logger/parse-args'
import { resolveTransport } from '@/logger/transports'
import type {
  Bindings,
  EmittableLevel,
  LeakInfo,
  Level,
  LogRecord,
  LoggerOptions,
  RedactOptions,
  Transport,
} from '@/types'

/**
 * Shape of the optional walker hooks supplied by the logger. Mirrors the
 * shape the engine consumes internally, declared inline here so the logger
 * does not need to import an internal type.
 */
type LoggerWalkHooks = { onLeak: (info: LeakInfo) => void } | undefined

/**
 * Numeric values for each level. Used as the comparison threshold for level
 * filtering. The terminal `silent` value sits above every emittable level
 * so it short circuits all emission.
 */
const LEVEL_VALUES = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100,
} as const

/**
 * Marker emitted in place of bindings when the redaction engine itself
 * throws. The logger contract is that emission never throws, so any
 * walker error degrades to this single field instead.
 */
const REDACT_ERROR_MARKER = '[REDACT_ERROR]'

/**
 * Field name attached to a record when the redaction walker fails. Paired
 * with {@link REDACT_ERROR_MARKER} to keep the magic strings in one place.
 */
const REDACT_ERROR_FIELD = '_redact_error'

/**
 * Structured logger.
 *
 * Wraps the redaction engine plus a transport. Every public emission
 * method forwards to the same internal `#emit` pipeline (level filter,
 * parse args, merge bindings, redact, serialize, dispatch). Failures at
 * any stage are caught so the logging path never throws into the caller.
 *
 * The `TBindings` type parameter carries the static shape of the
 * `base` bindings (and any merged child bindings) through the record and
 * any custom {@link Transport}, so a typed logger surfaces its own fields
 * to the consumer without per call casts.
 *
 * Construct with {@link createLogger}. Direct `new Logger(...)` works
 * but skips the `base` bindings convenience that `createLogger` applies.
 *
 * @example
 * ```ts
 * const log = createLogger({ level: 'info', base: { service: 'api' } })
 * log.info({ user }, 'user signed in')
 * const requestLog = log.child({ requestId })
 * requestLog.error(error, 'request failed')
 * ```
 *
 * @typeParam TBindings - Static shape of the bindings carried on every
 *   record this logger emits.
 */
export class Logger<TBindings extends Bindings = Bindings> {
  readonly #level: Level
  readonly #threshold: number
  readonly #transport: Transport<TBindings>
  readonly #redactOptions: RedactOptions | undefined
  readonly #bindings: TBindings
  readonly #getTime: () => string
  readonly #onLeak: ((info: LeakInfo) => void) | undefined
  readonly #walkHooks: LoggerWalkHooks
  #transportHasErrored = false

  constructor(options: LoggerOptions<TBindings> = {}, bindings: TBindings = {} as TBindings) {
    this.#level = options.level ?? 'info'
    this.#threshold = LEVEL_VALUES[this.#level]
    this.#transport = resolveTransport<TBindings>(options.transport)
    this.#redactOptions = options.redact
    this.#bindings = bindings
    this.#getTime = options.timeFn ?? (() => new Date().toISOString())
    this.#onLeak = options.onLeak
    this.#walkHooks = options.onLeak ? { onLeak: options.onLeak } : undefined
  }

  /** Emit at level `trace`. */
  trace(message: string): void
  trace(bindings: Bindings, message?: string): void
  trace(error: Error, message?: string): void
  trace(...args: unknown[]): void {
    this.#emit('trace', args)
  }

  /** Emit at level `debug`. */
  debug(message: string): void
  debug(bindings: Bindings, message?: string): void
  debug(error: Error, message?: string): void
  debug(...args: unknown[]): void {
    this.#emit('debug', args)
  }

  /** Emit at level `info`. */
  info(message: string): void
  info(bindings: Bindings, message?: string): void
  info(error: Error, message?: string): void
  info(...args: unknown[]): void {
    this.#emit('info', args)
  }

  /** Emit at level `warn`. */
  warn(message: string): void
  warn(bindings: Bindings, message?: string): void
  warn(error: Error, message?: string): void
  warn(...args: unknown[]): void {
    this.#emit('warn', args)
  }

  /** Emit at level `error`. */
  error(message: string): void
  error(bindings: Bindings, message?: string): void
  error(error: Error, message?: string): void
  error(...args: unknown[]): void {
    this.#emit('error', args)
  }

  /** Emit at level `fatal`. */
  fatal(message: string): void
  fatal(bindings: Bindings, message?: string): void
  fatal(error: Error, message?: string): void
  fatal(...args: unknown[]): void {
    this.#emit('fatal', args)
  }

  /**
   * Create a child logger that inherits the parent's level, transport,
   * redact options, and time function, then merges the supplied bindings
   * on top of the parent's bindings. The returned logger carries the
   * intersection of the parent shape and the child shape, so static field
   * access is preserved across the relationship.
   *
   * @typeParam TChildBindings - Shape of the additional bindings supplied
   *   to this child. Inferred from the argument.
   */
  child<TChildBindings extends Bindings>(bindings: TChildBindings): Logger<TBindings & TChildBindings> {
    return new Logger<TBindings & TChildBindings>(
      {
        level: this.#level,
        transport: this.#transport as Transport<TBindings & TChildBindings>,
        redact: this.#redactOptions,
        timeFn: this.#getTime,
        onLeak: this.#onLeak,
      },
      { ...this.#bindings, ...bindings } as TBindings & TChildBindings
    )
  }

  /**
   * Test whether a given level would actually be emitted by this logger.
   * Useful for guarding expensive payload construction:
   *
   * @example
   * ```ts
   * if (log.isLevelEnabled('debug')) {
   *   log.debug({ snapshot: buildExpensiveSnapshot() })
   * }
   * ```
   */
  isLevelEnabled(level: Level): boolean {
    if (this.#level === 'silent') return false
    // The terminal `silent` value is a threshold, not a passable emission
    // level. Asking whether `silent` is enabled is meaningless and always
    // returns false, even on a non silent logger.
    if (level === 'silent') return false
    return LEVEL_VALUES[level] >= this.#threshold
  }

  /**
   * The internal emission pipeline.
   *
   * Failures at any stage are caught so the logging path never throws:
   *
   * - A walker error on any source degrades to a single `_redact_error`
   *   field for that source.
   * - A `JSON.stringify` failure degrades to a fallback record describing
   *   the failure.
   * - A transport that throws is logged once via `console.error` and
   *   silenced for the remainder of the logger's lifetime.
   *
   * The bindings, fields, and error are walked separately rather than
   * merged first, so a throwing getter in any source is handled by the
   * walker's per property try block rather than crashing during a spread.
   */
  #emit(level: EmittableLevel, methodArgs: unknown[]): void {
    if (!this.isLevelEnabled(level)) return

    const { msg, fields, error } = parseArgs(methodArgs)
    const safeBindings = this.#walkBindingsSafely(this.#bindings)
    const safeFields = fields ? this.#walkBindingsSafely(fields) : undefined
    const safeError = error ? this.#walkErrorSafely(error) : undefined

    const record = {
      time: this.#getTime(),
      level,
      ...(msg !== undefined ? { msg } : {}),
      ...safeBindings,
      ...safeFields,
      ...(safeError !== undefined ? { err: safeError } : {}),
    } as LogRecord<TBindings>

    const line = serializeRecord(record)
    this.#dispatchToTransport(line, record)
  }

  /**
   * Send a serialized line to the transport, swallowing any throw so
   * the logger contract holds (emission never raises into the caller).
   */
  #dispatchToTransport(line: string, record: LogRecord<TBindings>): void {
    try {
      this.#transport(line, record)
    } catch (transportError) {
      this.#reportTransportFailureOnce(transportError)
    }
  }

  /**
   * Run the walker over a bindings source, catching any walker error and
   * substituting a `_redact_error` marker. The walker already handles
   * throwing getters internally, so under normal operation this never
   * catches anything. The catch is a defensive backstop.
   */
  #walkBindingsSafely(input: Bindings): Bindings {
    try {
      return walk(input, this.#redactOptions, this.#walkHooks) as Bindings
    } catch {
      return { [REDACT_ERROR_FIELD]: REDACT_ERROR_MARKER }
    }
  }

  /**
   * Run the walker over an Error, catching any walker failure. The
   * walker handles `cause`, custom subclass properties, and throwing
   * getters internally, so under normal operation this never catches.
   */
  #walkErrorSafely(input: Error): unknown {
    try {
      return walk(input, this.#redactOptions, this.#walkHooks)
    } catch {
      return REDACT_ERROR_MARKER
    }
  }

  /**
   * Report the first transport failure via `console.error` and silence
   * any subsequent failures. Wrapped so a `console.error` that itself
   * throws cannot escape the logger.
   */
  #reportTransportFailureOnce(transportError: unknown): void {
    if (this.#transportHasErrored) return
    this.#transportHasErrored = true
    try {
      console.error('autoredact: transport threw, further failures silenced:', transportError)
    } catch {
      // Defensive. If even console.error throws (unusual but possible in
      // tests or sandboxed runtimes), give up silently. The logger
      // contract is that logging never throws into the caller.
    }
  }
}

/**
 * Serialize a record to a JSON line. The walker's output is JSON safe by
 * construction (no BigInt, no cycles, no functions, no Symbol keys), so
 * the catch is a defensive backstop rather than a path that the current
 * implementation actually exercises. When it does fire, the fallback
 * record collapses everything into a single `msg` field for a uniform
 * schema (no special `error` field).
 */
function serializeRecord(record: LogRecord): string {
  try {
    return JSON.stringify(record)
  } catch (serializationError) {
    return JSON.stringify({
      time: record.time,
      level: record.level,
      msg: `autoredact: serialization failed (${String(serializationError)})`,
    })
  }
}

/**
 * Build a new {@link Logger} from the supplied options. The recommended
 * way to construct a logger.
 *
 * The returned logger carries the inferred shape of `options.base` so
 * downstream `record.foo` access in a custom transport stays statically
 * typed. Pass an explicit type argument when the inferred shape is
 * narrower than intended (for example, when `base` uses string literals
 * that should widen to `string`).
 *
 * @example
 * ```ts
 * const log = createLogger({
 *   level: 'info',
 *   transport: 'json',
 *   base: { service: 'api', region: 'sg' },
 *   redact: { extraPhrases: [['internal', 'id']] },
 * })
 * ```
 *
 * @typeParam TBindings - Static shape of the bindings carried on every
 *   record. Inferred from `options.base` when present.
 */
export function createLogger<TBindings extends Bindings = Bindings>(
  options?: LoggerOptions<TBindings>
): Logger<TBindings> {
  return new Logger<TBindings>(options, options?.base)
}
