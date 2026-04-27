/**
 * Log severity levels in increasing order of importance. The terminal value
 * `silent` short circuits all emission so a logger configured with that
 * level never invokes its transport.
 */
export type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent'

/**
 * Levels that actually emit a record. Excludes the terminal `silent` value,
 * which is only meaningful as a threshold. Used as the level field of a
 * {@link LogRecord} and as the key of the pretty transport's color map.
 */
export type EmittableLevel = Exclude<Level, 'silent'>

/**
 * A bag of arbitrary key value pairs decorating a log record. Bindings can
 * come from `LoggerOptions.base`, from `child(bindings)`, or from the per
 * call `fields` argument. Used as the default and the constraint for the
 * `TBindings` generic parameter on {@link Logger} and friends.
 */
export type Bindings = Record<string, unknown>

/**
 * Shape of a fully assembled log record before serialization. The `time`
 * and `level` fields are always present, `msg` appears only when the call
 * site supplied a message, and the supplied `TBindings` shape sits beside
 * them so a typed transport can read its own fields off the record.
 *
 * @typeParam TBindings - Static binding shape promised by the logger.
 *   Defaults to {@link Bindings} (loose record).
 */
export type LogRecord<TBindings extends Bindings = Bindings> = {
  time: string
  level: EmittableLevel
  msg?: string
} & TBindings

/**
 * A transport receives both the serialized line (already a string ready to
 * write) and the structured record. Custom transports can route by level,
 * filter by field, or send to multiple destinations. Carries the same
 * `TBindings` parameter as the logger that fed it, so a transport written
 * for a typed logger sees its bindings in the record argument.
 *
 * @typeParam TBindings - Static binding shape of the calling logger.
 */
export type Transport<TBindings extends Bindings = Bindings> = (line: string, record: LogRecord<TBindings>) => void

/**
 * Options for the redaction engine. Every field is optional, the defaults
 * cover the spec recommended security baseline at section 3.7 of the
 * design document.
 */
export type RedactOptions = {
  /** Replace the default phrase list. Most users want `extraPhrases` instead. */
  phrases?: ReadonlyArray<ReadonlyArray<string>>
  /** Add to the default phrase list. The recommended way to extend the deny list. */
  extraPhrases?: ReadonlyArray<ReadonlyArray<string>>
  /** Path strings (for example 'user.email') whose values are exempt from redaction. */
  allow?: ReadonlyArray<string>
  /** Replacement value for redacted fields. Defaults to the literal '[REDACTED]'. */
  censor?: string
  /** Scan string values for credential shapes (JWT, AWS keys, and so on). Default true. */
  valueShapes?: boolean
  /** Add to the default value shape regex list. */
  extraValuePatterns?: ReadonlyArray<RegExp>
  /** Maximum object or array nesting depth before emitting a truncated marker. Default 8. */
  maxDepth?: number
  /** Maximum string length before truncation. Default 8192. */
  maxStringLen?: number
  /**
   * Optional callback invoked once per redaction event, with the path,
   * kind, matched substring, and reason. Useful for metrics, alarms, and
   * audit trails. The callback runs synchronously inside the walker, so
   * keep it cheap and never throw.
   */
  onLeak?: (info: LeakInfo) => void
}

/**
 * Options for `createLogger`. All fields are optional.
 *
 * @typeParam TBindings - Static binding shape promised by the logger.
 *   Inferred from the `base` field when supplied, otherwise defaults to
 *   {@link Bindings} (loose record).
 */
export type LoggerOptions<TBindings extends Bindings = Bindings> = {
  level?: Level
  transport?: 'json' | 'pretty' | Transport<TBindings>
  redact?: RedactOptions
  base?: TBindings
  /** Override the time source. Used in tests to produce stable output. */
  timeFn?: () => string
  /**
   * Optional callback invoked once per redaction event the logger detects,
   * with the path, kind, matched substring, and reason. Inherited by every
   * child logger. Useful for metrics, alarms, and audit trails. The
   * callback runs synchronously inside the walker, so keep it cheap and
   * never throw.
   */
  onLeak?: (info: LeakInfo) => void
}

/**
 * Information about a single redaction event, supplied to any `onLeak`
 * callback the caller wires up. Surfaces in three places: the standalone
 * `redact()` via `RedactOptions.onLeak`, the logger via
 * `LoggerOptions.onLeak`, and the bundled `autoredact-scan` CLI scanner.
 */
export type LeakInfo = {
  /** Dotted path to the field, for example 'user.api_key' or 'env[3].token'. */
  path: string
  /** Whether the redaction was triggered by the key name or by the value shape. */
  kind: 'key' | 'value'
  /** The matched substring (for value matches) or the key name (for key matches). */
  matched: string
  /** Which detection rule fired. */
  reason: 'phrase' | 'pattern' | 'luhn'
}
