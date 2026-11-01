<script setup>
// File list; in tree mode files are sorted and grouped under folder headings. The slot draws one file.
import { computed } from 'vue'
import { settings } from './settings.js'

const props = defineProps({ files: Array })
const rows = computed(() => {
  if (!settings.treeView) return props.files.map(f => ({ f, name: f.path }))
  let last
  return [...props.files].sort((a, b) => a.path.localeCompare(b.path)).map(f => {
    const i = f.path.lastIndexOf('/')
    const dir = i < 0 ? '' : f.path.slice(0, i)
    const row = { f, name: f.path.slice(i + 1), dir: dir === last ? null : dir }
    last = dir
    return row
  })
})
</script>

<template>
  <template v-for="r in rows" :key="r.f.path">
    <div v-if="r.dir !== undefined && r.dir !== null" class="dirhead">▾ {{ r.dir || '/' }}</div>
    <slot :f="r.f" :label="r.name" />
  </template>
</template>

<style>
.dirhead { margin: 6px 0 2px; color: var(--dim); font-size: 11px; }
</style>
