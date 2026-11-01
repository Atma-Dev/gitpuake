<script setup>
// Branches, remotes, tags, stashes, forge and repo extras.
import Forge from './Forge.vue'
import { MERGE_MODES, addRemote, branches, checkout, closeTab, commit, commits, createBranch, deleteTag, dragRef, dropOn, error, fetchRemote, filter, firstRemote, forge, forgeEl, g, goBack, head, hideRef, info, jumpTo, merge, newBranch, newBranchAt, openPR, openPath, prevHead, pull, push, pushTag, rebaseOnto, refState, remoteForm, remotes, removeBranch, removeRemote, removeRemoteBranch, repo, run, selected, setFilter, soloRef, stashDo, stashes, tags, vFocus } from './store.js'
import { NO_FILTER } from './branchops.js'
import SidebarExtras from './SidebarExtras.vue'
import { reactive, ref } from 'vue'
import { FLOW, flowFinish, flowKind, flowStart } from './store.js'

const flow = ref({ kind: 'feature', name: '' })
const startFlow = () => flowStart(flow.value.kind, flow.value.name).then(() => (flow.value.name = ''))

// which sections are expanded, remembered; like GitKraken only Local starts open
const open = reactive({ local: true, ...JSON.parse(localStorage.getItem('sideOpen') || '{}') })
const toggle = (k, e) => {
  open[k] = e.target.open
  localStorage.setItem('sideOpen', JSON.stringify(open))
}

const q = ref('')
const hit = b => b.toLowerCase().includes(q.value.trim().toLowerCase())
</script>

<template>
  <aside class="sidebar">
    <p class="viewing">Viewing <b>{{ commits.length }}</b></p>
    <label class="side-filter"><input v-model="q" placeholder="Filter branch / tag" /><span aria-hidden="true">⌕</span></label>
    <form class="new-branch" @submit.prevent="createBranch">
      <input v-model="newBranch" :placeholder="selected === 'WIP' ? 'Branch baru dari HEAD' : 'Branch baru dari ' + selected.slice(0, 7)" />
    </form>
    <p v-if="filter.solo || filter.hidden.length" class="hint filter-note">
      Graph {{ filter.solo ? 'hanya ' + filter.solo.replace(/^refs\/(heads|remotes)\//, '') : 'tanpa ' + filter.hidden.length + ' branch' }}
      <button @click="setFilter(NO_FILTER)">Tampilkan semua</button>
    </p>
    <details :open="open.local" @toggle="toggle('local', $event)">
    <summary><h4><i>⌂</i>Local <b>{{ branches.local.length }}</b></h4></summary>
    <div
      v-for="b in branches.local.filter(hit)"
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
    </details>
    <details :open="open.remote" @toggle="toggle('remote', $event)">
    <summary><h4>
      <i>☁</i>Remote <b>{{ branches.remote.length }}</b>
      <button v-if="!remoteForm" title="Tambah remote" @click.stop.prevent="remoteForm = { name: remotes.length ? '' : 'origin', url: '' }">+ Tambah</button>
    </h4></summary>
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
        v-for="b in branches.remote.filter(b => b.startsWith(r.name + '/') && hit(b))"
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
          <button title="Hapus branch di remote" @click="removeRemoteBranch(b)">✕</button>
        </span>
      </div>
    </template>
    </details>
    <details v-if="tags.length" :open="open.tag" @toggle="toggle('tag', $event)">
      <summary><h4><i>◆</i>Tag <b>{{ tags.length }}</b></h4></summary>
      <div v-for="t in tags.filter(t => hit(t.name))" :key="t.name" class="branch" @click="jumpTo(t.commit)">
        <span class="name" :title="t.name">◆ {{ t.name }}</span>
        <span class="actions">
          <button :title="'Push tag ke ' + firstRemote()" @click.stop="pushTag(t)">↑</button>
          <button title="Hapus tag" @click.stop="deleteTag(t)">✕</button>
        </span>
      </div>
    </details>
    <details v-if="stashes.length" :open="open.stash" @toggle="toggle('stash', $event)">
      <summary><h4><i>⊟</i>Stash <b>{{ stashes.length }}</b></h4></summary>
      <div v-for="s in stashes" :key="s.ref" class="branch">
        <span class="name" :title="s.ref + ': ' + s.subject">{{ s.subject }}</span>
        <span class="actions">
          <button title="Apply" @click="stashDo('apply', s)">↧</button>
          <button title="Pop" @click="stashDo('pop', s)">⊟</button>
          <button title="Hapus" @click="stashDo('drop', s)">✕</button>
        </span>
      </div>
    </details>
    <button v-if="flowKind" class="primary" @click="flowFinish">Finish {{ head }}</button>
    <details class="gitflow" :open="open.flow" @toggle="toggle('flow', $event)">
      <summary><h4><i>⑂</i>Gitflow</h4></summary>
      <form class="remote-form" @submit.prevent="startFlow">
        <select v-model="flow.kind" aria-label="Jenis branch gitflow"><option v-for="k in FLOW" :key="k" :value="k">{{ k }}</option></select>
        <input v-model="flow.name" placeholder="Nama (misalnya login-page)" />
        <button class="primary" :disabled="!flow.name.trim()">Start</button>
      </form>
    </details>
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
