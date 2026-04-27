import { bench, describe } from 'vitest'

import { redact } from '@/index'

/**
 * Representative Express request payload used for the headline benchmark.
 * Roughly 10 keys and two levels deep, the shape the spec uses for its
 * sub 50 microsecond goal.
 */
const expressRequestFixture = {
  method: 'POST',
  url: '/api/users/123',
  headers: {
    'content-type': 'application/json',
    authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signaturexxxxxxxx',
  },
  body: { id: 123, name: 'A', email: 'a@b.com', password: 'hunter2' },
  ts: Date.now(),
}

const oneHundredItemArray = Array.from({ length: 100 }, (_, index) => ({
  id: index,
  token: `t${index}`,
  name: `n${index}`,
}))

describe('engine bench', () => {
  bench('redact typical Express request payload', () => {
    redact(expressRequestFixture)
  })

  bench('redact 100 item array', () => {
    redact(oneHundredItemArray)
  })
})
