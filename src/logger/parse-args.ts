import type { Bindings } from '@/types'

/**
 * Result of parsing a logger method's variadic arguments into the three
 * canonical slots the rest of the pipeline understands: a message string,
 * a fields object, and an Error instance. Each slot is independently
 * optional.
 *
 * @internal
 */
export type ParsedLog = {
  msg: string | undefined
  fields: Bindings | undefined
  error: Error | undefined
}

/**
 * Parse a logger method's variadic arguments into a normalized record.
 *
 * Supported call shapes:
 *
 * - `log.info('hello')` parses to msg only.
 * - `log.info({ user })` parses to fields only.
 * - `log.info({ user }, 'hello')` parses to fields and msg together.
 * - `log.error(err)` parses to error and msg derived from `err.message`.
 * - `log.error(err, 'request failed')` parses to error and an explicit msg.
 *
 * Anything else (a number, a boolean, `null`) coerces to a string `msg`
 * via `String(...)`. The rest of the pipeline never sees an unexpected
 * argument shape.
 *
 * @param args - The variadic arguments captured by a logger method.
 * @returns The normalized record.
 *
 * @internal
 */
export function parseArgs(args: ReadonlyArray<unknown>): ParsedLog {
  if (args.length === 0) {
    return { msg: undefined, fields: undefined, error: undefined }
  }

  const firstArgument = args[0]
  const secondArgument = args[1]
  const explicitMessage = typeof secondArgument === 'string' ? secondArgument : undefined

  if (firstArgument instanceof Error) {
    return {
      error: firstArgument,
      msg: explicitMessage ?? firstArgument.message,
      fields: undefined,
    }
  }

  if (firstArgument !== null && typeof firstArgument === 'object') {
    return {
      fields: firstArgument as Bindings,
      msg: explicitMessage,
      error: undefined,
    }
  }

  if (typeof firstArgument === 'string') {
    return { msg: firstArgument, fields: undefined, error: undefined }
  }

  return { msg: String(firstArgument), fields: undefined, error: undefined }
}
