<script setup>
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

defineProps({ recent: Array })
const emit = defineEmits(['open', 'forget', 'error'])

const cloneUrl = ref('')
const showClone = ref(false)
const busy = ref('')

const pick = async () => {
  const dir = await open({ directory: true, title: 'Pilih repository' })
  if (dir) emit('open', dir)
}

async function clone() {
  const url = cloneUrl.value.trim()
  if (!url) return
  const parent = await open({ directory: true, title: 'Clone ke folder mana?' })
  if (!parent) return
  const name = url.replace(/\/+$/, '').split(/[/:]/).at(-1).replace(/\.git$/, '')
  busy.value = 'clone'
  try {
    await invoke('git', { repo: parent, args: ['clone', '--', url, name] })
    emit('open', `${parent}/${name}`)
  } catch (e) {
    emit('error', String(e))
  }
  busy.value = ''
}

async function init() {
  const dir = await open({ directory: true, title: 'Folder untuk repository baru' })
  if (!dir) return
  try {
    await invoke('git', { repo: dir, args: ['init'] })
    emit('open', dir)
  } catch (e) {
    emit('error', String(e))
  }
}

const SCUTES = [362, 380, 396, 410, 424, 436]
</script>

<template>
  <div class="welcome">
    <svg class="scene" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="w-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0a120e" />
          <stop offset="1" stop-color="#1a2a21" />
        </linearGradient>
        <linearGradient id="w-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#11211b" />
          <stop offset="1" stop-color="#0a120e" />
        </linearGradient>
        <radialGradient id="w-iris" cx="0.4" cy="0.4" r="0.7">
          <stop offset="0" stop-color="#ffe08a" />
          <stop offset="0.55" stop-color="#f0a52a" />
          <stop offset="1" stop-color="#9c4a0c" />
        </radialGradient>
        <filter id="w-blur" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="8" /></filter>
      </defs>
      <rect width="1200" height="292" fill="url(#w-sky)" />
      <circle cx="930" cy="110" r="90" fill="#d9d2a4" opacity="0.06" filter="url(#w-blur)" />
      <circle cx="930" cy="110" r="56" fill="#d9d2a4" opacity="0.1" />
      <!-- mangrove line on the far bank -->
      <path
        d="M0 292V236C40 214 70 238 110 214C150 190 180 226 226 220C262 196 300 236 340 226C380 206 420 232 460 228C500 222 520 246 560 240C610 218 650 250 700 238C740 214 780 232 820 226C860 204 900 236 950 228C990 210 1030 238 1080 226C1120 214 1160 236 1200 228V292Z"
        fill="#0c1611"
      />
      <rect y="290" width="1200" height="110" fill="url(#w-water)" />
      <g fill="#d9d2a4" opacity="0.08">
        <rect x="900" y="304" width="60" height="3" rx="1.5" />
        <rect x="912" y="318" width="38" height="3" rx="1.5" />
        <rect x="920" y="334" width="24" height="3" rx="1.5" />
      </g>

      <!-- puake: only eyes, snout and back break the surface -->
      <g class="croc" transform="translate(642 292) scale(1.7) translate(-642 -292)">
        <path v-for="x in SCUTES" :key="x" :d="`M${x - 9} 292Q${x} ${278 - (x % 3) * 2} ${x + 9} 292Z`" fill="#1d2a18" stroke="#0a120e" stroke-width="2" />
        <path d="M450 292C470 284 500 280 520 279C528 258 572 252 588 274C640 276 720 280 790 282C798 270 818 270 824 284C830 288 832 291 834 292Z" fill="#22301c" stroke="#0a120e" stroke-width="2.5" stroke-linejoin="round" />
        <path d="M528 262C542 254 566 254 584 266" fill="none" stroke="#0a120e" stroke-width="4" stroke-linecap="round" />
        <ellipse cx="808" cy="279" rx="3.5" ry="2" fill="#0a120e" />
        <circle cx="556" cy="269" r="16" fill="#ff6a12" opacity="0.55" filter="url(#w-blur)" />
        <ellipse cx="556" cy="269" rx="10" ry="7" fill="url(#w-iris)" stroke="#0a120e" stroke-width="2" />
        <ellipse cx="556.5" cy="269" rx="1.8" ry="6.5" fill="#0c0602" />
        <ellipse class="lid" cx="556" cy="269" rx="11" ry="8" fill="#22301c" />
        <!-- reflection -->
        <path d="M450 293C500 304 560 310 620 306C700 302 780 298 834 293Z" fill="#22301c" opacity="0.35" />
        <ellipse cx="556" cy="306" rx="26" ry="3" fill="#ff7a1a" opacity="0.35" filter="url(#w-blur)" />
        <g fill="none" stroke="#2f5545" stroke-width="1.5" stroke-linecap="round" opacity="0.6">
          <path d="M420 299C500 306 760 307 870 299" />
          <path d="M390 306C500 314 800 315 910 305" opacity="0.6" />
        </g>
      </g>
      <!-- another one, far off -->
      <g fill="#ff8a2a">
        <circle cx="70" cy="289" r="2.2" opacity="0.7" />
        <circle cx="84" cy="289" r="2.2" opacity="0.7" />
        <circle cx="77" cy="289" r="10" opacity="0.15" filter="url(#w-blur)" />
      </g>
    </svg>

    <div class="content">
      <section class="intro">
        <h1>gitpuake</h1>
        <p class="tagline">Ia menunggu di dasar sungai, menjaga setiap commit. Pilih repository yang mau dijaga.</p>
        <div class="actions">
          <button class="primary" @click="pick">Buka repository</button>
          <button :class="{ on: showClone }" @click="showClone = !showClone">Clone dari URL</button>
          <button @click="init">Buat repository baru</button>
        </div>
        <form v-if="showClone" class="clone" @submit.prevent="clone">
          <input v-model="cloneUrl" placeholder="git@github.com:user/repo.git" :disabled="!!busy" />
          <button class="primary" :disabled="!cloneUrl.trim() || !!busy">{{ busy ? 'Cloning…' : 'Pilih folder & clone' }}</button>
        </form>
      </section>

      <section class="recent">
        <h2>Terakhir dibuka</h2>
        <p v-if="!recent.length" class="empty">Belum ada. Repository yang kamu buka akan muncul di sini.</p>
        <ul v-else>
          <li v-for="r in recent" :key="r">
            <button class="repo-link" @click="emit('open', r)">
              <b>{{ r.split('/').at(-1) }}</b>
              <span>{{ r }}</span>
            </button>
            <button class="forget" title="Hapus dari daftar" @click="emit('forget', r)">✕</button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  height: 100vh;
  display: grid;
  grid-template-rows: minmax(220px, 48vh) 1fr;
  background: #0a120e;
  overflow: auto;
}
.scene { width: 100%; height: 100%; display: block; }
.lid {
  transform-box: fill-box;
  transform-origin: center;
  transform: scaleY(0);
  animation: blink 7s infinite 2s;
}
@keyframes blink {
  0%, 95%, 100% { transform: scaleY(0); }
  97% { transform: scaleY(1); }
}
@media (prefers-reduced-motion: reduce) {
  .lid { animation: none; }
}

.content {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 56px;
  width: min(1040px, 100% - 32px);
  margin: 0 auto;
  padding: 8px 0 48px;
}
@media (max-width: 760px) {
  .content { grid-template-columns: 1fr; gap: 32px; }
}
h1 {
  margin: 0;
  font: 700 76px/1 'Grenze Gotisch', serif;
  color: var(--bone);
  letter-spacing: 0.01em;
  text-shadow: 0 2px 24px #ff6a1222;
}
.tagline { margin: 12px 0 28px; max-width: 46ch; color: var(--dim); font-size: 15px; line-height: 1.55; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; }
.actions button { padding: 9px 16px; font-size: 14px; }
.actions button.on { border-color: var(--accent); }
.clone { display: flex; gap: 8px; margin-top: 14px; }
.clone input { flex: 1; padding: 8px 10px; }
.clone button { white-space: nowrap; }

h2 { margin: 6px 0 12px; font-size: 15px; font-weight: 600; color: var(--fg); }
.empty { color: var(--dim); }
ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
li { display: flex; align-items: center; border-bottom: 1px solid var(--line); }
.repo-link {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 9px 4px;
  border: 0;
  background: none;
  text-align: left;
}
.repo-link b { font-size: 14px; color: var(--bone); }
.repo-link span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dim); font-size: 12px; }
.repo-link:hover b { color: var(--accent); }
.forget { border: 0; background: none; color: var(--dim); visibility: hidden; }
li:hover .forget, .forget:focus-visible { visibility: visible; }
</style>
