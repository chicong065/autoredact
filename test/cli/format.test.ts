import { describe, expect, it } from 'vitest'

import { renderHuman, renderJson } from '@/cli/format'
import type { ScanResult } from '@/cli/scan'

const buildResult = (overrides: Partial<ScanResult> = {}): ScanResult => ({
  file: 'log.jsonl',
  lines: 100,
  skipped: 0,
  leaks: [],
  ...overrides,
})

describe('renderHuman', () => {
  it('emits one row per leak with file, line, path, kind, and reason', () => {
    const output = renderHuman(
      [
        buildResult({
          leaks: [
            {
              file: 'log.jsonl',
              line: 42,
              path: 'user.api_key',
              kind: 'key',
              matched: 'api_key',
              reason: 'phrase',
            },
          ],
        }),
      ],
      { quiet: false, color: false }
    )
    expect(output).toContain('log.jsonl:42')
    expect(output).toContain('user.api_key')
    expect(output).toContain('KEY')
    expect(output).toContain('phrase=api_key')
  })

  it('emits a value row with shape= reason for value matches', () => {
    const output = renderHuman(
      [
        buildResult({
          leaks: [
            {
              file: 'log.jsonl',
              line: 7,
              path: 'msg',
              kind: 'value',
              matched: 'AKIAIOSFODNN7EXAMPLE',
              reason: 'pattern',
            },
          ],
        }),
      ],
      { quiet: false, color: false }
    )
    expect(output).toContain('VALUE')
    expect(output).toContain('shape=AKIAIOSFODNN7EXAMPLE')
  })

  it('appends a summary line by default, mentioning leak count, lines, files, and unique paths', () => {
    const output = renderHuman(
      [
        buildResult({
          lines: 50,
          leaks: [
            {
              file: 'log.jsonl',
              line: 1,
              path: 'user.token',
              kind: 'key',
              matched: 'token',
              reason: 'phrase',
            },
            {
              file: 'log.jsonl',
              line: 2,
              path: 'user.token',
              kind: 'key',
              matched: 'token',
              reason: 'phrase',
            },
          ],
        }),
      ],
      { quiet: false, color: false }
    )
    expect(output).toContain('2 leaks')
    expect(output).toContain('50 lines')
    expect(output).toContain('1 file')
    expect(output).toContain('1 unique path')
  })

  it('uses singular "file" and "path" for counts of one', () => {
    const output = renderHuman(
      [
        buildResult({
          leaks: [{ file: 'log.jsonl', line: 1, path: 'p', kind: 'key', matched: 'p', reason: 'phrase' }],
        }),
      ],
      { quiet: false, color: false }
    )
    expect(output).toContain('1 file,')
    expect(output).toContain('1 unique path')
  })

  it('uses plural "files" and "paths" for counts greater than one', () => {
    const output = renderHuman(
      [
        buildResult({
          file: 'a.log',
          leaks: [{ file: 'a.log', line: 1, path: 'a', kind: 'key', matched: 'a', reason: 'phrase' }],
        }),
        buildResult({
          file: 'b.log',
          leaks: [{ file: 'b.log', line: 1, path: 'b', kind: 'key', matched: 'b', reason: 'phrase' }],
        }),
      ],
      { quiet: false, color: false }
    )
    expect(output).toContain('2 files')
    expect(output).toContain('2 unique paths')
  })

  it('omits the summary in quiet mode', () => {
    const output = renderHuman(
      [
        buildResult({
          leaks: [{ file: 'a', line: 1, path: 'p', kind: 'key', matched: 'p', reason: 'phrase' }],
        }),
      ],
      { quiet: true, color: false }
    )
    expect(output).not.toMatch(/leaks in/)
    expect(output).toContain('a:1')
  })

  it('truncates long matched values for display in the value row', () => {
    const veryLongValue = 'A'.repeat(200)
    const output = renderHuman(
      [
        buildResult({
          leaks: [
            {
              file: 'a',
              line: 1,
              path: 'p',
              kind: 'value',
              matched: veryLongValue,
              reason: 'pattern',
            },
          ],
        }),
      ],
      { quiet: false, color: false }
    )
    expect(output).toContain('shape=')
    // The truncation suffix is the Unicode ellipsis character.
    expect(output).toContain('…')
  })
})

describe('renderJson', () => {
  it('emits the documented stable schema', () => {
    const output = renderJson([
      buildResult({
        lines: 100,
        skipped: 2,
        leaks: [{ file: 'log.jsonl', line: 42, path: 'p', kind: 'key', matched: 'm', reason: 'phrase' }],
      }),
    ])
    const parsed = JSON.parse(output)
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.scanned).toEqual([{ file: 'log.jsonl', lines: 100 }])
    expect(parsed.leaks).toHaveLength(1)
    expect(parsed.summary).toEqual({
      total: 1,
      uniquePaths: 1,
      files: 1,
      skipped: 2,
    })
  })

  it('aggregates summary counts across multiple files', () => {
    const output = renderJson([
      buildResult({
        file: 'a.log',
        lines: 10,
        leaks: [
          {
            file: 'a.log',
            line: 1,
            path: 'token',
            kind: 'key',
            matched: 'token',
            reason: 'phrase',
          },
        ],
      }),
      buildResult({
        file: 'b.log',
        lines: 20,
        skipped: 3,
        leaks: [
          {
            file: 'b.log',
            line: 1,
            path: 'api_key',
            kind: 'key',
            matched: 'api_key',
            reason: 'phrase',
          },
          {
            file: 'b.log',
            line: 2,
            path: 'api_key',
            kind: 'key',
            matched: 'api_key',
            reason: 'phrase',
          },
        ],
      }),
    ])
    const parsed = JSON.parse(output)
    expect(parsed.summary.total).toBe(3)
    expect(parsed.summary.uniquePaths).toBe(2)
    expect(parsed.summary.files).toBe(2)
    expect(parsed.summary.skipped).toBe(3)
  })

  it('emits a parseable JSON document even when there are no leaks', () => {
    const output = renderJson([buildResult({ lines: 0 })])
    const parsed = JSON.parse(output)
    expect(parsed.leaks).toEqual([])
    expect(parsed.summary.total).toBe(0)
  })
})
