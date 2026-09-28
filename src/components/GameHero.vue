<script setup lang="ts">
import { computed, ref } from 'vue';
import { useNow } from '@vueuse/core';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import type { Game } from '@/types/types';
import { useGameLibrary } from '@/composables/game-library';
import { useScheduler } from '@/composables/scheduler';
import { useDiscordDetect } from '@/composables/discord-detect';
import { useToasts } from '@/composables/toasts';
import { useRpcState } from '@/composables/rpc-state';
import { defaultExecutable, formatElapsed, getFilename, runningExecutable } from '@/utils/executables';
import GameAvatar from './GameAvatar.vue';
import BaseModal from './BaseModal.vue';

const props = defineProps<{ game: Game }>();

const library = useGameLibrary();
const scheduler = useScheduler();
const discord = useDiscordDetect();
const { toast } = useToasts();
const now = useNow({ interval: 250 });

const running = computed(() => runningExecutable(props.game));
const busy = computed(() => library.busy.value.has(props.game.uid!));
const timer = computed(() => scheduler.statusFor(props.game.uid!));

/** What the ring shows: progress 0..1, the big number and its caption. */
const ring = computed(() => {
    const t = timer.value;
    const r = scheduler.run.value;
    const nowMs = now.value.getTime();
    if (t?.state === 'running' && t.endsAt && r) {
        const left = Math.max(0, t.endsAt - nowMs);
        return { progress: 1 - left / r.durationMs, value: formatElapsed(left), caption: 'left', mode: 'timer' };
    }
    if (t?.state === 'waiting') return { progress: 0, value: '···', caption: 'waiting for Discord', mode: 'waiting' };
    if (t?.state === 'queued') return { progress: 0, value: t.position ? `#${t.position}` : '—', caption: 'in queue', mode: 'idle' };
    if (running.value?.started_at) {
        return { progress: 1, value: formatElapsed(nowMs - running.value.started_at), caption: 'playing', mode: 'playing' };
    }
    return { progress: 0, value: '—', caption: 'not running', mode: 'idle' };
});

const CIRC = 2 * Math.PI * 54;

const detection = computed(() => {
    const exe = running.value;
    if (!exe) return null;
    if (exe.detected_at) return { tone: 'ok', text: 'Discord detected it' };
    if (!discord.available.value) return { tone: 'muted', text: "Running (Discord's log not found)" };
    return { tone: 'warn', text: 'Waiting for Discord to notice…' };
});

function copyId() {
    navigator.clipboard?.writeText(props.game.id)
        .then(() => toast('success', 'Copied the application ID', props.game.id, 1800))
        .catch(() => {});
}

// ----- Experimental RPC mode -----
const rpcState = useRpcState();
const showRpcWarning = ref(false);
const rpcActiveHere = computed(() => rpcState.gameId.value === props.game.id);

function toggleRpc() {
    if (rpcState.connecting.value || rpcState.gameId.value) {
        emit('event_disconnect');
        rpcState.gameId.value = null;
        rpcState.connecting.value = false;
        return;
    }
    showRpcWarning.value = true;
}

function continueRpcRisk() {
    showRpcWarning.value = false;
    const game = props.game;
    rpcState.connecting.value = true;
    invoke('connect_to_discord_rpc_3', {
        activity_json: JSON.stringify({ app_id: game.id }),
        action: 'connect',
    }).then(() => {
        rpcState.gameId.value = game.id;
        toast('success', `RPC activity set for ${game.name}`);
    }).catch(error => {
        toast('error', 'RPC connection failed', String(error));
    }).finally(() => {
        rpcState.connecting.value = false;
    });
}
</script>

<template>
    <div class="relative flex items-center gap-6 px-7 py-6 h-full overflow-hidden">
        <span class="absolute top-[18px] right-[18px] w-3 h-3 rounded-full bg-ink" aria-hidden="true"></span>

        <div class="relative shrink-0">
            <div class="icon-shell">
                <GameAvatar :game="game" :size="96" />
            </div>
        </div>

        <div class="relative min-w-0 flex-1">
            <div class="eyebrow mb-1.5 flex items-center gap-2">
                <span>Selected game</span><span>·</span>
                <button class="eyebrow hover:!text-ink transition-colors tabular-nums" data-tip="Copy application ID"
                    @click="copyId">ID {{ game.id }}</button>
            </div>
            <h1 class="display text-[34px] leading-[36px] text-ink truncate selectable">
                {{ game.name }}
            </h1>

            <div class="flex flex-wrap items-center gap-2 mt-3">
                <Transition name="pop" mode="out-in">
                    <span v-if="detection" :key="detection.text" class="chip"
                        :class="{ '!text-ink !border-ink': detection.tone === 'ok' }">
                        <svg v-if="detection.tone === 'ok'" viewBox="0 0 16 16" class="w-3.5 h-3.5" fill="none" stroke="currentColor"
                            stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
                        <span v-else-if="detection.tone === 'warn'" class="wait-dot"></span>
                        {{ detection.text }}
                    </span>
                    <span v-else class="chip">Not running</span>
                </Transition>
                <span v-if="running" class="chip font-mono !font-normal">{{ getFilename(running) }}</span>
            </div>

            <div class="flex items-center gap-2 mt-5">
                <button class="btn min-w-[7.5rem]" :class="running ? 'btn-danger' : 'btn-primary'"
                    :disabled="busy || !defaultExecutable(game)" @click="library.toggle(game)">
                    <span v-if="busy" class="spinner"></span>
                    <svg v-else-if="running" viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
                    <svg v-else viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor"><path d="M7 5.5v13L18 12z" /></svg>
                    {{ running ? 'Stop' : 'Play' }}
                </button>
                <Transition name="pop">
                    <button v-if="timer?.state === 'waiting'" class="btn btn-glass btn-sm"
                        data-tip="Don't wait for Discord; start the countdown now" @click="scheduler.startNow(game.uid!)">
                        Start countdown now
                    </button>
                </Transition>
                <button class="icon-btn" data-tip="Remove from library" @click="library.removeGame(game)">
                    <svg viewBox="0 0 24 24" class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
                </button>
                <button class="icon-btn" :class="{ '!text-warn': rpcActiveHere }"
                    :data-tip="rpcActiveHere ? 'Disconnect RPC' : 'Experimental: set activity via RPC'" @click="toggleRpc">
                    <svg viewBox="0 0 24 24" class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" /></svg>
                </button>
            </div>
        </div>

        <!-- progress ring -->
        <div class="relative shrink-0 w-[132px] h-[132px]">
            <svg viewBox="0 0 120 120" class="w-full h-full -rotate-90">
                <circle cx="60" cy="60" r="54" fill="none" stroke="var(--line)" stroke-width="6" />
                <circle cx="60" cy="60" r="54" fill="none" stroke="var(--accent)" stroke-width="6" stroke-linecap="round"
                    :class="{ spinning: ring.mode === 'waiting' }"
                    :stroke-dasharray="CIRC"
                    :stroke-dashoffset="ring.mode === 'waiting' ? CIRC * 0.75 : CIRC * (1 - Math.min(1, Math.max(0, ring.progress)))"
                    style="transition: stroke-dashoffset 400ms linear" />
            </svg>
            <div class="absolute inset-0 grid place-items-center text-center">
                <div>
                    <div class="display text-[26px] text-ink tabular-nums leading-7">{{ ring.value }}</div>
                    <div class="text-[11px] text-muted mt-0.5 max-w-[88px] leading-tight">{{ ring.caption }}</div>
                </div>
            </div>
        </div>

        <BaseModal :open="showRpcWarning" eyebrow="Experimental" title="Set activity through RPC?" @close="showRpcWarning = false">
            <div class="text-sm text-ink-2 leading-relaxed space-y-3">
                <p>This sets your Discord activity through RPC using the game's actual ID, rather than letting Discord
                    detect a running game or application.</p>
                <p class="text-warn font-medium">It may flag your account as suspicious for self-botting.</p>
            </div>
            <template #footer>
                <button class="btn btn-glass" @click="showRpcWarning = false">Cancel</button>
                <button class="btn btn-danger" @click="continueRpcRisk">Accept risk and continue</button>
            </template>
        </BaseModal>
    </div>
</template>

<style scoped>
.icon-shell {
    padding: 5px;
    border-radius: 29px;
    border: 1px solid var(--line-strong);
}

.spinning {
    transform-origin: 60px 60px;
    animation: ring-spin 1.2s linear infinite;
}

@keyframes ring-spin {
    to {
        transform: rotate(360deg);
    }
}
</style>
