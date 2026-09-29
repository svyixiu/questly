<script setup lang="ts">
import { computed } from 'vue';
import type { Game } from '@/types/types';
import { useGameLibrary } from '@/composables/game-library';
import { useClock } from '@/composables/clock';
import { formatElapsed, runningExecutable } from '@/utils/executables';
import GameAvatar from './GameAvatar.vue';

/** A running game in the Activity panel; only this row redraws as its time goes up. */
const props = defineProps<{ game: Game }>();

const library = useGameLibrary();
const { focusedUid } = library;
const now = useClock();

const exe = computed(() => runningExecutable(props.game));
const elapsed = computed(() => exe.value?.started_at ? formatElapsed(now.value.getTime() - exe.value.started_at) : '');
</script>

<template>
    <div class="row group flex items-center gap-3 rounded-2xl px-2 py-1.5" @click="focusedUid = game.uid!">
        <GameAvatar :game="game" :size="30" status="online" />
        <div class="min-w-0 flex-1">
            <div class="text-[13px] font-semibold text-ink truncate">{{ game.name }}</div>
            <div class="text-xs text-muted tabular-nums">
                {{ elapsed }}
                <span v-if="exe?.detected_at" class="text-ok">· seen by Discord</span>
            </div>
        </div>
        <button class="icon-btn w-7 h-7 opacity-0 group-hover:opacity-100 hover:!text-danger" data-tip="Stop"
            @click.stop="library.stop(game)">
            <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
        </button>
    </div>
</template>

<style scoped>
.row {
    transition: background-color 150ms ease;
}

.row:hover {
    background: var(--glass-2);
}
</style>
