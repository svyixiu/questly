<script setup lang="ts">
import { computed } from 'vue';
import { useNow } from '@vueuse/core';
import type { Game } from '@/types/types';
import { useGameLibrary } from '@/composables/game-library';
import { useScheduler, type RunItem } from '@/composables/scheduler';
import { usePerformanceGuard } from '@/composables/performance-guard';
import { formatDuration, formatElapsed, runningExecutable } from '@/utils/executables';
import { vSmooth } from '@/directives/smooth-scroll';
import GameAvatar from './GameAvatar.vue';

const emit = defineEmits<{ timer: [] }>();

const library = useGameLibrary();
const scheduler = useScheduler();
const { run } = scheduler;
const { runningGames, focusedUid } = library;
const now = useNow({ interval: 250 });
const guard = usePerformanceGuard();

const items = computed(() =>
    (run.value?.items ?? [])
        .map((item, index) => ({ item, index, game: library.findByUid(item.uid) }))
        .filter((x): x is { item: RunItem; index: number; game: Game } => !!x.game)
);

const progress = computed(() => scheduler.progress(now.value.getTime()));

function label(item: RunItem) {
    switch (item.state) {
        case 'queued': return item.pausedByGuard
            ? `Paused by Performance Guard · ${formatElapsed(item.remainingMs ?? run.value?.durationMs ?? 0)} left`
            : 'Queued';
        case 'launching': return 'Launching…';
        case 'waiting': return 'Waiting for Discord…';
        case 'running': return `${formatElapsed(Math.max(0, (item.endsAt ?? 0) - now.value.getTime()))} left`;
        case 'done': return 'Done';
        case 'failed': return 'Failed';
    }
}

function elapsed(game: Game) {
    const exe = runningExecutable(game);
    return exe?.started_at ? formatElapsed(now.value.getTime() - exe.started_at) : '';
}
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
                        <span v-if="run.mode === 'sequential'" class="text-muted font-normal">· {{ run.order === 'random' ? 'random' : 'fixed' }} order</span>
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
                    <div v-if="run.mode === 'parallel' && guard.enabled.value && guard.limit.value !== null"
                        class="flex items-center gap-2 mt-2 rounded-xl bg-warn-soft px-2.5 py-1.5 text-[11.5px] text-warn">
                        <span class="wait-dot !w-1.5 !h-1.5"></span>
                        <span>Performance Guard: at most {{ guard.limit.value }} open at once. The rest resume when your PC calms down.</span>
                    </div>
                </Transition>
            </div>
            <div v-smooth class="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
                <TransitionGroup name="list" tag="div" class="relative space-y-1">
                    <div v-for="{ item, index, game } in items" :key="item.uid"
                        class="row flex items-center gap-3 rounded-2xl px-2 py-1.5" :class="item.state"
                        @click="focusedUid = game.uid!">
                        <span class="w-5 text-center text-xs font-semibold text-faint tabular-nums">{{ index + 1 }}</span>
                        <GameAvatar :game="game" :size="30" :status="item.state === 'running' ? 'online' : item.state === 'waiting' ? 'idle' : null" />
                        <div class="min-w-0 flex-1">
                            <div class="text-[13px] font-semibold text-ink truncate">{{ game.name }}</div>
                            <div class="text-xs tabular-nums truncate" :class="{
                                'text-accent font-semibold': item.state === 'running',
                                'text-warn': item.state === 'waiting' || (item.state === 'queued' && item.pausedByGuard),
                                'text-ok': item.state === 'done',
                                'text-danger': item.state === 'failed',
                                'text-muted': (item.state === 'queued' && !item.pausedByGuard) || item.state === 'launching',
                            }">{{ label(item) }}</div>
                        </div>
                        <button v-if="item.state === 'waiting'" class="btn btn-glass btn-sm !h-7 !px-2.5 !text-xs"
                            data-tip="Start the countdown without waiting" @click.stop="scheduler.startNow(item.uid)">Start now</button>
                        <svg v-else-if="item.state === 'done'" viewBox="0 0 16 16" class="w-4 h-4 text-ok" fill="none" stroke="currentColor"
                            stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
                    </div>
                </TransitionGroup>
            </div>
        </template>

        <!-- Running games -->
        <div v-else v-smooth class="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
            <TransitionGroup name="list" tag="div" class="relative space-y-1">
                <div v-for="game in runningGames" :key="game.uid" class="row group flex items-center gap-3 rounded-2xl px-2 py-1.5"
                    @click="focusedUid = game.uid!">
                    <GameAvatar :game="game" :size="30" status="online" />
                    <div class="min-w-0 flex-1">
                        <div class="text-[13px] font-semibold text-ink truncate">{{ game.name }}</div>
                        <div class="text-xs text-muted tabular-nums">
                            {{ elapsed(game) }}
                            <span v-if="runningExecutable(game)?.detected_at" class="text-ok">· seen by Discord</span>
                        </div>
                    </div>
                    <button class="icon-btn w-7 h-7 opacity-0 group-hover:opacity-100 hover:!text-danger" data-tip="Stop"
                        @click.stop="library.stop(game)">
                        <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
                    </button>
                </div>
            </TransitionGroup>
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
.row {
    transition: background-color 150ms ease, opacity 300ms ease;
}

.row:hover {
    background: var(--glass-2);
}

.row.running {
    background: var(--glass-2);
}

.row.done,
.row.failed {
    opacity: 0.6;
}

.bar {
    background: var(--accent);
}
</style>
