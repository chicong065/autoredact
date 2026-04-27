import { describe, expect, it } from 'vitest'

import { parseArgs } from '@/logger/parse-args'

describe('parseArgs', () => {
  it('parses a single string as msg only', () => {
    expect(parseArgs(['hello'])).toEqual({
      msg: 'hello',
      fields: undefined,
      error: undefined,
    })
  })

  it('parses a single object as fields only', () => {
    expect(parseArgs([{ user: 'a' }])).toEqual({
      msg: undefined,
      fields: { user: 'a' },
      error: undefined,
    })
  })

  it('parses object plus string as fields and msg', () => {
    expect(parseArgs([{ user: 'a' }, 'hello'])).toEqual({
      msg: 'hello',
      fields: { user: 'a' },
      error: undefined,
    })
  })

  it('parses an Error with msg derived from error.message', () => {
    const error = new Error('boom')
    const result = parseArgs([error])
    expect(result.error).toBe(error)
    expect(result.msg).toBe('boom')
    expect(result.fields).toBeUndefined()
  })

  it('parses an Error plus explicit string with explicit msg overriding error.message', () => {
    const error = new Error('boom')
    const result = parseArgs([error, 'request failed'])
    expect(result.error).toBe(error)
    expect(result.msg).toBe('request failed')
    expect(result.fields).toBeUndefined()
  })

  it('parses no arguments as the empty record', () => {
    expect(parseArgs([])).toEqual({
      msg: undefined,
      fields: undefined,
      error: undefined,
    })
  })

  it('coerces a number first argument to a string msg', () => {
    expect(parseArgs([42]).msg).toBe('42')
  })

  it('coerces a boolean first argument to a string msg', () => {
    expect(parseArgs([true]).msg).toBe('true')
  })

  it('coerces null first argument to the literal string "null"', () => {
    expect(parseArgs([null]).msg).toBe('null')
  })

  it('treats a subclass of Error like Error', () => {
    class CustomError extends Error {}
    const error = new CustomError('custom boom')
    const result = parseArgs([error])
    expect(result.error).toBe(error)
    expect(result.msg).toBe('custom boom')
  })

  it('falls back to error.message when the second argument is not a string (Error case)', () => {
    const error = new Error('boom')
    const result = parseArgs([error, { extra: 'context' }])
    expect(result.msg).toBe('boom')
    expect(result.error).toBe(error)
  })

  it('leaves msg undefined when the second argument is not a string (object case)', () => {
    const result = parseArgs([{ user: 'a' }, 42])
    expect(result.msg).toBeUndefined()
    expect(result.fields).toEqual({ user: 'a' })
  })
})
