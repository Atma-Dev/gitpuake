<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open, ask } from '@tauri-apps/plugin-dialog'
import { LOG_FORMAT, parseLog, layout } from './graph.js'
import { parseDiff, hunkPatch, linesPatch } from './diff.js'
import { parseBlame } from './blame.js'
import DiffView from './DiffView.vue'
import { ACTIONS, buildTodo, validate } from './rebase.js'
import Welcome from './Welcome.vue'
import logo from './assets/puake.svg'

const ROW = 34
const LANE = 22
const REFS = 180
const COLORS = ['#2fb7f5', '#e65c9c', '#8ee05b', '#f5a623', '#a77bf3', '#36d6c3', '#f2665b', '#d6d14a']
const MAX_COMMITS = 1000 // ponytail: no virtual scrolling, raise or virtualize if huge histories matter

const repo = ref(localStorage.getItem('repo') || '')
const commits = ref([])
const graphWidth = ref(1)
const head = ref('')
const branches = ref({ local: [], remote: [] })
const status = ref({ staged: [], unstaged: [], conflicts: [] })
const selected = ref('WIP')
const commitFiles = ref([])
const diff = ref(null)
const msg = ref('')
const newBranch = ref('')
const busy = ref('')
const error = ref('')
const stashes = ref([])
const amend = ref(false)
const menu = ref(null) // commit context menu: { x, y, hash, input, value }
const diffMode = ref(localStorage.getItem('diffMode') || 'split')

const g = (...args) => invoke('git', { repo: repo.value, args })
const gIn = (input, ...args) => invoke('git', { repo: repo.value, args, input })
const vFocus = { mounted: el => el.focus() }
const selectedCommit = computed(() => commits.value.find(c => c.hash === selected.value))
const dirty = computed(() => status.value.staged.length + status.value.unstaged.length + status.value.conflicts.length > 0)
const x = i => LANE / 2 + 6 + i * LANE
const color = i => COLORS[i % COLORS.length]
const headRow = computed(() => commits.value.findIndex(c => c.refs.some(r => r === 'HEAD' || r.startsWith('HEAD -> '))))
const headCol = computed(() => commits.value[headRow.value]?.col ?? 0)

const initials = name => name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
const avatarColor = name => `hsl(${[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)} 45% 42%)`

const rtf = new Intl.RelativeTimeFormat('id', { numeric: 'auto' })
const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]
function ago(t) {
  const s = t - Date.now() / 1000
  const [unit, size] = UNITS.find(([, n]) => Math.abs(s) >= n) ?? ['second', 1]
  return rtf.format(Math.round(s / size), unit)
}

// "main" + "origin/main" on one commit collapse into a single synced pill.
function pills(refs, remotes) {
  const list = refs.filter(r => !r.endsWith('/HEAD')).map(r =>
    r.startsWith('tag: ') ? { name: r.slice(5), icon: '◆' }
    : r === 'HEAD' ? { name: 'HEAD', icon: '✔', head: true }
    : r.startsWith('HEAD -> ') ? { name: r.slice(8), icon: '✔', head: true }
    : remotes.has(r) ? { name: r, icon: '☁', remote: true }
    : { name: r, icon: '⎇' },
  )
  const short = p => p.name.slice(p.name.indexOf('/') + 1)
  const names = new Set(list.map(p => p.name))
  return list
    .filter(p => !(p.remote && names.has(short(p))))
    .map(p => ({ ...p, synced: list.some(q => q.remote && short(q) === p.name) }))
}

function path([a, b, kind], r) {
  const top = r * ROW, mid = top + ROW / 2, bot = top + ROW
  const [y1, y2] = kind === 'top' ? [top, mid] : kind === 'bottom' ? [mid, bot] : [top, bot]
  const ym = (y1 + y2) / 2
  return `M${x(a)} ${y1} C${x(a)} ${ym} ${x(b)} ${ym} ${x(b)} ${y2}`
}

// ponytail: undo entries capture state when the action ran; git commands run outside the app can make them stale
const undos = ref([]) // [{ label, undo }], newest last

async function run(label, fn, undo) {
  busy.value = label
  error.value = ''
  try {
    await fn()
    if (undo) undos.value = [...undos.value.slice(-19), { label, undo }]
  } catch (e) {
    error.value = String(e)
  }
  busy.value = ''
  await refresh()
}

function undo() {
  const u = undos.value.at(-1)
  if (!u || busy.value) return
  undos.value = undos.value.slice(0, -1)
  run('Undo ' + u.label.toLowerCase(), u.undo)
}

const headHash = async () => (await g('rev-parse', '-q', '--verify', 'HEAD')).trim()
const prevHead = async () => ({ branch: head.value, hash: await headHash() })
const goBack = p => (p.branch ? g('switch', p.branch) : g('switch', '--detach', p.hash))
// Moves HEAD back; --keep refuses instead of overwriting uncommitted work.
const resetBack = (hash, mode = '--keep') => () => (hash ? g('reset', mode, hash) : g('update-ref', '-d', 'HEAD'))

// Discard = stash the changes, then drop the entry but keep its commit hash so undo can re-apply it.
async function stashAway(paths) {
  const before = (await g('rev-parse', '-q', '--verify', 'refs/stash')).trim()
  await g('stash', 'push', '-u', '--keep-index', '-m', 'gitpuake discard', '--', ...paths)
  const hash = (await g('rev-parse', '-q', '--verify', 'refs/stash')).trim()
  if (!hash || hash === before) return '' // nothing was stashed; never drop the user's own stash
  await g('stash', 'drop', '-q')
  return hash
}
// Undo of stashAway: copy the stashed working-tree files back, leaving the index alone.
// ponytail: a discarded file deletion is not re-deleted on undo
async function unstashAway(hash) {
  const lines = s => s.split('\0').filter(Boolean)
  const tracked = lines(await g('diff', '--name-only', '-z', '--diff-filter=d', hash + '^1', hash))
  if (tracked.length) await g('restore', '--source=' + hash, '--worktree', '--', ...tracked)
  const untracked = (await g('rev-parse', '-q', '--verify', hash + '^3')).trim()
  if (untracked) await g('restore', '--source=' + untracked, '--worktree', '--', ...lines(await g('ls-tree', '-r', '-z', '--name-only', untracked)))
}

const UNMERGED = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']
function parseStatus(out) {
  const staged = [], unstaged = [], conflicts = []
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]
    if (!e) continue
    const [X, Y, path] = [e[0], e[1], e.slice(3)]
    if (X === 'R' || X === 'C') i++ // -z puts the rename source in the next entry
    if (UNMERGED.includes(X + Y)) {
      conflicts.push({ path, code: 'C' })
      continue
    }
    if (X !== ' ' && X !== '?') staged.push({ path, code: X })
    if (Y !== ' ') unstaged.push({ path, code: Y === '?' ? 'U' : Y })
  }
  return { staged, unstaged, conflicts }
}

const OPS = { REBASE_HEAD: 'rebase', MERGE_HEAD: 'merge', CHERRY_PICK_HEAD: 'cherry-pick', REVERT_HEAD: 'revert' }
const operation = ref('') // in-progress merge / cherry-pick / revert
const resolve = p => run('Resolve', () => g('add', '--', p))
const abortOp = async () => {
  if (await ask(`Batalkan ${operation.value}? Repo kembali ke kondisi sebelum ${operation.value} dimulai.`, { kind: 'warning' }))
    run('Abort', () => g(operation.value, '--abort'))
}
const continueOp = () =>
  run('Continue', () =>
    operation.value === 'merge' ? g('commit', '--no-edit') : g('-c', 'core.editor=true', operation.value, '--continue'),
  )

const query = ref('')
const searchEl = ref(null)
const matches = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return null
  return new Set(
    commits.value
      .filter(c => c.subject.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.hash.startsWith(q))
      .map(c => c.hash),
  )
})
function nextMatch(back) {
  const list = commits.value.filter(c => matches.value?.has(c.hash))
  if (!list.length) return
  const i = list.findIndex(c => c.hash === selected.value)
  const c = i < 0 ? list[0] : list[(i + (back ? -1 : 1) + list.length) % list.length]
  selectCommit(c.hash)
  document.getElementById('c-' + c.hash)?.scrollIntoView({ block: 'center' })
}

async function refresh() {
  if (!repo.value) return
  try {
    const [log, st, refs, cur, stash, ops] = await Promise.all([
      // empty repo has no log; stashes are listed in the sidebar instead of the graph
      g('log', '--exclude=refs/stash', '--all', '--topo-order', '-n', String(MAX_COMMITS), LOG_FORMAT).catch(() => ''),
      g('status', '--porcelain=v1', '-z', '-uall'),
      g('for-each-ref', '--format=%(refname)%1f%(upstream:track,nobracket)', 'refs/heads', 'refs/remotes'),
      g('branch', '--show-current'),
      g('stash', 'list', '--format=%gd%x1f%gs'),
      Promise.all(Object.keys(OPS).map(r => g('rev-parse', '-q', '--verify', r))), // missing ref -> ''
    ])
    stashes.value = stash.split('\n').filter(Boolean).map(l => {
      const [ref, subject] = l.split('\x1f')
      return { ref, subject }
    })
    operation.value = Object.values(OPS)[ops.findIndex(o => o.trim())] ?? ''
    const rows = refs.split('\n').map(l => l.split('\x1f')).filter(([r]) => r && !r.endsWith('/HEAD'))
    const track = {}
    for (const [r, t] of rows) {
      if (r.startsWith('refs/heads/') && t)
        track[r.slice(11)] = { ahead: +(t.match(/ahead (\d+)/)?.[1] ?? 0), behind: +(t.match(/behind (\d+)/)?.[1] ?? 0) }
    }
    branches.value = {
      local: rows.filter(([r]) => r.startsWith('refs/heads/')).map(([r]) => r.slice(11)),
      remote: rows.filter(([r]) => r.startsWith('refs/remotes/')).map(([r]) => r.slice(13)),
      track,
    }
    const remotes = new Set(branches.value.remote)
    const list = parseLog(log)
    for (const c of list) c.pills = pills(c.refs, remotes)
    graphWidth.value = layout(list)
    commits.value = list
    status.value = parseStatus(st)
    head.value = cur.trim()
    if (selected.value !== 'WIP' && !selectedCommit.value) selectCommit('WIP')
  } catch (e) {
    error.value = String(e)
  }
}

const recent = ref(JSON.parse(localStorage.getItem('recent') || '[]'))
const saveRecent = list => localStorage.setItem('recent', JSON.stringify((recent.value = list)))
const forget = path => saveRecent(recent.value.filter(r => r !== path))

async function openPath(dir) {
  try {
    const top = (await invoke('git', { repo: dir, args: ['rev-parse', '--show-toplevel'] })).trim()
    repo.value = top
    localStorage.setItem('repo', top)
    saveRecent([top, ...recent.value.filter(r => r !== top)].slice(0, 8))
    undos.value = []
    query.value = ''
    selected.value = 'WIP'
    diff.value = fileView.value = plan.value = null
    await refresh()
  } catch (e) {
    error.value = `${dir} bukan git repository. Pilih folder yang berisi .git, atau buat repository baru.`
  }
}
async function openRepo() {
  const dir = await open({ directory: true })
  if (dir) openPath(dir)
}
function goHome() {
  repo.value = ''
  localStorage.removeItem('repo')
  commits.value = []
  diff.value = fileView.value = plan.value = null
}

async function selectCommit(hash) {
  selected.value = hash
  diff.value = null
  fileView.value = null
  commitFiles.value = []
  if (hash === 'WIP') return
  const out = await g('show', '--format=', '--name-status', '--diff-merges=first-parent', hash)
  commitFiles.value = out.split('\n').filter(Boolean).map(l => {
    const [code, ...paths] = l.split('\t')
    return { code: code[0], path: paths.at(-1) }
  })
}

async function showDiff(file, kind) {
  const p = file.path
  let text
  if (kind === 'commit') text = await g('show', '--format=', '--diff-merges=first-parent', selected.value, '--', p)
  else if (kind === 'staged') text = await g('diff', '--cached', '--', p)
  else if (file.code === 'U' || file.code === 'C') text = await g('diff', '--no-index', '--', '/dev/null', p) // conflict: whole file with markers
  else text = await g('diff', '--', p)
  const d = parseDiff(text)
  fileView.value = null
  for (const h of d.hunks) h.picked = new Set() // raw line indexes picked for line-level staging
  diff.value = { file, kind, d }
}

const setDiffMode = m => localStorage.setItem('diffMode', (diffMode.value = m))
// Untracked files have no index entry to patch, so they are staged whole.
const hunkable = computed(() => diff.value && diff.value.kind !== 'commit' && !'UC'.includes(diff.value.file.code))
// Applies hunk `h` of the open diff, or only its picked lines when some are picked.
async function applyHunk(label, h, flags, undoFor) {
  const { file, kind, d } = diff.value
  const patch = h.picked.size ? linesPatch(d, h, h.picked, flags.includes('--reverse')) : hunkPatch(d, h)
  await run(h.picked.size ? label + ' baris' : label + ' hunk', () => gIn(patch, 'apply', ...flags, '-'), undoFor?.(patch))
  await showDiff(file, kind)
}
const discardHunk = async h => {
  if (!(await ask(h.picked.size ? `Buang ${h.picked.size} baris terpilih?` : 'Buang perubahan di hunk ini?', { kind: 'warning' }))) return
  applyHunk('Discard', h, ['--reverse'], patch => () => gIn(patch, 'apply', '-'))
}

const fileView = ref(null) // { type: 'history', path, items, sel, d } | { type: 'blame', path, rev, lines }
async function openHistory(path) {
  const out = await g('log', '--follow', '-n', '300', '--format=%x1e%H%x1f%an%x1f%at%x1f%s', '--name-only', '--', path)
  const items = out.split('\x1e').filter(c => c.trim()).map(chunk => {
    const [meta, ...files] = chunk.split('\n')
    const [hash, author, time, subject] = meta.split('\x1f')
    return { hash, author, time: +time, subject, path: files.find(Boolean) ?? path } // path at that commit (renames)
  })
  fileView.value = { type: 'history', path, items, sel: null, d: null }
  if (items.length) pickHistory(items[0])
}
async function pickHistory(it) {
  fileView.value.sel = it.hash
  fileView.value.d = parseDiff(await g('show', '--format=', '--diff-merges=first-parent', it.hash, '--', it.path))
}
async function openBlame(path, rev) {
  try {
    const lines = parseBlame(await g('blame', '--porcelain', ...(rev ? [rev] : []), '--', path))
    fileView.value = { type: 'blame', path, rev, lines }
  } catch (e) {
    error.value = String(e)
  }
}
function jumpTo(hash) {
  if (/^0+$/.test(hash)) return
  fileView.value = null
  diff.value = null
  selectCommit(hash)
  setTimeout(() => document.getElementById('c-' + hash)?.scrollIntoView({ block: 'center' }))
}

const stage = p => run('Stage', () => g('add', '--', p))
const unstage = p => run('Unstage', () => g('restore', '--staged', '--', p))
const stageAll = () => run('Stage', () => g('add', '-A'))
const unstageAll = () => run('Unstage', () => g('restore', '--staged', '--', '.'))
async function discardPaths(label, paths) {
  let hash = ''
  run(label, async () => (hash = await stashAway(paths)), () => hash && unstashAway(hash))
}
const discard = async f => {
  if (await ask(`Buang perubahan di "${f.path}"?`, { kind: 'warning' })) discardPaths('Discard', [f.path])
}
const discardAll = async () => {
  if (await ask('Buang semua perubahan unstaged, termasuk file baru?', { kind: 'warning' })) discardPaths('Discard all', ['.'])
}

watch(amend, async on => {
  if (on && !msg.value.trim()) msg.value = (await g('log', '-1', '--format=%B')).trim()
})
async function commit() {
  if (!msg.value.trim()) return
  const before = await headHash()
  run(
    amend.value ? 'Amend' : 'Commit',
    async () => {
      await g('commit', ...(amend.value ? ['--amend'] : []), '-m', msg.value)
      msg.value = ''
      amend.value = false
    },
    resetBack(before, '--soft'), // changes go back to staged
  )
}

const stash = () => run('Stash', () => g('stash', 'push', '-u'), () => g('stash', 'pop', '--index'))
async function stashDo(action, s) {
  if (action !== 'drop') return run('Stash ' + action, () => g('stash', action, s.ref))
  if (!(await ask(`Hapus ${s.ref}?`, { kind: 'warning' }))) return
  const hash = (await g('rev-parse', s.ref)).trim()
  run('Drop stash', () => g('stash', 'drop', s.ref), () => g('stash', 'store', '-m', s.subject, hash))
}

function openMenu(e, c) {
  selectCommit(c.hash)
  menu.value = { x: Math.min(e.clientX, innerWidth - 240), y: Math.min(e.clientY, innerHeight - 440), hash: c.hash, input: null, value: '' }
}
// Runs a HEAD-changing action; `undoFor(prev)` builds its undo from the HEAD state before it ran.
async function act(label, args, undoFor) {
  menu.value = null
  const prev = await prevHead()
  run(label, () => g(...args), undoFor?.(prev))
}
const newBranchAt = (name, at) => act('Branch', ['switch', '-c', name, ...at], p => async () => {
  await goBack(p)
  await g('branch', '-D', name)
})
async function resetTo(mode) {
  const { hash } = menu.value
  if (mode === 'hard' && !(await ask(`Reset --hard ke ${hash.slice(0, 7)}? Perubahan yang belum di-commit akan hilang dan tidak bisa di-undo.`, { kind: 'warning' }))) return
  act('Reset', ['reset', '--' + mode, hash], p => resetBack(p.hash, mode === 'hard' ? '--keep' : '--soft'))
}
const rebaseOnto = target => act('Rebase', ['rebase', '--autostash', target], p => resetBack(p.hash))

const plan = ref(null) // interactive rebase: { base, items (newest first), drag }
const planError = computed(() => plan.value && validate(plan.value.items))
async function openRebase() {
  const base = menu.value.hash
  menu.value = null
  const out = await g('log', '--format=%H%x1f%P%x1f%s', `${base}..HEAD`)
  const rows = out.split('\n').filter(Boolean).map(l => l.split('\x1f'))
  if (!rows.length) return (error.value = 'Tidak ada commit di atas commit ini untuk di-rebase.')
  if (rows.some(([, parents]) => parents.includes(' ')))
    return (error.value = 'Rentang ini berisi merge commit. Interactive rebase yang melewati merge belum didukung.')
  diff.value = null
  plan.value = { base, drag: -1, items: rows.map(([hash, , subject]) => ({ hash, subject, action: 'pick', msg: subject })) }
}
// squash/fixup fold into the nearest older commit that survives on its own
const foldTarget = i => plan.value.items.slice(i + 1).find(x => !['drop', 'squash', 'fixup'].includes(x.action))?.hash.slice(0, 7)
function moveItem(from, to) {
  const items = plan.value.items
  if (from < 0 || to < 0 || to >= items.length || from === to) return
  items.splice(to, 0, items.splice(from, 1)[0])
}
async function startRebase() {
  const { base, items } = plan.value
  plan.value = null
  const prev = await headHash()
  // the "editor" just writes our todo (fed on stdin) over git's
  run('Rebase', () => gIn(buildTodo(items), '-c', 'sequence.editor=cat >', '-c', 'core.editor=true', 'rebase', '-i', '--autostash', base), resetBack(prev))
}

const copyHash = () => {
  navigator.clipboard.writeText(menu.value.hash)
  menu.value = null
}
function submitMenu() {
  const { hash, input, value } = menu.value
  const name = value.trim()
  if (!name) return
  if (input === 'branch') newBranchAt(name, [hash])
  else act('Tag', ['tag', '-a', name, '-m', name, hash], () => () => g('tag', '-d', name))
}

function createBranch() {
  const name = newBranch.value.trim()
  if (!name) return
  newBranchAt(name, selected.value === 'WIP' ? [] : [selected.value])
  newBranch.value = ''
}
// `switch foo` for a remote origin/foo creates a local tracking branch.
const checkout = (b, remote) => act('Checkout', ['switch', remote ? b.slice(b.indexOf('/') + 1) : b], p => () => goBack(p))
const merge = b => act('Merge', ['merge', b], p => resetBack(p.hash))
async function removeBranch(b) {
  if (!(await ask(`Hapus branch "${b}"?`, { kind: 'warning' }))) return
  const hash = (await g('rev-parse', b)).trim()
  run('Delete branch', () => g('branch', '-d', b), () => g('branch', b, hash))
}

const fetchAll = () => run('Fetch', () => g('fetch', '--all', '--prune'))
const pull = () => act('Pull', ['pull'], p => resetBack(p.hash))
const push = () =>
  run('Push', () =>
    g('push', '--follow-tags').catch(e => {
      // ponytail: assumes remote "origin" for first push of a new branch
      if (String(e).includes('no upstream')) return g('push', '--follow-tags', '-u', 'origin', 'HEAD')
      throw e
    }),
  )
const headTrack = computed(() => branches.value.track?.[head.value] ?? { ahead: 0, behind: 0 })

onMounted(() => {
  refresh()
  window.addEventListener('focus', refresh)
  window.addEventListener('click', () => (menu.value = null))
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') menu.value = null
    const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
    if (e.ctrlKey && e.key === 'f' && repo.value) {
      e.preventDefault()
      searchEl.value?.focus()
    } else if (e.ctrlKey && e.key === 'z' && !typing && repo.value) {
      e.preventDefault()
      undo()
    }
  })
})
</script>

<template>
  <Welcome v-if="!repo" :recent="recent" @open="openPath" @forget="forget" @error="e => (error = e)" />
  <div v-else class="app">
    <header class="toolbar">
      <button class="home" title="Kembali ke halaman awal" @click="goHome"><img :src="logo" alt="gitpuake" /></button>
      <button @click="openRepo">📂 Open</button>
      <span class="repo" :title="repo">{{ repo ? repo.split('/').at(-1) : 'Belum ada repo' }}</span>
      <template v-if="repo">
        <span class="sep" />
        <button :disabled="!!busy" @click="fetchAll">⟳ Fetch</button>
        <button :disabled="!!busy" @click="pull">↓ Pull<b v-if="headTrack.behind" class="count">{{ headTrack.behind }}</b></button>
        <button :disabled="!!busy" @click="push">↑ Push<b v-if="headTrack.ahead" class="count">{{ headTrack.ahead }}</b></button>
        <span class="sep" />
        <button :disabled="!!busy || !dirty" @click="stash">⊞ Stash</button>
        <button :disabled="!!busy || !stashes.length" @click="stashDo('pop', stashes[0])">⊟ Pop</button>
        <span class="sep" />
        <span class="head">⎇ {{ head || '(detached)' }}</span>
        <span v-if="busy" class="busy">{{ busy }}…</span>
        <span class="spacer" />
        <button :disabled="!undos.length || !!busy" :title="undos.length ? 'Undo: ' + undos.at(-1).label + ' (Ctrl+Z)' : 'Belum ada yang bisa di-undo'" @click="undo">
          ↶ Undo<small v-if="undos.length"> {{ undos.at(-1).label.toLowerCase() }}</small>
        </button>
        <input
          ref="searchEl"
          v-model="query"
          class="search"
          placeholder="Cari commit, author, hash (Ctrl+F)"
          @keydown.enter="nextMatch($event.shiftKey)"
          @keydown.esc="query = ''"
        />
        <small v-if="matches" class="busy">{{ matches.size }} hasil</small>
      </template>
    </header>

    <aside class="sidebar" v-if="repo">
      <form class="new-branch" @submit.prevent="createBranch">
        <input v-model="newBranch" :placeholder="selected === 'WIP' ? 'Branch baru dari HEAD' : 'Branch baru dari ' + selected.slice(0, 7)" />
      </form>
      <h4>Local</h4>
      <div v-for="b in branches.local" :key="b" class="branch" :class="{ current: b === head }" @dblclick="checkout(b)">
        <span class="name" :title="b">{{ b }}</span>
        <span v-if="branches.track[b]?.ahead || branches.track[b]?.behind" class="track" title="ahead / behind upstream">
          <template v-if="branches.track[b].ahead">↑{{ branches.track[b].ahead }}</template>
          <template v-if="branches.track[b].behind"> ↓{{ branches.track[b].behind }}</template>
        </span>
        <span class="actions" v-if="b !== head">
          <button title="Merge ke branch aktif" @click="merge(b)">⤵</button>
          <button title="Rebase branch aktif ke branch ini" @click="rebaseOnto(b)">⤴</button>
          <button title="Hapus" @click="removeBranch(b)">✕</button>
        </span>
      </div>
      <h4>Remote</h4>
      <div v-for="b in branches.remote" :key="b" class="branch" @dblclick="checkout(b, true)">
        <span class="name" :title="b">{{ b }}</span>
        <span class="actions">
          <button title="Merge ke branch aktif" @click="merge(b)">⤵</button>
          <button title="Rebase branch aktif ke branch ini" @click="rebaseOnto(b)">⤴</button>
        </span>
      </div>
      <template v-if="stashes.length">
        <h4>Stash</h4>
        <div v-for="s in stashes" :key="s.ref" class="branch">
          <span class="name" :title="s.ref + ': ' + s.subject">{{ s.subject }}</span>
          <span class="actions">
            <button title="Apply" @click="stashDo('apply', s)">↧</button>
            <button title="Pop" @click="stashDo('pop', s)">⊟</button>
            <button title="Hapus" @click="stashDo('drop', s)">✕</button>
          </span>
        </div>
      </template>
      <p class="hint">Double-click branch untuk checkout · klik kanan commit untuk aksi lain</p>
    </aside>

    <div v-if="operation" class="op-banner">
      <b>{{ { rebase: 'Rebase', merge: 'Merge', 'cherry-pick': 'Cherry-pick', revert: 'Revert' }[operation] }} sedang berlangsung.</b>
      <span v-if="status.conflicts.length">
        {{ status.conflicts.length }} file conflict. Perbaiki di editor, lalu klik "Tandai selesai" di panel kanan.
      </span>
      <span v-else>Semua conflict sudah selesai.</span>
      <span class="spacer" />
      <button @click="abortOp">Abort</button>
      <button class="primary" :disabled="status.conflicts.length > 0 || !!busy" @click="continueOp">Continue</button>
    </div>

    <main class="main" v-if="repo">
      <div v-if="plan" class="rebase">
        <div class="diff-head">
          <b>Interactive rebase</b>
          <small>{{ plan.items.length }} commit di atas {{ plan.base.slice(0, 7) }}, paling atas yang terbaru</small>
          <span class="spacer" />
          <button @click="plan = null">Batal</button>
          <button class="primary" :disabled="!!planError || !!busy" @click="startRebase">Mulai rebase</button>
        </div>
        <p v-if="planError" class="plan-error">{{ planError }}</p>
        <ol class="plan">
          <li
            v-for="(it, i) in plan.items"
            :key="it.hash"
            :class="it.action"
            draggable="true"
            @dragstart="plan.drag = i"
            @dragover.prevent
            @drop="moveItem(plan.drag, i)"
          >
            <span class="grip" title="Seret untuk mengubah urutan">⠿</span>
            <select v-model="it.action" :aria-label="'Aksi untuk ' + it.subject">
              <option v-for="a in ACTIONS" :key="a" :value="a">{{ a }}</option>
            </select>
            <code>{{ it.hash.slice(0, 7) }}</code>
            <input v-if="it.action === 'reword'" v-model="it.msg" class="msg" aria-label="Judul commit baru" />
            <span v-else class="subj">{{ it.subject }}</span>
            <small v-if="it.action === 'squash' || it.action === 'fixup'" class="into">masuk ke {{ foldTarget(i) ?? '—' }}</small>
            <span class="move">
              <button :disabled="i === 0" title="Naikkan" @click="moveItem(i, i - 1)">↑</button>
              <button :disabled="i === plan.items.length - 1" title="Turunkan" @click="moveItem(i, i + 1)">↓</button>
            </span>
          </li>
        </ol>
        <p class="plan-help">
          <b>squash</b> menggabungkan commit ke commit di bawahnya dan menyimpan kedua pesannya. <b>fixup</b> juga menggabung,
          tapi pesannya dibuang. <b>reword</b> hanya mengganti judul commit. Hasil rebase bisa di-undo.
        </p>
      </div>
      <div v-else-if="fileView" class="fileview">
        <div class="diff-head">
          <b>{{ fileView.type === 'history' ? 'Riwayat' : 'Blame' }}</b>
          <span class="path">{{ fileView.path }}</span>
          <small v-if="fileView.type === 'blame'">{{ fileView.rev ? 'di ' + fileView.rev.slice(0, 7) : 'versi working tree' }}</small>
          <span class="spacer" />
          <span v-if="fileView.type === 'history'" class="seg">
            <button :class="{ on: diffMode === 'split' }" @click="setDiffMode('split')">Split</button>
            <button :class="{ on: diffMode === 'unified' }" @click="setDiffMode('unified')">Unified</button>
          </span>
          <button @click="fileView = null">✕ Tutup</button>
        </div>
        <template v-if="fileView.type === 'history'">
          <ol class="file-log">
            <li v-for="it in fileView.items" :key="it.hash" :class="{ sel: fileView.sel === it.hash }">
              <button @click="pickHistory(it)">
                <code>{{ it.hash.slice(0, 7) }}</code>
                <span class="subj">{{ it.subject }}</span>
                <span class="who">{{ it.author }}</span>
                <span class="when">{{ ago(it.time) }}</span>
              </button>
            </li>
          </ol>
          <div class="file-log-diff">
            <DiffView v-if="fileView.d" :d="fileView.d" :mode="diffMode" />
          </div>
        </template>
        <table v-else class="lines blame">
          <tr v-for="(l, i) in fileView.lines" :key="i" :class="{ first: i === 0 || fileView.lines[i - 1].hash !== l.hash }">
            <td class="who" :style="{ '--c': avatarColor(l.hash) }">
              <button v-if="i === 0 || fileView.lines[i - 1].hash !== l.hash" :title="l.summary" @click="jumpTo(l.hash)">
                <template v-if="/^0+$/.test(l.hash)">Belum di-commit</template>
                <template v-else><code>{{ l.hash.slice(0, 7) }}</code> {{ l.author }} · {{ ago(l.time) }}</template>
              </button>
            </td>
            <td class="ln">{{ l.n }}</td>
            <td class="src">{{ l.text }}</td>
          </tr>
        </table>
      </div>
      <div v-else-if="diff" class="diff">
        <div class="diff-head">
          <b>{{ diff.file.path }}</b>
          <small>{{ { commit: 'commit ' + selected.slice(0, 7), staged: 'staged', unstaged: 'unstaged' }[diff.kind] }}</small>
          <small v-if="hunkable" class="hint-pick">klik baris +/− untuk memilih baris tertentu</small>
          <span class="spacer" />
          <button v-if="diff.file.code !== 'U'" @click="openHistory(diff.file.path)">Riwayat</button>
          <button v-if="diff.file.code !== 'D'" @click="openBlame(diff.file.path, diff.kind === 'commit' ? selected : '')">Blame</button>
          <span class="seg">
            <button :class="{ on: diffMode === 'split' }" @click="setDiffMode('split')">Split</button>
            <button :class="{ on: diffMode === 'unified' }" @click="setDiffMode('unified')">Unified</button>
          </span>
          <button @click="diff = null">✕ Tutup</button>
        </div>
        <DiffView :d="diff.d" :mode="diffMode" :selectable="hunkable">
          <template #actions="{ h }">
            <template v-if="hunkable">
              <template v-if="diff.kind === 'unstaged'">
                <button @click="discardHunk(h)">Discard {{ h.picked.size ? h.picked.size + ' baris' : 'hunk' }}</button>
                <button class="primary" @click="applyHunk('Stage', h, ['--cached'])">Stage {{ h.picked.size ? h.picked.size + ' baris' : 'hunk' }}</button>
              </template>
              <button v-else @click="applyHunk('Unstage', h, ['--cached', '--reverse'])">Unstage {{ h.picked.size ? h.picked.size + ' baris' : 'hunk' }}</button>
            </template>
          </template>
        </DiffView>
      </div>
      <div v-else class="history">
        <div class="cols">
          <span :style="{ width: REFS + 'px' }">Branch / Tag</span>
          <span :style="{ width: x(graphWidth) + 'px' }">Graph</span>
          <span class="subject">Commit message</span>
          <span class="author">Author</span>
          <span class="date">Waktu</span>
        </div>
        <div class="rows">
          <svg class="graph" :style="{ left: REFS + 'px' }" :width="x(graphWidth)" :height="(commits.length + 1) * ROW">
            <path v-if="dirty && headRow >= 0" :d="`M${x(headCol)} ${ROW / 2} V${(headRow + 1.5) * ROW}`" stroke="#8a90a0" stroke-width="2" stroke-dasharray="3 4" />
            <template v-for="(c, r) in commits" :key="c.hash">
              <path v-for="(l, k) in c.lines" :key="k" :d="path(l, r + 1)" :stroke="color(l[2] === 'top' ? l[0] : l[1])" fill="none" stroke-width="2.5" stroke-linecap="round" />
            </template>
            <template v-for="(c, r) in commits" :key="c.hash">
              <line v-if="c.pills.length" x1="0" :x2="x(c.col)" :y1="(r + 1.5) * ROW" :y2="(r + 1.5) * ROW" :stroke="color(c.col)" stroke-width="2" opacity="0.6" />
              <circle v-if="c.parents.length > 1" :cx="x(c.col)" :cy="(r + 1.5) * ROW" r="5" :fill="color(c.col)" stroke="#0f1813" stroke-width="2" />
              <g v-else>
                <circle :cx="x(c.col)" :cy="(r + 1.5) * ROW" r="11" :fill="avatarColor(c.author)" :stroke="selected === c.hash ? '#fff' : color(c.col)" stroke-width="2.5" />
                <text :x="x(c.col)" :y="(r + 1.5) * ROW" dy=".35em" text-anchor="middle" class="ini">{{ initials(c.author) }}</text>
              </g>
            </template>
            <circle v-if="dirty" :cx="x(headCol)" :cy="ROW / 2" r="9" fill="#0f1813" stroke="#8a90a0" stroke-width="2" stroke-dasharray="3 3" />
          </svg>
          <div class="row wip" :class="{ sel: selected === 'WIP' }" @click="selectCommit('WIP')">
            <span class="refs" :style="{ width: REFS + 'px' }" />
            <span :style="{ width: x(graphWidth) + 'px' }" class="gutter" />
            <span class="subject">// WIP <small v-if="dirty">({{ status.staged.length + status.unstaged.length + status.conflicts.length }} file berubah)</small></span>
          </div>
          <div v-for="c in commits" :key="c.hash" class="row" :id="'c-' + c.hash" :class="{ sel: selected === c.hash, dim: matches && !matches.has(c.hash) }" :style="{ '--c': color(c.col) }" @click="selectCommit(c.hash)" @contextmenu.prevent="openMenu($event, c)">
            <span class="refs" :style="{ width: REFS + 'px' }">
              <template v-if="c.pills.length">
                <span class="pill" :class="{ head: c.pills[0].head }" :title="c.pills[0].name">
                  <i>{{ c.pills[0].icon }}</i>{{ c.pills[0].name }}<i v-if="c.pills[0].synced" title="sinkron dengan remote">☁</i>
                </span>
                <span v-if="c.pills.length > 1" class="pill more" :title="c.pills.slice(1).map(p => p.name).join('\n')">+{{ c.pills.length - 1 }}</span>
              </template>
            </span>
            <span :style="{ width: x(graphWidth) + 'px' }" class="gutter" />
            <span class="subject">{{ c.subject }}</span>
            <span class="author">{{ c.author }}</span>
            <span class="date" :title="new Date(c.time * 1000).toLocaleString()">{{ ago(c.time) }}</span>
          </div>
        </div>
      </div>
    </main>
    <aside class="panel" v-if="repo">
      <template v-if="selected === 'WIP'">
        <div v-if="status.conflicts.length" class="section conflicts">
          <h4>Conflict ({{ status.conflicts.length }})</h4>
          <div v-for="f in status.conflicts" :key="f.path" class="file" @click="showDiff(f, 'unstaged')">
            <span class="code C">!</span>
            <span class="name" :title="f.path">{{ f.path }}</span>
            <button @click.stop="resolve(f.path)">Tandai selesai</button>
          </div>
        </div>
        <div class="section">
          <h4>
            Unstaged ({{ status.unstaged.length }})
            <span v-if="status.unstaged.length" class="h-actions">
              <button @click="discardAll">Discard all</button>
              <button @click="stageAll">Stage all</button>
            </span>
          </h4>
          <div v-for="f in status.unstaged" :key="f.path" class="file" @click="showDiff(f, 'unstaged')">
            <span class="code" :class="f.code">{{ f.code }}</span>
            <span class="name" :title="f.path">{{ f.path }}</span>
            <button title="Buang perubahan" @click.stop="discard(f)">✕</button>
            <button @click.stop="stage(f.path)">Stage</button>
          </div>
        </div>
        <div class="section">
          <h4>Staged ({{ status.staged.length }}) <button v-if="status.staged.length" @click="unstageAll">Unstage all</button></h4>
          <div v-for="f in status.staged" :key="f.path" class="file" @click="showDiff(f, 'staged')">
            <span class="code" :class="f.code">{{ f.code }}</span>
            <span class="name" :title="f.path">{{ f.path }}</span>
            <button @click.stop="unstage(f.path)">Unstage</button>
          </div>
        </div>
        <div class="commit-box">
          <label class="amend"><input v-model="amend" type="checkbox" :disabled="!commits.length" /> Amend commit terakhir</label>
          <textarea v-model="msg" placeholder="Commit message (Ctrl+Enter)" @keydown.ctrl.enter="commit" />
          <button class="primary" :disabled="!msg.trim() || (!amend && !status.staged.length) || !!busy" @click="commit">
            {{ amend ? 'Amend commit' : `Commit ${status.staged.length} file` }}
          </button>
        </div>
      </template>
      <template v-else-if="selectedCommit">
        <div class="section">
          <h3>{{ selectedCommit.subject }}</h3>
          <p class="meta">
            <code>{{ selectedCommit.hash.slice(0, 10) }}</code><br />
            {{ selectedCommit.author }} · {{ new Date(selectedCommit.time * 1000).toLocaleString() }}
          </p>
          <h4>File ({{ commitFiles.length }})</h4>
          <div v-for="f in commitFiles" :key="f.path" class="file" @click="showDiff(f, 'commit')">
            <span class="code" :class="f.code">{{ f.code }}</span>
            <span class="name" :title="f.path">{{ f.path }}</span>
          </div>
        </div>
      </template>
    </aside>

    <div v-if="menu" class="menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
      <form v-if="menu.input" @submit.prevent="submitMenu">
        <input v-model="menu.value" v-focus :placeholder="menu.input === 'tag' ? 'Nama tag' : 'Nama branch baru'" />
      </form>
      <template v-else>
        <div class="menu-title"><code>{{ menu.hash.slice(0, 7) }}</code></div>
        <button @click="act('Checkout', ['switch', '--detach', menu.hash], p => () => goBack(p))">Checkout commit ini</button>
        <button @click="menu.input = 'branch'">Buat branch di sini…</button>
        <button @click="menu.input = 'tag'">Buat tag di sini…</button>
        <hr />
        <button @click="act('Cherry-pick', ['cherry-pick', menu.hash], p => resetBack(p.hash))">Cherry-pick ke {{ head || 'HEAD' }}</button>
        <button @click="act('Revert', ['revert', '--no-edit', menu.hash], p => resetBack(p.hash))">Revert commit</button>
        <hr />
        <button @click="rebaseOnto(menu.hash)">Rebase {{ head || 'HEAD' }} ke sini</button>
        <button @click="openRebase">Interactive rebase dari sini…</button>
        <hr />
        <button @click="resetTo('soft')">Reset {{ head || 'HEAD' }} ke sini · soft</button>
        <button @click="resetTo('mixed')">Reset {{ head || 'HEAD' }} ke sini · mixed</button>
        <button class="danger" @click="resetTo('hard')">Reset {{ head || 'HEAD' }} ke sini · hard</button>
        <hr />
        <button @click="copyHash">Salin hash</button>
      </template>
    </div>
  </div>

  <div v-if="error" class="error" @click="error = ''">
    <pre>{{ error }}</pre>
    <small>klik untuk tutup</small>
  </div>
</template>

<style>
:root {
  /* murky river at night: mud, croc scales, bone teeth, amber eye */
  --bg: #0f1813;
  --bg2: #142019;
  --bg3: #1d2b22;
  --line: #2a3a30;
  --fg: #dde3d4;
  --bone: #ebe2c6;
  --dim: #849282;
  --accent: #eba93a;
  font: 13px/1.4 system-ui, sans-serif;
  color: var(--fg);
  background: var(--bg);
}
* { box-sizing: border-box; }
body { margin: 0; }
button {
  background: var(--bg3);
  color: var(--fg);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 3px 9px;
  cursor: pointer;
  font: inherit;
}
button:hover:not(:disabled) { border-color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.home { padding: 0; border: 0; background: none; display: flex; }
.home img { width: 30px; height: 30px; border-radius: 7px; }
.home:hover img { box-shadow: 0 0 0 2px var(--accent); }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--accent); color: #1a1206; border: 0; font-weight: 600; }
input, textarea {
  width: 100%;
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 5px 7px;
  font: inherit;
}
h4 { margin: 12px 0 6px; color: var(--dim); text-transform: uppercase; font-size: 11px; display: flex; justify-content: space-between; align-items: center; }
h4 button { padding: 1px 6px; font-size: 11px; text-transform: none; }

.app {
  display: grid;
  grid-template: 44px auto minmax(0, 1fr) / 230px minmax(0, 1fr) 340px;
  height: 100vh;
}
.sidebar, .main, .panel { grid-row: 3; }
.op-banner {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: #4a2a0c;
  border-bottom: 1px solid var(--accent);
  color: var(--bone);
}
.spacer { flex: 1; }
.count {
  margin-left: 5px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--accent);
  color: #1a1206;
  font-size: 11px;
}
.search { width: 240px; }
.track { color: var(--accent); font-size: 11px; white-space: nowrap; }
.row.dim { opacity: 0.3; }
.conflicts { flex: none; }

.plan-error { margin: 10px; padding: 8px 10px; border-radius: 4px; background: #4a1f1f; color: #f9b1aa; }
.plan { list-style: none; margin: 10px; padding: 0; border: 1px solid var(--line); border-radius: 6px; }
.plan li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
}
.plan li:last-child { border-bottom: 0; }
.plan select {
  width: 84px;
  appearance: none;
  -webkit-appearance: none;
  padding: 3px 20px 3px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font: inherit;
  color: var(--fg);
  background: var(--bg3) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23849282' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat right 7px center;
}
.plan .into { color: #36d6c3; white-space: nowrap; }
.plan code { color: var(--dim); }
.plan .subj { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan .msg { flex: 1; }
.plan .grip { cursor: grab; color: var(--dim); }
.plan .move { display: flex; gap: 2px; }
.plan .move button { padding: 0 6px; }
.plan li.reword select { border-color: var(--accent); color: var(--accent); }
.plan li.squash, .plan li.fixup { padding-left: 34px; background: var(--bg2); }
.plan li.squash select, .plan li.fixup select { border-color: #36d6c3; color: #36d6c3; }
.plan li.drop .subj { text-decoration: line-through; opacity: 0.45; }
.plan li.drop select { border-color: #f2665b; color: #f2665b; }
.plan-help { margin: 0 10px; max-width: 72ch; color: var(--dim); line-height: 1.5; }
.plan-help b { color: var(--fg); font-weight: 600; }

.lines .pickable { cursor: pointer; }
.lines .pickable:hover { filter: brightness(1.3); }
.lines .picked { box-shadow: inset 3px 0 var(--accent); filter: brightness(1.45); }
.hint-pick { color: var(--dim); font-style: italic; }
.diff-head .path { color: var(--bone); }

.fileview { display: flex; flex-direction: column; height: 100%; }
.file-log { list-style: none; margin: 0; padding: 0; max-height: 38%; overflow: auto; flex: none; border-bottom: 1px solid #000; }
.file-log button {
  display: flex;
  gap: 10px;
  width: 100%;
  padding: 5px 10px;
  border: 0;
  border-radius: 0;
  background: none;
  text-align: left;
}
.file-log li.sel button { background: color-mix(in srgb, var(--accent) 18%, transparent); box-shadow: inset 3px 0 var(--accent); }
.file-log code { color: var(--dim); }
.file-log .subj { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-log .who { width: 130px; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-log .when { width: 130px; color: var(--dim); text-align: right; white-space: nowrap; }
.file-log-diff { flex: 1; overflow: auto; }
.blame { margin: 0; }
.blame tr.first td { border-top: 1px solid var(--line); }
.blame .who { width: 260px; padding: 0; border-left: 3px solid var(--c); vertical-align: top; }
.blame .who button {
  width: 100%;
  border: 0;
  border-radius: 0;
  background: none;
  padding: 0 8px;
  text-align: left;
  color: var(--dim);
  font: 12px/1.55 system-ui, sans-serif;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.blame .who button:hover { color: var(--accent); }
.blame .who code { color: var(--fg); }
.code.C { color: #f2665b; }
.toolbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  background: var(--bg2);
  border-bottom: 1px solid #000;
}
.repo { font-weight: 600; }
.head { color: var(--accent); }
.busy { color: var(--dim); }
.sep { width: 1px; height: 22px; background: var(--line); margin: 0 4px; }

.sidebar, .panel { background: var(--bg2); overflow: auto; padding: 8px 10px; }
.sidebar { border-right: 1px solid #000; }
.panel { border-left: 1px solid #000; display: flex; flex-direction: column; }
.branch, .file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 4px;
  cursor: pointer;
}
.branch:hover, .file:hover { background: var(--bg3); }
.branch.current { color: var(--accent); font-weight: 600; }
.name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions { display: none; gap: 2px; }
.actions button, .file button { padding: 0 6px; font-size: 11px; }
.branch:hover .actions { display: flex; }
.file button { visibility: hidden; }
.file:hover button { visibility: visible; }
.hint { color: var(--dim); font-size: 11px; }
.code { width: 14px; font-weight: 700; font-family: monospace; }
.code.M { color: #f5a623; } .code.A, .code.U { color: #8ee05b; } .code.D { color: #f2665b; } .code.R { color: #a77bf3; }

.main { overflow: auto; position: relative; }
.rows { position: relative; }
.graph { position: absolute; top: 0; left: 0; pointer-events: none; }
.cols {
  display: flex;
  gap: 10px;
  padding-right: 10px;
  height: 26px;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg2);
  border-bottom: 1px solid #000;
  color: var(--dim);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.cols span:first-child { padding-left: 10px; }
.row {
  --c: #8a90a0;
  display: flex;
  align-items: center;
  height: 34px;
  padding-right: 10px;
  gap: 10px;
  cursor: pointer;
  white-space: nowrap;
}
.row:hover { background: color-mix(in srgb, var(--c) 10%, transparent); }
.row.sel { background: color-mix(in srgb, var(--c) 24%, transparent); box-shadow: inset 3px 0 var(--c); }
.row.wip { color: var(--dim); font-style: italic; }
.gutter, .refs { flex: none; }
.refs { display: flex; justify-content: flex-end; gap: 3px; overflow: hidden; }
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: color-mix(in srgb, var(--c) 35%, var(--bg));
  border: 1px solid var(--c);
}
.pill i { font-style: normal; opacity: 0.8; }
.pill.head { background: var(--c); color: #1a1206; }
.pill.more { flex: none; background: var(--bg3); }
.ini { fill: #fff; font-size: 9px; font-weight: 700; }
.subject { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.author { width: 140px; color: var(--dim); overflow: hidden; text-overflow: ellipsis; }
.date { width: 110px; color: var(--dim); text-align: right; }

.section { flex: 1; overflow: auto; }
.section h3 { margin: 4px 0; font-size: 15px; }
.meta { color: var(--dim); }
.commit-box { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid #000; }
.commit-box textarea { height: 80px; resize: vertical; }

.diff-head {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  background: var(--bg2);
  border-bottom: 1px solid #000;
  position: sticky;
  top: 0;
  z-index: 2;
}
.diff-head small { color: var(--dim); }
.seg { display: inline-flex; }
.seg button { border-radius: 0; }
.seg button:first-child { border-radius: 4px 0 0 4px; }
.seg button:last-child { border-radius: 0 4px 4px 0; border-left: 0; }
.seg button.on { background: var(--accent); color: #1a1206; }
.no-diff { color: var(--dim); padding: 20px; }
.hunk { margin: 10px; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.hunk-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: #2fb7f514;
  color: var(--accent);
  font-size: 12px;
}
.hunk-actions { display: flex; gap: 4px; }
.hunk-actions button { padding: 1px 8px; font-size: 11px; }
.lines { width: 100%; border-collapse: collapse; table-layout: fixed; font: 12px/1.55 ui-monospace, monospace; }
.lines .ln { width: 44px; padding: 0 6px; text-align: right; color: #5c6272; user-select: none; vertical-align: top; }
.lines .src { white-space: pre-wrap; word-break: break-all; padding: 0 8px; }
.lines.split .src { border-right: 1px solid var(--line); }
.lines .add { background: #8ee05b1c; color: #c3f3a6; }
.lines .del { background: #f2665b1c; color: #f9b1aa; }
.lines .none { background: repeating-linear-gradient(-45deg, transparent 0 4px, #ffffff06 4px 8px); }

.h-actions { display: flex; gap: 4px; }
.amend { display: flex; align-items: center; gap: 6px; color: var(--dim); cursor: pointer; }
.amend input { width: auto; }

.menu {
  position: fixed;
  z-index: 10;
  min-width: 230px;
  padding: 4px;
  background: var(--bg2);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 8px 24px #0009;
  display: flex;
  flex-direction: column;
}
.menu button { text-align: left; border: 0; background: none; padding: 5px 10px; }
.menu button:hover { background: var(--accent); color: #1a1206; }
.menu button.danger { color: #f2665b; }
.menu button.danger:hover { background: #f2665b; color: #fff; }
.menu hr { border: 0; border-top: 1px solid var(--line); margin: 4px 0; width: 100%; }
.menu-title { padding: 3px 10px; color: var(--dim); font-size: 11px; }

.error {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 70vw;
  background: #4a1f1f;
  border: 1px solid #f2665b;
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
}
.error pre { margin: 0; white-space: pre-wrap; font-size: 12px; }
.error small { color: var(--dim); }
</style>
