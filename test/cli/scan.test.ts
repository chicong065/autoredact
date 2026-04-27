import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { scanFile, scanStream } from '@/cli/scan'

const createTempDirectory = (): string => mkdtempSync(join(tmpdir(), 'autoredact-test-'))

const defaultOptions = {
  mode: 'auto' as const,
  extraPhrases: [],
  extraPatterns: [],
  valueShapes: true,
}

describe('scanFile', () => {
  it('finds a key match leak in a JSONL file', async () => {
    const directory = createTempDirectory()
    const filePath = join(directory, 'log.jsonl')
    writeFileSync(filePath, JSON.stringify({ msg: 'hi', user: { api_key: 'secret' } }) + '\n')

    const result = await scanFile(filePath, defaultOptions)

    expect(result.lines).toBe(1)
    expect(result.skipped).toBe(0)
    const apiKeyLeak = result.leaks.find((leak) => leak.path === 'user.api_key')
    expect(apiKeyLeak).toBeDefined()
    expect(apiKeyLeak?.kind).toBe('key')
    expect(apiKeyLeak?.line).toBe(1)
    expect(apiKeyLeak?.file).toBe(filePath)
  })

  it('finds a value shape leak in a JSONL file', async () => {
    const directory = createTempDirectory()
    const filePath = join(directory, 'log.jsonl')
    writeFileSync(filePath, JSON.stringify({ msg: 'AKIAIOSFODNN7EXAMPLE in ctx' }) + '\n')

    const result = await scanFile(filePath, defaultOptions)

    const valueLeak = result.leaks.find((leak) => leak.kind === 'value')
    expect(valueLeak).toBeDefined()
    expect(valueLeak?.matched).toContain('AKIA')
  })

  it('falls back to a text scan when a line is not JSON in auto mode', async () => {
    const directory = createTempDirectory()
    const filePath = join(directory, 'log.txt')
    writeFileSync(filePath, 'INFO using AKIAIOSFODNN7EXAMPLE for s3\n')

    const result = await scanFile(filePath, defaultOptions)

    expect(result.lines).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.leaks).toHaveLength(1)
    expect(result.leaks[0]!.kind).toBe('value')
    expect(result.leaks[0]!.path).toBe('<line>')
  })

  it('counts non parseable lines as skipped in jsonl mode', async () => {
    const directory = createTempDirectory()
    const filePath = join(directory, 'mixed.log')
    writeFileSync(filePath, 'plain text line\n')

    const result = await scanFile(filePath, { ...defaultOptions, mode: 'jsonl' })

    expect(result.lines).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.leaks).toHaveLength(0)
  })

  it('skips JSON parse and runs text only scan in text mode', async () => {
    const directory = createTempDirectory()
    const filePath = join(directory, 'log.txt')
    // The line is valid JSON with a key match (`password`). In text mode,
    // the scanner does not parse the line, so the key match is invisible
    // and only the value pattern scan runs (which finds nothing here).
    writeFileSync(filePath, JSON.stringify({ password: 'p' }) + '\n')

    const result = await scanFile(filePath, { ...defaultOptions, mode: 'text' })

    expect(result.lines).toBe(1)
    expect(result.leaks.filter((leak) => leak.kind === 'key')).toHaveLength(0)
  })

  it('returns zero leaks for an empty file', async () => {
    const directory = createTempDirectory()
    const filePath = join(directory, 'empty.log')
    writeFileSync(filePath, '')

    const result = await scanFile(filePath, defaultOptions)

    expect(result.lines).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.leaks).toHaveLength(0)
  })

  it('counts every leak in a multi line file with both key and value matches', async () => {
    const directory = createTempDirectory()
    const filePath = join(directory, 'log.jsonl')
    const lines = [
      JSON.stringify({ msg: 'first', token: 't1' }),
      JSON.stringify({ msg: 'AKIAIOSFODNN7EXAMPLE', user: { api_key: 'k' } }),
      JSON.stringify({ msg: 'innocent' }),
    ]
    writeFileSync(filePath, lines.join('\n') + '\n')

    const result = await scanFile(filePath, defaultOptions)

    expect(result.lines).toBe(3)
    expect(result.leaks.filter((leak) => leak.line === 1)).toHaveLength(1)
    expect(result.leaks.filter((leak) => leak.line === 2).length).toBeGreaterThanOrEqual(2)
    expect(result.leaks.filter((leak) => leak.line === 3)).toHaveLength(0)
  })

  it('honors --no-value-shapes by skipping the value pattern scan in text mode', async () => {
    const directory = createTempDirectory()
    const filePath = join(directory, 'log.txt')
    writeFileSync(filePath, 'using AKIAIOSFODNN7EXAMPLE for s3\n')

    const result = await scanFile(filePath, {
      ...defaultOptions,
      mode: 'text',
      valueShapes: false,
    })

    expect(result.lines).toBe(1)
    expect(result.leaks).toHaveLength(0)
  })

  it('applies extra phrases supplied through options', async () => {
    const directory = createTempDirectory()
    const filePath = join(directory, 'log.jsonl')
    writeFileSync(filePath, JSON.stringify({ internalId: 'x' }) + '\n')

    const result = await scanFile(filePath, {
      ...defaultOptions,
      extraPhrases: [['internal', 'id']],
    })

    const internalIdLeak = result.leaks.find((leak) => leak.path === 'internalId')
    expect(internalIdLeak).toBeDefined()
    expect(internalIdLeak?.kind).toBe('key')
  })
})

describe('scanStream', () => {
  it('reads from a Readable stream and finds leaks', async () => {
    const stream = Readable.from([Buffer.from('using AKIAIOSFODNN7EXAMPLE for s3\n')])
    const result = await scanStream(stream, '<stdin>', defaultOptions)
    expect(result.leaks).toHaveLength(1)
    expect(result.file).toBe('<stdin>')
  })

  it('handles a multi line stream and tracks line numbers correctly', async () => {
    const lines = ['plain log line one', JSON.stringify({ token: 't' }), 'and a third']
    const stream = Readable.from([Buffer.from(lines.join('\n') + '\n')])
    const result = await scanStream(stream, '<stdin>', defaultOptions)
    const tokenLeak = result.leaks.find((leak) => leak.path === 'token')
    expect(tokenLeak?.line).toBe(2)
  })
})
