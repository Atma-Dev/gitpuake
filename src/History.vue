<script setup>
// Commit graph with virtual scrolling (rows are positioned absolutely).
import { REFS, ROW, ago, avatarColor, color, commits, compare, dirty, dragRef, draggablePill, dropOn, g, graphWidth, head, headCol, headRow, initials, matches, openMenu, path, pickPair, pills, rowTarget, selectCommit, selected, status, visible, x } from './store.js'
import { avatar } from './identity.js'
import { settings } from './settings.js'
</script>

<template>
  <div class="history">
    <div class="cols">
      <span :style="{ width: REFS + 'px' }">Branch / Tag</span>
      <span :style="{ width: x(graphWidth) + 'px' }">Graph</span>
      <span class="subject">Commit message</span>
      <span class="author">Author</span>
      <span class="date">Waktu</span>
    </div>
    <div class="rows" :style="{ height: (commits.length + 1) * ROW + 'px' }">
      <svg class="graph" :style="{ left: REFS + 'px' }" :width="x(graphWidth)" :height="(commits.length + 1) * ROW">
        <path v-if="dirty && headRow >= 0" :d="`M${x(headCol)} ${ROW / 2} V${(headRow + 1.5) * ROW}`" stroke="#8a90a0" stroke-width="2" stroke-dasharray="3 4" />
        <template v-for="(c, k) in visible.list" :key="c.hash">
          <path v-for="(l, j) in c.lines" :key="j" :d="path(l, visible.first + k + 1)" :stroke="color(l[2] === 'top' ? l[0] : l[1])" fill="none" stroke-width="2.5" stroke-linecap="round" />
        </template>
        <template v-for="(c, k) in visible.list" :key="c.hash">
          <line v-if="c.pills.length" x1="0" :x2="x(c.col)" :y1="(visible.first + k + 1.5) * ROW" :y2="(visible.first + k + 1.5) * ROW" :stroke="color(c.col)" stroke-width="2" opacity="0.6" />
          <circle v-if="c.parents.length > 1" :cx="x(c.col)" :cy="(visible.first + k + 1.5) * ROW" r="5" :fill="color(c.col)" stroke="#0f1813" stroke-width="2" />
          <g v-else>
            <circle :cx="x(c.col)" :cy="(visible.first + k + 1.5) * ROW" r="11" :fill="avatarColor(c.author)" :stroke="selected === c.hash ? '#fff' : color(c.col)" stroke-width="2.5" />
            <text :x="x(c.col)" :y="(visible.first + k + 1.5) * ROW" dy=".35em" text-anchor="middle" class="ini">{{ initials(c.author) }}</text>
          </g>
        </template>
        <circle v-if="dirty" :cx="x(headCol)" :cy="ROW / 2" r="9" fill="#0f1813" stroke="#8a90a0" stroke-width="2" stroke-dasharray="3 3" />
      </svg>
      <div class="row wip" :class="{ sel: selected === 'WIP' }" @click="selectCommit('WIP')">
        <span class="refs" :style="{ width: REFS + 'px' }" />
        <span :style="{ width: x(graphWidth) + 'px' }" class="gutter" />
        <span class="subject">// WIP <small v-if="dirty">({{ status.staged.length + status.unstaged.length + status.conflicts.length }} file berubah)</small></span>
      </div>
      <div
        v-for="(c, k) in visible.list"
        :key="c.hash"
        class="row"
        :class="{ sel: selected === c.hash || compare?.b === c.hash || compare?.a === c.hash, dim: matches && !matches.has(c.hash) }"
        :style="{ '--c': color(c.col), top: (visible.first + k + 1) * ROW + 'px' }"
        @click="$event.ctrlKey || $event.metaKey ? pickPair(c.hash) : selectCommit(c.hash)"
        @contextmenu.prevent="openMenu($event, c)"
        @dragover="dragRef && $event.preventDefault()"
        @drop="dropOn($event, rowTarget(c))"
      >
        <span class="refs" :style="{ width: REFS + 'px' }">
          <template v-if="c.pills.length">
            <span
              class="pill"
              :class="{ head: c.pills[0].head }"
              :title="c.pills[0].name"
              :draggable="draggablePill(c.pills[0])"
              @dragstart="dragRef = c.pills[0].name"
              @dragend="dragRef = ''"
            >
              <i>{{ c.pills[0].icon }}</i>{{ c.pills[0].name }}<i v-if="c.pills[0].synced" title="sinkron dengan remote">☁</i>
            </span>
            <span v-if="c.pills.length > 1" class="pill more" :title="c.pills.slice(1).map(p => p.name).join('\n')">+{{ c.pills.length - 1 }}</span>
          </template>
        </span>
        <span :style="{ width: x(graphWidth) + 'px' }" class="gutter" />
        <span class="subject">{{ c.subject }}</span>
        <span class="author"><img v-if="settings.avatars && avatar(c.email)" :src="avatar(c.email)" class="avatar" alt="" loading="lazy" />{{ c.author }}</span>
        <span class="date" :title="new Date(c.time * 1000).toLocaleString()">{{ ago(c.time) }}</span>
      </div>
    </div>
  </div>
</template>
