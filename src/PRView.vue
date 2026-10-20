<script setup>
// GitHub pull request detail in the main area: description, checks, conversation, changed files,
// plus comment / review / merge through `gh`. Markdown is shown as plain text, never as HTML.
import { ref, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { ask } from '@tauri-apps/plugin-dialog'
import { parseDiff } from './diff.js'
import { highlightRows } from './highlight.js'
import { splitDiff } from './forge.js'
import DiffView from './DiffView.vue'

const props = defineProps({ repo: String, n: Number, mode: String, busy: String, run: Function })
const emit = defineEmits(['close', 'mode', 'changed'])
const FIELDS = 'number,title,body,author,state,isDraft,reviewDecision,headRefName,baseRefName,url,mergeable,statusCheckRollup,comments,reviews,files'

const gh = (...args) => invoke('gh', { repo: props.repo, args })
const pr = ref(null)
const files = ref([]) // [{ path, text }] from `gh pr diff`
const sel = ref(null) // { path, d }
const err = ref('')
const text = ref('')
const method = ref('merge')

async function load() {
  const n = props.n
  err.value = ''
  try {
    const [json, diff] = await Promise.all([gh('pr', 'view', String(n), '--json', FIELDS), gh('pr', 'diff', String(n), '--color', 'never')])
    if (n !== props.n) return
    pr.value = JSON.parse(json)
    files.value = splitDiff(diff)
    const keep = files.value.find(f => f.path === sel.value?.path) ?? files.value[0]
    if (keep) pick(keep)
  } catch (e) {
    err.value = String(e)
  }
}
watch(() => props.n, () => {
  pr.value = sel.value = null
  load()
}, { immediate: true })

function pick(f) {
  const d = parseDiff(f.text)
  for (const h of d.hunks) highlightRows(h.rows, f.path)
  sel.value = { path: f.path, d }
}
const stat = path => pr.value?.files?.find(f => f.path === path)

// CheckRun has name/status/conclusion, StatusContext has context/state
const checks = computed(() => (pr.value?.statusCheckRollup ?? []).map(c => ({
  name: c.name ?? c.context,
  state: (c.conclusion || c.status || c.state || '').toUpperCase(),
  url: c.detailsUrl ?? c.targetUrl,
})))
const checkIcon = s => (s === 'SUCCESS' ? '✓' : ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(s) ? '✗' : '•')
// comments and reviews in one timeline, oldest first
const timeline = computed(() => [
  ...(pr.value?.comments ?? []).map(c => ({ who: c.author?.login, body: c.body, at: c.createdAt })),
  ...(pr.value?.reviews ?? []).map(r => ({ who: r.author?.login, body: r.body, at: r.submittedAt, review: r.state })),
].sort((a, b) => (a.at < b.at ? -1 : 1)))
const REVIEW = { APPROVED: '✓ disetujui', CHANGES_REQUESTED: '✗ minta perubahan', COMMENTED: 'review', DISMISSED: 'review dibatalkan', PENDING: 'review tertunda' }
const when = t => (t ? new Date(t).toLocaleString() : '')
const openUrl = url => url && invoke('open_url', { url })

// text is cleared only when gh succeeded, so a failed comment is not lost
async function send(label, args) {
  await props.run(label, async () => {
    await gh(...args)
    text.value = ''
  })
  load()
}
const num = () => String(props.n)
const comment = () => send('Komentar', ['pr', 'comment', num(), '--body', text.value])
const review = flag => send('Review', ['pr', 'review', num(), flag, ...(text.value.trim() ? ['--body', text.value] : [])])
async function merge() {
  if (!(await ask(`Merge PR #${props.n} ke ${pr.value.baseRefName} dengan ${method.value}?`, { kind: 'warning', okLabel: 'Merge', cancelLabel: 'Batal' }))) return
  await send('Merge PR', ['pr', 'merge', num(), '--' + method.value])
  emit('changed')
}
</script>

<template>
  <div class="prview">
    <div class="diff-head">
      <b>PR #{{ n }}</b>
      <span v-if="pr" class="path">{{ pr.title }}</span>
      <span class="spacer" />
      <button v-if="pr" @click="openUrl(pr.url)">↗ Browser</button>
      <button title="Muat ulang" @click="load">⟳</button>
      <button @click="emit('close')">✕ Tutup</button>
    </div>
    <p v-if="err" class="plan-error">{{ err }}</p>
    <p v-else-if="!pr" class="no-diff">Memuat…</p>
    <template v-else>
      <section class="pr-meta">
        <p>
          <span class="pr-state" :class="pr.state">{{ pr.isDraft ? 'DRAFT' : pr.state }}</span>
          <b>{{ pr.author?.login }}</b> ingin merge <code>{{ pr.headRefName }}</code> ke <code>{{ pr.baseRefName }}</code>
          <template v-if="REVIEW[pr.reviewDecision]"> · {{ REVIEW[pr.reviewDecision] }}</template>
          <template v-if="pr.mergeable === 'CONFLICTING'"> · <span class="bad">ada conflict</span></template>
        </p>
        <div class="pr-text">{{ pr.body || '(tanpa deskripsi)' }}</div>
        <template v-if="checks.length">
          <h4>Checks</h4>
          <div v-for="(c, i) in checks" :key="i" class="pr-check" :class="checkIcon(c.state) === '✓' ? 'ok' : checkIcon(c.state) === '✗' ? 'bad' : ''">
            <span>{{ checkIcon(c.state) }}</span> {{ c.name }} <small>{{ c.state.toLowerCase() }}</small>
            <button v-if="c.url" title="Buka di browser" @click="openUrl(c.url)">↗</button>
          </div>
        </template>
        <h4>Percakapan ({{ timeline.length }})</h4>
        <div v-for="(t, i) in timeline" :key="i" class="pr-comment">
          <header><b>{{ t.who }}</b> <small v-if="t.review">{{ REVIEW[t.review] ?? t.review }}</small> <small>{{ when(t.at) }}</small></header>
          <div v-if="t.body" class="pr-text">{{ t.body }}</div>
        </div>
        <textarea v-model="text" rows="4" placeholder="Tulis komentar atau catatan review" />
        <div class="pr-actions">
          <button :disabled="!!busy || !text.trim()" @click="comment">Komentar</button>
          <span class="sep" />
          <button :disabled="!!busy" @click="review('--approve')">✓ Setujui</button>
          <button :disabled="!!busy || !text.trim()" @click="review('--request-changes')">✗ Minta perubahan</button>
          <button :disabled="!!busy || !text.trim()" @click="review('--comment')">Review komentar</button>
          <span class="spacer" />
          <template v-if="pr.state === 'OPEN'">
            <select v-model="method" aria-label="Cara merge">
              <option value="merge">merge commit</option>
              <option value="squash">squash</option>
              <option value="rebase">rebase</option>
            </select>
            <button class="primary" :disabled="!!busy || pr.isDraft" @click="merge">Merge</button>
          </template>
        </div>
        <h4>
          File berubah ({{ files.length }})
          <span class="seg">
            <button :class="{ on: mode === 'split' }" @click="emit('mode', 'split')">Split</button>
            <button :class="{ on: mode === 'unified' }" @click="emit('mode', 'unified')">Unified</button>
          </span>
        </h4>
        <div v-for="f in files" :key="f.path" class="file" :class="{ sel: sel?.path === f.path }" @click="pick(f)">
          <span class="name" :title="f.path">{{ f.path }}</span>
          <small v-if="stat(f.path)"><span class="ok">+{{ stat(f.path).additions }}</span> <span class="bad">−{{ stat(f.path).deletions }}</span></small>
        </div>
      </section>
      <DiffView v-if="sel" :d="sel.d" :mode="mode" />
    </template>
  </div>
</template>

<style>
.prview .pr-meta { padding: 4px 12px; max-width: 900px; }
.pr-state { margin-right: 6px; padding: 1px 7px; border-radius: 4px; background: var(--bg3); font-size: 11px; font-weight: 700; }
.pr-state.OPEN { background: #8ee05b; color: #1a1206; }
.pr-state.MERGED { background: #a77bf3; color: #1a1206; }
.pr-text { white-space: pre-wrap; word-break: break-word; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg2); }
.pr-check { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
.pr-check small { color: var(--dim); }
.pr-check button { padding: 0 6px; font-size: 11px; }
.prview .ok { color: #8ee05b; }
.prview .bad { color: #f2665b; }
.pr-comment { margin-bottom: 8px; }
.pr-comment header { margin-bottom: 3px; color: var(--fg); }
.pr-comment small { color: var(--dim); margin-left: 6px; }
.prview textarea { margin-top: 6px; resize: vertical; }
.pr-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 6px 0 4px; }
.pr-actions select { background: var(--bg3); color: var(--fg); border: 1px solid var(--line); border-radius: 4px; padding: 3px 6px; font: inherit; }
.prview .file.sel { background: color-mix(in srgb, var(--accent) 18%, transparent); box-shadow: inset 3px 0 var(--accent); }
</style>
