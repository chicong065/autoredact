import { afterEach, describe, expect, it, vi } from 'vitest'

import { createLogger } from '@/logger/logger'
import type { LeakInfo } from '@/types'

const captureLines = () => {
  const capturedLines: string[] = []
  return {
    capturedLines,
    transport: (line: string) => {
      capturedLines.push(line)
    },
  }
}

describe('Logger', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic emission', () => {
    it('writes a JSON line containing time, level, and msg', () => {
      const { capturedLines, transport } = captureLines()
      const log = createLogger({
        transport,
        timeFn: () => '2026-01-01T00:00:00.000Z',
      })
      log.info({ user: 'alice' }, 'hello')
      expect(capturedLines).toHaveLength(1)
      const record = JSON.parse(capturedLines[0]!)
      expect(record.level).toBe('info')
      expect(record.msg).toBe('hello')
      expect(record.user).toBe('alice')
      expect(record.time).toBe('2026-01-01T00:00:00.000Z')
    })

    it('omits msg when only an object is passed', () => {
      const { capturedLines, transport } = captureLines()
      const log = createLogger({ transport, timeFn: () => 'T' })
      log.info({ count: 1 })
      const record = JSON.parse(capturedLines[0]!)
      expect(record.msg).toBeUndefined()
      expect(record.count).toBe(1)
    })

    it('redacts sensitive fields by default', () => {
      const { capturedLines, transport } = captureLines()
      const log = createLogger({ transport })
      log.info({ user: { id: 'u', api_key: 'secret' } })
      const record = JSON.parse(capturedLines[0]!)
      expect(record.user.api_key).toBe('[REDACTED]')
      expect(record.user.id).toBe('u')
    })
  })

  describe('level filtering', () => {
    it('drops records below the configured threshold', () => {
      const { capturedLines, transport } = captureLines()
      const log = createLogger({ level: 'warn', transport })
      log.debug('skipped')
      log.info('skipped')
      log.warn('emitted')
      log.error('emitted')
      expect(capturedLines).toHaveLength(2)
    })

    it('emits nothing when level is silent', () => {
      const { capturedLines, transport } = captureLines()
      const log = createLogger({ level: 'silent', transport })
      log.error('skipped')
      log.fatal('skipped')
      expect(capturedLines).toHaveLength(0)
    })

    it('isLevelEnabled returns true for levels at or above the threshold', () => {
      const log = createLogger({ level: 'warn' })
      expect(log.isLevelEnabled('error')).toBe(true)
      expect(log.isLevelEnabled('warn')).toBe(true)
      expect(log.isLevelEnabled('info')).toBe(false)
    })

    it('isLevelEnabled returns false for any level when the logger is silent', () => {
      const log = createLogger({ level: 'silent' })
      expect(log.isLevelEnabled('error')).toBe(false)
      expect(log.isLevelEnabled('fatal')).toBe(false)
    })

    it('isLevelEnabled returns false when the queried level is silent on a non silent logger', () => {
      // The terminal `silent` value is a threshold, not a passable emission
      // level. Asking whether `silent` is enabled is meaningless and must
      // never return true.
      const log = createLogger({ level: 'info' })
      expect(log.isLevelEnabled('silent')).toBe(false)
    })
  })

  describe('child loggers', () => {
    it('inherits the level, transport, redact options, and merges bindings', () => {
      const { capturedLines, transport } = captureLines()
      const parent = createLogger({ transport, base: { service: 'api' } })
      const child = parent.child({ requestId: 'r1' })
      child.info('processing')
      const record = JSON.parse(capturedLines[0]!)
      expect(record.service).toBe('api')
      expect(record.requestId).toBe('r1')
    })

    it('redacts inherited bindings on the child too', () => {
      const { capturedLines, transport } = captureLines()
      const parent = createLogger({ transport })
      const child = parent.child({ token: 'leakedFromParent' })
      child.info('done')
      const record = JSON.parse(capturedLines[0]!)
      expect(record.token).toBe('[REDACTED]')
    })

    it('inherits the level threshold so a child of a warn logger drops info records', () => {
      const { capturedLines, transport } = captureLines()
      const parent = createLogger({ level: 'warn', transport })
      const child = parent.child({ requestId: 'r1' })
      child.info('dropped')
      child.warn('emitted')
      expect(capturedLines).toHaveLength(1)
      const record = JSON.parse(capturedLines[0]!)
      expect(record.level).toBe('warn')
      expect(record.requestId).toBe('r1')
    })

    it('does not affect the parent when the child gains new bindings', () => {
      const { capturedLines, transport } = captureLines()
      const parent = createLogger({ transport, base: { app: 'svc' } })
      const child = parent.child({ requestId: 'r1' })
      child.info('child')
      parent.info('parent')
      const childRecord = JSON.parse(capturedLines[0]!)
      const parentRecord = JSON.parse(capturedLines[1]!)
      expect(childRecord.requestId).toBe('r1')
      expect(parentRecord.requestId).toBeUndefined()
    })
  })

  describe('Error handling on the input side', () => {
    it('treats Error as the first arg, msg defaults to error.message', () => {
      const { capturedLines, transport } = captureLines()
      const log = createLogger({ transport })
      log.error(new Error('boom'))
      const record = JSON.parse(capturedLines[0]!)
      expect(record.msg).toBe('boom')
      expect(record.err.name).toBe('Error')
      expect(record.err.message).toBe('boom')
      expect(typeof record.err.stack).toBe('string')
    })

    it('Error plus explicit msg overrides the default', () => {
      const { capturedLines, transport } = captureLines()
      const log = createLogger({ transport })
      log.error(new Error('boom'), 'request failed')
      const record = JSON.parse(capturedLines[0]!)
      expect(record.msg).toBe('request failed')
    })
  })

  describe('options forwarding', () => {
    it('respects a custom censor through redact options', () => {
      const { capturedLines, transport } = captureLines()
      const log = createLogger({ transport, redact: { censor: '***' } })
      log.info({ password: 'p' })
      const record = JSON.parse(capturedLines[0]!)
      expect(record.password).toBe('***')
    })

    it('respects extraPhrases through redact options', () => {
      const { capturedLines, transport } = captureLines()
      const log = createLogger({ transport, redact: { extraPhrases: [['internal', 'id']] } })
      log.info({ internalId: 'x' })
      const record = JSON.parse(capturedLines[0]!)
      expect(record.internalId).toBe('[REDACTED]')
    })
  })

  describe('resilience', () => {
    it('survives a transport that throws and silences subsequent failures', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const failingTransport = vi.fn(() => {
        throw new Error('transport down')
      })
      const log = createLogger({ transport: failingTransport })
      expect(() => {
        log.info('first')
        log.info('second')
        log.info('third')
      }).not.toThrow()
      expect(failingTransport).toHaveBeenCalledTimes(3)
      expect(errorSpy).toHaveBeenCalledTimes(1)
      // Pin the error message shape so a regression that changes the wording
      // surfaces as a test failure rather than a silent text drift.
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('autoredact: transport threw'), expect.any(Error))
      errorSpy.mockRestore()
    })

    it('handles a throwing getter on the input by converting it to a [GETTER_THREW] marker', () => {
      // The walker catches the getter throw and substitutes the marker, so
      // the record stays well formed JSON. This pins the throwing getter
      // path, the JSON.stringify fallback branch is defensive code that the
      // walker's output is designed to never exercise.
      const { capturedLines, transport } = captureLines()
      const log = createLogger({ transport })
      const trapped: Record<string, unknown> = {}
      Object.defineProperty(trapped, 'self', {
        enumerable: true,
        get() {
          throw new Error('getter says no')
        },
      })
      log.info(trapped)
      expect(capturedLines).toHaveLength(1)
      const record = JSON.parse(capturedLines[0]!)
      expect(record.level).toBe('info')
      expect(record.self).toBe('[GETTER_THREW]')
    })
  })

  describe('onLeak observability hook', () => {
    it('fires once per key redaction with LeakInfo metadata', () => {
      const observed: LeakInfo[] = []
      const log = createLogger({
        transport: () => {},
        onLeak: (info) => observed.push(info),
      })
      log.info({ user: { id: 'u_1', api_key: 'sk_live_xxx' } }, 'request')
      expect(observed).toHaveLength(1)
      expect(observed[0]).toEqual({
        path: 'user.api_key',
        kind: 'key',
        matched: 'api_key',
        reason: 'phrase',
      })
    })

    it('fires for value shape matches inside string fields and inside Error messages', () => {
      const observed: LeakInfo[] = []
      const log = createLogger({
        transport: () => {},
        onLeak: (info) => observed.push(info),
      })
      log.error(new Error('cannot connect to postgres://app:hunter2@db.example.com/mydb'))
      const reasons = observed.map((entry) => entry.reason)
      expect(reasons).toContain('pattern')
      const paths = observed.map((entry) => entry.path)
      expect(paths).toContain('message')
    })

    it('does not fire when nothing matches', () => {
      const observed: LeakInfo[] = []
      const log = createLogger({
        transport: () => {},
        onLeak: (info) => observed.push(info),
      })
      log.info({ id: 'u_1', name: 'Alice' })
      expect(observed).toHaveLength(0)
    })

    it('child loggers inherit the parent onLeak callback', () => {
      const observed: LeakInfo[] = []
      const parent = createLogger({
        transport: () => {},
        onLeak: (info) => observed.push(info),
      })
      const child = parent.child({ requestId: 'r1' })
      child.info({ password: 'p' }, 'after child')
      expect(observed).toHaveLength(1)
      expect(observed[0]?.matched).toBe('password')
      expect(observed[0]?.reason).toBe('phrase')
    })
  })
})
