import { describe, expect, it } from 'vitest'

import { createLogger } from '@/index'

describe('integration: Express request log', () => {
  it('redacts headers, cookies, and request body fields end to end', () => {
    const capturedLines: string[] = []
    const log = createLogger({ transport: (line) => capturedLines.push(line) })
    const request = {
      method: 'POST',
      url: '/login',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature1234567890',
        cookie: 'session=abc123',
      },
      body: { email: 'a@b.com', password: 'hunter2' },
    }
    log.info({ request }, 'request received')

    const record = JSON.parse(capturedLines[0]!)
    expect(record.request.headers.authorization).toBe('[REDACTED]')
    expect(record.request.headers.cookie).toBe('[REDACTED]')
    expect(record.request.body.password).toBe('[REDACTED]')
    expect(record.request.body.email).toBe('a@b.com')
    expect(record.request.method).toBe('POST')
    expect(record.request.url).toBe('/login')
  })
})
