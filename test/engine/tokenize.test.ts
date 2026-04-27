import { describe, expect, it } from 'vitest'

import { tokenize } from '@/engine/tokenize'

describe('tokenize', () => {
  it.each<[string, string[]]>([
    ['password', ['password']],
    ['userPassword', ['user', 'password']],
    ['user_password', ['user', 'password']],
    ['user-password', ['user', 'password']],
    ['x-api-key', ['x', 'api', 'key']],
    ['API_KEY', ['api', 'key']],
    ['xApiKey', ['x', 'api', 'key']],
    ['URLPath', ['url', 'path']],
    ['HTTPRequest', ['http', 'request']],
    ['accessToken', ['access', 'token']],
    ['MFA_CODE', ['mfa', 'code']],
    ['__init__', ['init']],
    ['user.email', ['user', 'email']],
    ['v2.access_token', ['v2', 'access', 'token']],
    ['CamelCase', ['camel', 'case']],
    ['snake_case_thing', ['snake', 'case', 'thing']],
    ['kebab-case-thing', ['kebab', 'case', 'thing']],
    ['', []],
    ['   ', []],
    ['1234', ['1234']],
    // false positive guards: these contain a sensitive substring but tokenize as a single word
    ['tokenizer', ['tokenizer']],
    ['passwordless', ['passwordless']],
    ['accessLog', ['access', 'log']],
  ])('tokenize(%j) becomes %j', (input, expected) => {
    expect(tokenize(input)).toEqual(expected)
  })
})
