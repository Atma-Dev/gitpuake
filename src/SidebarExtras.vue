<script setup>
// Sidebar sections for worktrees, plus submodules and Git LFS when the repo uses them.
import { ref, watch, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open, ask } from '@tauri-apps/plugin-dialog'
import { parseWorktrees, parseSubmodules } from './extras.js'

// g/run are App's git helpers; tick changes on every App refresh
const props = defineProps({ repo: String, g: Function, run: Function, branches: Array, tick: null })
const emit = defineEmits(['open', 'close'])
const g = (...a) => props.g(...a)
const run = (...a) => props.run(...a) // its refresh bumps tick, which reloads these sections
const vFocus = { mounted: el => el.focus() }

const worktrees = ref([])
const submodules = ref([])
const lfs = ref({ installed: false, used: false, files: 0 })
const wtForm = ref(null) // { branch, create } while adding a worktree
const lfsForm = ref(null) // { pattern } while tracking a pattern

const SUB_STATE = { '-': 'belum di-init', '+': 'commit berbeda', U: 'conflict' }
const name = p => p.split('/').at(-1)

async function load() {
  if (!props.repo) return
  const [wt, sm, lfsFiles, attrs] = await Promise.all([
    g('worktree', 'list', '--porcelain').catch(() => ''),
    g('submodule', 'status').catch(() => ''),
    g('ls-files', '-z', ':(attr:filter=lfs)').catch(() => ''), // works without git-lfs installed
    // ponytail: only the root .gitattributes is checked for a pattern with no files yet; nested ones are caught once files exist
    invoke('read_file', { repo: props.repo, path: '.gitattributes' }).catch(() => ''),
  ])
  worktrees.value = parseWorktrees(wt)
  submodules.value = parseSubmodules(sm)
  const files = lfsFiles.split('\0').filter(Boolean).length
  lfs.value = { ...lfs.value, files, used: files > 0 || /filter=lfs/.test(attrs) }
}
watch(() => [props.repo, props.tick], load)
onMounted(async () => {
  lfs.value.installed = await g('lfs', 'version').then(() => true, () => false)
  load()
})

// Submodules
const subUpdate = s =>
  run(s ? 'Update submodule' : 'Init submodule', () => g('submodule', 'update', '--init', '--recursive', ...(s ? ['--', s.path] : [])))

// Worktrees
async function addWorktree() {
  const branch = wtForm.value.branch.trim(), create = wtForm.value.create
  if (!branch) return
  const parent = await open({ directory: true, title: 'Pilih folder induk untuk worktree' })
  if (!parent) return
  wtForm.value = null
  const path = parent.replace(/\/$/, '') + '/' + branch.replaceAll('/', '-')
  run(
    'Tambah worktree',
    () => g('worktree', 'add', ...(create ? ['-b', branch, path] : [path, branch])),
    async () => {
      await g('worktree', 'remove', path)
      if (create) await g('branch', '-D', branch)
    },
  )
}
async function removeWorktree(w) {
  if (!(await ask(`Hapus worktree "${w.path}"? Foldernya ikut dihapus, branch-nya tetap ada.`, { kind: 'warning' }))) return
  run(
    'Hapus worktree',
    async () => {
      try {
        await g('worktree', 'remove', w.path)
      } catch (e) {
        if (/modified or untracked/.test(String(e)))
          throw `Worktree "${name(w.path)}" masih punya perubahan yang belum di-commit. Commit, stash, atau buang dulu perubahannya, lalu hapus lagi.`
        throw e
      }
      emit('close', w.path) // drop its tab, if open
    },
    () => g('worktree', 'add', ...(w.branch ? [w.path, w.branch] : ['--detach', w.path, w.head])),
  )
}

// Git LFS
function track() {
  const pattern = lfsForm.value.pattern.trim()
  if (!pattern) return
  lfsForm.value = null
  run('LFS track', () => g('lfs', 'track', pattern), () => g('lfs', 'untrack', pattern))
}
</script>

<template>
  <template v-if="submodules.length">
    <h4>Submodule <button title="git submodule update --init --recursive" @click="subUpdate()">Init & update</button></h4>
    <div v-for="s in submodules" :key="s.path" class="branch" :title="s.path + ' @ ' + s.sha.slice(0, 7)">
      <span class="name">▣ {{ s.path }}</span>
      <small v-if="SUB_STATE[s.state]" class="x-state" :class="'s' + s.state">{{ SUB_STATE[s.state] }}</small>
      <span class="actions">
        <button title="Init & update submodule ini" @click="subUpdate(s)">↻</button>
        <button v-if="s.state !== '-'" title="Buka di tab" @click="emit('open', repo + '/' + s.path)">↗</button>
      </span>
    </div>
  </template>

  <h4>
    Worktree
    <span class="h-actions">
      <button v-if="worktrees.some(w => w.prunable)" title="git worktree prune: bersihkan worktree yang foldernya sudah hilang" @click="run('Prune worktree', () => g('worktree', 'prune'))">Prune</button>
      <button v-if="!wtForm" title="Tambah worktree" @click="wtForm = { branch: '', create: false }">+ Tambah</button>
    </span>
  </h4>
  <form v-if="wtForm" class="remote-form" @submit.prevent="addWorktree" @keydown.esc="wtForm = null">
    <input v-model="wtForm.branch" v-focus list="x-branches" :placeholder="wtForm.create ? 'Nama branch baru' : 'Branch yang di-checkout'" />
    <datalist id="x-branches"><option v-for="b in branches" :key="b" :value="b" /></datalist>
    <label class="amend"><input v-model="wtForm.create" type="checkbox" /> Buat branch baru dari HEAD</label>
    <span class="form-actions">
      <button type="button" @click="wtForm = null">Batal</button>
      <button class="primary" :disabled="!wtForm.branch.trim()">Pilih folder…</button>
    </span>
  </form>
  <div v-for="(w, i) in worktrees" :key="w.path" class="branch" :class="{ current: w.path === repo }" :title="w.path">
    <span class="name">⌂ {{ name(w.path) }} <small class="x-state">{{ w.branch || (w.bare ? 'bare' : 'detached') }}</small></span>
    <small v-if="w.prunable" class="x-state s-">hilang</small>
    <small v-else-if="w.locked" class="x-state" title="Terkunci (git worktree lock)">🔒</small>
    <span class="actions">
      <button v-if="w.path !== repo && !w.prunable && !w.bare" title="Buka di tab" @click="emit('open', w.path)">↗</button>
      <button v-if="i > 0 && w.path !== repo && !w.prunable" title="Hapus worktree" @click="removeWorktree(w)">✕</button>
    </span>
  </div>

  <template v-if="lfs.used">
    <h4>
      Git LFS
      <span v-if="lfs.installed" class="h-actions">
        <button title="git lfs pull" @click="run('LFS pull', () => g('lfs', 'pull'))">Pull</button>
        <button v-if="!lfsForm" @click="lfsForm = { pattern: '' }">Track pola…</button>
      </span>
    </h4>
    <form v-if="lfsForm" class="remote-form" @submit.prevent="track" @keydown.esc="lfsForm = null">
      <input v-model="lfsForm.pattern" v-focus placeholder="Pola file, misalnya *.psd" />
      <span class="form-actions">
        <button type="button" @click="lfsForm = null">Batal</button>
        <button class="primary" :disabled="!lfsForm.pattern.trim()">Track</button>
      </span>
    </form>
    <p class="hint">
      {{ lfs.files }} file dilacak LFS.
      <template v-if="!lfs.installed">
        Repo ini memakai Git LFS, tapi <code>git-lfs</code> belum terpasang. Pasang lalu jalankan <code>git lfs install</code> supaya file aslinya ikut terunduh.
      </template>
    </p>
  </template>
</template>

<style>
.x-state { color: var(--dim); font-size: 11px; font-weight: 400; white-space: nowrap; }
.x-state.s- { color: #f2665b; }
.x-state.s\+ { color: var(--accent); }
.x-state.sU { color: #f2665b; }
</style>
