// node src/diff.test.js
import assert from 'node:assert/strict'
import { parseDiff, hunkPatch, split, linesPatch } from './diff.js'

const text = `diff --git a/f b/f
index 1..2 100644
--- a/f
+++ b/f
@@ -1,3 +1,3 @@
 a
-b
+B
 c
@@ -10,2 +10,3 @@ fn
 x
+y
 z
\\ No newline at end of file
`
const d = parseDiff(text)
assert.equal(d.header.length, 4)
assert.equal(d.hunks.length, 2)
assert.deepEqual(d.hunks[0].rows.map(r => [r.type, r.o, r.n]), [['ctx', 1, 1], ['del', 2, undefined], ['add', undefined, 2], ['ctx', 3, 3]])
assert.deepEqual(d.hunks[1].rows.map(r => r.text), ['x', 'y', 'z']) // "\ No newline" is not a row...
assert.ok(hunkPatch(d, d.hunks[1]).includes('\\ No newline')) // ...but stays in the patch
assert.ok(hunkPatch(d, d.hunks[1]).startsWith('diff --git a/f b/f\n') && !hunkPatch(d, d.hunks[1]).includes('-b'))
const s = split(d.hunks[0].rows)
assert.equal(s.length, 3)
assert.deepEqual([s[1][0].text, s[1][1].text], ['b', 'B']) // deletion paired with its replacement
assert.deepEqual(split(d.hunks[1].rows)[1], [null, d.hunks[1].rows[1]])
// pick only "+B" of "-b +B +C": forward turns -b into context and drops +C
const one = parseDiff('--- a/f\n+++ b/f\n@@ -1,2 +1,3 @@\n a\n-b\n+B\n+C\n')
const h0 = one.hunks[0]
const pickB = new Set([h0.rows.find(r => r.text === 'B').ri])
assert.equal(linesPatch(one, h0, pickB, false), '--- a/f\n+++ b/f\n@@ -1,2 +1,3 @@\n a\n b\n+B\n')
// reverse (unstage/discard "+B" only): -b is dropped, +C becomes context
assert.equal(linesPatch(one, h0, pickB, true), '--- a/f\n+++ b/f\n@@ -1,2 +1,3 @@\n a\n+B\n C\n')
console.log('diff ok')
