<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open, ask } from '@tauri-apps/plugin-dialog'
import { LOG_FORMAT, parseLog, layout } from './graph.js'
import { parseDiff, hunkPatch, split } from './diff.js'
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
const status = ref({ staged: [], unstaged: [] })
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
const dirty = computed(() => status.value.staged.length + status.value.unstaged.length > 0)
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

async function run(label, fn) {
  busy.value = label
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = String(e)
  }
  busy.value = ''
  await refresh()
}

function parseStatus(out) {
  const staged = [], unstaged = []
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]
    if (!e) continue
    const [X, Y, path] = [e[0], e[1], e.slice(3)]
    if (X === 'R' || X === 'C') i++ // -z puts the rename source in the next entry
    if (X !== ' ' && X !== '?') staged.push({ path, code: X })
    if (Y !== ' ') unstaged.push({ path, code: Y === '?' ? 'U' : Y })
  }
  return { staged, unstaged }
}

async function refresh() {
  if (!repo.value) return
  try {
    const [log, st, refs, cur, stash] = await Promise.all([
      // empty repo has no log; stashes are listed in the sidebar instead of the graph
      g('log', '--exclude=refs/stash', '--all', '--topo-order', '-n', String(MAX_COMMITS), LOG_FORMAT).catch(() => ''),
      g('status', '--porcelain=v1', '-z', '-uall'),
      g('for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'),
      g('branch', '--show-current'),
      g('stash', 'list', '--format=%gd%x1f%gs'),
    ])
    stashes.value = stash.split('\n').filter(Boolean).map(l => {
      const [ref, subject] = l.split('\x1f')
      return { ref, subject }
    })
    const names = refs.split('\n').filter(r => r && !r.endsWith('/HEAD'))
    branches.value = {
      local: names.filter(r => r.startsWith('refs/heads/')).map(r => r.slice(11)),
      remote: names.filter(r => r.startsWith('refs/remotes/')).map(r => r.slice(13)),
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
    selected.value = 'WIP'
    diff.value = null
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
  diff.value = null
}

async function selectCommit(hash) {
  selected.value = hash
  diff.value = null
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
  else if (file.code === 'U') text = await g('diff', '--no-index', '--', '/dev/null', p)
  else text = await g('diff', '--', p)
  diff.value = { file, kind, d: parseDiff(text) }
}

const setDiffMode = m => localStorage.setItem('diffMode', (diffMode.value = m))
// Untracked files have no index entry to patch, so they are staged whole.
const hunkable = computed(() => diff.value && diff.value.kind !== 'commit' && diff.value.file.code !== 'U')
const applyHunk = async (label, h, ...flags) => {
  const { file, kind, d } = diff.value
  await run(label, () => gIn(hunkPatch(d, h), 'apply', ...flags, '-'))
  await showDiff(file, kind)
}
const discardHunk = async h => {
  if (await ask('Buang perubahan di hunk ini? Tidak bisa di-undo.', { kind: 'warning' })) applyHunk('Discard', h, '--reverse')
}

const stage = p => run('Stage', () => g('add', '--', p))
const unstage = p => run('Unstage', () => g('restore', '--staged', '--', p))
const stageAll = () => run('Stage', () => g('add', '-A'))
const unstageAll = () => run('Unstage', () => g('restore', '--staged', '--', '.'))
const discard = async f => {
  if (!(await ask(`Buang perubahan di "${f.path}"? Tidak bisa di-undo.`, { kind: 'warning' }))) return
  run('Discard', () => (f.code === 'U' ? g('clean', '-f', '--', f.path) : g('restore', '--', f.path)))
}
const discardAll = async () => {
  if (!(await ask('Buang SEMUA perubahan unstaged, termasuk file baru? Tidak bisa di-undo.', { kind: 'warning' }))) return
  run('Discard', async () => {
    await g('restore', '--', '.').catch(() => {}) // fails when only untracked files changed
    await g('clean', '-fd')
  })
}

watch(amend, async on => {
  if (on && !msg.value.trim()) msg.value = (await g('log', '-1', '--format=%B')).trim()
})
const commit = () =>
  msg.value.trim() &&
  run('Commit', async () => {
    await g('commit', ...(amend.value ? ['--amend'] : []), '-m', msg.value)
    msg.value = ''
    amend.value = false
  })

const stash = () => run('Stash', () => g('stash', 'push', '-u'))
const stashDo = async (action, s) => {
  if (action === 'drop' && !(await ask(`Hapus ${s.ref}?`, { kind: 'warning' }))) return
  run('Stash ' + action, () => g('stash', action, s.ref))
}

function openMenu(e, c) {
  selectCommit(c.hash)
  menu.value = { x: Math.min(e.clientX, innerWidth - 240), y: Math.min(e.clientY, innerHeight - 360), hash: c.hash, input: null, value: '' }
}
const act = (label, ...args) => {
  menu.value = null
  run(label, () => g(...args))
}
async function resetTo(mode) {
  const { hash } = menu.value
  menu.value = null
  if (mode === 'hard' && !(await ask(`Reset --hard ke ${hash.slice(0, 7)}? Semua perubahan yang belum di-commit akan hilang.`, { kind: 'warning' }))) return
  run('Reset', () => g('reset', '--' + mode, hash))
}
const copyHash = () => {
  navigator.clipboard.writeText(menu.value.hash)
  menu.value = null
}
function submitMenu() {
  const { hash, input, value } = menu.value
  const name = value.trim()
  if (!name) return
  if (input === 'branch') act('Branch', 'switch', '-c', name, hash)
  else act('Tag', 'tag', '-a', name, '-m', name, hash)
}

const createBranch = () => {
  const name = newBranch.value.trim()
  if (!name) return
  const at = selected.value === 'WIP' ? [] : [selected.value]
  run('Branch', async () => {
    await g('switch', '-c', name, ...at)
    newBranch.value = ''
  })
}
// `switch foo` for a remote origin/foo creates a local tracking branch.
const checkout = (b, remote) => run('Checkout', () => g('switch', remote ? b.slice(b.indexOf('/') + 1) : b))
const merge = b => run('Merge', () => g('merge', b))
const removeBranch = async b => {
  if (await ask(`Hapus branch "${b}"?`, { kind: 'warning' })) run('Delete', () => g('branch', '-d', b))
}

const fetchAll = () => run('Fetch', () => g('fetch', '--all', '--prune'))
const pull = () => run('Pull', () => g('pull'))
const push = () =>
  run('Push', () =>
    g('push', '--follow-tags').catch(e => {
      // ponytail: assumes remote "origin" for first push of a new branch
      if (String(e).includes('no upstream')) return g('push', '--follow-tags', '-u', 'origin', 'HEAD')
      throw e
    }),
  )

onMounted(() => {
  refresh()
  window.addEventListener('focus', refresh)
  window.addEventListener('click', () => (menu.value = null))
  window.addEventListener('keydown', e => e.key === 'Escape' && (menu.value = null))
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
        <button :disabled="!!busy" @click="pull">↓ Pull</button>
        <button :disabled="!!busy" @click="push">↑ Push</button>
        <span class="sep" />
        <button :disabled="!!busy || !dirty" @click="stash">⊞ Stash</button>
        <button :disabled="!!busy || !stashes.length" @click="stashDo('pop', stashes[0])">⊟ Pop</button>
        <span class="sep" />
        <span class="head">⎇ {{ head || '(detached)' }}</span>
        <span v-if="busy" class="busy">{{ busy }}…</span>
      </template>
    </header>

    <aside class="sidebar" v-if="repo">
      <form class="new-branch" @submit.prevent="createBranch">
        <input v-model="newBranch" :placeholder="selected === 'WIP' ? 'Branch baru dari HEAD' : 'Branch baru dari ' + selected.slice(0, 7)" />
      </form>
      <h4>Local</h4>
      <div v-for="b in branches.local" :key="b" class="branch" :class="{ current: b === head }" @dblclick="checkout(b)">
        <span class="name" :title="b">{{ b }}</span>
        <span class="actions" v-if="b !== head">
          <button title="Merge ke branch aktif" @click="merge(b)">⤵</button>
          <button title="Hapus" @click="removeBranch(b)">✕</button>
        </span>
      </div>
      <h4>Remote</h4>
      <div v-for="b in branches.remote" :key="b" class="branch" @dblclick="checkout(b, true)">
        <span class="name" :title="b">{{ b }}</span>
        <span class="actions"><button title="Merge ke branch aktif" @click="merge(b)">⤵</button></span>
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

    <main class="main" v-if="repo">
      <div v-if="diff" class="diff">
        <div class="diff-head">
          <b>{{ diff.file.path }}</b>
          <small>{{ { commit: 'commit ' + selected.slice(0, 7), staged: 'staged', unstaged: 'unstaged' }[diff.kind] }}</small>
          <span class="spacer" />
          <span class="seg">
            <button :class="{ on: diffMode === 'split' }" @click="setDiffMode('split')">Split</button>
            <button :class="{ on: diffMode === 'unified' }" @click="setDiffMode('unified')">Unified</button>
          </span>
          <button @click="diff = null">✕ Tutup</button>
        </div>
        <p v-if="!diff.d.hunks.length" class="no-diff">{{ diff.d.header.filter(l => l.startsWith('Binary')).join('\n') || 'Tidak ada perubahan' }}</p>
        <section v-for="(h, i) in diff.d.hunks" :key="i" class="hunk">
          <div class="hunk-head">
            <code>{{ h.header }}</code>
            <span v-if="hunkable" class="hunk-actions">
              <template v-if="diff.kind === 'unstaged'">
                <button @click="discardHunk(h)">Discard hunk</button>
                <button class="primary" @click="applyHunk('Stage hunk', h, '--cached')">Stage hunk</button>
              </template>
              <button v-else @click="applyHunk('Unstage hunk', h, '--cached', '--reverse')">Unstage hunk</button>
            </span>
          </div>
          <table v-if="diffMode === 'split'" class="lines split">
            <tr v-for="([l, r], k) in split(h.rows)" :key="k">
              <td class="ln">{{ l?.o }}</td>
              <td class="src" :class="l?.type ?? 'none'">{{ l?.text }}</td>
              <td class="ln">{{ r?.n }}</td>
              <td class="src" :class="r?.type ?? 'none'">{{ r?.text }}</td>
            </tr>
          </table>
          <table v-else class="lines">
            <tr v-for="(row, k) in h.rows" :key="k">
              <td class="ln">{{ row.o }}</td>
              <td class="ln">{{ row.n }}</td>
              <td class="src" :class="row.type">{{ { add: '+', del: '-', ctx: ' ' }[row.type] }}{{ row.text }}</td>
            </tr>
          </table>
        </section>
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
            <span class="subject">// WIP <small v-if="dirty">({{ status.staged.length + status.unstaged.length }} file berubah)</small></span>
          </div>
          <div v-for="c in commits" :key="c.hash" class="row" :class="{ sel: selected === c.hash }" :style="{ '--c': color(c.col) }" @click="selectCommit(c.hash)" @contextmenu.prevent="openMenu($event, c)">
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
        <button @click="act('Checkout', 'switch', '--detach', menu.hash)">Checkout commit ini</button>
        <button @click="menu.input = 'branch'">Buat branch di sini…</button>
        <button @click="menu.input = 'tag'">Buat tag di sini…</button>
        <hr />
        <button @click="act('Cherry-pick', 'cherry-pick', menu.hash)">Cherry-pick ke {{ head || 'HEAD' }}</button>
        <button @click="act('Revert', 'revert', '--no-edit', menu.hash)">Revert commit</button>
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
  grid-template: 44px minmax(0, 1fr) / 230px minmax(0, 1fr) 340px;
  height: 100vh;
}
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
.spacer { flex: 1; }
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
