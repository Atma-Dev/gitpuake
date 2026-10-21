<script setup>
// Branches, remotes, tags, stashes, forge and repo extras.
import Forge from './Forge.vue'
import { MERGE_MODES, addRemote, branches, checkout, closeTab, commit, commits, createBranch, deleteTag, dragRef, dropOn, error, fetchRemote, filter, firstRemote, forge, forgeEl, g, goBack, head, hideRef, info, jumpTo, merge, newBranch, newBranchAt, openPR, openPath, prevHead, pull, push, pushTag, rebaseOnto, refState, remoteForm, remotes, removeBranch, removeRemote, repo, run, selected, setFilter, soloRef, stashDo, stashes, tags, vFocus } from './store.js'
import { NO_FILTER } from './branchops.js'
import SidebarExtras from './SidebarExtras.vue'
</script>

<template>
  <aside class="sidebar">
    <form class="new-branch" @submit.prevent="createBranch">
      <input v-model="newBranch" :placeholder="selected === 'WIP' ? 'Branch baru dari HEAD' : 'Branch baru dari ' + selected.slice(0, 7)" />
    </form>
    <p v-if="filter.solo || filter.hidden.length" class="hint filter-note">
      Graph {{ filter.solo ? 'hanya ' + filter.solo.replace(/^refs\/(heads|remotes)\//, '') : 'tanpa ' + filter.hidden.length + ' branch' }}
      <button @click="setFilter(NO_FILTER)">Tampilkan semua</button>
    </p>
    <h4>Local</h4>
    <div
      v-for="b in branches.local"
      :key="b"
      class="branch"
      :class="{ current: b === head, ...refState('refs/heads/' + b) }"
      draggable="true"
      @dragstart="dragRef = b"
      @dragend="dragRef = ''"
      @dragover="dragRef && $event.preventDefault()"
      @drop="dropOn($event, b)"
      @dblclick="checkout(b)"
    >
      <span class="name" :title="b">{{ b }}</span>
      <span class="actions">
        <button title="Tampilkan hanya branch ini di graph" @click="soloRef('refs/heads/' + b)">◎</button>
        <button title="Sembunyikan dari graph" @click="hideRef('refs/heads/' + b)">⊘</button>
      </span>
      <span v-if="branches.track[b]?.ahead || branches.track[b]?.behind" class="track" title="ahead / behind upstream">
        <template v-if="branches.track[b].ahead">↑{{ branches.track[b].ahead }}</template>
        <template v-if="branches.track[b].behind"> ↓{{ branches.track[b].behind }}</template>
      </span>
      <span class="actions" v-if="b !== head">
        <select class="merge-pick" title="Merge ke branch aktif" :aria-label="'Merge ' + b" @change="merge(b, $event.target.value); $event.target.value = ''; $event.target.blur()">
          <option value="" hidden>⤵</option>
          <option v-for="(l, k) in MERGE_MODES" :key="k" :value="k">{{ l }}</option>
        </select>
        <button title="Rebase branch aktif ke branch ini" @click="rebaseOnto(b)">⤴</button>
        <button title="Hapus" @click="removeBranch(b)">✕</button>
      </span>
    </div>
    <h4>
      Remote
      <button v-if="!remoteForm" title="Tambah remote" @click="remoteForm = { name: remotes.length ? '' : 'origin', url: '' }">+ Tambah</button>
    </h4>
    <form v-if="remoteForm" class="remote-form" @submit.prevent="addRemote" @keydown.esc="remoteForm = null">
      <input v-model="remoteForm.name" v-focus placeholder="Nama, misalnya origin" />
      <input v-model="remoteForm.url" placeholder="git@github.com:user/repo.git" />
      <span class="form-actions">
        <button type="button" @click="remoteForm = null">Batal</button>
        <button class="primary" :disabled="!remoteForm.name.trim() || !remoteForm.url.trim()">Tambah remote</button>
      </span>
    </form>
    <p v-if="!remotes.length && !remoteForm" class="hint">Belum ada remote. Tambahkan supaya bisa push dan pull.</p>
    <template v-for="r in remotes" :key="r.name">
      <div class="branch remote-head" :title="r.url">
        <span class="name">☁ {{ r.name }}</span>
        <span class="actions">
          <button title="Fetch remote ini" @click="fetchRemote(r)">⟳</button>
          <button title="Hapus remote" @click="removeRemote(r)">✕</button>
        </span>
      </div>
      <div
        v-for="b in branches.remote.filter(b => b.startsWith(r.name + '/'))"
        :key="b"
        class="branch nested"
        :class="refState('refs/remotes/' + b)"
        draggable="true"
        @dragstart="dragRef = b"
        @dragend="dragRef = ''"
        @dblclick="checkout(b, true)"
      >
        <span class="name" :title="b">{{ b.slice(r.name.length + 1) }}</span>
        <span class="actions">
          <button title="Tampilkan hanya branch ini di graph" @click="soloRef('refs/remotes/' + b)">◎</button>
          <button title="Sembunyikan dari graph" @click="hideRef('refs/remotes/' + b)">⊘</button>
          <select class="merge-pick" title="Merge ke branch aktif" :aria-label="'Merge ' + b" @change="merge(b, $event.target.value); $event.target.value = ''; $event.target.blur()">
            <option value="" hidden>⤵</option>
            <option v-for="(l, k) in MERGE_MODES" :key="k" :value="k">{{ l }}</option>
          </select>
          <button title="Rebase branch aktif ke branch ini" @click="rebaseOnto(b)">⤴</button>
        </span>
      </div>
    </template>
    <template v-if="tags.length">
      <h4>Tag</h4>
      <div v-for="t in tags" :key="t.name" class="branch" @click="jumpTo(t.commit)">
        <span class="name" :title="t.name">◆ {{ t.name }}</span>
        <span class="actions">
          <button :title="'Push tag ke ' + firstRemote()" @click.stop="pushTag(t)">↑</button>
          <button title="Hapus tag" @click.stop="deleteTag(t)">✕</button>
        </span>
      </div>
    </template>
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
    <Forge
      ref="forgeEl"
      :repo="repo"
      :forge="forge"
      :remote="firstRemote()"
      :head="head"
      :g="g"
      :run="run"
      :prev-head="prevHead"
      :go-back="goBack"
      @error="e => (error = e)"
      @info="m => (info = m)"
      @branch="name => newBranchAt(name, [])"
      @open-pr="openPR"
    />
    <SidebarExtras :repo="repo" :g="g" :run="run" :branches="branches.local" :tick="commits" @open="openPath" @close="closeTab" />
    <p class="hint">Double-click branch untuk checkout · klik kanan commit untuk aksi lain · seret branch ke branch/commit lain untuk merge atau rebase · Ctrl+klik commit kedua untuk membandingkan · Ctrl+P untuk semua perintah</p>
  </aside>
</template>
