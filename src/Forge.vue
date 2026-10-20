<script setup>
// Sidebar section for the repo's forge: pull/merge requests and issues through the user's
// `gh` (GitHub) or `glab` (GitLab) CLI; Bitbucket has no CLI, so it only gets browser links.
import { ref, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { issueBranch, cliError } from './forge.js'

const props = defineProps({
  repo: String,
  forge: Object, // parseRemote() of the first remote
  remote: String, // its name, for pushing
  head: String,
  g: Function,
  run: Function,
  prevHead: Function,
  goBack: Function,
})
const emit = defineEmits(['error', 'info', 'branch', 'open-pr'])

const vFocus = { mounted: el => el.focus() }
const kind = computed(() => props.forge?.forge)
const lab = computed(() => kind.value === 'gitlab')
const cliName = computed(() => ({ github: 'gh', gitlab: 'glab' })[kind.value])
const cli = (...args) => invoke(cliName.value, { repo: props.repo, args })
const openUrl = url => invoke('open_url', { url }).catch(e => emit('error', String(e)))
const bitbucket = computed(() => 'https://bitbucket.org/' + props.forge.path + '/pull-requests/')

const prs = ref(null) // null | { list } | { error: 'missing' | 'auth' | message }
const issues = ref(null)
const form = ref(null) // { type: 'pr' | 'issue', title, body, base, draft } while the dialog is open

// gh and glab JSON both normalized to the gh field names
const PR_ARGS = {
  github: ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,author,headRefName,baseRefName,isDraft,reviewDecision,url'],
  gitlab: ['mr', 'list', '--output', 'json', '--per-page', '50'],
}
const ISSUE_ARGS = {
  github: ['issue', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,author,labels,url'],
  gitlab: ['issue', 'list', '--output', 'json', '--per-page', '50'],
}
const fromLab = x => ({
  number: x.iid, title: x.title, author: x.author?.username, url: x.web_url, labels: x.labels ?? [],
  headRefName: x.source_branch, baseRefName: x.target_branch, isDraft: x.draft,
})
const fromHub = x => ({ ...x, author: x.author?.login, labels: x.labels?.map(l => l.name) ?? [] })

async function list(args) {
  try {
    return { list: JSON.parse(await cli(...args)).map(lab.value ? fromLab : fromHub) }
  } catch (e) {
    return { error: cliError(e, cliName.value) }
  }
}
async function load() {
  prs.value = issues.value = null
  if (!cliName.value) return
  const at = props.repo
  const [p, i] = await Promise.all([list(PR_ARGS[kind.value]), list(ISSUE_ARGS[kind.value])])
  if (at === props.repo) [prs.value, issues.value] = [p, i] // ignore results for a repo we already left
}
watch(() => [props.repo, kind.value, props.forge?.path], load, { immediate: true })

async function checkout(pr) {
  const prev = await props.prevHead()
  await props.run('Checkout ' + (lab.value ? 'MR !' : 'PR #') + pr.number, () => cli(lab.value ? 'mr' : 'pr', 'checkout', String(pr.number)), () => props.goBack(prev))
}

async function openPRForm() {
  if (kind.value === 'bitbucket')
    return props.run('Push', async () => {
      await props.g('push', '-u', props.remote, 'HEAD') // the branch must exist on Bitbucket first
      await openUrl(bitbucket.value + 'new?source=' + encodeURIComponent(props.head))
    })
  const base = (await props.g('symbolic-ref', '-q', '--short', `refs/remotes/${props.remote}/HEAD`)).trim().split('/').slice(1).join('/')
  const title = (await props.g('log', '-1', '--format=%s')).trim()
  form.value = { type: 'pr', title, body: '', base: base || 'main', draft: false }
}
const openIssueForm = () => (form.value = { type: 'issue', title: '', body: '' })
function submit() {
  const { type, title, body, base, draft } = form.value
  form.value = null
  if (type === 'issue')
    return props.run('Buat issue', async () => {
      const url = await (lab.value ? cli('issue', 'create', '--title', title, '--description', body, '--yes') : cli('issue', 'create', '--title', title, '--body', body))
      emit('info', 'Issue dibuat: ' + url.trim())
      await load()
    })
  props.run(lab.value ? 'Buat MR' : 'Buat PR', async () => {
    await props.g('push', '-u', props.remote, 'HEAD') // gh/glab need the branch on the forge first
    const d = draft ? ['--draft'] : []
    const url = lab.value
      ? await cli('mr', 'create', '--title', title, '--description', body, '--target-branch', base, '--source-branch', props.head, '--yes', ...d)
      : await cli('pr', 'create', '--title', title, '--body', body, '--base', base, '--head', props.head, ...d)
    emit('info', (lab.value ? 'Merge request' : 'Pull request') + ' dibuat: ' + url.trim())
    await load()
  })
}
const REVIEW = { APPROVED: '✓ disetujui', CHANGES_REQUESTED: '✗ perlu perubahan', REVIEW_REQUIRED: 'menunggu review' }
const PR = computed(() => (lab.value ? 'Merge Request' : 'Pull Request'))
const authHint = computed(() => `${cliName.value} auth login`)

defineExpose({ load, openPRForm })
</script>

<template>
  <template v-if="kind === 'bitbucket'">
    <h4>Pull Request</h4>
    <div class="branch" @click="openUrl(bitbucket)"><span class="name">↗ Buka PR di browser</span></div>
    <div v-if="head" class="branch" title="Push branch ini lalu buka halaman PR baru" @click="openPRForm"><span class="name">⇪ Buat PR di browser</span></div>
  </template>
  <template v-else-if="cliName">
    <h4>{{ PR }} <button title="Muat ulang" @click="load">⟳</button></h4>
    <p v-if="!prs" class="hint">Memuat…</p>
    <p v-else-if="prs.error === 'missing'" class="hint">
      <template v-if="lab">Pasang GitLab CLI (<code>glab</code>)</template><template v-else>Pasang GitHub CLI (<code>gh</code>)</template>,
      lalu jalankan <code>{{ authHint }}</code> untuk melihat {{ lab ? 'merge request' : 'pull request' }} dan issue.
    </p>
    <p v-else-if="prs.error === 'auth'" class="hint">Jalankan <code>{{ authHint }}</code> di terminal, lalu klik ⟳.</p>
    <p v-else-if="prs.error" class="hint" :title="prs.error">Gagal memuat: {{ prs.error.split('\n')[0] }}</p>
    <p v-else-if="!prs.list.length" class="hint">Tidak ada {{ lab ? 'merge request' : 'pull request' }} terbuka.</p>
    <div
      v-for="pr in prs?.list ?? []"
      :key="pr.number"
      class="branch pr"
      :title="lab ? pr.title : pr.title + '\nKlik untuk detail, double-click untuk checkout'"
      @click="!lab && emit('open-pr', pr.number)"
      @dblclick="checkout(pr)"
    >
      <span class="name">
        <span class="pr-title"><b>{{ lab ? '!' : '#' }}{{ pr.number }}</b> {{ pr.title }}</span>
        <small>
          {{ pr.headRefName }} → {{ pr.baseRefName }} · {{ pr.author }}
          <template v-if="pr.isDraft"> · draft</template>
          <template v-else-if="REVIEW[pr.reviewDecision]"> · {{ REVIEW[pr.reviewDecision] }}</template>
        </small>
      </span>
      <span class="actions">
        <button title="Checkout branch ini" @click.stop="checkout(pr)">⎇</button>
        <button title="Buka di browser" @click.stop="openUrl(pr.url)">↗</button>
      </span>
    </div>

    <template v-if="issues?.list || (issues?.error && !['missing', 'auth'].includes(issues.error))">
      <h4>Issue <button title="Buat issue" @click="openIssueForm">+ Buat</button></h4>
      <p v-if="issues.error" class="hint" :title="issues.error">Gagal memuat issue: {{ issues.error.split('\n')[0] }}</p>
      <p v-else-if="!issues.list.length" class="hint">Tidak ada issue terbuka.</p>
      <div v-for="i in issues.list ?? []" :key="i.number" class="branch pr" :title="i.title" @click="openUrl(i.url)">
        <span class="name">
          <span class="pr-title"><b>#{{ i.number }}</b> {{ i.title }}</span>
          <small>{{ i.author }}<template v-if="i.labels.length"> · {{ i.labels.join(', ') }}</template></small>
        </span>
        <span class="actions">
          <button :title="'Buat branch ' + issueBranch(i.number, i.title) + ' dari HEAD'" @click.stop="emit('branch', issueBranch(i.number, i.title))">⎇</button>
          <button title="Buka di browser" @click.stop="openUrl(i.url)">↗</button>
        </span>
      </div>
    </template>
  </template>

  <div v-if="form" class="dialog-backdrop" @click.self="form = null" @keydown.esc="form = null">
    <form class="dialog" @submit.prevent="submit">
      <template v-if="form.type === 'issue'">
        <h3>Buat issue</h3>
        <label>Judul <input v-model="form.title" v-focus /></label>
        <label>Deskripsi <textarea v-model="form.body" rows="6" placeholder="Apa masalahnya, dan cara mereproduksinya" /></label>
        <span class="form-actions">
          <button type="button" @click="form = null">Batal</button>
          <button class="primary" :disabled="!form.title.trim()">Buat issue</button>
        </span>
      </template>
      <template v-else>
        <h3>Buat {{ lab ? 'merge request' : 'pull request' }}</h3>
        <p class="dialog-sub">Branch <b>{{ head }}</b> akan di-push dulu, lalu {{ lab ? 'MR' : 'PR' }} dibuat ke branch tujuan.</p>
        <label>Branch tujuan <input v-model="form.base" /></label>
        <p v-if="form.base.trim() === head" class="plan-error">Branch tujuan sama dengan branch ini. Buat branch baru untuk perubahanmu dulu.</p>
        <label>Judul <input v-model="form.title" v-focus /></label>
        <label>Deskripsi <textarea v-model="form.body" rows="6" placeholder="Apa yang berubah dan kenapa" /></label>
        <label class="amend"><input v-model="form.draft" type="checkbox" /> Buat sebagai draft</label>
        <span class="form-actions">
          <button type="button" @click="form = null">Batal</button>
          <button class="primary" :disabled="!form.title.trim() || !form.base.trim() || form.base.trim() === head">Push & buat {{ lab ? 'MR' : 'PR' }}</button>
        </span>
      </template>
    </form>
  </div>
</template>
