<script setup>
import { onMounted } from 'vue'
import CommitMenu from './CommitMenu.vue'
import DiffPane from './DiffPane.vue'
import FileView from './FileView.vue'
import History from './History.vue'
import MergeEditor from './MergeEditor.vue'
import PRView from './PRView.vue'
import Palette from './Palette.vue'
import Panel from './Panel.vue'
import Reflog from './Reflog.vue'
import RebasePlan from './RebasePlan.vue'
import Settings from './Settings.vue'
import Sidebar from './Sidebar.vue'
import Terminal from './Terminal.vue'
import TopBar from './TopBar.vue'
import Welcome from './Welcome.vue'
import { abortOp, bisect, bisecting, busy, commands, commits, compare, continueOp, diff, diffMode, dropMenu, error, fileView, forgeEl, forget, info, keyName, mainEl, menu, mergeView, onScroll, openPath, operation, plan, prView, recent, refresh, repo, run, searchEl, selectCommit, selected, setDiffMode, showPalette, showReflog, showSettings, showTerminal, status, undo } from './store.js'

onMounted(() => {
  refresh()
  window.addEventListener('focus', refresh)
  window.addEventListener('click', () => (menu.value = dropMenu.value = null))
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      menu.value = dropMenu.value = null
      if (compare.value) selectCommit(selected.value)
    }
    const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
    const k = keyName(e)
    if ((k === 'Ctrl+P' || k === 'Ctrl+Shift+P') && repo.value) {
      e.preventDefault()
      showPalette.value = !showPalette.value
      return
    }
    const cmd = !showPalette.value && k !== 'Ctrl+Z' && k !== 'Ctrl+F' && commands.value.find(c => c.keys === k)
    if (cmd) {
      e.preventDefault()
      cmd.run()
    } else if (e.ctrlKey && e.key === 'f' && repo.value) {
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
    <TopBar />
    <Sidebar v-if="repo" />

    <div v-if="operation" class="op-banner">
      <b>{{ { rebase: 'Rebase', merge: 'Merge', 'cherry-pick': 'Cherry-pick', revert: 'Revert', am: 'Penerapan patch' }[operation] }} sedang berlangsung.</b>
      <span v-if="status.conflicts.length">
        {{ status.conflicts.length }} file conflict. Klik file di panel kanan untuk memilih versi yang dipakai.
      </span>
      <span v-else>Semua conflict sudah selesai.</span>
      <span class="spacer" />
      <button @click="abortOp">Abort</button>
      <button class="primary" :disabled="status.conflicts.length > 0 || !!busy" @click="continueOp">Continue</button>
    </div>

    <div v-if="bisecting" class="bisect-banner">
      <b>Bisect sedang berjalan.</b>
      <span>Uji commit yang sedang di-checkout, lalu tandai hasilnya.</span>
      <span class="spacer" />
      <button :disabled="!!busy" @click="bisect('good')">Good</button>
      <button :disabled="!!busy" @click="bisect('bad')">Bad</button>
      <button :disabled="!!busy" @click="bisect('skip')">Skip</button>
      <button :disabled="!!busy" @click="bisect('reset')">Selesai (reset)</button>
    </div>

    <main ref="mainEl" class="main" v-if="repo" @scroll.passive="onScroll">
      <RebasePlan v-if="plan" />
      <MergeEditor v-else-if="mergeView" />
      <FileView v-else-if="fileView" />
      <DiffPane v-else-if="diff" />
      <PRView
        v-else-if="prView"
        :repo="repo"
        :n="prView"
        :mode="diffMode"
        :busy="busy"
        :run="run"
        @mode="setDiffMode"
        @close="prView = null"
        @changed="forgeEl?.load()"
      />
      <History v-else />
    </main>
    <Panel v-if="repo" />

    <CommitMenu />
    <footer class="statusbar"><span>{{ repo }}</span><span class="spacer" /><span>{{ commits.length }} commit</span><span v-if="busy">{{ busy }}…</span></footer>
  </div>

  <Palette v-if="showPalette && repo" :commands="commands" @close="showPalette = false" />
  <Terminal v-if="showTerminal && repo" />
  <Reflog v-if="showReflog && repo" @close="showReflog = false" />
  <Settings v-if="showSettings && repo" :repo="repo" :run="run" @close="showSettings = false" />
  <div v-if="info" class="error info" @click="info = ''">
    <pre>{{ info }}</pre>
    <small>klik untuk tutup</small>
  </div>
  <div v-if="error" class="error" @click="error = ''">
    <pre>{{ error }}</pre>
    <small>klik untuk tutup</small>
  </div>
</template>
