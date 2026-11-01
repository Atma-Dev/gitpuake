<script setup>
// Commit context menu and the branch drop menu.
import { act, bisecting, bisectMark, bisectStart, cherryPickMany, commit, multi, planFor, copyHash, dropDo, dropMenu, goBack, head, menu, merge, openRebase, rebaseOnto, resetBack, resetTo, savePatch, shortRef, submitMenu, vFocus, x } from './store.js'
</script>

<template>
  <div v-if="menu" class="menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
    <form v-if="menu.input" @submit.prevent="submitMenu">
      <input v-model="menu.value" v-focus :placeholder="menu.input === 'tag' ? 'Nama tag' : 'Nama branch baru'" />
    </form>
    <template v-else-if="multi.length > 1">
      <div class="menu-title">{{ multi.length }} commit dipilih</div>
      <button @click="cherryPickMany">Cherry-pick ke {{ head || 'HEAD' }}</button>
      <button @click="planFor('squash')">Squash jadi satu…</button>
      <button class="danger" @click="planFor('drop')">Drop…</button>
    </template>
    <template v-else>
      <div class="menu-title"><code>{{ menu.hash.slice(0, 7) }}</code></div>
      <button @click="act('Checkout', ['switch', '--detach', menu.hash], p => () => goBack(p))">Checkout commit ini</button>
      <button @click="menu.input = 'branch'">Buat branch di sini…</button>
      <button @click="menu.input = 'tag'">Buat tag di sini…</button>
      <hr />
      <button @click="act('Cherry-pick', ['cherry-pick', menu.hash], p => resetBack(p.hash))">Cherry-pick ke {{ head || 'HEAD' }}</button>
      <button @click="act('Revert', ['revert', '--no-edit', menu.hash], p => resetBack(p.hash))">Revert commit</button>
      <hr />
      <button @click="rebaseOnto(menu.hash)">Rebase {{ head || 'HEAD' }} ke sini</button>
      <button @click="planFor('reword')">Edit pesan commit…</button>
      <button @click="openRebase">Interactive rebase dari sini…</button>
      <hr />
      <button @click="resetTo('soft')">Reset {{ head || 'HEAD' }} ke sini · soft</button>
      <button @click="resetTo('mixed')">Reset {{ head || 'HEAD' }} ke sini · mixed</button>
      <button class="danger" @click="resetTo('hard')">Reset {{ head || 'HEAD' }} ke sini · hard</button>
      <hr />
      <template v-if="bisecting">
        <button @click="bisectMark('good', menu.hash)">Bisect: commit ini good</button>
        <button @click="bisectMark('bad', menu.hash)">Bisect: commit ini bad</button>
      </template>
      <button v-else @click="bisectStart(menu.hash)">Bisect: mulai, commit ini bad</button>
      <hr />
      <button @click="copyHash">Salin hash</button>
      <button @click="savePatch">Simpan sebagai patch…</button>
    </template>
  </div>
  <div v-if="dropMenu" class="menu" :style="{ left: dropMenu.x + 'px', top: dropMenu.y + 'px' }" @click.stop>
    <button v-if="dropMenu.acts.includes('merge')" @click="dropDo('merge')">Merge {{ dropMenu.src }} ke {{ dropMenu.dst }}</button>
    <button v-if="dropMenu.acts.includes('rebase')" @click="dropDo('rebase')">Rebase {{ dropMenu.src }} ke {{ shortRef(dropMenu.dst) }}</button>
  </div>
</template>
