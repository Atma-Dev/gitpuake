// node src/avatars.test.js
import assert from 'node:assert/strict'
import { parseAvatarRows } from './forge.js'

const m = parseAvatarRows('A@x.io\thttps://avatars.githubusercontent.com/u/1?v=4\n\nb@x.io\thttps://a/b.png\n')
assert.equal(m['a@x.io'], 'https://avatars.githubusercontent.com/u/1?v=4&s=64')
assert.equal(m['b@x.io'], 'https://a/b.png?s=64')
assert.equal(Object.keys(m).length, 2)
console.log('avatars ok')
