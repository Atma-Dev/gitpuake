<script>
export const MODES = {
  merge: { label: 'Pull (merge)', args: ['--no-rebase'] },
  rebase: { label: 'Pull (rebase)', args: ['--rebase', '--autostash'] },
  ff: { label: 'Fast-forward saja', args: ['--ff-only'] },
}
</script>

<script setup>
// Pull button with a mode caret; picking a mode pulls with it and makes it the default.
import { ref } from 'vue'

defineProps({ disabled: Boolean, behind: Number })
const emit = defineEmits(['pull'])
const mode = ref(MODES[localStorage.getItem('pullMode')] ? localStorage.getItem('pullMode') : 'merge')
function pick(e) {
  localStorage.setItem('pullMode', (mode.value = e.target.value))
  emit('pull', MODES[mode.value].args)
}
</script>

<template>
  <span class="pull-split">
    <button :disabled="disabled" :title="MODES[mode].label" @click="emit('pull', MODES[mode].args)">
      <i>↓</i>Pull<small v-if="mode !== 'merge'"> · {{ mode }}</small><b v-if="behind" class="count">{{ behind }}</b>
    </button>
    <select :value="mode" :disabled="disabled" aria-label="Cara pull" title="Pilih cara pull" @change="pick">
      <option v-for="(m, k) in MODES" :key="k" :value="k">{{ m.label }}</option>
    </select>
  </span>
</template>

<style>
.pull-split { display: inline-flex; }
.pull-split button { border-radius: 4px 0 0 4px; }
.pull-split small { color: var(--dim); }
.pull-split select {
  width: 22px;
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid var(--line);
  border-left: 0;
  border-radius: 0 4px 4px 0;
  color: transparent;
  cursor: pointer;
  background: var(--bg3) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23849282' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat center;
}
.pull-split select:hover:not(:disabled) { border-color: var(--accent); }
.pull-split option { color: var(--fg); background: var(--bg2); }
</style>
