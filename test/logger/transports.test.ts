import { describe, expect, it, vi } from 'vitest'

import { jsonTransport, prettyTransport, resolveTransport } from '@/logger/transports'

describe('jsonTransport', () => {
  it('writes the line via console.log', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    jsonTransport('{"a":1}', { time: 't', level: 'info' })
    expect(consoleSpy).toHaveBeenCalledWith('{"a":1}')
    consoleSpy.mockRestore()
  })
})

describe('prettyTransport', () => {
  it('formats output with the time slice, the level label, and the msg', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    prettyTransport('', {
      time: '2026-01-01T12:34:56.789Z',
      level: 'info',
      msg: 'hello',
      foo: 'bar',
    })
    expect(consoleSpy).toHaveBeenCalled()
    const consoleArguments = consoleSpy.mock.calls[0] ?? []
    const renderedOutput = consoleArguments.map(String).join(' ')
    expect(renderedOutput).toContain('hello')
    expect(renderedOutput).toContain('12:34:56')
    expect(renderedOutput).toContain('"foo":"bar"')
    consoleSpy.mockRestore()
  })

  it('omits the JSON suffix when no extra fields are present', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    prettyTransport('', {
      time: '2026-01-01T00:00:00.000Z',
      level: 'info',
      msg: 'hi',
    })
    const consoleArguments = consoleSpy.mock.calls[0] ?? []
    expect(consoleArguments.length).toBe(1)
    consoleSpy.mockRestore()
  })

  it('handles a record with no msg by rendering an empty trailing message slot', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    prettyTransport('', {
      time: '2026-01-01T00:00:00.000Z',
      level: 'warn',
      foo: 'bar',
    })
    const consoleArguments = consoleSpy.mock.calls[0] ?? []
    const renderedOutput = consoleArguments.map(String).join(' ')
    expect(renderedOutput).toContain('WARN')
    expect(renderedOutput).toContain('"foo":"bar"')
    consoleSpy.mockRestore()
  })
})

const customTransport = (): void => {}

describe('resolveTransport', () => {
  it('returns jsonTransport when the option is undefined', () => {
    expect(resolveTransport(undefined)).toBe(jsonTransport)
  })

  it('returns jsonTransport when the option is the string "json"', () => {
    expect(resolveTransport('json')).toBe(jsonTransport)
  })

  it('returns prettyTransport when the option is the string "pretty"', () => {
    expect(resolveTransport('pretty')).toBe(prettyTransport)
  })

  it('returns the exact function reference when a custom transport is passed', () => {
    expect(resolveTransport(customTransport)).toBe(customTransport)
  })
})
