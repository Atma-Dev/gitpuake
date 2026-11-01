<script setup>
// Built-in terminal: runs one line at a time in the repo folder (no pty, see lib.rs), then refreshes the app.
import { nextTick, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { refresh, repo, showTerminal } from './store.js'

const line = ref('')
const log = ref([]) // [{ cmd, out, running }]
const past = ref([])
const at = ref(-1)
const box = ref(null)
const input = ref(null)
const MAX = 200000

watch(showTerminal, on => on && nextTick(() => input.value?.focus()), { immediate: true })

async function go() {
  const cmd = line.value.trim()
  if (!cmd) return
  line.value = ''
  past.value.push(cmd)
  at.value = -1
  const entry = { cmd, out: '', running: true }
  log.value.push(entry)
  log.value = log.value.slice(-50)
  const e = log.value.at(-1)
  try {
    e.out = (await invoke('shell', { repo: repo.value, line: cmd })).slice(-MAX)
  } catch (err) {
    e.out = String(err)
  }
  e.running = false
  nextTick(() => box.value && (box.value.scrollTop = box.value.scrollHeight))
  refresh()
}
function hist(e) {
  const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
  if (!d || !past.value.length) return
  e.preventDefault()
  at.value = Math.min(Math.max((at.value < 0 ? past.value.length : at.value) + d, 0), past.value.length)
  line.value = past.value[at.value] ?? ''
}
</script>

<template>
  <section class="terminal" aria-label="Terminal" @keydown.esc="showTerminal = false">
    <header>
      <b>Terminal</b><small>{{ repo }}</small>
      <button aria-label="Tutup terminal" @click="showTerminal = false">✕</button>
    </header>
    <div ref="box" class="term-log">
      <div v-for="(e, i) in log" :key="i">
        <div class="term-cmd">$ {{ e.cmd }}</div>
        <pre v-if="e.out">{{ e.out }}</pre>
        <small v-if="e.running" class="busy">berjalan…</small>
      </div>
    </div>
    <form @submit.prevent="go">
      <span>$</span>
      <input ref="input" v-model="line" placeholder="perintah shell di folder repo" spellcheck="false" autocomplete="off" @keydown="hist" />
    </form>
  </section>
</template>

<style>
.terminal { position: fixed; left: 0; right: 0; bottom: 22px; height: 300px; z-index: 15; display: flex; flex-direction: column; background: var(--bg0); border-top: 2px solid var(--accent); }
.terminal header { display: flex; align-items: center; gap: 10px; padding: 4px 10px; background: var(--bg2); }
.terminal header small { color: var(--dim); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.term-log { flex: 1; overflow: auto; padding: 6px 10px; font: 12px/1.45 ui-monospace, Menlo, monospace; }
.term-log pre { margin: 0 0 6px; white-space: pre-wrap; word-break: break-all; }
.term-cmd { color: var(--accent); }
.terminal form { display: flex; gap: 6px; padding: 6px 10px; border-top: 1px solid var(--line); font-family: ui-monospace, Menlo, monospace; }
.terminal form input { flex: 1; font: inherit; }
</style>
