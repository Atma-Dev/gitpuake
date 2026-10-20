// node src/blame.test.js
import assert from 'node:assert/strict'
import { parseBlame } from './blame.js'

const A = 'a'.repeat(40), B = 'b'.repeat(40)
const out = [
  `${A} 1 1 2`, 'author Ani', 'author-time 100', 'summary first', 'filename f', '\tline one',
  `${A} 2 2`, '\tline two',
  `${B} 3 3 1`, 'author Budi Santoso', 'author-time 200', 'summary second commit', 'filename f', '\t',
  '',
].join('\n')
const lines = parseBlame(out)
assert.equal(lines.length, 3)
assert.deepEqual(lines[1], { hash: A, n: 2, text: 'line two', author: 'Ani', time: 100, summary: 'first' }) // details reused
assert.equal(lines[2].author, 'Budi Santoso')
assert.equal(lines[2].text, '') // empty source line
console.log('blame ok')
