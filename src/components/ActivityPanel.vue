<script setup lang="ts">
import { computed } from 'vue';
import { useNow } from '@vueuse/core';
import type { Game } from '@/types/types';
import { useGameLibrary } from '@/composables/game-library';
import { useScheduler, type RunItem } from '@/composables/scheduler';
import { usePerformanceGuard } from '@/composables/performance-guard';
import { formatDuration } from '@/utils/executables';
import { vSmooth } from '@/directives/smooth-scroll';
import ActivityRunRow from './ActivityRunRow.vue';
import ActivityPlayingRow from './ActivityPlayingRow.vue';

const emit = defineEmits<{ timer: [] }>();

const library = useGameLibrary();
const scheduler = useScheduler();
const { run } = scheduler;
const { runningGames } = library;
const now = useNow({ interval: 250 });
const guard = usePerformanceGuard();

// A run can hold thousands of games, so the list shows the part that matters:
// the last few that finished, the ones playing now and the next ones in line.
const SHOWN = 40;
const FINISHED_SHOWN = 3;
const total = computed(() => run.value?.items.length ?? 0);
/** the first game that isn't finished yet */
const frontier = computed(() => {
    const list = run.value?.items ?? [];
    const i = list.findIndex(x => x.state !== 'done' && x.state !== 'failed');
    return i < 0 ? list.length : i;
});
const start = computed(() => Math.max(0, Math.min(frontier.value - FINISHED_SHOWN, total.value - SHOWN)));
const later = computed(() => Math.max(0, total.value - start.value - SHOWN));
const numberWidth = computed(() => total.value > 999 ? 'w-8' : total.value > 99 ? 'w-6' : 'w-5');

const items = computed(() =>
    (run.value?.items ?? [])
        .slice(start.value, start.value + SHOWN)
        .map((item, i) => ({ item, index: start.value + i, game: library.findByUid(item.uid) }))
        .filter((x): x is { item: RunItem; index: number; game: Game } => !!x.game)
);

const progress = computed(() => scheduler.progress(now.value.getTime()));

// "Launch all" on a big library can have thousands running: the first ones are listed
const playingShown = computed(() => runningGames.value.slice(0, SHOWN));
const playingMore = computed(() => runningGames.value.length - playingShown.value.length);
</script>

<template>
    <div class="flex flex-col h-full min-h-0">
        <div class="flex items-center justify-between px-5 pt-4 pb-2">
            <div class="eyebrow">{{ run ? 'Timed run' : 'Now playing' }}</div>
            <button v-if="run" class="btn btn-link btn-sm !h-6 hover:!text-danger" @click="scheduler.cancel()">Cancel</button>
            <button v-else class="btn btn-link btn-sm !h-6" @click="emit('timer')">New timer</button>
        </div>

        <!-- Timed run -->
        <template v-if="run">
            <div class="px-5 pb-3">
                <div class="flex items-baseline justify-between gap-2 text-sm">
                    <span class="text-ink font-semibold">
                        {{ run.mode === 'parallel' ? 'All at once' : 'One after another' }}
                        <span v-if="run.mode === 'sequential'" class="text-muted font-normal">· {{ run.atOnce > 1 ? `${run.atOnce} at a time, ` : '' }}{{ run.order === 'random' ? 'random' : 'fixed' }} order</span>
                    </span>
                    <span class="text-muted text-xs">{{ formatDuration(run.durationMs / 1000) }}{{ run.mode === 'sequential' ? ' each' : '' }}</span>
                </div>
                <div class="h-1.5 rounded-full bg-glass-3 mt-2 overflow-hidden">
                    <div class="h-full rounded-full bar transition-[width] duration-300 ease-linear"
                        :style="{ width: `${Math.min(100, progress * 100)}%` }"></div>
                </div>
                <div v-if="run.waitForDiscord" class="text-[11px] text-muted mt-1.5">
                    Each countdown starts once Discord reports the game.
                </div>
                <Transition name="rise">
                    <div v-if="(run.mode === 'parallel' || run.atOnce > 1) && guard.enabled.value && guard.limit.value !== null"
                        class="flex items-center gap-2 mt-2 rounded-xl bg-warn-soft px-2.5 py-1.5 text-[11.5px] text-warn">
                        <span class="wait-dot !w-1.5 !h-1.5"></span>
                        <span>Performance Guard: at most {{ guard.limit.value }} open at once. The rest resume when your PC calms down.</span>
                    </div>
                </Transition>
            </div>
            <div v-smooth class="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
                <div v-if="start > 0" class="px-2 pb-1.5 text-xs text-muted tabular-nums">
                    {{ start.toLocaleString() }} finished
                </div>
                <TransitionGroup name="list" tag="div" class="relative space-y-1">
                    <ActivityRunRow v-for="{ item, index, game } in items" :key="item.uid" :item="item" :index="index"
                        :game="game" :duration-ms="run.durationMs" :number-width="numberWidth" />
                </TransitionGroup>
                <div v-if="later > 0" class="px-2 pt-2 text-xs text-muted tabular-nums">
                    and {{ later.toLocaleString() }} more in line
                </div>
            </div>
        </template>

        <!-- Running games -->
        <div v-else v-smooth class="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
            <TransitionGroup name="list" tag="div" class="relative space-y-1">
                <ActivityPlayingRow v-for="game in playingShown" :key="game.uid" :game="game" />
            </TransitionGroup>
            <div v-if="playingMore > 0" class="px-2 pt-2 text-xs text-muted tabular-nums">
                and {{ playingMore.toLocaleString() }} more playing
            </div>
            <div v-if="runningGames.length === 0" class="h-full grid place-items-center text-center px-4">
                <div>
                    <div class="text-sm font-semibold text-ink-2">Nothing running yet.</div>
                    <p class="text-xs text-muted mt-1">Press Play, Launch, or start a timer.</p>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.bar {
    background: var(--accent);
}
</style>
