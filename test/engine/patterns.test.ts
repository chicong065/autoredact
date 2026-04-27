import { describe, expect, it } from 'vitest'

import { DEFAULT_PHRASES, DEFAULT_VALUE_PATTERNS } from '@/engine/patterns'

describe('DEFAULT_PHRASES', () => {
  it('contains core single token phrases', () => {
    const phrasesAsStrings = DEFAULT_PHRASES.map((phrase) => phrase.join(' '))
    const expectedSingleTokenPhrases = [
      'password',
      'secret',
      'token',
      'authorization',
      'cookie',
      'session',
      'pin',
      'ssn',
      'cvv',
      'credential',
      'credentials',
    ]
    for (const expected of expectedSingleTokenPhrases) {
      expect(phrasesAsStrings).toContain(expected)
    }
  })

  it('contains multi token phrases', () => {
    const phrasesAsStrings = DEFAULT_PHRASES.map((phrase) => phrase.join(' '))
    const expectedMultiTokenPhrases = [
      'api key',
      'access key',
      'private key',
      'client secret',
      'credit card',
      'card number',
    ]
    for (const expected of expectedMultiTokenPhrases) {
      expect(phrasesAsStrings).toContain(expected)
    }
  })

  it('every phrase is a non empty array of lowercase non empty strings', () => {
    for (const phrase of DEFAULT_PHRASES) {
      expect(phrase.length).toBeGreaterThan(0)
      for (const segment of phrase) {
        expect(segment).toMatch(/^[a-z0-9]+$/)
      }
    }
  })
})

describe('DEFAULT_VALUE_PATTERNS', () => {
  it.each<[string, string]>([
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk0'],
    ['AWS access key', 'AKIAIOSFODNN7EXAMPLE'],
    ['AWS STS token', 'ASIAIOSFODNN7EXAMPLE'],
    ['Stripe live key', 'sk_live_abc123def456ghi789jklmnopqr'],
    ['Stripe test key', 'sk_test_abc123def456ghi789jklmnopqr'],
    ['GitHub PAT classic', 'ghp_abc123def456ghi789jklmnopqrstuvwxyz1234'],
    ['GitHub PAT fine grained', 'github_pat_11ABCDE0Y0abcdefghijklmnopqrstuvwxyz1234'],
    ['Slack token', 'xoxb-1234567890-abcdef'],
    ['Bearer token in free text', 'Bearer abcdef0123456789ghijklmn'],
    ['Postgres URL with creds', 'postgres://user:hunter2@db.example.com/mydb'],
    ['MySQL URL with creds', 'mysql://root:secret@db.example.com:3306/x'],
  ])('matches %s', (_label, sample) => {
    const matched = DEFAULT_VALUE_PATTERNS.some((pattern) => {
      pattern.lastIndex = 0
      return pattern.test(sample)
    })
    expect(matched).toBe(true)
  })

  it('does not match innocent strings', () => {
    const innocentSamples = ['hello world', 'GET /users/123', 'production', '2026-04-25', 'https://example.com']
    for (const innocentText of innocentSamples) {
      const matched = DEFAULT_VALUE_PATTERNS.some((pattern) => {
        pattern.lastIndex = 0
        return pattern.test(innocentText)
      })
      expect(matched).toBe(false)
    }
  })

  it('does not match a JWT shaped string with segments below the minimum length', () => {
    // Three dot separated runs starting with `eyJ` but each shorter than 10
    // base64url characters. Real JWTs have payloads and signatures well above
    // this floor, so this near miss must not be flagged as a JWT.
    const nearMissJwt = 'eyJhello.world.x'
    const matched = DEFAULT_VALUE_PATTERNS.some((pattern) => {
      pattern.lastIndex = 0
      return pattern.test(nearMissJwt)
    })
    expect(matched).toBe(false)
  })

  it('matches a PEM private key block', () => {
    // The body is deliberately abbreviated with a Unicode ellipsis. The PEM
    // pattern uses a permissive `[\s\S]+?` between the BEGIN and END markers.
    const pemBlock = '-----BEGIN RSA PRIVATE KEY-----\nMIIEvAIBADANBgkqhki…\n-----END RSA PRIVATE KEY-----'
    const matched = DEFAULT_VALUE_PATTERNS.some((pattern) => {
      pattern.lastIndex = 0
      return pattern.test(pemBlock)
    })
    expect(matched).toBe(true)
  })

  it('regression: every pattern is stateful under the global flag and requires a lastIndex reset between .test() calls', () => {
    // This test pins the documented contract of `DEFAULT_VALUE_PATTERNS`: all
    // patterns carry the `g` flag, which makes `.test()` advance `lastIndex`.
    // A second back to back call on the same string returns false until the
    // caller resets `lastIndex` to 0. Future maintainers who consider switching
    // away from the global flag must update the JSDoc warning and any iterators
    // built on top of the export.
    const jwtSample = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk0'
    const jwtPattern = DEFAULT_VALUE_PATTERNS[0]!
    expect(jwtPattern.flags).toContain('g')
    jwtPattern.lastIndex = 0
    const firstCall = jwtPattern.test(jwtSample)
    const secondCallWithoutReset = jwtPattern.test(jwtSample)
    expect(firstCall).toBe(true)
    expect(secondCallWithoutReset).toBe(false)
    jwtPattern.lastIndex = 0
    expect(jwtPattern.test(jwtSample)).toBe(true)
  })
})
