import { describe, expect, it } from 'vitest'

import { createLogger } from '@/index'

describe('integration: error cause chain', () => {
  it('serializes nested causes and redacts sensitive properties at each level', () => {
    const capturedLines: string[] = []
    const log = createLogger({ transport: (line) => capturedLines.push(line) })

    const rootError = new Error('db down') as Error & { connection_string?: string }
    rootError.connection_string = 'postgres://app:secret@db.example.com/mydb'

    const wrappedError = new Error('boot failed', { cause: rootError })
    log.error(wrappedError)

    const record = JSON.parse(capturedLines[0]!)
    expect(record.err.message).toBe('boot failed')
    const cause = record.err.cause as Record<string, string>
    expect(cause.message).toBe('db down')
    expect(cause.connection_string).not.toContain('secret')
  })
})
