/**
 * Default sensitive key phrases used by `isSensitiveKey`.
 *
 * Each entry is an ordered token sequence (the kind produced by `tokenize`).
 * A single token phrase matches when any segment of a tokenized key equals it.
 * A multi token phrase requires those tokens as consecutive segments.
 *
 * Grouped by category for readability. Order does not affect matching.
 */
export const DEFAULT_PHRASES: ReadonlyArray<ReadonlyArray<string>> = [
  // Passwords and passphrases
  ['password'],
  ['passwd'],
  ['pwd'],
  ['passphrase'],

  // Generic secret and credential containers
  ['secret'],
  ['secrets'],
  ['credential'],
  ['credentials'],

  // Tokens of any flavor
  ['token'],
  ['tokens'],
  ['bearer'],
  ['refresh', 'token'],
  ['id', 'token'],
  ['access', 'token'],

  // HTTP authorization and cookies
  ['authorization'],
  ['auth'],
  ['cookie'],
  ['cookies'],
  ['set', 'cookie'],

  // API and access keys
  ['api', 'key'],
  ['access', 'key'],
  ['private', 'key'],
  ['client', 'secret'],

  // Sessions
  ['session'],

  // Multi factor authentication codes
  ['otp'],
  ['mfa'],
  ['totp'],

  // National identifiers
  ['ssn'],
  ['sin'],

  // Payment cards
  ['credit', 'card'],
  ['card', 'number'],
  ['cvv'],
  ['cvc'],
  ['cvv2'],

  // Tax and banking identifiers
  ['tax', 'id'],
  ['ein'],
  ['iban'],
  ['routing', 'number'],

  // PIN codes
  ['pin'],
  ['pincode'],
]

/** JSON Web Token. Three base64url segments separated by dots, prefixed `eyJ`. */
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g

/** AWS access key id, prefix `AKIA`, exactly 16 uppercase alphanumerics after. */
const AWS_ACCESS_KEY_PATTERN = /\bAKIA[0-9A-Z]{16}\b/g

/** AWS Security Token Service short term token, prefix `ASIA`, exactly 16 uppercase alphanumerics after. */
const AWS_STS_TOKEN_PATTERN = /\bASIA[0-9A-Z]{16}\b/g

/** Stripe live, test, secret, restricted, and publishable keys. */
const STRIPE_KEY_PATTERN = /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g

/**
 * GitHub classic personal access tokens, OAuth tokens, refresh tokens, and
 * server tokens. The single character after `gh` distinguishes the token type:
 * `p` (personal access token), `o` (oauth), `u` (user to server), `s` (server
 * to server), `r` (refresh).
 */
const GITHUB_CLASSIC_TOKEN_PATTERN = /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g

/** GitHub fine grained personal access tokens (the format introduced in 2022). */
const GITHUB_FINE_GRAINED_PAT_PATTERN = /\bgithub_pat_[A-Za-z0-9_]{36,}\b/g

/**
 * Slack tokens (any prefix variant in the `xox` family).
 *
 * The dash in the trailing class `[A-Za-z0-9-]` sits at the end of the class
 * so it is treated literally and not as a range. Editors adding more
 * characters after the dash must keep the dash in trailing position.
 */
const SLACK_TOKEN_PATTERN = /\bxox[a-z]-[A-Za-z0-9-]{10,}\b/g

/** PEM encoded private key block, including RSA, EC, and PKCS8 variants. */
const PEM_PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g

/**
 * `Bearer <token>` in free text (case insensitive on the prefix).
 *
 * The dash sits at the very end of the character class so it cannot be
 * misread as a range. The previous codepoint in the class is `=` (U+003D),
 * which would form an invalid descending range in Unicode aware mode.
 */
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi

/**
 * Database connection string with embedded credentials.
 * Matches forms like `postgres://user:password@host/db`, `mysql://...`, `mongodb+srv://...`.
 * Requires both a username and a password (the colon between them is mandatory)
 * to avoid matching plain URLs without user info.
 */
const DB_CONNECTION_STRING_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/gi

/**
 * Default value shape regex patterns. Each entry is named after the
 * credential format it detects so reviews and stack traces can refer to them
 * by name rather than by regex shape.
 *
 * **Stateful global flag warning.** Every entry carries the `g` flag so
 * callers can use `String.prototype.replace` to redact every match in a
 * single pass. The `g` flag also makes `.test()` stateful: each call
 * advances `lastIndex`, so back to back calls on the same string can return
 * different results. Callers that use `.test()` MUST set `pattern.lastIndex = 0`
 * before each call. Iteration helpers built on top of these patterns must
 * guarantee the reset themselves.
 */
export const DEFAULT_VALUE_PATTERNS: ReadonlyArray<RegExp> = [
  JWT_PATTERN,
  AWS_ACCESS_KEY_PATTERN,
  AWS_STS_TOKEN_PATTERN,
  STRIPE_KEY_PATTERN,
  GITHUB_CLASSIC_TOKEN_PATTERN,
  GITHUB_FINE_GRAINED_PAT_PATTERN,
  SLACK_TOKEN_PATTERN,
  PEM_PRIVATE_KEY_PATTERN,
  BEARER_TOKEN_PATTERN,
  DB_CONNECTION_STRING_PATTERN,
]
