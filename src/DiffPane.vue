<script setup>
// Diff of one file, with hunk/line staging.
import DiffView from './DiffView.vue'
import ImageDiff, { isImage } from './ImageDiff.vue'
import { applyHunk, commit, compare, diff, diffMode, discardHunk, head, hunkable, ignoreWs, openBlame, openHistory, path, repo, selected, setDiffMode, stage, toggleWords, toggleWs, wordsOn } from './store.js'
</script>

<template>
  <div class="diff">
    <div class="diff-head">
      <b>{{ diff.file.path }}</b>
      <small>{{ { commit: 'commit ' + selected.slice(0, 7), staged: 'staged', unstaged: 'unstaged', compare: compare && compare.a.slice(0, 7) + '..' + compare.b.slice(0, 7) }[diff.kind] }}</small>
      <small v-if="hunkable" class="hint-pick">klik baris +/− untuk memilih baris tertentu</small>
      <small v-else-if="diff.ws && diff.kind !== 'commit'" class="hint-pick">matikan "Abaikan spasi" untuk stage per hunk</small>
      <span class="spacer" />
      <button v-if="diff.file.code !== 'U'" @click="openHistory(diff.file.path)">Riwayat</button>
      <button v-if="diff.file.code !== 'D'" @click="openBlame(diff.file.path, diff.kind === 'compare' ? compare.b : diff.kind === 'commit' ? selected : '')">Blame</button>
      <button :class="{ on: ignoreWs }" class="toggle" title="git diff -w, hanya untuk tampilan" @click="toggleWs">Abaikan spasi</button>
      <button :class="{ on: wordsOn }" class="toggle" title="Tandai kata yang berubah (menggantikan warna sintaks di baris itu)" @click="toggleWords">Beda kata</button>
      <span class="seg">
        <button :class="{ on: diffMode === 'split' }" @click="setDiffMode('split')">Split</button>
        <button :class="{ on: diffMode === 'unified' }" @click="setDiffMode('unified')">Unified</button>
      </span>
      <button @click="diff = null">✕ Tutup</button>
    </div>
    <ImageDiff v-if="isImage(diff.file.path)" :repo="repo" :file="diff.file" :kind="diff.kind" :hash="diff.kind === 'compare' ? compare.b : selected" :base="compare?.a" />
    <DiffView v-else :d="diff.d" :mode="diffMode" :selectable="hunkable" :words="wordsOn">
      <template #actions="{ h }">
        <template v-if="hunkable">
          <template v-if="diff.kind === 'unstaged'">
            <button @click="discardHunk(h)">Discard {{ h.picked.size ? h.picked.size + ' baris' : 'hunk' }}</button>
            <button class="primary" @click="applyHunk('Stage', h, ['--cached'])">Stage {{ h.picked.size ? h.picked.size + ' baris' : 'hunk' }}</button>
          </template>
          <button v-else @click="applyHunk('Unstage', h, ['--cached', '--reverse'])">Unstage {{ h.picked.size ? h.picked.size + ' baris' : 'hunk' }}</button>
        </template>
      </template>
    </DiffView>
  </div>
</template>
