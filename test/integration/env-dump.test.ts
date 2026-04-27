import { describe, expect, it } from 'vitest'

import { createLogger } from '@/index'

describe('integration: process.env style dump', () => {
  it('redacts every recognizable secret env var by key or by value shape', () => {
    const capturedLines: string[] = []
    const log = createLogger({ transport: (line) => capturedLines.push(line) })
    log.info({
      environment: {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://app:hunter2@db.example.com/mydb',
        STRIPE_SECRET_KEY: 'sk_live_abcdefghijklmnopqrstuvwxyz1234',
        AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
        AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        GITHUB_TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz12345678901',
        PORT: '3000',
      },
    })

    const record = JSON.parse(capturedLines[0]!)
    const environment = record.environment as Record<string, string>

    // Key matches replace the entire value with the censor.
    expect(environment.STRIPE_SECRET_KEY).toBe('[REDACTED]')
    expect(environment.AWS_ACCESS_KEY_ID).toBe('[REDACTED]')
    expect(environment.AWS_SECRET_ACCESS_KEY).toBe('[REDACTED]')
    expect(environment.GITHUB_TOKEN).toBe('[REDACTED]')

    // Value shape match scrubs the matched substring inside the string.
    expect(environment.DATABASE_URL).not.toContain('hunter2')

    // Innocent fields stay intact.
    expect(environment.PORT).toBe('3000')
    expect(environment.NODE_ENV).toBe('production')
  })
})
