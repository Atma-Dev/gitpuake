<script setup>
// Conflict editor for one file.
import { busy, conflictCount, diff, fold, head, merge, mergeView, path, saveMerge, toggleManual, unresolved } from './store.js'
</script>

<template>
        <div class="merge">
          <div class="diff-head">
            <b>Selesaikan conflict</b>
            <span class="path">{{ mergeView.path }}</span>
            <small v-if="mergeView.manual === null">{{ unresolved ? unresolved + ' dari ' + conflictCount + ' belum dipilih' : 'semua sudah dipilih' }}</small>
            <span class="spacer" />
            <button @click="toggleManual">{{ mergeView.manual === null ? 'Edit manual' : 'Kembali ke pilihan' }}</button>
            <button @click="mergeView = null">Batal</button>
            <button class="primary" :disabled="(mergeView.manual === null && unresolved > 0) || !!busy" @click="saveMerge">Simpan & tandai selesai</button>
          </div>
          <textarea v-if="mergeView.manual !== null" v-model="mergeView.manual" class="merge-manual" spellcheck="false" aria-label="Isi file hasil merge" />
          <div v-else class="merge-body">
            <template v-for="(sg, i) in mergeView.segs" :key="i">
              <pre v-if="sg.lines" class="merge-common">{{ fold(sg.lines).head.join('\n') }}<template v-if="fold(sg.lines).hidden">
  <span class="folded">… {{ fold(sg.lines).hidden }} baris sama di kedua versi …</span>
  {{ fold(sg.lines).tail.join('\n') }}</template></pre>
              <section v-else class="conflict" :class="{ done: sg.choice }">
                <div class="sides">
                  <div class="side" :class="{ chosen: ['ours', 'both', 'both-rev'].includes(sg.choice), dropped: sg.choice === 'theirs' }">
                    <header>
                      <span>Versi <b>{{ sg.oursLabel || 'kamu' }}</b></span>
                      <button :class="{ primary: sg.choice === 'ours' }" @click="sg.choice = 'ours'">Pakai ini</button>
                    </header>
                    <pre>{{ sg.ours.join('\n') || '(kosong)' }}</pre>
                  </div>
                  <div class="side" :class="{ chosen: ['theirs', 'both', 'both-rev'].includes(sg.choice), dropped: sg.choice === 'ours' }">
                    <header>
                      <span>Versi <b>{{ sg.theirsLabel || 'masuk' }}</b></span>
                      <button :class="{ primary: sg.choice === 'theirs' }" @click="sg.choice = 'theirs'">Pakai ini</button>
                    </header>
                    <pre>{{ sg.theirs.join('\n') || '(kosong)' }}</pre>
                  </div>
                </div>
                <div class="conflict-foot">
                  <button :class="{ primary: sg.choice === 'both' }" @click="sg.choice = 'both'">Pakai keduanya, kiri dulu</button>
                  <button :class="{ primary: sg.choice === 'both-rev' }" @click="sg.choice = 'both-rev'">Pakai keduanya, kanan dulu</button>
                  <button v-if="sg.choice" @click="sg.choice = null">Batalkan pilihan</button>
                  <details v-if="sg.base" class="base">
                    <summary>Lihat versi asal</summary>
                    <pre>{{ sg.base.join('\n') || '(kosong)' }}</pre>
                  </details>
                </div>
              </section>
            </template>
          </div>
        </div>
</template>
