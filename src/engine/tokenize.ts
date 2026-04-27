/**
 * Insert an underscore at every boundary where a lowercase letter or digit is
 * followed by an uppercase letter. Turns `apiKey` into `api_Key`.
 */
const CAMEL_CASE_BOUNDARY = /([a-z0-9])([A-Z])/g

/**
 * Insert an underscore at acronym boundaries where a run of uppercase letters
 * is followed by an uppercase letter that starts a new lowercase word.
 * Turns `URLPath` into `URL_Path` so the leading acronym becomes its own segment.
 */
const ACRONYM_BOUNDARY = /([A-Z]+)([A-Z][a-z])/g

/**
 * Match runs of one or more characters that are neither lowercase ASCII letters
 * nor digits. Used as the split delimiter after lowercasing.
 */
const NON_ALPHANUMERIC_RUN = /[^a-z0-9]+/

/**
 * Split a key into lowercase token segments.
 *
 * Pipeline:
 *
 * 1. Insert underscores at camelCase and PascalCase boundaries.
 * 2. Insert underscores at acronym boundaries (so `URLPath` becomes `URL_Path`).
 * 3. Lowercase the whole string.
 * 4. Split on any run of non alphanumeric characters.
 * 5. Drop empty segments produced by leading, trailing, or repeated separators.
 *
 * Characters outside the ASCII range are treated as delimiters because the
 * splitter rejects anything that is not in `[a-z0-9]` after lowercasing. There
 * is no Unicode aware case folding.
 *
 * Examples (input then expected segments):
 *
 *     'userPassword' becomes ['user', 'password']
 *     'x-api-key'    becomes ['x', 'api', 'key']
 *     'URLPath'      becomes ['url', 'path']
 *     'tokenizer'    stays as ['tokenizer']  (one segment, no false positive on `token`)
 */
export function tokenize(key: string): string[] {
  // Runtime safety net: catches null or undefined from untyped JS callers
  // before the regex chain would throw on a non string receiver.
  if (!key) return []

  return key
    .replace(CAMEL_CASE_BOUNDARY, '$1_$2')
    .replace(ACRONYM_BOUNDARY, '$1_$2')
    .toLowerCase()
    .split(NON_ALPHANUMERIC_RUN)
    .filter(Boolean)
}
