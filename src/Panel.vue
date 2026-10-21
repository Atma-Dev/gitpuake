<script setup>
// Right panel: working tree and commit box, a compare, or commit details.
import { amend, busy, commit, commitFiles, commits, compare, discard, discardAll, identity, msg, openMerge, path, resolve, selected, selectedCommit, showDiff, showSettings, sig, stage, stageAll, stashFile, status, unstage, unstageAll } from './store.js'
import { avatar } from './identity.js'
import { settings } from './settings.js'
</script>

<template>
  <aside class="panel">
    <template v-if="selected === 'WIP'">
      <div v-if="status.conflicts.length" class="section conflicts">
        <h4>Conflict ({{ status.conflicts.length }})</h4>
        <div v-for="f in status.conflicts" :key="f.path" class="file" title="Buka editor conflict" @click="openMerge(f)">
          <span class="code C">!</span>
          <span class="name" :title="f.path">{{ f.path }}</span>
          <button @click.stop="resolve(f.path)">Tandai selesai</button>
        </div>
      </div>
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
          <button title="Stash file ini saja" @click.stop="stashFile(f)">⊞</button>
          <button @click.stop="stage(f.path)">Stage</button>
        </div>
      </div>
      <div class="section">
        <h4>Staged ({{ status.staged.length }}) <button v-if="status.staged.length" @click="unstageAll">Unstage all</button></h4>
        <div v-for="f in status.staged" :key="f.path" class="file" @click="showDiff(f, 'staged')">
          <span class="code" :class="f.code">{{ f.code }}</span>
          <span class="name" :title="f.path">{{ f.path }}</span>
          <button title="Stash file ini saja (staged dan unstaged)" @click.stop="stashFile(f)">⊞</button>
          <button @click.stop="unstage(f.path)">Unstage</button>
        </div>
      </div>
      <div class="commit-box">
        <label class="amend"><input v-model="amend" type="checkbox" :disabled="!commits.length" /> Amend commit terakhir</label>
        <textarea v-model="msg" placeholder="Commit message (Ctrl+Enter)" @keydown.ctrl.enter="commit" />
        <button class="who-am-i" title="Ganti identitas di Pengaturan" @click="showSettings = true">
          <template v-if="identity?.name && identity?.email">Commit sebagai <b>{{ identity.name }}</b> &lt;{{ identity.email }}&gt;</template>
          <template v-else-if="identity">Identitas git belum diatur, atur dulu</template>
        </button>
        <button class="primary" :disabled="!msg.trim() || (!amend && !status.staged.length) || !!busy" @click="commit">
          {{ amend ? 'Amend commit' : `Commit ${status.staged.length} file` }}
        </button>
      </div>
    </template>
    <template v-else-if="compare">
      <div class="section">
        <h3>Bandingkan commit</h3>
        <p class="meta">
          <code>{{ compare.a.slice(0, 7) }}</code> → <code>{{ compare.b.slice(0, 7) }}</code><br />
          Esc atau klik commit lain untuk selesai
        </p>
        <h4>File berubah ({{ compare.files.length }})</h4>
        <div v-for="f in compare.files" :key="f.path" class="file" @click="showDiff(f, 'compare')">
          <span class="code" :class="f.code">{{ f.code }}</span>
          <span class="name" :title="f.path">{{ f.path }}</span>
        </div>
      </div>
    </template>
    <template v-else-if="selectedCommit">
      <div class="section">
        <h3>{{ selectedCommit.subject }}</h3>
        <p class="meta">
          <code>{{ selectedCommit.hash.slice(0, 10) }}</code>
          <span v-if="sig" class="sig" :class="sig.tone" :title="sig.signer ? 'Ditandatangani oleh ' + sig.signer : ''">{{ sig.code === 'G' ? '✓ ' : '' }}{{ sig.label }}</span><br />
          <img v-if="settings.avatars && avatar(selectedCommit.email)" :src="avatar(selectedCommit.email)" class="avatar" alt="" loading="lazy" />
          <span :title="selectedCommit.email">{{ selectedCommit.author }}</span> · {{ new Date(selectedCommit.time * 1000).toLocaleString() }}
        </p>
        <h4>File ({{ commitFiles.length }})</h4>
        <div v-for="f in commitFiles" :key="f.path" class="file" @click="showDiff(f, 'commit')">
          <span class="code" :class="f.code">{{ f.code }}</span>
          <span class="name" :title="f.path">{{ f.path }}</span>
        </div>
      </div>
    </template>
  </aside>
</template>
