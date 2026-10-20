// node src/identity.test.js
import assert from 'node:assert/strict'
import { parseSig, gravatarUrl, writeIdentity } from './identity.js'

assert.equal(parseSig('N\x1f\n'), null)
assert.deepEqual(parseSig('G\x1fAna <ana@x.id>\n'), { code: 'G', label: 'Terverifikasi', tone: 'ok', signer: 'Ana <ana@x.id>' })
assert.equal(parseSig('B\x1f').tone, 'bad')

// SHA-256 of "test@example.com"; case and spaces are normalized first
const url = await gravatarUrl('  Test@Example.com ')
assert.equal(url, 'https://gravatar.com/avatar/973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b?s=64&d=identicon')

// empty values unset, missing keys are left alone
const calls = []
await writeIdentity(async (...a) => calls.push(a.join(' ')), '--local', { name: 'Ana', signingkey: '' })
assert.deepEqual(calls, ['config --local user.name Ana', 'config --local --unset user.signingkey'])
console.log('identity ok')
