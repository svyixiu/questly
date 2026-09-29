<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { useEventListener, useIntersectionObserver } from '@vueuse/core';
import type { Game } from '@/types/types';
import { Pages, useGlobalState } from '@/composables/app-state';
import { useGameLibrary } from '@/composables/game-library';
import { useScheduler } from '@/composables/scheduler';
import { isGameRunning } from '@/utils/executables';
import { smoothScrollIntoView, vSmooth } from '@/directives/smooth-scroll';
import Spotlight from '@/components/Spotlight.vue';
import LibraryRow from '@/components/LibraryRow.vue';
import GameHero from '@/components/GameHero.vue';
import GameExecutables from '@/components/GameExecutables.vue';
import ActivityPanel from '@/components/ActivityPanel.vue';
import AnimatedCheckbox from '@/components/AnimatedCheckbox.vue';
import ShortcutsModal from '@/components/ShortcutsModal.vue';
import TimerModal from '@/components/TimerModal.vue';

const { page } = useGlobalState();
const library = useGameLibrary();
const scheduler = useScheduler();
const { run: timedRun } = scheduler;
const {
    games, checked, checkedGames, allChecked, focusedUid, focusedGame,
    busy, batchBusy, runningGames,
} = library;

const listRef = useTemplateRef<HTMLElement>('listRef');
const spotlightOpen = ref(false);
const shortcutsOpen = ref(false);
const timerOpen = ref(false);

const someChecked = computed(() => checked.value.size > 0);

// ----- drawing a big library in chunks -----
// A library of hundreds of games is drawn 100 at a time. Scrolling near the end
// brings in the next 100, a few rows per frame so scrolling stays smooth, with
// skeleton rows showing where they're coming. Everything else (checking all,
// launching, timers) still works on the whole library.
const CHUNK = 100;
const ROWS_PER_FRAME = 25;
const shown = ref(CHUNK);
const loadingMore = ref(false);
const shownGames = computed(() => games.value.slice(0, shown.value));
const remaining = computed(() => Math.max(0, games.value.length - shown.value));
const skeletonRows = computed(() => Math.min(remaining.value, 6));

function loadMore() {
    if (loadingMore.value || remaining.value === 0) return;
    loadingMore.value = true;
    const goal = Math.min(shown.value + CHUNK, games.value.length);
    const step = () => {
        shown.value = Math.min(goal, shown.value + ROWS_PER_FRAME);
        if (shown.value < goal) requestAnimationFrame(step);
        else loadingMore.value = false;
    };
    // let the skeleton rows paint first
    requestAnimationFrame(() => requestAnimationFrame(step));
}

// the skeleton rows at the end: in view (or nearly) means "draw the next chunk"
const moreRef = useTemplateRef<HTMLElement>('moreRef');
const nearEnd = ref(false);
useIntersectionObserver(moreRef, ([entry]) => { nearEnd.value = !!entry?.isIntersecting; },
    { root: listRef, rootMargin: '0px 0px 480px 0px' });
// keeps going while the end stays in view (a tall window, or a fast scroll)
watch([nearEnd, loadingMore], ([near, busy]) => { if (near && !busy) loadMore(); });

// a game further down (keyboard focus, just added) is drawn right away so it can be shown
watch(focusedUid, uid => {
    const index = games.value.findIndex(g => g.uid === uid);
    if (index >= shown.value) shown.value = Math.min(games.value.length, Math.ceil((index + 1) / CHUNK) * CHUNK);
});

const launchTargets = computed(() => someChecked.value ? checkedGames.value : games.value);
const launchLabel = computed(() => someChecked.value ? `Launch ${checked.value.size}` : 'Launch all');
const canLaunch = computed(() =>
    batchBusy.value === null && launchTargets.value.some(g => !isGameRunning(g))
);

function openTimer() {
    if (!scheduler.isActive.value && launchTargets.value.length > 0) timerOpen.value = true;
}

// ----- selection -----

let lastCheckedIndex = -1;
function onCheck(game: Game, index: number, event: MouseEvent) {
    const value = !checked.value.has(game.uid!);
    if (event.shiftKey && lastCheckedIndex >= 0) {
        const [a, b] = [lastCheckedIndex, index].sort((x, y) => x - y);
        games.value.slice(a, b + 1).forEach(g => library.toggleChecked(g.uid!, value));
    } else {
        library.toggleChecked(game.uid!, value);
    }
    lastCheckedIndex = index;
}

function moveFocus(delta: number) {
    const list = games.value;
    if (list.length === 0) return;
    const index = list.findIndex(g => g.uid === focusedUid.value);
    const next = index < 0 ? 0 : Math.min(list.length - 1, Math.max(0, index + delta));
    focusedUid.value = list[next].uid!;
    nextTick(() => {
        const row = listRef.value?.querySelector<HTMLElement>(`[data-uid="${focusedUid.value}"]`);
        if (row && listRef.value) smoothScrollIntoView(listRef.value, row);
    });
}

function removeCheckedOrFocused() {
    if (someChecked.value) library.removeGames([...checked.value]);
    else if (focusedGame.value) library.removeGame(focusedGame.value);
}

function launchTargetsNow() {
    if (canLaunch.value) library.launchMany(launchTargets.value);
}

async function stopAllNow() {
    if (batchBusy.value !== null) return;
    // stopping everything also ends a timed run, rather than letting it move on
    if (scheduler.isActive.value) await scheduler.cancel({ stopGames: false, quiet: true });
    if (runningGames.value.length > 0) library.stopAll();
}

// ----- keyboard shortcuts -----

function isTyping(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
    if (page.value !== Pages.HOME) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    // some layouts report Shift+/ as "/" with shiftKey set
    const isHelpKey = e.key === '?' || (e.key === '/' && e.shiftKey);

    if (shortcutsOpen.value) {
        if (isHelpKey) { e.preventDefault(); shortcutsOpen.value = false; }
        return;
    }
    if (document.querySelector('[aria-modal="true"]')) return;

    if ((ctrl && key === 'k') || (e.key === '/' && !e.shiftKey && !isTyping(e))) {
        e.preventDefault();
        spotlightOpen.value = true;
        return;
    }
    if (ctrl && key === 'l') {
        e.preventDefault();
        if (e.shiftKey) stopAllNow();
        else launchTargetsNow();
        return;
    }
    if (ctrl && key === 't') {
        e.preventDefault();
        openTimer();
        return;
    }
    if (isTyping(e)) return;
    // a keyboard-focused button handles its own Enter/Space
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement)?.tagName === 'BUTTON') return;

    if (isHelpKey) { e.preventDefault(); shortcutsOpen.value = true; }
    else if (e.key === 'ArrowDown' || key === 'j') { e.preventDefault(); moveFocus(1); }
    else if (e.key === 'ArrowUp' || key === 'k') { e.preventDefault(); moveFocus(-1); }
    else if (e.key === ' ' && focusedGame.value) { e.preventDefault(); library.toggleChecked(focusedGame.value.uid!); }
    else if (e.key === 'Enter' && focusedGame.value) {
        e.preventDefault();
        library.toggle(focusedGame.value);
    }
    else if (e.key === 'Delete') { e.preventDefault(); removeCheckedOrFocused(); }
    else if (ctrl && key === 'a') { e.preventDefault(); library.toggleAllChecked(); }
    else if (e.key === 'Escape' && someChecked.value) { checked.value.clear(); }
});

const searchExamples = ['VALORANT', 'Genshin Impact', 'Fortnite', 'Minecraft', 'Marvel Rivals', 'Rocket League'];
</script>

<template>
    <div class="h-full grid grid-cols-[336px_minmax(0,1fr)] gap-4 px-4 pt-3 pb-4">
        <!-- ===== Library column ===== -->
        <section class="glass flex flex-col min-h-0 overflow-hidden">
            <!-- title + search; the line under it is where the list scrolls away -->
            <div class="shrink-0 flex flex-col border-b border-line">
            <div class="flex items-center gap-2 px-5 pt-4 pb-3">
                <h2 class="display text-[22px] text-ink">Library</h2>
                <span class="chip !h-5 !px-2 tabular-nums">{{ games.length }}</span>
                <div class="ml-auto flex items-center gap-1">
                    <AnimatedCheckbox v-if="games.length" :checked="allChecked" :indeterminate="someChecked && !allChecked"
                        label="Check all games" data-tip="Check all (Ctrl+A)" @toggle="library.toggleAllChecked()" />
                    <button class="icon-btn" data-tip="Shortcuts (?)" @click="shortcutsOpen = true">
                        <svg viewBox="0 0 24 24" class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round"><rect x="2.5" y="6" width="19" height="12" rx="3" /><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" /></svg>
                    </button>
                </div>
            </div>

            <!-- search prompt (opens Spotlight) -->
            <button class="search mx-4 mb-3 flex items-center gap-2.5 h-11 px-4 rounded-full text-left"
                @click="spotlightOpen = true">
                <svg viewBox="0 0 24 24" class="w-4 h-4 text-muted shrink-0" fill="none" stroke="currentColor" stroke-width="2.2"
                    stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                <span class="flex-1 min-w-0 truncate text-sm text-faint">Search games to add…</span>
                <span class="kbd">Ctrl K</span>
            </button>
            </div>

            <div ref="listRef" v-smooth class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2.5 pt-2 pb-2">
                <TransitionGroup name="list" tag="div" class="relative flex flex-col gap-1">
                    <LibraryRow v-for="(game, index) in shownGames" :key="game.uid" :game="game"
                        :focused="focusedUid === game.uid" :some-checked="someChecked"
                        @focus="focusedUid = game.uid!" @check="onCheck(game, index, $event)" />
                </TransitionGroup>

                <!-- where the next chunk of a big library comes in -->
                <div v-if="remaining > 0" ref="moreRef" class="flex flex-col gap-1 mt-1" aria-hidden="true">
                    <div v-for="i in skeletonRows" :key="i" class="flex items-center gap-3 h-14 px-2.5"
                        :style="{ opacity: 1 - (i - 1) * 0.14 }">
                        <span class="skeleton w-[38px] h-[38px] rounded-[10px] shrink-0"></span>
                        <span class="flex-1 min-w-0 flex flex-col gap-2">
                            <span class="skeleton h-3 rounded-full" :style="{ width: `${62 - ((i * 17) % 28)}%` }"></span>
                            <span class="skeleton h-2.5 rounded-full" :style="{ width: `${40 - ((i * 11) % 18)}%` }"></span>
                        </span>
                    </div>
                </div>

                <div v-if="games.length === 0" class="px-3 pt-6 text-center">
                    <div class="text-sm font-semibold text-ink-2">Your library is empty.</div>
                    <p class="text-xs text-muted mt-1.5 mb-4">Add the games your quests ask for.</p>
                    <button class="btn btn-primary btn-sm" @click="spotlightOpen = true">Find a game</button>
                </div>
            </div>

            <!-- action bar -->
            <div class="flex items-center gap-2 p-3 border-t border-line">
                <button class="btn btn-primary flex-1" :disabled="!canLaunch" data-tip="Ctrl+L" @click="launchTargetsNow">
                    <span v-if="batchBusy === 'launch'" class="spinner"></span>
                    <svg v-else viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M7 5.5v13L18 12z" /></svg>
                    {{ launchLabel }}
                </button>
                <button class="btn btn-glass !px-3" :disabled="timedRun !== null || launchTargets.length === 0"
                    data-tip="Timed run (Ctrl+T)" @click="openTimer">
                    <svg viewBox="0 0 24 24" class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="2.2"
                        stroke-linecap="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></svg>
                </button>
                <button class="btn btn-danger !px-3" :disabled="(runningGames.length === 0 && !timedRun) || batchBusy !== null"
                    data-tip="Stop all (Ctrl+Shift+L)" @click="stopAllNow">
                    <span v-if="batchBusy === 'stop'" class="spinner"></span>
                    <svg v-else viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
                </button>
            </div>
        </section>

        <!-- ===== Detail column ===== -->
        <div class="grid grid-rows-[208px_minmax(0,1fr)] gap-4 min-h-0">
            <section class="paper overflow-hidden">
                <Transition name="rise" mode="out-in">
                    <GameHero v-if="focusedGame" :key="focusedGame.uid" :game="focusedGame" />
                    <div v-else class="h-full flex flex-col justify-center px-8">
                        <span class="absolute top-[18px] right-[18px] w-3 h-3 rounded-full bg-ink" aria-hidden="true"></span>
                        <div class="eyebrow mb-2">Questly · Discord quests</div>
                        <h1 class="display text-[40px] leading-[42px] text-ink">
                            Quests, done quietly.
                        </h1>
                        <p class="text-[15px] text-muted mt-3 max-w-md leading-snug">
                            Add a game, press Play, and Discord sees you playing it. Timers can wait until Discord actually
                            notices before counting down.
                        </p>
                    </div>
                </Transition>
            </section>

            <div class="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4 min-h-0">
                <section class="glass flex flex-col min-h-0 overflow-hidden">
                    <div class="px-5 pt-4 pb-2 flex items-baseline justify-between gap-2">
                        <div class="eyebrow">Executables</div>
                        <div v-if="focusedGame" class="text-[11px] text-faint">Selected one is used by Play &amp; timers</div>
                    </div>
                    <div v-smooth class="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
                        <Transition name="rise" mode="out-in">
                            <GameExecutables v-if="focusedGame" :key="focusedGame.uid" :game="focusedGame" />
                            <div v-else class="px-2 text-sm text-muted">Select a game to see how it can be launched.</div>
                        </Transition>
                    </div>
                </section>

                <section class="glass min-h-0 overflow-hidden">
                    <ActivityPanel @timer="openTimer" />
                </section>
            </div>
        </div>

        <Spotlight :open="spotlightOpen" @close="spotlightOpen = false" />
        <ShortcutsModal :open="shortcutsOpen" @close="shortcutsOpen = false" />
        <TimerModal :open="timerOpen" :games="launchTargets" :from-selection="someChecked" @close="timerOpen = false" />
    </div>
</template>

<style scoped>
.search {
    border: 1px solid var(--line-strong);
    transition: background-color 160ms ease, border-color 160ms ease;
}

.search:hover {
    background: var(--glass-2);
    border-color: var(--ink-2);
}

</style>
