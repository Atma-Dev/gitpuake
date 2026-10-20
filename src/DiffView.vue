<script setup>
import { split } from './diff.js'

// `selectable`: changed lines can be clicked to pick them (each hunk needs a `picked` Set).
defineProps({ d: Object, mode: String, selectable: Boolean })
const SIGN = { add: '+', del: '-', ctx: ' ' }

function toggle(h, row, on) {
  if (!on || !row || row.type === 'ctx') return
  h.picked.has(row.ri) ? h.picked.delete(row.ri) : h.picked.add(row.ri)
}
const cls = (h, row, on) => [row?.type ?? 'none', { pickable: on && row && row.type !== 'ctx', picked: on && h.picked?.has(row?.ri) }]
</script>

<template>
  <p v-if="!d.hunks.length" class="no-diff">{{ d.header.filter(l => l.startsWith('Binary')).join('\n') || 'Tidak ada perubahan' }}</p>
  <section v-for="(h, i) in d.hunks" :key="i" class="hunk">
    <div class="hunk-head">
      <code>{{ h.header }}</code>
      <span class="hunk-actions"><slot name="actions" :h="h" /></span>
    </div>
    <table v-if="mode === 'split'" class="lines split">
      <tr v-for="([l, r], k) in split(h.rows)" :key="k">
        <td class="ln">{{ l?.o }}</td>
        <td class="src" :class="cls(h, l, selectable)" @click="toggle(h, l, selectable)">{{ l?.text }}</td>
        <td class="ln">{{ r?.n }}</td>
        <td class="src" :class="cls(h, r, selectable)" @click="toggle(h, r, selectable)">{{ r?.text }}</td>
      </tr>
    </table>
    <table v-else class="lines">
      <tr v-for="(row, k) in h.rows" :key="k">
        <td class="ln">{{ row.o }}</td>
        <td class="ln">{{ row.n }}</td>
        <td class="src" :class="cls(h, row, selectable)" @click="toggle(h, row, selectable)">{{ SIGN[row.type] }}{{ row.text }}</td>
      </tr>
    </table>
  </section>
</template>
