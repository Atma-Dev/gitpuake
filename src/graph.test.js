// node src/graph.test.js
import assert from 'node:assert/strict'
import { parseLog, layout } from './graph.js'

// M merges F (feature) into B; F and B both branch off A.
const log = ['M\x1fB F\x1fHEAD -> main\x1fx\x1f3\x1fmerge', 'F\x1fA\x1f\x1fx\x1f2\x1ffeat', 'B\x1fA\x1f\x1fx\x1f2\x1fmain work', 'A\x1f\x1ftag: v1\x1fx\x1f1\x1froot'].join('\n')
const c = parseLog(log)
assert.deepEqual(c[0].parents, ['B', 'F'])
assert.deepEqual(c[0].refs, ['HEAD -> main'])
assert.equal(layout(c), 2)
assert.deepEqual(c.map(x => x.col), [0, 1, 0, 0])
assert.deepEqual(c[0].lines, [[0, 0, 'bottom'], [0, 1, 'bottom']])
assert.deepEqual(c[1].lines, [[0, 0, 'pass'], [1, 1, 'top'], [1, 1, 'bottom']])
assert.deepEqual(c[3].lines, [[0, 0, 'top'], [1, 0, 'top']]) // both branches converge on A
console.log('graph ok')
