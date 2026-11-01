<script setup>
// Repository tabs and the toolbar.
import PullButton from './PullButton.vue'
import { ago, applyPatch, busy, closeTab, commit, diff, dirty, fetchAll, forge, forgeEl, goHome, head, headTrack, lastFetch, matches, nextMatch, openPath, openRepo, pull, push, query, redo, redos, repo, searchEl, showPalette, showSettings, stash, stashDo, stashes, tabs, undo, undos } from './store.js'
import logo from './assets/puake.svg'
import { settings } from './settings.js'
</script>

<template>
  <nav class="tabs" aria-label="Repository terbuka">
    <button class="home" title="Halaman awal" @click="goHome"><img :src="logo" alt="gitpuake" /></button>
    <div v-for="t in tabs" :key="t" class="tab" :class="{ on: t === repo }" :title="t">
      <button class="tab-name" @click="t !== repo && openPath(t)" @auxclick.middle="closeTab(t)">
        {{ t.split('/').at(-1) }}<small v-if="t === repo && head"> ⎇ {{ head }}</small>
      </button>
      <button class="tab-close" :aria-label="'Tutup ' + t.split('/').at(-1)" @click="closeTab(t)">✕</button>
    </div>
    <button class="tab-add" title="Buka repository lain" @click="openRepo">+</button>
  </nav>
  <header class="toolbar">
    <template v-if="repo">
      <span class="crumb"><small>repository</small><b>{{ repo.split('/').at(-1) }}</b></span>
      <span class="crumb"><small>branch</small><b class="head">{{ head || '(detached)' }}</b></span>
      <span class="spacer" />
      <button :disabled="!undos.length || !!busy" :title="undos.length ? 'Undo: ' + undos.at(-1).label + ' (Ctrl+Z)' : 'Belum ada yang bisa di-undo'" @click="undo"><i>↶</i>Undo</button>
      <button :disabled="!redos.length || !!busy" :title="redos.length ? 'Redo: ' + redos.at(-1).label + ' (Ctrl+Shift+Z)' : 'Belum ada yang bisa di-redo'" @click="redo"><i>↷</i>Redo</button>
      <span class="sep" />
      <button :disabled="!!busy" :title="(settings.fetchMinutes ? 'Fetch otomatis tiap ' + settings.fetchMinutes + ' menit' : 'Fetch otomatis mati') + (lastFetch ? '. Terakhir: ' + ago(lastFetch / 1000) : '')" @click="fetchAll"><i>⟳</i>Fetch</button>
      <PullButton :disabled="!!busy" :behind="headTrack.behind" @pull="pull" />
      <button :disabled="!!busy" @click="push"><i>↑</i>Push<b v-if="headTrack.ahead" class="count">{{ headTrack.ahead }}</b></button>
      <span class="sep" />
      <button :disabled="!!busy || !dirty" @click="stash"><i>⊞</i>Stash</button>
      <button :disabled="!!busy || !stashes.length" @click="stashDo('pop', stashes[0])"><i>⊟</i>Pop</button>
      <button :disabled="!!busy" title="Terapkan file .patch atau .diff" @click="applyPatch"><i>⎘</i>Patch</button>
      <button v-if="forge?.forge && head" :disabled="!!busy" title="Push branch ini lalu buat pull request" @click="forgeEl.openPRForm()"><i>⇪</i>{{ forge.forge === 'gitlab' ? 'MR' : 'PR' }}</button>
      <span class="spacer" />
      <span v-if="busy" class="busy">{{ busy }}…</span>
      <input
        ref="searchEl"
        v-model="query"
        class="search"
        placeholder="Cari commit, author, hash (Ctrl+F)"
        @keydown.enter="nextMatch($event.shiftKey)"
        @keydown.esc="query = ''"
      />
      <small v-if="matches" class="busy">{{ matches.size }} hasil</small>
      <button title="Perintah (Ctrl+P)" aria-label="Perintah" @click="showPalette = true"><i>⌘</i>Aksi</button>
      <button title="Pengaturan (Ctrl+,)" aria-label="Pengaturan" @click="showSettings = true"><i>⚙</i></button>
    </template>
  </header>
</template>
