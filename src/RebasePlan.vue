<script setup>
// Interactive rebase editor.
import { ACTIONS } from './rebase.js'
import { busy, commit, diff, error, foldTarget, head, moveItem, msg, plan, planError, startRebase, undo } from './store.js'
</script>

<template>
  <div class="rebase">
    <div class="diff-head">
      <b>Interactive rebase</b>
      <small>{{ plan.items.length }} commit di atas {{ plan.base.slice(0, 7) }}, paling atas yang terbaru</small>
      <span class="spacer" />
      <button @click="plan = null">Batal</button>
      <button class="primary" :disabled="!!planError || !!busy" @click="startRebase">Mulai rebase</button>
    </div>
    <p v-if="planError" class="plan-error">{{ planError }}</p>
    <ol class="plan">
      <li
        v-for="(it, i) in plan.items"
        :key="it.hash"
        :class="it.action"
        draggable="true"
        @dragstart="plan.drag = i"
        @dragover.prevent
        @drop="moveItem(plan.drag, i)"
      >
        <span class="grip" title="Seret untuk mengubah urutan">⠿</span>
        <select v-model="it.action" :aria-label="'Aksi untuk ' + it.subject">
          <option v-for="a in ACTIONS" :key="a" :value="a">{{ a }}</option>
        </select>
        <code>{{ it.hash.slice(0, 7) }}</code>
        <input v-if="it.action === 'reword'" v-model="it.msg" class="msg" aria-label="Judul commit baru" />
        <span v-else class="subj">{{ it.subject }}</span>
        <small v-if="it.action === 'squash' || it.action === 'fixup'" class="into">masuk ke {{ foldTarget(i) ?? '—' }}</small>
        <span class="move">
          <button :disabled="i === 0" title="Naikkan" @click="moveItem(i, i - 1)">↑</button>
          <button :disabled="i === plan.items.length - 1" title="Turunkan" @click="moveItem(i, i + 1)">↓</button>
        </span>
      </li>
    </ol>
    <p class="plan-help">
      <b>squash</b> menggabungkan commit ke commit di bawahnya dan menyimpan kedua pesannya. <b>fixup</b> juga menggabung,
      tapi pesannya dibuang. <b>reword</b> hanya mengganti judul commit. Hasil rebase bisa di-undo.
    </p>
  </div>
</template>
