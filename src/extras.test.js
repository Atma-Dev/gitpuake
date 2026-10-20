// node src/extras.test.js
import assert from 'node:assert/strict'
import { parseWorktrees, parseSubmodules } from './extras.js'

const wt = parseWorktrees(`worktree /r/main
HEAD aaa
branch refs/heads/main

worktree /r/w 2
HEAD bbb
detached
prunable gitdir file points to non-existent location

worktree /r/feat
HEAD ccc
branch refs/heads/feature/x
locked

`)
assert.equal(wt.length, 3)
assert.deepEqual(wt[0], { path: '/r/main', head: 'aaa', branch: 'main', bare: false, locked: false, prunable: false })
assert.equal(wt[1].path, '/r/w 2')
assert.equal(wt[1].branch, '')
assert.ok(wt[1].prunable)
assert.equal(wt[2].branch, 'feature/x')
assert.ok(wt[2].locked)
assert.ok(parseWorktrees('worktree /r/bare.git\nbare\n')[0].bare)

const sm = parseSubmodules(` 1111111111111111111111111111111111111111 libs/a (v1.0)
-2222222222222222222222222222222222222222 libs/b c
+3333333333333333333333333333333333333333 vendor/x (heads/main)
U0000000000000000000000000000000000000000 conflict
`)
assert.deepEqual(sm.map(s => s.state), [' ', '-', '+', 'U'])
assert.deepEqual(sm.map(s => s.path), ['libs/a', 'libs/b c', 'vendor/x', 'conflict'])
assert.equal(sm[0].sha, '1111111111111111111111111111111111111111')
console.log('extras ok')
