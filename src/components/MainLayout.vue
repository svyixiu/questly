<script setup lang="ts">
import { computed, ref } from 'vue';
import { useEventListener } from '@vueuse/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Pages, useGlobalState } from '@/composables/app-state';
import { useGameDB } from '@/composables/game-db';
import { useGameLibrary } from '@/composables/game-library';
import { useDiscordDetect } from '@/composables/discord-detect';
import { usePanic } from '@/composables/panic';
import AppBackground from './AppBackground.vue';
import ToastHost from './ToastHost.vue';
import LogoMark from './LogoMark.vue';
import TooltipLayer from './TooltipLayer.vue';
import PanicModal from './PanicModal.vue';

/** minimal: just the title bar (installer / uninstaller screens) */
const props = defineProps<{ minimal?: boolean }>();

const { page, setPage } = useGlobalState();
const { gameDB, gameListSource, allFetchDone, fetchGameList } = useGameDB();
const { runningGames } = useGameLibrary();
const discord = useDiscordDetect();

const tabs = [
  { id: Pages.HOME, label: 'Library' },
  { id: Pages.PLAYGROUND, label: 'Activity' },
  { id: Pages.SETTINGS, label: 'Settings' },
] as const;
const activeIndex = computed(() => Math.max(0, tabs.findIndex(t => t.id === page.value)));

// macOS greys out the traffic lights while the window isn't focused
const focused = ref(document.hasFocus());
useEventListener(window, 'focus', () => { focused.value = true; });
useEventListener(window, 'blur', () => { focused.value = false; });

function win() {
  try {
    return getCurrentWindow();
  } catch {
    return null; // not inside the desktop app
  }
}
const close = () => win()?.close().catch(() => {});
const minimize = () => win()?.minimize().catch(() => {});

const dbTip = computed(() => allFetchDone.value
  ? `${gameDB.value.length.toLocaleString()} detectable games · ${gameListSource.value}. Click to refresh.`
  : 'Syncing the game list…');
const discordTip = computed(() => discord.available.value
  ? `Reading ${discord.clients.value.join(', ')} to confirm when games are detected`
  : "Discord's log wasn't found, so detection can't be confirmed");

const panic = usePanic();

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  // Panic Abort works everywhere in the app, even while typing
  if (!props.minimal && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.code === 'KeyX' || e.key?.toLowerCase() === 'x')) {
    e.preventDefault();
    panic.panic();
    return;
  }
  if (props.minimal || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
  const index = ['1', '2', '3'].indexOf(e.key);
  if (index >= 0) {
    e.preventDefault();
    setPage(tabs[index].id);
  }
});
</script>

<template>
  <div class="relative h-dvh flex flex-col overflow-hidden">
    <AppBackground />

    <!-- Title bar: the whole strip drags the window -->
    <!-- the separator is exactly where scrolled content gets cut off: pages put
         their top spacing inside (pt-3), never as a gap under the bar -->
    <header data-tauri-drag-region
      class="relative z-30 h-14 shrink-0 flex items-center px-4 gap-4 border-b border-line bg-[color-mix(in_srgb,var(--bg)_70%,transparent)] backdrop-blur-md">
      <div class="lights flex items-center gap-2" :class="{ blurred: !focused }">
        <button class="light close" aria-label="Close" @click="close">
          <svg viewBox="0 0 12 12"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" /></svg>
        </button>
        <button class="light min" aria-label="Minimize" @click="minimize">
          <svg viewBox="0 0 12 12"><path d="M3 6h6" /></svg>
        </button>
        <!-- zoom is disabled: the window has a fixed size -->
        <button class="light zoom" aria-label="Zoom (disabled)" disabled></button>
      </div>

      <div data-tauri-drag-region class="flex items-center gap-2 min-w-0 ml-1">
        <LogoMark class="w-6 h-6" data-tauri-drag-region />
        <span data-tauri-drag-region class="display text-[19px] text-ink leading-none">Questly</span>
      </div>

      <!-- Tabs: outlined pill with a solid active pill that slides -->
      <nav v-if="!minimal" class="tabs absolute left-1/2 -translate-x-1/2">
        <span class="indicator" :style="{ transform: `translateX(${activeIndex * 100}%)` }"></span>
        <button v-for="tab in tabs" :key="tab.id" class="tab" :class="{ active: page === tab.id }"
          @click="setPage(tab.id)">
          {{ tab.label }}
        </button>
      </nav>

      <div v-if="!minimal" data-tauri-drag-region class="ml-auto flex items-center gap-2">
        <Transition name="pop">
          <span v-if="runningGames.length" class="tag">{{ runningGames.length }} running</span>
        </Transition>
        <button class="panic chip" :disabled="panic.busy.value" data-tip="Panic Abort: stop everything now (Ctrl+Shift+X)"
          data-tip-pos="bottom" @click="panic.panic()">
          <span v-if="panic.busy.value" class="spinner !w-2.5 !h-2.5 !border-[1.5px]"></span>
          <svg v-else viewBox="0 0 24 24" class="w-3 h-3" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3" /></svg>
          Panic
        </button>
        <span class="chip" :data-tip="discordTip" data-tip-pos="bottom">
          <span class="w-1.5 h-1.5 rounded-full" :class="discord.available.value ? 'bg-accent' : 'bg-faint'"></span>
          {{ discord.available.value ? discord.clients.value[0] : 'No Discord' }}
        </span>
        <button class="chip hover:!text-ink hover:!border-ink-2 transition-colors" :data-tip="dbTip" data-tip-pos="bottom"
          :disabled="!allFetchDone" @click="fetchGameList()">
          <span v-if="!allFetchDone" class="spinner !w-2.5 !h-2.5 !border-[1.5px]"></span>
          <span v-else class="tabular-nums">{{ (gameDB.length / 1000).toFixed(1) }}k</span>
          games
        </button>
      </div>
    </header>

    <main class="relative z-10 flex-1 min-h-0">
      <slot></slot>
    </main>

    <ToastHost />
    <TooltipLayer />
    <PanicModal v-if="!minimal" />
  </div>
</template>

<style scoped>
.light {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.25);
  transition: background-color 150ms ease, transform 150ms ease;
}

.light svg {
  width: 8px;
  height: 8px;
  fill: none;
  stroke: rgba(40, 10, 10, 0.7);
  stroke-width: 1.4;
  stroke-linecap: round;
  opacity: 0;
  transition: opacity 120ms ease;
}

.lights:hover .light svg {
  opacity: 1;
}

.light:active:not(:disabled) {
  transform: scale(0.88);
}

.close {
  background: #ff5f57;
}

.min {
  background: #febc2e;
}

.zoom {
  background: var(--line-strong);
}

.lights.blurred .light {
  background: var(--line-strong);
}

.tabs {
  display: flex;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: color-mix(in srgb, var(--bg) 60%, transparent);
}

.tab {
  position: relative;
  z-index: 1;
  width: 6rem;
  height: 2rem;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--ink-2);
  transition: color 300ms ease;
}

.tab:hover {
  color: var(--ink);
}

.tab.active {
  color: var(--btn-ink);
}

/* same shape as the other chips, in the danger color */
.panic {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 55%, transparent);
  font-weight: 700;
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, transform 220ms var(--ease-spring);
}

.panic:hover:not(:disabled) {
  background: var(--danger);
  border-color: var(--danger);
  color: var(--bg);
}

.panic:active:not(:disabled) {
  transform: scale(0.94);
}

.indicator {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 6rem;
  height: 2rem;
  border-radius: 999px;
  background: var(--btn);
  /* a smooth glide with no overshoot, so it never pokes out of the pill */
  transition: transform 480ms var(--ease-quint), background-color 300ms ease;
}
</style>
