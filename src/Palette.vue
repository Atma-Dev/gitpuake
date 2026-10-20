<script setup>
import { ref, computed, nextTick, watch } from 'vue'

// Command palette: `commands` is [{ label, keys?, run }]; every typed word must appear in the label.
const props = defineProps({ commands: Array })
const emit = defineEmits(['close'])
const q = ref('')
const at = ref(0)
const input = ref(null)
const list = ref(null)

const shown = computed(() => {
  const words = q.value.toLowerCase().split(/\s+/).filter(Boolean)
  return props.commands.filter(c => words.every(w => c.label.toLowerCase().includes(w))).slice(0, 50)
})
watch(q, () => (at.value = 0))
watch(at, i => nextTick(() => list.value?.children[i]?.scrollIntoView({ block: 'nearest' })))
nextTick(() => input.value?.focus())

function go(c) {
  if (!c) return
  emit('close')
  c.run()
}
function key(e) {
  const n = shown.value.length
  if (e.key === 'ArrowDown') at.value = (at.value + 1) % n
  else if (e.key === 'ArrowUp') at.value = (at.value - 1 + n) % n
  else if (e.key === 'Enter') go(shown.value[at.value])
  else if (e.key === 'Escape') emit('close')
  else return
  e.preventDefault()
}
</script>

<template>
  <div class="dialog-backdrop palette-backdrop" @click.self="emit('close')">
    <div class="palette" role="dialog" aria-label="Perintah">
      <input ref="input" v-model="q" placeholder="Ketik perintah atau nama branch…" @keydown="key" />
      <ul ref="list" role="listbox">
        <li v-for="(c, i) in shown" :key="c.label" role="option" :aria-selected="i === at" :class="{ on: i === at }" @mousemove="at = i" @click="go(c)">
          <span>{{ c.label }}</span><kbd v-if="c.keys">{{ c.keys }}</kbd>
        </li>
        <li v-if="!shown.length" class="empty">Tidak ada perintah yang cocok</li>
      </ul>
    </div>
  </div>
</template>

<style>
.palette-backdrop { align-items: flex-start; padding-top: 12vh; }
.palette { width: min(560px, 92vw); background: var(--bg2); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5); overflow: hidden; }
.palette input { width: 100%; box-sizing: border-box; padding: 12px 14px; font: inherit; font-size: 14px; color: var(--fg); background: var(--bg3); border: 0; border-bottom: 1px solid var(--line); outline: none; }
.palette ul { list-style: none; margin: 0; padding: 4px; max-height: 50vh; overflow-y: auto; }
.palette li { display: flex; justify-content: space-between; gap: 12px; padding: 7px 10px; border-radius: 5px; cursor: pointer; font-size: 13px; }
.palette li.on { background: var(--bg3); color: var(--bone); box-shadow: inset 2px 0 var(--accent); }
.palette li.empty { color: var(--dim); cursor: default; }
.palette kbd { font: inherit; font-size: 11px; color: var(--dim); }
</style>
