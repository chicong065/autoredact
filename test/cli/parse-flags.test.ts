import { describe, expect, it } from 'vitest'

import { parseFlags } from '@/cli/parse-flags'

describe('parseFlags', () => {
  describe('positional file arguments', () => {
    it('collects a single file argument', () => {
      expect(parseFlags(['log.jsonl'])).toMatchObject({ files: ['log.jsonl'] })
    })

    it('collects multiple file arguments in order', () => {
      expect(parseFlags(['a.log', 'b.log', 'c.log'])).toMatchObject({
        files: ['a.log', 'b.log', 'c.log'],
      })
    })

    it('treats arguments after a double dash terminator as files', () => {
      expect(parseFlags(['--', '--json'])).toMatchObject({
        files: ['--json'],
        json: false,
      })
    })
  })

  describe('boolean flags', () => {
    it('parses --json', () => {
      expect(parseFlags(['--json', 'a.log'])).toMatchObject({ json: true, files: ['a.log'] })
    })

    it('parses --quiet and --strict together', () => {
      expect(parseFlags(['--quiet', '--strict'])).toMatchObject({
        quiet: true,
        strict: true,
        files: [],
      })
    })

    it('parses --no-value-shapes', () => {
      expect(parseFlags(['--no-value-shapes'])).toMatchObject({ valueShapes: false })
    })

    it('parses -h and --help to the same help boolean', () => {
      expect(parseFlags(['-h'])).toMatchObject({ help: true })
      expect(parseFlags(['--help'])).toMatchObject({ help: true })
    })

    it('parses -v and --version to the same version boolean', () => {
      expect(parseFlags(['-v'])).toMatchObject({ version: true })
      expect(parseFlags(['--version'])).toMatchObject({ version: true })
    })
  })

  describe('mode flag', () => {
    it('accepts the inline form --mode=jsonl', () => {
      expect(parseFlags(['--mode=jsonl'])).toMatchObject({ mode: 'jsonl' })
    })

    it('accepts the separate value form --mode text', () => {
      expect(parseFlags(['--mode', 'text'])).toMatchObject({ mode: 'text' })
    })

    it('accepts the auto value', () => {
      expect(parseFlags(['--mode', 'auto'])).toMatchObject({ mode: 'auto' })
    })

    it('rejects an unsupported mode value', () => {
      expect(() => parseFlags(['--mode', 'xml'])).toThrow(/--mode/)
    })
  })

  describe('repeatable phrase flag', () => {
    it('collects each phrase as a comma split token list', () => {
      const parsed = parseFlags(['--phrase', 'foo,bar', '--phrase', 'baz'])
      expect(parsed.phrases).toEqual([['foo', 'bar'], ['baz']])
    })

    it('trims whitespace around the comma separated tokens', () => {
      const parsed = parseFlags(['--phrase', 'foo , bar'])
      expect(parsed.phrases).toEqual([['foo', 'bar']])
    })

    it('drops empty tokens produced by trailing or repeated commas', () => {
      const parsed = parseFlags(['--phrase', 'foo,,bar,'])
      expect(parsed.phrases).toEqual([['foo', 'bar']])
    })
  })

  describe('repeatable pattern flag', () => {
    it('parses a slash delimited regex literal with flags', () => {
      const parsed = parseFlags(['--pattern', '/abc/i'])
      expect(parsed.patterns).toHaveLength(1)
      expect(parsed.patterns[0]!.source).toBe('abc')
      expect(parsed.patterns[0]!.flags).toContain('i')
      expect(parsed.patterns[0]!.flags).toContain('g')
    })

    it('parses a bare string as a literal regex', () => {
      const parsed = parseFlags(['--pattern', 'abc'])
      expect(parsed.patterns).toHaveLength(1)
      expect(parsed.patterns[0]!.source).toBe('abc')
      expect(parsed.patterns[0]!.flags).toContain('g')
    })

    it('collects multiple patterns in order', () => {
      const parsed = parseFlags(['--pattern', '/abc/', '--pattern', '/xyz/i'])
      expect(parsed.patterns).toHaveLength(2)
      expect(parsed.patterns[0]!.source).toBe('abc')
      expect(parsed.patterns[1]!.source).toBe('xyz')
    })
  })

  describe('error handling', () => {
    it('rejects an unknown flag', () => {
      expect(() => parseFlags(['--bogus'])).toThrow(/unknown flag/i)
    })

    it('rejects --mode without a value', () => {
      expect(() => parseFlags(['--mode'])).toThrow(/requires a value/i)
    })

    it('rejects --phrase without a value', () => {
      expect(() => parseFlags(['--phrase'])).toThrow(/requires a value/i)
    })
  })

  describe('defaults', () => {
    it('starts every boolean and array field at the documented default', () => {
      const parsed = parseFlags([])
      expect(parsed).toEqual({
        files: [],
        json: false,
        quiet: false,
        strict: false,
        mode: 'auto',
        phrases: [],
        patterns: [],
        valueShapes: true,
        help: false,
        version: false,
      })
    })
  })
})
