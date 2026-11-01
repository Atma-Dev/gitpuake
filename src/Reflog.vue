<script setup>
// Reflog browser: every place HEAD has been, with a way back.
import { ref } from 'vue'
import { act, ago, g, goBack, jumpTo, resetBack } from './store.js'

const emit = defineEmits(['close'])
const rows = ref([])
g('reflog', '-n', '300', '--format=%H%x1f%gd%x1f%gs%x1f%ct').then(out => {
  rows.value = out.split('\n').filter(Boolean).map(l => {
    const [hash, ref, what, time] = l.split('\x1f')
    return { hash, ref, what, time: +time }
  })
})
const close = fn => () => { emit('close'); fn() }
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="dialog reflog" role="dialog" aria-label="Reflog">
      <h3>Reflog</h3>
      <p class="dialog-sub">Riwayat perpindahan HEAD. Cocok untuk menemukan commit setelah salah reset atau rebase.</p>
      <ul>
        <li v-for="r in rows" :key="r.ref">
          <code>{{ r.hash.slice(0, 7) }}</code>
          <span class="what" :title="r.what">{{ r.what }}</span>
          <small>{{ ago(r.time) }}</small>
          <button @click="close(() => jumpTo(r.hash))()">Lihat</button>
          <button title="Pindah ke commit ini (detached)" @click="close(() => act('Checkout', ['switch', '--detach', r.hash], p => () => goBack(p)))()">Checkout</button>
          <button title="Pindahkan branch aktif ke sini (reset --keep)" @click="close(() => act('Reset', ['reset', '--keep', r.hash], p => resetBack(p.hash)))()">Reset</button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style>
.reflog { width: min(820px, 94vw); max-height: 80vh; display: flex; flex-direction: column; }
.reflog ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
.reflog li { display: flex; align-items: center; gap: 10px; padding: 4px 0; border-bottom: 1px solid var(--line); }
.reflog .what { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reflog small { color: var(--dim); white-space: nowrap; }
</style>
