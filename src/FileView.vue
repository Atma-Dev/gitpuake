<script setup>
// File history and blame.
import DiffView from './DiffView.vue'
import { ago, avatarColor, commit, diff, diffMode, fileView, head, jumpTo, path, pickHistory, setDiffMode, wordsOn } from './store.js'
</script>

<template>
  <div class="fileview">
    <div class="diff-head">
      <b>{{ fileView.type === 'history' ? 'Riwayat' : 'Blame' }}</b>
      <span class="path">{{ fileView.path }}</span>
      <small v-if="fileView.type === 'blame'">{{ fileView.rev ? 'di ' + fileView.rev.slice(0, 7) : 'versi working tree' }}</small>
      <span class="spacer" />
      <span v-if="fileView.type === 'history'" class="seg">
        <button :class="{ on: diffMode === 'split' }" @click="setDiffMode('split')">Split</button>
        <button :class="{ on: diffMode === 'unified' }" @click="setDiffMode('unified')">Unified</button>
      </span>
      <button @click="fileView = null">✕ Tutup</button>
    </div>
    <template v-if="fileView.type === 'history'">
      <ol class="file-log">
        <li v-for="it in fileView.items" :key="it.hash" :class="{ sel: fileView.sel === it.hash }">
          <button @click="pickHistory(it)">
            <code>{{ it.hash.slice(0, 7) }}</code>
            <span class="subj">{{ it.subject }}</span>
            <span class="who">{{ it.author }}</span>
            <span class="when">{{ ago(it.time) }}</span>
          </button>
        </li>
      </ol>
      <div class="file-log-diff">
        <DiffView v-if="fileView.d" :d="fileView.d" :mode="diffMode" :words="wordsOn" />
      </div>
    </template>
    <table v-else class="lines blame">
      <tr v-for="(l, i) in fileView.lines" :key="i" :class="{ first: i === 0 || fileView.lines[i - 1].hash !== l.hash }">
        <td class="who" :style="{ '--c': avatarColor(l.hash) }">
          <button v-if="i === 0 || fileView.lines[i - 1].hash !== l.hash" :title="l.summary" @click="jumpTo(l.hash)">
            <template v-if="/^0+$/.test(l.hash)">Belum di-commit</template>
            <template v-else><code>{{ l.hash.slice(0, 7) }}</code> {{ l.author }} · {{ ago(l.time) }}</template>
          </button>
        </td>
        <td class="ln">{{ l.n }}</td>
        <td class="src"><span v-if="l.html" v-html="l.html" /><template v-else>{{ l.text }}</template></td>
      </tr>
    </table>
  </div>
</template>
