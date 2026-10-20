// node src/words.test.js
import assert from 'node:assert/strict'
import { wordDiff, markWords } from './words.js'

assert.deepEqual(wordDiff('let a = 1;', 'let b = 1;'), ['let <mark>a</mark> = 1;', 'let <mark>b</mark> = 1;'])
assert.deepEqual(wordDiff('x <b>', 'y <b>'), ['<mark>x</mark> &#60;b&#62;', '<mark>y</mark> &#60;b&#62;']) // file text stays escaped
assert.deepEqual(wordDiff('foo(a, b)', 'foo(a, b, c)'), ['foo(a, b)', 'foo(a, b<mark>, c</mark>)'])
assert.equal(wordDiff('alpha', 'beta'), null) // nothing shared: leave syntax highlight alone

const rows = [
  { type: 'ctx', text: 'same' },
  { type: 'del', text: 'old one' },
  { type: 'del', text: 'gone' },
  { type: 'add', text: 'new one' },
]
markWords(rows)
assert.equal(rows[1].words, '<mark>old</mark> one')
assert.equal(rows[3].words, '<mark>new</mark> one')
assert.equal(rows[2].words, undefined) // unpaired deletion
assert.equal(rows[0].words, undefined)
console.log('words ok')
