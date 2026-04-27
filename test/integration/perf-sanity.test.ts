import { describe, expect, it } from 'vitest'

import { redact } from '@/index'

describe('integration: perf sanity', () => {
  it('redacts a 1000 item array of small records under 100 milliseconds', () => {
    const items = Array.from({ length: 1000 }, (_, index) => ({
      id: index,
      token: `t${index}`,
      name: `n${index}`,
    }))

    const startTime = performance.now()
    const output = redact(items) as Array<Record<string, unknown>>
    const elapsedMilliseconds = performance.now() - startTime

    expect(output[0]!.token).toBe('[REDACTED]')
    expect(output[999]!.name).toBe('n999')
    expect(elapsedMilliseconds).toBeLessThan(100)
  })

  it('handles a deeply nested object up to depth 6 without truncation', () => {
    let nested: Record<string, unknown> = { value: 'leaf' }
    for (let layer = 0; layer < 6; layer++) {
      nested = { next: nested, layer, password: 'p' }
    }
    const output = redact(nested) as Record<string, unknown>
    expect(output.password).toBe('[REDACTED]')
    // The layer count above is intentionally one below the default maxDepth
    // (8) so no truncation marker should appear at any visited depth.
    expect(JSON.stringify(output)).not.toContain('[TRUNCATED:DEPTH]')
  })
})
