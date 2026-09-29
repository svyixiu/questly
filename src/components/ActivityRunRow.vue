<script setup lang="ts">
import { computed } from 'vue';
import type { Game } from '@/types/types';
import { useGameLibrary } from '@/composables/game-library';
import { useScheduler, type RunItem } from '@/composables/scheduler';
import { useClock } from '@/composables/clock';
import { formatElapsed } from '@/utils/executables';
import GameAvatar from './GameAvatar.vue';

/**
 * One game of a timed run in the Activity panel. Its own component so the
 * countdown ticking only redraws this row, not the whole animated list.
 */
const props = defineProps<{ item: RunItem; index: number; game: Game; durationMs: number; numberWidth: string }>();

const { focusedUid } = useGameLibrary();
const scheduler = useScheduler();
const now = useClock();

const label = computed(() => {
    const item = props.item;
    switch (item.state) {
        case 'queued': return item.pausedByGuard
            ? `Paused by Performance Guard · ${formatElapsed(item.remainingMs ?? props.durationMs)} left`
            : 'Queued';
        case 'launching': return 'Launching…';
        case 'waiting': return 'Waiting for Discord…';
        case 'running': return `${formatElapsed(Math.max(0, (item.endsAt ?? 0) - now.value.getTime()))} left`;
        case 'done': return 'Done';
        case 'failed': return 'Failed';
    }
    return '';
});
</script>

<template>
    <div class="row flex items-center gap-3 rounded-2xl px-2 py-1.5" :class="item.state" @click="focusedUid = game.uid!">
        <span class="shrink-0 text-center text-xs font-semibold text-faint tabular-nums" :class="numberWidth">{{ index + 1 }}</span>
        <GameAvatar :game="game" :size="30" :status="item.state === 'running' ? 'online' : item.state === 'waiting' ? 'idle' : null" />
        <div class="min-w-0 flex-1">
            <div class="text-[13px] font-semibold text-ink truncate">{{ game.name }}</div>
            <div class="text-xs tabular-nums truncate" :class="{
                'text-accent font-semibold': item.state === 'running',
                'text-warn': item.state === 'waiting' || (item.state === 'queued' && item.pausedByGuard),
                'text-ok': item.state === 'done',
                'text-danger': item.state === 'failed',
                'text-muted': (item.state === 'queued' && !item.pausedByGuard) || item.state === 'launching',
            }">{{ label }}</div>
        </div>
        <button v-if="item.state === 'waiting'" class="btn btn-glass btn-sm !h-7 !px-2.5 !text-xs"
            data-tip="Start the countdown without waiting" @click.stop="scheduler.startNow(item.uid)">Start now</button>
        <svg v-else-if="item.state === 'done'" viewBox="0 0 16 16" class="w-4 h-4 text-ok" fill="none" stroke="currentColor"
            stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
    </div>
</template>

<style scoped>
.row {
    transition: background-color 150ms ease, opacity 300ms ease;
}

.row:hover,
.row.running {
    background: var(--glass-2);
}

.row.done,
.row.failed {
    opacity: 0.6;
}
</style>
