<script setup lang="ts">
import { computed } from 'vue';
import type { Game } from '@/types/types';
import { useGameLibrary } from '@/composables/game-library';
import { useScheduler } from '@/composables/scheduler';
import { useClock } from '@/composables/clock';
import { defaultExecutable, formatElapsed, getFilename, isGameRunning, runningExecutable } from '@/utils/executables';
import GameAvatar from './GameAvatar.vue';
import AnimatedCheckbox from './AnimatedCheckbox.vue';

/**
 * One game in the Library list. Its own component so a row only re-renders
 * when something about *this* game changes; the clock is only read while
 * the game is running or timed.
 */
const props = defineProps<{ game: Game; focused: boolean; someChecked: boolean }>();
const emit = defineEmits<{ focus: []; check: [event: MouseEvent] }>();

const library = useGameLibrary();
const scheduler = useScheduler();
const now = useClock();

type Tone = 'timer' | 'playing' | 'waiting' | 'queued' | 'idle';

/**
 * Second line under the game's name (only depends on the clock while it shows a
 * live time). It keeps the same object while the text stays the same, so a
 * timed run moving along only redraws the rows whose line really changed.
 */
const line = computed<{ text: string; tone: Tone }>(previous => {
    const next = status();
    return previous && previous.text === next.text && previous.tone === next.tone ? previous : next;
});

function status(): { text: string; tone: Tone } {
    const game = props.game;
    const t = scheduler.statusFor(game.uid!);
    if (t?.state === 'running' && t.endsAt) return { text: `${formatElapsed(Math.max(0, t.endsAt - now.value.getTime()))} left`, tone: 'timer' };
    if (t?.state === 'waiting') return { text: 'Waiting for Discord…', tone: 'waiting' };
    if (t?.state === 'queued' && t.pausedByGuard) return { text: 'Paused by Performance Guard', tone: 'waiting' };
    // a place in line only while it's near; far back it's just "Queued"
    if (t?.state === 'queued') return { text: t.position && t.position <= 99 ? `Up next · #${t.position}` : 'Queued', tone: 'queued' };
    const exe = runningExecutable(game);
    if (exe) return { text: `Playing · ${exe.started_at ? formatElapsed(now.value.getTime() - exe.started_at) : ''}`, tone: 'playing' };
    if (t?.state === 'done') return { text: 'Done ✓', tone: 'idle' };
    const def = defaultExecutable(game);
    return { text: def ? getFilename(def)! : 'No launchable executable', tone: 'idle' };
}

function play() {
    emit('focus');
    library.toggle(props.game);
}
</script>

<template>
    <div class="row group flex items-center gap-3 h-14 px-2.5 rounded-2xl" :data-uid="game.uid"
        :class="{ 'is-focused': focused, 'is-checked': library.checked.value.has(game.uid!) }"
        @click="emit('focus')" @dblclick="library.toggle(game)">
        <GameAvatar :game="game" :size="38"
            :status="isGameRunning(game) ? 'online' : scheduler.statusFor(game.uid!)?.state === 'waiting' ? 'idle' : null" />
        <div class="min-w-0 flex-1">
            <div class="text-sm font-semibold text-ink truncate">{{ game.name }}</div>
            <div class="text-xs truncate tabular-nums" :class="{
                'text-ok font-semibold': line.tone === 'playing',
                'text-accent font-semibold': line.tone === 'timer',
                'text-warn': line.tone === 'waiting',
                'text-muted': line.tone === 'queued',
                'text-faint font-mono': line.tone === 'idle',
            }">{{ line.text }}</div>
        </div>
        <button class="mini-play" :class="{ running: isGameRunning(game) }"
            :disabled="library.busy.value.has(game.uid!) || !defaultExecutable(game)"
            :aria-label="isGameRunning(game) ? 'Stop' : 'Play'"
            @mousedown.prevent @dblclick.stop @click.stop="play">
            <span v-if="library.busy.value.has(game.uid!)" class="spinner !w-3 !h-3"></span>
            <svg v-else-if="isGameRunning(game)" viewBox="0 0 24 24" class="w-3 h-3" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
            <svg v-else viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="currentColor"><path d="M7 5.5v13L18 12z" /></svg>
        </button>
        <AnimatedCheckbox :checked="library.checked.value.has(game.uid!)" :label="`Check ${game.name}`"
            :class="someChecked ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity'"
            @toggle="emit('check', $event)" />
    </div>
</template>

<style scoped>
.row {
    transition: background-color 160ms ease, box-shadow 200ms ease;
    /* rows out of view skip layout and painting, so showing the Library page
       again stays quick however far the list was scrolled */
    content-visibility: auto;
    contain-intrinsic-size: auto 56px;
}

.row:hover {
    background: var(--glass-2);
}

.row.is-checked {
    background: var(--accent-soft);
}

.row.is-focused {
    background: var(--glass-3);
    box-shadow: inset 0 0 0 1px var(--line-strong), inset 0 1px 0 var(--highlight);
}

.row.is-focused.is-checked {
    background: color-mix(in srgb, var(--accent) 22%, var(--glass-2));
}

.mini-play {
    display: grid;
    place-items: center;
    width: 1.875rem;
    height: 1.875rem;
    border-radius: 999px;
    flex-shrink: 0;
    color: var(--ink);
    background: var(--glass-2);
    box-shadow: inset 0 0 0 1px var(--line);
    opacity: 0;
    transform: scale(0.85);
    transition: opacity 160ms ease, transform 260ms var(--ease-spring), background 160ms ease, color 160ms ease;
}

.row:hover .mini-play,
.row.is-focused .mini-play,
.mini-play.running {
    opacity: 1;
    transform: scale(1);
}

.mini-play:hover:not(:disabled) {
    background: var(--btn);
    color: var(--btn-ink);
    box-shadow: none;
}

.mini-play.running {
    color: var(--danger);
    background: var(--danger-soft);
}

.mini-play.running:hover:not(:disabled) {
    background: var(--danger);
    color: #fff;
}

.mini-play:disabled {
    opacity: 0.3;
}
</style>
