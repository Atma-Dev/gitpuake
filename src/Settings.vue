<script setup>
import { ref, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { ask } from '@tauri-apps/plugin-dialog'
import { settings } from './settings.js'
import { readIdentity, writeIdentity } from './identity.js'

// `run` is App's run(label, fn, undo): busy state, error toast, undo, refresh.
const props = defineProps({ repo: String, run: Function })
defineEmits(['close'])
const g = (...args) => invoke('git', { repo: props.repo, args })

const local = ref({ name: '', email: '' })
const global = ref({ name: '', email: '' })
const form = ref(null) // new profile while adding: { label, name, email, signingkey }
const FETCH = [0, 1, 5, 15, 30, 60]

async function load() {
  ;[local.value, global.value] = await Promise.all([readIdentity(g, '--local'), readIdentity(g, '--global')])
}
onMounted(load)

async function setIdentity(label, scope, id) {
  const before = await readIdentity(g, scope)
  await props.run(label, () => writeIdentity(g, scope, id), () => writeIdentity(g, scope, before))
  await load()
}
const saveScope = (scope, f) => setIdentity(scope === '--global' ? 'Identitas global' : 'Identitas repo', scope, { name: f.name, email: f.email })
// A profile without a key also clears the repo's own signing key, so commits never get signed as the previous identity.
const applyProfile = p => setIdentity('Profil ' + p.label, '--local', { name: p.name, email: p.email, signingkey: p.signingkey || '' })

function addProfile() {
  const p = Object.fromEntries(Object.entries(form.value).map(([k, v]) => [k, v.trim()]))
  if (!p.label || !p.name || !p.email) return
  settings.profiles.push(p)
  form.value = null
}
async function removeProfile(i) {
  if (await ask(`Hapus profil "${settings.profiles[i].label}"? Config git repo tidak berubah.`, { kind: 'warning' })) settings.profiles.splice(i, 1)
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="$emit('close')" @keydown.esc="$emit('close')">
    <div class="dialog settings" role="dialog" aria-label="Pengaturan">
      <header class="set-head">
        <h3>Pengaturan</h3>
        <button @click="$emit('close')">✕ Tutup</button>
      </header>

      <h4>Identitas git</h4>
      <div class="ids">
        <form v-for="[scope, f, title, hint] in [['--local', local, 'Repo ini', 'Kosong = pakai global'], ['--global', global, 'Global', 'Untuk semua repo']]" :key="scope" class="id-form" @submit.prevent="saveScope(scope, f)">
          <b>{{ title }} <small>{{ hint }}</small></b>
          <input v-model="f.name" placeholder="Nama" :aria-label="'Nama ' + title" />
          <input v-model="f.email" type="email" placeholder="Email" :aria-label="'Email ' + title" />
          <small v-if="f.signingkey" class="hint">Kunci tanda tangan: <code>{{ f.signingkey }}</code></small>
          <span class="form-actions"><button>Simpan</button></span>
        </form>
      </div>

      <h4>
        Profil identitas
        <button v-if="!form" @click="form = { label: '', name: local.name || global.name, email: local.email || global.email, signingkey: '' }">+ Tambah</button>
      </h4>
      <form v-if="form" class="profile-form" @submit.prevent="addProfile" @keydown.esc.stop="form = null">
        <input v-model="form.label" placeholder="Nama profil, misalnya Kantor" aria-label="Nama profil" />
        <input v-model="form.name" placeholder="Nama" aria-label="Nama" />
        <input v-model="form.email" type="email" placeholder="Email" aria-label="Email" />
        <input v-model="form.signingkey" placeholder="Kunci tanda tangan (opsional)" aria-label="Kunci tanda tangan" />
        <span class="form-actions">
          <button type="button" @click="form = null">Batal</button>
          <button class="primary" :disabled="!form.label.trim() || !form.name.trim() || !form.email.trim()">Simpan profil</button>
        </span>
      </form>
      <p v-if="!settings.profiles.length && !form" class="hint">Simpan identitas yang sering dipakai, misalnya kantor dan pribadi, lalu pasang ke repo dengan satu klik.</p>
      <div v-for="(p, i) in settings.profiles" :key="i" class="profile">
        <span class="name">
          <b>{{ p.label }}</b> {{ p.name }} &lt;{{ p.email }}&gt;
          <small v-if="p.signingkey" class="hint"> · kunci {{ p.signingkey }}</small>
        </span>
        <button v-if="local.name === p.name && local.email === p.email" disabled>Aktif</button>
        <button v-else class="primary" @click="applyProfile(p)">Pakai di repo ini</button>
        <button :aria-label="'Hapus profil ' + p.label" @click="removeProfile(i)">✕</button>
      </div>

      <h4>Umum</h4>
      <div class="row-set">
        Fetch otomatis
        <select v-model="settings.fetchMinutes" aria-label="Fetch otomatis">
          <option v-for="m in FETCH" :key="m" :value="m">{{ m ? 'tiap ' + m + ' menit' : 'mati' }}</option>
        </select>
      </div>
      <div class="row-set">
        Tampilan diff bawaan
        <span class="seg">
          <button :class="{ on: settings.diffMode === 'split' }" @click="settings.diffMode = 'split'">Split</button>
          <button :class="{ on: settings.diffMode === 'unified' }" @click="settings.diffMode = 'unified'">Unified</button>
        </span>
      </div>
      <div class="row-set">
        Tema
        <select v-model="settings.theme" aria-label="Tema">
          <option value="dark">Gelap</option>
          <option value="light">Terang</option>
          <option value="auto">Ikuti sistem</option>
        </select>
      </div>
      <label class="amend avatar-opt">
        <input v-model="settings.avatars" type="checkbox" />
        <span>
          Tampilkan foto author dari Gravatar
          <small class="hint">Aplikasi akan mengirim hash email setiap author ke gravatar.com. Gravatar jadi bisa tahu email siapa yang sedang kamu lihat, dan hash email umum bisa ditebak balik.</small>
        </span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.settings { width: min(640px, 100% - 32px); max-height: calc(100vh - 64px); overflow: auto; gap: 6px; }
.set-head { display: flex; justify-content: space-between; align-items: center; }
.ids { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.id-form, .profile-form { display: flex; flex-direction: column; gap: 6px; }
.id-form b { color: var(--bone); }
.id-form b small { color: var(--dim); font-weight: 400; }
.profile { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 4px; }
.profile:hover { background: var(--bg3); }
.profile button { padding: 1px 8px; font-size: 11px; }
.row-set { display: flex; justify-content: space-between; align-items: center; }
.row-set select {
  appearance: none;
  -webkit-appearance: none; /* WebKitGTK paints native selects white */
  padding: 3px 22px 3px 8px;
  color: var(--fg);
  border: 1px solid var(--line);
  border-radius: 4px;
  font: inherit;
  background: var(--bg3) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23849282' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat right 7px center;
}
.avatar-opt { align-items: flex-start; color: var(--fg); }
.avatar-opt input { margin-top: 3px; }
.avatar-opt small { display: block; }
</style>
