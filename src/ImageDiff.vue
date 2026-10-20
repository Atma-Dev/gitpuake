<script>
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' }
const ext = p => p.split('.').pop().toLowerCase()
export const isImage = p => ext(p) in MIME
</script>

<script setup>
import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'

// Old vs new image of a changed file. `kind` is commit | staged | unstaged, like the text diff.
const props = defineProps({ repo: String, file: Object, kind: String, hash: String })
const sides = ref([])

// Where each version lives: a git rev (`''` = index), working tree (rev undefined), or null when it does not exist.
function sources({ code, path, from = path }, kind, hash) {
  if (kind === 'commit') return [code === 'A' ? null : { rev: hash + '^', path: from }, code === 'D' ? null : { rev: hash, path }]
  if (kind === 'staged') return [code === 'A' ? null : { rev: 'HEAD', path }, code === 'D' ? null : { rev: '', path }]
  return [code === 'U' ? null : { rev: '', path }, code === 'D' ? null : { path }]
}

let seq = 0
watch(
  () => [props.file, props.kind, props.hash],
  async () => {
    const mine = ++seq
    const out = await Promise.all(
      sources(props.file, props.kind, props.hash).map(async s => {
        if (!s) return { missing: true }
        try {
          const b64 = await invoke('file_base64', { repo: props.repo, path: s.path, rev: s.rev })
          return { src: `data:${MIME[ext(s.path)]};base64,${b64}`, kb: Math.ceil((b64.length * 3) / 4 / 1024) }
        } catch (e) {
          return { error: String(e) }
        }
      }),
    )
    if (mine === seq) sides.value = out
  },
  { immediate: true },
)
const dims = (s, e) => (s.dims = `${e.target.naturalWidth}×${e.target.naturalHeight}`)
</script>

<template>
  <div class="image-diff">
    <figure v-for="(s, i) in sides" :key="i" :class="i ? 'add' : 'del'">
      <figcaption>
        {{ i ? 'Sesudah' : 'Sebelum' }}<small v-if="s.src"> · {{ s.dims ? s.dims + ' · ' : '' }}{{ s.kb }} KB</small>
      </figcaption>
      <!-- svg in <img> cannot run scripts -->
      <img v-if="s.src" :src="s.src" alt="" @load="dims(s, $event)" />
      <p v-else class="no-diff">{{ s.missing ? (i ? 'File dihapus' : 'File baru') : s.error }}</p>
    </figure>
  </div>
</template>

<style>
.image-diff { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px; }
.image-diff figure { margin: 0; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.image-diff figcaption { padding: 4px 8px; background: var(--bg2); color: var(--dim); font-size: 12px; }
.image-diff .del figcaption { box-shadow: inset 3px 0 #f2665b; }
.image-diff .add figcaption { box-shadow: inset 3px 0 #8ee05b; }
.image-diff img {
  display: block;
  max-width: 100%;
  margin: 10px auto;
  /* checkerboard so transparent pixels are visible */
  background: repeating-conic-gradient(#ffffff14 0 25%, transparent 0 50%) 0 0 / 16px 16px;
}
</style>
