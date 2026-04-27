## autoredact

#### A JSON logger that strips secrets and PII out of every record.

## Why this matters

Your logs end up in places you do not control. A Lambda `console.log({ req })` writes every `Authorization` header into CloudWatch for the length of the retention policy. `Sentry.captureException(err, { extra: payload })` ships that payload to Sentry's servers. A Datadog agent indexes your stdout JSON field by field, so an `sk_live_` Stripe key or a `cookie` value lands in a search index the whole workspace can query. Once a credential reaches any of those, "rotate" is the only safe response.

## Installation

```bash
npm install autoredact
```

```bash
pnpm add autoredact
```

```bash
yarn add autoredact
```

## Usage

Zero configuration required.

```ts
import { createLogger } from 'autoredact'

const logger = createLogger()

// Sensitive keys redact regardless of where they sit in the tree.
logger.info({ user: { id: 'u_1', api_key: 'sk_live_xxx', email: 'abc@xyz.com' } }, 'user signed in')
// {
//   "time": "...",
//   "level": "info",
//   "msg": "user signed in",
//   "user": {
//     "id": "u_1",
//     "api_key": "[REDACTED]",
//     "email": "abc@xyz.com"
//   }
// }

// Credentials buried inside a free form string are caught by shape, not by path.
logger.info({ note: 'rotated AKIAIOSFODNN7EXAMPLE yesterday' })
// {
//   "time": "...",
//   "level": "info",
//   "note": "rotated [REDACTED] yesterday"
// }

// Errors get scrubbed inside both message and stack, even though the surrounding
// keys are 'message' and 'stack', not 'databaseUrl'.
logger.error(new Error('cannot connect to postgres://app:hunter2@db.example.com/mydb'))
// {
//   "time": "...",
//   "level": "error",
//   "msg": "cannot connect to [REDACTED]",
//   "err": {
//     "name": "Error",
//     "message": "cannot connect to [REDACTED]",
//     "stack": "Error: cannot connect to [REDACTED]\n    at ..."
//   }
// }
```

## How it works

### What gets redacted by key name

About thirty default phrases plus their snake, camel, and kebab variants. The full default list:

`password`, `passwd`, `pwd`, `passphrase`, `secret`, `secrets`, `credential`, `credentials`, `token`, `tokens`, `bearer`, `refresh_token`, `id_token`, `access_token`, `authorization`, `auth`, `cookie`, `cookies`, `set-cookie`, `api_key`, `access_key`, `private_key`, `client_secret`, `session`, `otp`, `mfa`, `totp`, `ssn`, `sin`, `credit_card`, `card_number`, `cvv`, `cvc`, `cvv2`, `tax_id`, `ein`, `iban`, `routing_number`, `pin`, `pincode`.

The tokenizer splits keys at camel boundaries, underscores, and dashes, so `userApiKey`, `user_api_key`, and `x-api-key` all match the phrase `['api', 'key']` once. There is no per case duplication in the deny list.

### What gets redacted by value shape

Patterns scan every string value in the tree, including string values inside Error messages and stack traces:

- `eyJ...` JWT (three base64url segments)
- `AKIA...` AWS access keys, `ASIA...` AWS STS tokens
- `sk_live_...`, `sk_test_...`, `pk_live_...`, `rk_...` Stripe keys
- `ghp_...`, `gho_...`, `ghu_...`, `ghs_...`, `ghr_...` GitHub classic tokens
- `github_pat_...` GitHub fine grained PATs
- `xox[a-z]-...` Slack tokens
- `-----BEGIN ... PRIVATE KEY-----` PEM blocks
- `Bearer <token>` in free text
- `protocol://user:password@host` database connection strings
- 13 to 19 digit numbers that pass the Luhn checksum (credit card numbers)

The Luhn gate keeps the credit card pattern from redacting innocent digit runs (order ids, invoice numbers).

## API

### `createLogger(options?)`

```ts
const logger = createLogger({
  level: 'info', // 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent'
  transport: 'json', // 'json' | 'pretty' | (line, record) => void
  redact: { extraPhrases: [['hmac']] },
  base: { service: 'api' },
})

logger.info('msg')
logger.info({ obj: 1 }, 'msg')
logger.error(error)
logger.error(error, 'context')

const child = logger.child({ requestId })
logger.isLevelEnabled('debug')
```

The logger is generic on the binding shape. The `base` option's shape threads through every record and every child:

```ts
const logger = createLogger({ base: { service: 'api', region: 'sg' } })
// logger: Logger<{ service: string; region: string }>

const child = logger.child({ requestId: 'r1' })
// child: Logger<{ service: string; region: string; requestId: string }>

const transport = (line: string, record: LogRecord<{ service: string }>) => {
  // record.service is typed string, no cast needed
}
```

### `redact(value, options?)`

The standalone redactor for ad hoc use outside the logger. Useful before sending payloads to third party error reporters or analytics services.

```ts
import { redact } from 'autoredact'
sentry.captureException(error, { extra: redact(payload) })
```

### `RedactOptions`

All fields are optional. Defaults cover the security baseline.

```ts
type RedactOptions = {
  // Add to the default phrase list. The recommended way to extend.
  // Default: []
  extraPhrases?: ReadonlyArray<ReadonlyArray<string>>

  // Replace the default phrase list entirely. Advanced.
  // Default: DEFAULT_PHRASES
  phrases?: ReadonlyArray<ReadonlyArray<string>>

  // Path allowlist. Values at these paths pass through untouched.
  // Default: []
  allow?: ReadonlyArray<string>

  // Replacement string for redacted values.
  // Default: '[REDACTED]'
  censor?: string

  // Whether to scan string values for credential shapes.
  // Default: true
  valueShapes?: boolean

  // Add to the default value shape regex set. Each entry is coerced to
  // carry the `g` flag automatically.
  // Default: []
  extraValuePatterns?: ReadonlyArray<RegExp>

  // Maximum object or array nesting depth before emitting a marker.
  // Default: 8
  maxDepth?: number

  // Maximum string length before truncation.
  // Default: 8192
  maxStringLen?: number

  // Optional callback invoked once per redaction event. Receives the path,
  // kind, matched substring, and reason. Useful for metrics and alarms.
  // Default: undefined
  onLeak?: (info: LeakInfo) => void
}

type LeakInfo = {
  path: string // 'user.api_key', 'env[3].token'
  kind: 'key' | 'value' // key match or string content match
  matched: string // the key name or the matched substring
  reason: 'phrase' | 'pattern' | 'luhn' // which detector fired
}
```

`createLogger` accepts the same callback at the top level so the logger forwards every redaction it performs:

```ts
const logger = createLogger({
  base: { service: 'api' },
  onLeak: (info) => metrics.increment('autoredact.leak', { reason: info.reason }),
})
```

A child logger inherits its parent's `onLeak` automatically.

## Examples

### Add a custom phrase

```ts
const logger = createLogger({
  redact: { extraPhrases: [['internal', 'id'], ['hmac']] },
})
logger.info({ internalId: 'abc', hmac: 'xyz' })
// internalId and hmac both redact
```

### Allow a specific path

Useful when one specific field at a known path is safe to log even though its key name would otherwise match.

```ts
const logger = createLogger({
  redact: { allow: ['user.email', 'request.session.id'] },
})
```

### Custom censor

```ts
const logger = createLogger({
  redact: { censor: '***' },
})
```

### Custom value shape regex

```ts
const logger = createLogger({
  redact: {
    extraValuePatterns: [/internal-id-[a-f0-9]{16}/i],
  },
})
```

### Custom transport

```ts
const logger = createLogger({
  transport: (line, record) => {
    fetch('https://logs.example.com/ingest', { method: 'POST', body: line })
  },
})
```

### Observe what gets redacted

Wire `onLeak` to your metrics or alarm system to surface what would otherwise be silent. Useful both as a tripwire (a Stripe key fires a redaction, you want to know which call site put it there) and as a long term signal of where sanitisation is missing upstream.

```ts
const logger = createLogger({
  onLeak: (info) => {
    metrics.increment('autoredact.leak', { reason: info.reason, kind: info.kind })
    if (info.reason === 'pattern') {
      alarm.send(`credential shape redacted at ${info.path}`)
    }
  },
})
```

The same callback is available on `redact()` directly:

```ts
import { redact } from 'autoredact'

const safe = redact(payload, {
  onLeak: (info) => metrics.increment('autoredact.leak', { reason: info.reason }),
})
```

### Standalone redactor

```ts
import { redact } from 'autoredact'

const safePayload = redact({ user, requestBody, headers })
sentry.captureException(error, { extra: safePayload })
```

## CLI

`autoredact-scan` audits log files offline for leaks the application missed. Useful as a CI gate against historical files or as a periodic scan against a centralized log store.

```bash
npx autoredact-scan log.jsonl
npx autoredact-scan logs/*.jsonl
cat app.log | npx autoredact-scan
npx autoredact-scan --json log.jsonl > out.json
npx autoredact-scan --strict log.jsonl   # exit 1 if leaks found, for CI
```

Run `autoredact-scan --help` for the full flag list.

## Resilience

The walker is hardened against the inputs that crash naive implementations. Logging never crashes the calling app:

- Cycles emit `[CIRCULAR]` and recursion stops. Shared object references that are not cycles still walk normally.
- Depth caps at `maxDepth` (default 8) and emits `[TRUNCATED:DEPTH]`.
- String length caps at `maxStringLen` (default 8192) with a `[TRUNCATED]` suffix appended after scrubbing, so a credential straddling the cap does not leak a partial.
- Throwing getters substitute `[GETTER_THREW]` rather than crashing.
- Walker errors degrade to a single `_redact_error` field on the record.
- Transport errors log once via `console.error` and silence for the lifetime of the logger.

## License

[MIT License](./LICENSE) © 2026-present [Cong Nguyen](https://github.com/chicong065)
