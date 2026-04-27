import { describe, expect, it } from 'vitest'

import { luhnValid } from '@/engine/luhn'

describe('luhnValid', () => {
  describe('valid card numbers', () => {
    it.each<[string, string]>([
      ['Visa test card (16 digits)', '4111111111111111'],
      ['Mastercard test card (16 digits)', '5555555555554444'],
      ['Amex test card (15 digits)', '378282246310005'],
      ['Discover test card (16 digits)', '6011111111111117'],
      ['lower length boundary (13 digits, all 2s)', '4222222222222'],
      ['upper length boundary (19 digits)', '4000000000000000006'],
    ])('%s', (_label, cardNumber) => {
      expect(luhnValid(cardNumber)).toBe(true)
    })
  })

  describe('invalid inputs', () => {
    it.each<[string, string]>([
      ['off by one from a valid card', '4111111111111112'],
      ['16 digits but not Luhn checksumed', '1234567890123456'],
      ['empty string', ''],
      ['single digit', '1'],
      ['letters only', 'abc'],
      ['digits with a trailing letter', '1234567890a'],
      ['11 digits, below the lower length cap', '12345678901'],
      ['12 digits, just below the lower cap', '422222222222'],
      ['20 digits, above the upper length cap', '12345678901234567890'],
    ])('%s', (_label, input) => {
      expect(luhnValid(input)).toBe(false)
    })
  })
})
