// node src/merge.test.js
import assert from 'node:assert/strict'
import { parseConflicts, compose } from './merge.js'

const file = `top
<<<<<<< HEAD
mine
||||||| base
orig
=======
theirs 1
theirs 2
>>>>>>> feature
mid
<<<<<<< HEAD
=======
added
>>>>>>> feature
end
`
const segs = parseConflicts(file)
const conflicts = segs.filter(s => !s.lines)
assert.equal(conflicts.length, 2)
assert.deepEqual(conflicts[0].base, ['orig'])
assert.deepEqual(conflicts[0].theirs, ['theirs 1', 'theirs 2'])
assert.equal(conflicts[1].theirsLabel, 'feature')
assert.equal(compose(segs), file) // unresolved round-trips exactly, trailing newline included

conflicts[0].choice = 'theirs'
conflicts[1].choice = 'both'
assert.equal(compose(segs), 'top\ntheirs 1\ntheirs 2\nmid\nadded\nend\n')
conflicts[0].choice = 'both-rev'
assert.match(compose(segs), /^top\ntheirs 1\ntheirs 2\nmine\nmid/)
assert.throws(() => parseConflicts('a\n<<<<<<< HEAD\nb\n'), /tidak lengkap/)
console.log('merge ok')
