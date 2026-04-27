import { describe, expect, it } from 'vitest'

import { DEFAULT_PHRASES, DEFAULT_VALUE_PATTERNS } from '@/engine/patterns'
import { isSensitiveKey, redact, scrubString, walk } from '@/engine/walk'
import type { LeakInfo } from '@/types'

// Test helper: build a chain of nested objects, used by depth cap tests.
const buildNested = (count: number): unknown => (count === 0 ? 'leaf' : { next: buildNested(count - 1) })

// Named function used by the function serialization test. Lives at module
// scope so the function is created once rather than once per test run.
function namedHandlerForFunctionTest(): void {
  /* intentionally empty */
}

describe('isSensitiveKey', () => {
  describe('matches sensitive keys', () => {
    it.each<[string, string]>([
      ['plain password', 'password'],
      ['userPassword in camelCase', 'userPassword'],
      ['user_password in snake case', 'user_password'],
      ['PASSWORD in upper case', 'PASSWORD'],
      ['apiKey in camelCase', 'apiKey'],
      ['api_key in snake case', 'api_key'],
      ['API_KEY in upper case', 'API_KEY'],
      ['the kebab style HTTP header x api key', 'x-api-key'],
      ['xApiKey with a leading single letter x', 'xApiKey'],
      ['authorization', 'authorization'],
      ['cookie', 'cookie'],
      ['the kebab style HTTP header set cookie', 'set-cookie'],
      ['access_token', 'access_token'],
      ['accessToken', 'accessToken'],
      ['refreshToken', 'refreshToken'],
      ['idToken', 'idToken'],
      ['credit_card_number', 'credit_card_number'],
      ['CardNumber', 'CardNumber'],
      ['cvv', 'cvv'],
      ['ssn', 'ssn'],
      ['privateKey', 'privateKey'],
      ['private_key', 'private_key'],
      ['clientSecret', 'clientSecret'],
      ['pin', 'pin'],
      ['credentials', 'credentials'],
    ])('%s', (_label, key) => {
      expect(isSensitiveKey(key, DEFAULT_PHRASES)).toBe(true)
    })
  })

  describe('rejects false positive guards', () => {
    it.each<[string, string]>([
      ['tokenizer (one segment that is not the word token)', 'tokenizer'],
      ['tokenized', 'tokenized'],
      ['passwordless', 'passwordless'],
      ['passwordless_login', 'passwordless_login'],
      ['username', 'username'],
      ['user_name', 'user_name'],
      ['user_id', 'user_id'],
      ['email', 'email'],
      ['phone', 'phone'],
      ['createdAt', 'createdAt'],
      ['updatedAt', 'updatedAt'],
      ['description', 'description'],
      ['message', 'message'],
      ['count', 'count'],
      ['total', 'total'],
      ['accessLog (segments are access and log, no access key or access token match)', 'accessLog'],
      ['access_count', 'access_count'],
      ['identifier', 'identifier'],
    ])('%s', (_label, key) => {
      expect(isSensitiveKey(key, DEFAULT_PHRASES)).toBe(false)
    })
  })

  describe('with custom phrase lists', () => {
    it('matches a custom single token phrase', () => {
      expect(isSensitiveKey('foo', [['foo']])).toBe(true)
      expect(isSensitiveKey('bar', [['foo']])).toBe(false)
    })

    it('matches a multi token phrase as consecutive segments anywhere in the key', () => {
      expect(isSensitiveKey('userApiKey', [['api', 'key']])).toBe(true)
      expect(isSensitiveKey('apiSomethingKey', [['api', 'key']])).toBe(false)
    })

    it('matches a phrase that occupies the only viable window (whole key)', () => {
      // segments are exactly two long, phrase is exactly two long, only
      // possible start is index 0
      expect(isSensitiveKey('apiKey', [['api', 'key']])).toBe(true)
    })

    it('matches a phrase anchored at the right boundary of a longer key', () => {
      // segments are three long, phrase is two long, last viable start is
      // index 1 (so the phrase covers positions 1 and 2)
      expect(isSensitiveKey('myApiKey', [['api', 'key']])).toBe(true)
    })

    it('relies on tokenize for case folding (uppercase keys still match)', () => {
      // The function does no case folding of its own. It trusts tokenize to
      // lowercase before comparison, so an uppercase key still matches a
      // lowercase phrase.
      expect(isSensitiveKey('API_KEY', [['api', 'key']])).toBe(true)
    })

    it('treats an empty key as non sensitive', () => {
      expect(isSensitiveKey('', DEFAULT_PHRASES)).toBe(false)
    })

    it('treats an empty phrase list as non sensitive for every key', () => {
      expect(isSensitiveKey('password', [])).toBe(false)
    })

    it('ignores phrases that are longer than the key has segments', () => {
      expect(isSensitiveKey('foo', [['foo', 'bar']])).toBe(false)
    })

    it('ignores empty phrase entries inside the list', () => {
      expect(isSensitiveKey('foo', [[]])).toBe(false)
    })
  })
})

describe('scrubString', () => {
  it('replaces a JWT inside surrounding text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk0'
    expect(scrubString({ text: `auth ${jwt} ok`, censor: '[X]', patterns: DEFAULT_VALUE_PATTERNS })).toBe('auth [X] ok')
  })

  it('replaces an AWS access key embedded in free text', () => {
    expect(
      scrubString({ text: 'using AKIAIOSFODNN7EXAMPLE for s3', censor: '[X]', patterns: DEFAULT_VALUE_PATTERNS })
    ).toBe('using [X] for s3')
  })

  it('replaces multiple matches in one string', () => {
    const input = 'k1=AKIAIOSFODNN7EXAMPLE k2=AKIAIOSFODNN7OTHER12'
    expect(scrubString({ text: input, censor: '[X]', patterns: DEFAULT_VALUE_PATTERNS })).toBe('k1=[X] k2=[X]')
  })

  it('replaces a Luhn valid credit card number with separators', () => {
    expect(scrubString({ text: 'card: 4111 1111 1111 1111 ok', censor: '[X]', patterns: DEFAULT_VALUE_PATTERNS })).toBe(
      'card: [X] ok'
    )
  })

  it('does not replace a 16 digit number that fails the Luhn checksum', () => {
    const input = 'order: 1234 5678 9012 3456'
    expect(scrubString({ text: input, censor: '[X]', patterns: DEFAULT_VALUE_PATTERNS })).toBe(input)
  })

  it('replaces a database connection string with embedded credentials', () => {
    const input = 'using postgres://user:hunter2@db.example.com/x for backups'
    const output = scrubString({ text: input, censor: '[X]', patterns: DEFAULT_VALUE_PATTERNS })
    expect(output).not.toContain('hunter2')
    expect(output).toContain('[X]')
  })

  it('returns the input unchanged when no pattern matches', () => {
    expect(
      scrubString({
        text: 'plain log line, nothing to redact',
        censor: '[X]',
        patterns: DEFAULT_VALUE_PATTERNS,
      })
    ).toBe('plain log line, nothing to redact')
  })

  it('uses the provided censor string verbatim', () => {
    expect(scrubString({ text: 'AKIAIOSFODNN7EXAMPLE', censor: '<<HIDDEN>>', patterns: DEFAULT_VALUE_PATTERNS })).toBe(
      '<<HIDDEN>>'
    )
  })

  it('handles an empty pattern list by only running the credit card pass', () => {
    // No explicit patterns provided. The Luhn pass still redacts a valid card.
    expect(scrubString({ text: 'card: 4111111111111111 done', censor: '[X]', patterns: [] })).toBe('card: [X] done')
  })

  it('invokes the onMatch callback for every replacement', () => {
    const observed: Array<{ matched: string; reason: 'pattern' | 'luhn' }> = []
    scrubString({
      text: 'AKIAIOSFODNN7EXAMPLE then 4111111111111111',
      censor: '[X]',
      patterns: DEFAULT_VALUE_PATTERNS,
      onMatch: (matched, reason) => {
        observed.push({ matched, reason })
      },
    })
    expect(observed).toContainEqual({ matched: 'AKIAIOSFODNN7EXAMPLE', reason: 'pattern' })
    expect(observed).toContainEqual({ matched: '4111111111111111', reason: 'luhn' })
  })
})

describe('walk', () => {
  describe('redacts values at sensitive keys', () => {
    it('redacts a top level sensitive key', () => {
      expect(walk({ password: 'hunter2', name: 'Alice' })).toEqual({
        password: '[REDACTED]',
        name: 'Alice',
      })
    })

    it('redacts a nested sensitive key', () => {
      expect(walk({ user: { id: 'u', api_key: 'sk' } })).toEqual({
        user: { id: 'u', api_key: '[REDACTED]' },
      })
    })

    it('redacts inside arrays', () => {
      expect(walk([{ token: 't1' }, { token: 't2' }])).toEqual([{ token: '[REDACTED]' }, { token: '[REDACTED]' }])
    })

    it('does not redact when the key is in the allow list', () => {
      expect(walk({ user: { email: 'a@b.com', password: 'p' } }, { allow: ['user.email'] })).toEqual({
        user: { email: 'a@b.com', password: '[REDACTED]' },
      })
    })
  })

  describe('value shape detection on innocent keyed strings', () => {
    it('redacts a JWT inside a free text field', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk0'
      const output = walk({ note: `token=${jwt} ok` }) as { note: string }
      expect(output.note).not.toContain(jwt)
      expect(output.note).toContain('[REDACTED]')
    })

    it('redacts an AWS access key in a context note', () => {
      const output = walk({ context: 'using AKIAIOSFODNN7EXAMPLE for s3' }) as { context: string }
      expect(output.context).not.toContain('AKIAIOSFODNN7EXAMPLE')
    })

    it('skips value shape scrubbing when valueShapes is false', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk0'
      expect(walk({ note: jwt }, { valueShapes: false })).toEqual({ note: jwt })
    })
  })

  describe('truncation and depth caps', () => {
    it('truncates strings longer than maxStringLen', () => {
      const output = walk({ note: 'x'.repeat(10000) }, { maxStringLen: 100 }) as { note: string }
      expect(output.note.length).toBeLessThan(200)
      expect(output.note).toContain('[TRUNCATED]')
    })

    it('emits a depth marker once nesting exceeds maxDepth', () => {
      const output = walk(buildNested(20), { maxDepth: 3 })
      let cursor: unknown = output
      let traversedDepth = 0
      while (cursor && typeof cursor === 'object' && 'next' in (cursor as Record<string, unknown>)) {
        cursor = (cursor as { next: unknown }).next
        traversedDepth++
        if (traversedDepth > 6) break
      }
      expect(cursor).toBe('[TRUNCATED:DEPTH]')
    })
  })

  describe('cycle handling', () => {
    it('replaces cyclic self references with [CIRCULAR]', () => {
      const cyclicRoot: Record<string, unknown> = { name: 'root' }
      cyclicRoot.self = cyclicRoot
      const output = walk(cyclicRoot) as Record<string, unknown>
      expect(output.name).toBe('root')
      expect(output.self).toBe('[CIRCULAR]')
    })

    it('replaces cyclic parent child references too', () => {
      const parent: Record<string, unknown> = { kind: 'parent' }
      const child: Record<string, unknown> = { kind: 'child', back: parent }
      parent.child = child
      const output = walk(parent) as Record<string, unknown>
      const renderedChild = output.child as Record<string, unknown>
      expect(renderedChild.kind).toBe('child')
      expect(renderedChild.back).toBe('[CIRCULAR]')
    })
  })

  describe('special object types', () => {
    it('serializes Date as an ISO string', () => {
      const date = new Date('2026-01-01T00:00:00.000Z')
      expect(walk({ ts: date })).toEqual({ ts: '2026-01-01T00:00:00.000Z' })
    })

    it('serializes RegExp via toString', () => {
      expect(walk({ rx: /abc/i })).toEqual({ rx: '/abc/i' })
    })

    it('converts a Map to a plain object with stringified keys', () => {
      const source = new Map<string, string>([
        ['password', 'hunter2'],
        ['name', 'Alice'],
      ])
      expect(walk({ data: source })).toEqual({
        data: { password: '[REDACTED]', name: 'Alice' },
      })
    })

    it('converts a Set to an array of walked values', () => {
      expect(walk({ ids: new Set([1, 2, 3]) })).toEqual({ ids: [1, 2, 3] })
    })

    it('marks an ArrayBuffer with a binary placeholder', () => {
      const buffer = new ArrayBuffer(8)
      expect(walk({ payload: buffer })).toEqual({ payload: '[ArrayBuffer:8b]' })
    })

    it('marks a Uint8Array with a typed array placeholder', () => {
      const bytes = new Uint8Array([1, 2, 3])
      expect(walk({ payload: bytes })).toEqual({ payload: '[Uint8Array:3b]' })
    })
  })

  describe('Error serialization', () => {
    it('serializes name, message, and stack', () => {
      const error = new Error('boom')
      const output = walk({ err: error }) as { err: Record<string, unknown> }
      expect(output.err.name).toBe('Error')
      expect(output.err.message).toBe('boom')
      expect(typeof output.err.stack).toBe('string')
    })

    it('redacts sensitive own properties on a custom Error subclass', () => {
      class AuthError extends Error {
        constructor(public token: string) {
          super('auth failed')
        }
      }
      const output = walk({ err: new AuthError('secrettoken') }) as {
        err: Record<string, unknown>
      }
      expect(output.err.token).toBe('[REDACTED]')
    })

    it('serializes Error.cause and redacts inside the chain', () => {
      const root = new Error('root') as Error & { token?: string }
      root.token = 'abc123'
      const wrapped = new Error('wrap', { cause: root })
      const output = walk({ err: wrapped }) as { err: Record<string, unknown> }
      expect((output.err.cause as Record<string, unknown>).token).toBe('[REDACTED]')
    })
  })

  describe('primitives and other value types', () => {
    it('passes null through', () => {
      expect(walk(null)).toBe(null)
    })

    it('passes undefined through', () => {
      expect(walk(undefined)).toBe(undefined)
    })

    it('passes numbers and booleans through', () => {
      expect(walk(42)).toBe(42)
      expect(walk(true)).toBe(true)
      expect(walk(false)).toBe(false)
    })

    it('passes a top level string through unchanged when no value shape matches', () => {
      expect(walk('hello world')).toBe('hello world')
    })

    it('serializes BigInt as a string with the n suffix', () => {
      expect(walk({ big: 12345n })).toEqual({ big: '12345n' })
    })

    it('serializes Symbol via String', () => {
      const output = walk({ marker: Symbol('label') }) as { marker: string }
      expect(output.marker).toContain('label')
    })

    it('serializes a function with its name as a placeholder', () => {
      const output = walk({ handler: namedHandlerForFunctionTest }) as { handler: string }
      expect(output.handler).toBe('[Function:namedHandlerForFunctionTest]')
    })

    it('serializes an anonymous function with the placeholder anonymous', () => {
      const output = walk({ handler: () => 1 }) as { handler: string }
      expect(output.handler).toMatch(/\[Function:/)
    })
  })

  describe('options', () => {
    it('respects a custom censor', () => {
      expect(walk({ password: 'p' }, { censor: '***' })).toEqual({ password: '***' })
    })

    it('extends the phrase list via extraPhrases', () => {
      expect(walk({ internalId: 'x' }, { extraPhrases: [['internal', 'id']] })).toEqual({
        internalId: '[REDACTED]',
      })
    })

    it('replaces the phrase list when phrases is set explicitly', () => {
      // With an explicit empty phrase list, no key matches at all.
      expect(walk({ password: 'hunter2' }, { phrases: [] })).toEqual({
        password: 'hunter2',
      })
    })

    it('extends the value pattern list via extraValuePatterns', () => {
      const output = walk(
        { note: 'mycorp_ABCDEFGHIJKLMNOP appears here' },
        { extraValuePatterns: [/MYCORP_[A-Z]{16}/g] }
      ) as { note: string }
      // The custom pattern is case sensitive, so the lowercase prefix avoids
      // a match. Use uppercase to verify the redaction applies.
      expect(output.note).toBe('mycorp_ABCDEFGHIJKLMNOP appears here')
      const matchOutput = walk(
        { note: 'MYCORP_ABCDEFGHIJKLMNOP appears here' },
        { extraValuePatterns: [/MYCORP_[A-Z]{16}/g] }
      ) as { note: string }
      expect(matchOutput.note).not.toContain('MYCORP_ABCDEFGHIJKLMNOP')
    })
  })

  describe('mutation safety', () => {
    it('never mutates the input tree', () => {
      const input = { password: 'hunter2', user: { token: 'sk' } }
      walk(input)
      expect(input.password).toBe('hunter2')
      expect(input.user.token).toBe('sk')
    })
  })

  describe('throwing getters', () => {
    it('replaces a property whose getter throws with the [GETTER_THREW] marker', () => {
      const trapped: Record<string, unknown> = {}
      Object.defineProperty(trapped, 'evil', {
        enumerable: true,
        get() {
          throw new Error('boom')
        },
      })
      const output = walk(trapped) as Record<string, unknown>
      expect(output.evil).toBe('[GETTER_THREW]')
    })
  })

  describe('onLeak hook (CLI surface)', () => {
    it('reports key matches with path and matched key name', () => {
      const leaks: LeakInfo[] = []
      walk({ user: { api_key: 'sk' } }, undefined, {
        onLeak: (info) => leaks.push(info),
      })
      const apiKeyLeak = leaks.find((info) => info.path === 'user.api_key')
      expect(apiKeyLeak).toBeDefined()
      expect(apiKeyLeak?.kind).toBe('key')
      expect(apiKeyLeak?.reason).toBe('phrase')
      expect(apiKeyLeak?.matched).toBe('api_key')
    })

    it('reports value shape matches with path and matched substring', () => {
      const leaks: LeakInfo[] = []
      walk({ note: 'AKIAIOSFODNN7EXAMPLE inside text' }, undefined, {
        onLeak: (info) => leaks.push(info),
      })
      const valueLeak = leaks.find((info) => info.kind === 'value')
      expect(valueLeak).toBeDefined()
      expect(valueLeak?.path).toBe('note')
      expect(valueLeak?.reason).toBe('pattern')
      expect(valueLeak?.matched).toBe('AKIAIOSFODNN7EXAMPLE')
    })

    it('reports Luhn validated credit card matches with reason luhn', () => {
      const leaks: LeakInfo[] = []
      walk({ note: '4111111111111111' }, undefined, {
        onLeak: (info) => leaks.push(info),
      })
      const luhnLeak = leaks.find((info) => info.reason === 'luhn')
      expect(luhnLeak).toBeDefined()
      expect(luhnLeak?.kind).toBe('value')
    })

    it('reports paths inside arrays using bracket notation', () => {
      const leaks: LeakInfo[] = []
      walk({ entries: [{ token: 'a' }, { token: 'b' }] }, undefined, {
        onLeak: (info) => leaks.push(info),
      })
      const paths = leaks.map((info) => info.path).toSorted((leftPath, rightPath) => leftPath.localeCompare(rightPath))
      expect(paths).toEqual(['entries[0].token', 'entries[1].token'])
    })
  })
})

describe('redact (public wrapper)', () => {
  it('produces the same output as walk for the no hook case', () => {
    expect(redact({ password: 'p', name: 'A' })).toEqual({
      password: '[REDACTED]',
      name: 'A',
    })
  })

  it('forwards options through to the underlying walker', () => {
    expect(redact({ password: 'p' }, { censor: '***' })).toEqual({ password: '***' })
  })

  it('keeps a two argument signature (value, options) on the public surface', () => {
    // Hooks belong inside `options.onLeak`. A third positional argument here
    // would force an explicit decision on whether to widen the API again.
    expect(redact.length).toBe(2)
  })

  it('invokes onLeak once per key match with the leak metadata', () => {
    const observed: LeakInfo[] = []
    redact({ user: { id: 'u_1', api_key: 'sk_live_xxx' }, note: 'plain' }, { onLeak: (info) => observed.push(info) })
    expect(observed).toHaveLength(1)
    expect(observed[0]).toEqual({
      path: 'user.api_key',
      kind: 'key',
      matched: 'api_key',
      reason: 'phrase',
    })
  })

  it('invokes onLeak for value shape matches inside string values', () => {
    const observed: LeakInfo[] = []
    redact({ note: 'AKIAIOSFODNN7EXAMPLE leaked here' }, { onLeak: (info) => observed.push(info) })
    expect(observed).toHaveLength(1)
    expect(observed[0]?.path).toBe('note')
    expect(observed[0]?.kind).toBe('value')
    expect(observed[0]?.matched).toBe('AKIAIOSFODNN7EXAMPLE')
    expect(observed[0]?.reason).toBe('pattern')
  })

  it('does not call onLeak when nothing matches', () => {
    const observed: LeakInfo[] = []
    redact({ id: 'u_1', name: 'Alice' }, { onLeak: (info) => observed.push(info) })
    expect(observed).toHaveLength(0)
  })
})
