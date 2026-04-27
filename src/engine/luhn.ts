/**
 * ASCII code point of the character `0`. Used to convert a single digit
 * character to its numeric value via subtraction (`charCodeAt - DIGIT_ZERO_CODE`),
 * which is faster than `Number(...)` or `parseInt(...)` in tight loops.
 *
 * This trick only produces a correct numeric value when the input character is
 * already known to be in the ASCII range `0` to `9`. The validating regex below
 * (`VALID_CARD_DIGITS_PATTERN`) enforces that precondition at the public entry,
 * so the loop body can rely on it.
 */
const DIGIT_ZERO_CODE = 48

/**
 * Compiled pattern that matches a string of 13 to 19 ASCII digits, end to end.
 * The 13 to 19 range matches real card lengths (Visa short, Amex 15, standard 16,
 * Maestro 19) and corresponds to the spec at section 3.4 of the design document.
 * Anything shorter or longer, anything with non digit characters, is rejected.
 */
const VALID_CARD_DIGITS_PATTERN = /^\d{13,19}$/

/**
 * Validate a digit string against the Luhn checksum algorithm.
 *
 * Algorithm:
 *
 * 1. Reject any input that is not 13 to 19 ASCII digits.
 * 2. Walk the digits in reverse.
 * 3. Every other digit (counting from the rightmost, starting with the second
 *    rightmost) is doubled and folded back to a single digit if the doubled
 *    value exceeds 9.
 * 4. The remaining digits contribute their raw value.
 * 5. The final sum is valid when it is divisible by 10.
 *
 * Used by the engine to gate the credit card detector. Only digit runs that
 * pass this check are redacted, which avoids false positives on order numbers,
 * invoice ids, and other innocent digit sequences of the same length.
 */
export function luhnValid(digits: string): boolean {
  if (!VALID_CARD_DIGITS_PATTERN.test(digits)) return false

  let checksum = 0
  let shouldDouble = false

  for (let position = digits.length - 1; position >= 0; position--) {
    const rawDigit = digits.charCodeAt(position) - DIGIT_ZERO_CODE
    checksum += shouldDouble ? doubleAndFold(rawDigit) : rawDigit
    shouldDouble = !shouldDouble
  }

  return checksum % 10 === 0
}

/**
 * Luhn `double` step. When `2 * digit` is more than 9 (a value with two
 * decimal digits), fold it back to a single digit by subtracting 9. This is
 * equivalent to summing the two decimal digits of the doubled value
 * (for example, `8 * 2 = 16`, then `1 + 6 = 7`, equivalent to `16 - 9 = 7`).
 *
 * Precondition: `digit` is in the range 0 to 9. Calling this with any other
 * value silently produces a wrong contribution. The public entry above
 * enforces this precondition by validating the entire input string with
 * `VALID_CARD_DIGITS_PATTERN` before the loop runs.
 */
function doubleAndFold(digit: number): number {
  const doubled = digit * 2
  return doubled > 9 ? doubled - 9 : doubled
}
