<script setup>
import { ref, computed, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open, ask } from '@tauri-apps/plugin-dialog'
import { LOG_FORMAT, parseLog, layout } from './graph.js'

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

const g = (...args) => invoke('git', { repo: repo.value, args })
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
    const [log, st, refs, cur] = await Promise.all([
      g('log', '--all', '--topo-order', '-n', String(MAX_COMMITS), LOG_FORMAT).catch(() => ''), // empty repo has no log
      g('status', '--porcelain=v1', '-z', '-uall'),
      g('for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'),
      g('branch', '--show-current'),
    ])
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

async function openRepo() {
  const dir = await open({ directory: true })
  if (!dir) return
  try {
    const top = (await invoke('git', { repo: dir, args: ['rev-parse', '--show-toplevel'] })).trim()
    repo.value = top
    localStorage.setItem('repo', top)
    selected.value = 'WIP'
    diff.value = null
    await refresh()
  } catch (e) {
    error.value = `${dir} bukan git repository`
  }
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
  diff.value = { title: p, lines: text.split('\n') }
}

const lineClass = l =>
  l.startsWith('+++') || l.startsWith('---') ? 'meta'
  : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : ''

const stage = p => run('Stage', () => g('add', '--', p))
const unstage = p => run('Unstage', () => g('restore', '--staged', '--', p))
const stageAll = () => run('Stage', () => g('add', '-A'))
const unstageAll = () => run('Unstage', () => g('restore', '--staged', '--', '.'))

const commit = () =>
  msg.value.trim() &&
  run('Commit', async () => {
    await g('commit', '-m', msg.value)
    msg.value = ''
  })

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
    g('push').catch(e => {
      // ponytail: assumes remote "origin" for first push of a new branch
      if (String(e).includes('no upstream')) return g('push', '-u', 'origin', 'HEAD')
      throw e
    }),
  )

onMounted(() => {
  refresh()
  window.addEventListener('focus', refresh)
})
</script>

<template>
  <div class="app">
    <header class="toolbar">
      <button @click="openRepo">📂 Open</button>
      <span class="repo" :title="repo">{{ repo ? repo.split('/').at(-1) : 'Belum ada repo' }}</span>
      <template v-if="repo">
        <span class="sep" />
        <button :disabled="!!busy" @click="fetchAll">⟳ Fetch</button>
        <button :disabled="!!busy" @click="pull">↓ Pull</button>
        <button :disabled="!!busy" @click="push">↑ Push</button>
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
      <p class="hint">Double-click untuk checkout</p>
    </aside>

    <main class="main" v-if="repo">
      <div v-if="diff" class="diff">
        <div class="diff-head">
          <b>{{ diff.title }}</b>
          <button @click="diff = null">✕ Tutup</button>
        </div>
        <pre><div v-for="(l, i) in diff.lines" :key="i" :class="lineClass(l)">{{ l || ' ' }}</div></pre>
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
              <circle v-if="c.parents.length > 1" :cx="x(c.col)" :cy="(r + 1.5) * ROW" r="5" :fill="color(c.col)" stroke="#1b1d23" stroke-width="2" />
              <g v-else>
                <circle :cx="x(c.col)" :cy="(r + 1.5) * ROW" r="11" :fill="avatarColor(c.author)" :stroke="selected === c.hash ? '#fff' : color(c.col)" stroke-width="2.5" />
                <text :x="x(c.col)" :y="(r + 1.5) * ROW" dy=".35em" text-anchor="middle" class="ini">{{ initials(c.author) }}</text>
              </g>
            </template>
            <circle v-if="dirty" :cx="x(headCol)" :cy="ROW / 2" r="9" fill="#1b1d23" stroke="#8a90a0" stroke-width="2" stroke-dasharray="3 3" />
          </svg>
          <div class="row wip" :class="{ sel: selected === 'WIP' }" @click="selectCommit('WIP')">
            <span class="refs" :style="{ width: REFS + 'px' }" />
            <span :style="{ width: x(graphWidth) + 'px' }" class="gutter" />
            <span class="subject">// WIP <small v-if="dirty">({{ status.staged.length + status.unstaged.length }} file berubah)</small></span>
          </div>
          <div v-for="c in commits" :key="c.hash" class="row" :class="{ sel: selected === c.hash }" :style="{ '--c': color(c.col) }" @click="selectCommit(c.hash)">
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
    <main class="main empty" v-else>
      <button class="big" @click="openRepo">📂 Buka repository</button>
    </main>

    <aside class="panel" v-if="repo">
      <template v-if="selected === 'WIP'">
        <div class="section">
          <h4>Unstaged ({{ status.unstaged.length }}) <button v-if="status.unstaged.length" @click="stageAll">Stage all</button></h4>
          <div v-for="f in status.unstaged" :key="f.path" class="file" @click="showDiff(f, 'unstaged')">
            <span class="code" :class="f.code">{{ f.code }}</span>
            <span class="name" :title="f.path">{{ f.path }}</span>
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
          <textarea v-model="msg" placeholder="Commit message (Ctrl+Enter)" @keydown.ctrl.enter="commit" />
          <button class="primary" :disabled="!msg.trim() || !status.staged.length || !!busy" @click="commit">
            Commit {{ status.staged.length }} file
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

    <div v-if="error" class="error" @click="error = ''">
      <pre>{{ error }}</pre>
      <small>klik untuk tutup</small>
    </div>
  </div>
</template>

<style>
:root {
  --bg: #1b1d23;
  --bg2: #22252d;
  --bg3: #2c3039;
  --fg: #d6d9e0;
  --dim: #8a90a0;
  --accent: #2fb7f5;
  font: 13px/1.4 system-ui, sans-serif;
  color: var(--fg);
  background: var(--bg);
}
* { box-sizing: border-box; }
body { margin: 0; }
button {
  background: var(--bg3);
  color: var(--fg);
  border: 1px solid #3a3f4b;
  border-radius: 4px;
  padding: 3px 9px;
  cursor: pointer;
  font: inherit;
}
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--accent); color: #0b1a22; border: 0; font-weight: 600; }
input, textarea {
  width: 100%;
  background: var(--bg);
  color: var(--fg);
  border: 1px solid #3a3f4b;
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
.sep { width: 1px; height: 22px; background: #3a3f4b; margin: 0 4px; }

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
.main.empty { display: grid; place-items: center; }
.big { font-size: 16px; padding: 12px 22px; }
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
.pill.head { background: var(--c); color: #0b1a22; }
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

.diff { display: flex; flex-direction: column; height: 100%; }
.diff-head { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--bg2); position: sticky; top: 0; }
.diff pre { margin: 0; font: 12px/1.5 ui-monospace, monospace; }
.diff pre div { padding: 0 10px; white-space: pre; }
.diff .add { background: #8ee05b1f; color: #b5f08f; }
.diff .del { background: #f2665b1f; color: #f7a39c; }
.diff .hunk { color: var(--accent); background: #2fb7f510; }
.diff .meta { color: var(--dim); }

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
