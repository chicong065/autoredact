/**
 * Public package surface for `autoredact`.
 *
 * Two function entry points cover almost every use case:
 *
 * - {@link createLogger} for a structured JSON logger that auto redacts
 *   secrets and PII by default.
 * - {@link redact} for ad hoc redaction of any value tree, useful before
 *   passing payloads to third party error reporters.
 *
 * @packageDocumentation
 */

export { createLogger, Logger } from '@/logger/logger'
export { redact, isSensitiveKey } from '@/engine/walk'
export { DEFAULT_PHRASES, DEFAULT_VALUE_PATTERNS } from '@/engine/patterns'
export type { Level, Bindings, LogRecord, Transport, RedactOptions, LoggerOptions, LeakInfo } from '@/types'
