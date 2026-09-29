<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { until } from '@vueuse/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import MainLayout from './components/MainLayout.vue';
import { Pages, useGlobalState } from './composables/app-state';
import { useGameDB } from './composables/game-db';
import { useGameLibrary } from './composables/game-library';
import { useDiscordDetect } from './composables/discord-detect';
import { useScheduler } from './composables/scheduler';
import { useInstaller } from './composables/installer';
import { useBrandIcon } from './theme/brand-icon';
import { useBuddy } from './composables/legit-buddy';
import { useGameSearch } from './composables/game-search';
import HomeView from './pages/HomeView.vue';
import Playground from './pages/Playground.vue';
import SettingsView from './pages/SettingsView.vue';
import InstallerView from './pages/InstallerView.vue';
import UninstallView from './pages/UninstallView.vue';
import RiskNotice from './components/RiskNotice.vue';

// Start the shared game list fetch from the root component
const { allFetchDone } = useGameDB();
const library = useGameLibrary();
// start following Discord's log right away, so detections aren't missed
useDiscordDetect();
const scheduler = useScheduler();
// same exe = installer + app: decides which one to show
const installer = useInstaller();
const { mode } = installer;
// taskbar/tray icon in the accent color; the installed copy's shortcuts follow too
const iconReady = useBrandIcon(() => !!installer.info.value?.running_installed && !installer.info.value.dev);

const { page } = useGlobalState();

// Legitimate Buddy runs in the background of the app (not the installer);
// the search index gets built in the background too, before Spotlight is opened
watch(mode, m => {
  if (m !== 'app') return;
  useBuddy();
  useGameSearch();
}, { immediate: true });

// ----- startup splash: report loading stages (each turns a dot green) -----
const stage = (n: number) => invoke('splash_stage', { stage: n }).catch(() => {});
const within = <T,>(promise: Promise<T>, ms: number) =>
  Promise.race([promise.catch(() => undefined), new Promise(resolve => setTimeout(resolve, ms))]);

onMounted(async () => {
  // 1: the interface is up, in the right colors and with the right icon
  await within(iconReady, 1500);
  stage(1);
  // 2: which screen to show, and your library
  await installer.ready;
  if (mode.value === 'app') await within(library.ready, 4000);
  stage(2);
  // 3: Discord's game list (it can come from the network, so don't wait forever)
  if (mode.value === 'app') await within(until(allFetchDone).toBe(true), 6000);
  stage(3);
});

// Tray menu > Stop all games
const unlisten = listen('tray_stop_all', async () => {
  if (scheduler.isActive.value) await scheduler.cancel({ stopGames: false, quiet: true });
  library.stopAll();
}).catch(() => undefined);
onUnmounted(() => { unlisten.then(fn => fn?.()); });
</script>

<template>
  <MainLayout :minimal="mode !== 'app'">
    <Transition name="page">
      <InstallerView v-if="mode === 'installer'" class="page" />
      <UninstallView v-else-if="mode === 'uninstall'" class="page" />
    </Transition>

    <template v-if="mode === 'app'">
      <!-- v-show keeps every page alive, so state survives switching -->
      <Transition name="page">
        <HomeView v-show="page === Pages.HOME" class="page" />
      </Transition>
      <Transition name="page">
        <Playground v-show="page === Pages.PLAYGROUND" class="page" />
      </Transition>
      <Transition name="page">
        <SettingsView v-show="page === Pages.SETTINGS" class="page" />
      </Transition>
      <RiskNotice />
    </template>
  </MainLayout>
</template>

<style>
.page {
  position: absolute;
  inset: 0;
}

/* no blur filter here: blurring a whole page full of frosted cards every frame
   made switching tabs stutter with a big library */
.page-enter-active {
  transition: opacity 320ms ease, transform 600ms var(--ease-quint);
}

.page-leave-active {
  transition: opacity 160ms ease;
}

.page-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.99);
}

.page-leave-to {
  opacity: 0;
}
</style>
