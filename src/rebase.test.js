// node src/rebase.test.js
import assert from 'node:assert/strict'
import { buildTodo, validate } from './rebase.js'

const items = [
  { hash: 'c3', action: 'fixup', msg: 'three' },
  { hash: 'c2', action: 'reword', msg: "it's new" },
  { hash: 'c1', action: 'pick', msg: 'one' },
]
assert.equal(
  buildTodo(items),
  `pick c1\npick c2\nexec git commit --amend -q -m 'it'\\''s new' -m "$(git log -1 --format=%b)"\nfixup c3\n`,
)
assert.equal(validate(items), '')
assert.match(validate([{ hash: 'c1', action: 'squash', msg: 'x' }]), /paling lama/)
assert.match(validate([{ hash: 'c2', action: 'pick', msg: 'x' }, { hash: 'c1', action: 'drop', msg: 'y' }, { hash: 'c0', action: 'drop', msg: 'z' }].map((it, i) => (i === 0 ? { ...it, action: 'fixup' } : it))), /paling lama/)
assert.match(validate([{ hash: 'c1', action: 'reword', msg: ' ' }]), /kosong/)
console.log('rebase ok')
