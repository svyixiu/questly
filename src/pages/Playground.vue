<template>
    <div class="h-full px-4 pt-3 pb-4">
        <section class="glass h-full flex flex-col overflow-hidden">
            <header class="flex items-center gap-3 px-6 pt-5 pb-4">
                <div>
                    <div class="eyebrow">Activity</div>
                    <h1 class="display text-[30px] leading-[34px] text-ink mt-1">Everything, as it happened.</h1>
                </div>
                <div class="ml-auto flex items-center gap-2">
                    <div class="seg">
                        <button v-for="f in filters" :key="f" :class="{ on: filter === f }" class="capitalize" @click="filter = f">{{ f }}</button>
                    </div>
                    <button class="btn btn-sm" :class="isConnected ? 'btn-danger' : 'btn-glass'"
                        data-tip="Sends a sample activity through Discord RPC" data-tip-pos="bottom" @click="discordTest">
                        {{ isConnected ? 'Disconnect RPC' : 'RPC test' }}
                    </button>
                    <button class="icon-btn" data-tip="Clear" data-tip-pos="bottom" @click="clearLogs">
                        <svg viewBox="0 0 24 24" class="w-[18px] h-[18px]" fill="none" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
                    </button>
                </div>
            </header>

            <div ref="logContainer" v-smooth class="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
                <div v-if="visibleLogs.length === 0" class="h-full grid place-items-center text-sm text-muted">Nothing yet.</div>
                <ol v-else class="timeline selectable">
                    <li v-for="log in visibleLogs" :key="log.id" class="entry" :class="log.type">
                        <span class="dot"></span>
                        <span class="time">{{ time(log.timestamp) }}</span>
                        <span class="msg">
                            <span v-if="log.type !== 'info'" class="level">{{ log.type }}</span>
                            {{ log.message }}
                        </span>
                    </li>
                </ol>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { useGlobalState } from '@/composables/app-state';
import { useGameLibrary } from '@/composables/game-library';
import { useToasts } from '@/composables/toasts';
import { useRpcState } from '@/composables/rpc-state';
import { smoothScrollTo, vSmooth } from '@/directives/smooth-scroll';

const ActivityKind = {
    Playing: 0,
    Listening: 2,
    Watching: 3,
    Competing: 5
} as const;

// shared, so Panic Abort can clear it
const { testConnected: isConnected } = useRpcState();

const { logs, clearLogs } = useGlobalState();
const library = useGameLibrary();
const { toast } = useToasts();


const filters = ['all', 'info', 'warning', 'error', 'debug'] as const;
const filter = ref<typeof filters[number]>('all');
const visibleLogs = computed(() =>
    filter.value === 'all' ? logs.value : logs.value.filter(l => l.type === filter.value)
);

function time(d: Date) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Keep the view pinned to the newest entry, unless the user scrolled up
const logContainer = useTemplateRef<HTMLElement>('logContainer');
watch(() => logs.value.length, async () => {
    const el = logContainer.value;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    await nextTick();
    if (nearBottom) smoothScrollTo(el, el.scrollHeight);
});

/** Sets a plain "Playing <selected game>" activity: the game's own app ID, nothing else. */
function discordTest() {
    if (isConnected.value) {
        emit('event_disconnect');
        isConnected.value = false;
        return;
    }
    const game = library.focusedGame.value;
    if (!game) {
        toast('info', 'Select a game first', 'The RPC test shows you playing the game selected in your Library.');
        return;
    }
    invoke('connect_to_discord_rpc_3', {
        activity_json: JSON.stringify({
            app_id: game.id,
            activity_kind: ActivityKind.Playing,
            timestamp: Math.floor(Date.now() / 1000),
        }),
        action: 'connect',
    });
    isConnected.value = true;
    toast('success', `RPC test: playing ${game.name}`);
}

// function to create timestamp behind current time.
// example: input is `4h 30m` means timestamp should start from 4 hours and 30 minutes behind current time.
function createAgoTimestamp(input: string) {
    const time = input.split(' ');
    let hours = 0;
    let minutes = 0;

    for (let i = 0; i < time.length; i++) {
        if (time[i].includes('h')) {
            hours = parseInt(time[i]);
        } else if (time[i].includes('m')) {
            minutes = parseInt(time[i]);
        }
    }

    const date = new Date();
    date.setHours(date.getHours() - hours);
    date.setMinutes(date.getMinutes() - minutes);

    return Math.floor(date.getTime() / 1000);
}

</script>

<style scoped>
/* vertical timeline */
.timeline {
    position: relative;
    padding-left: 18px;
}

.timeline::before {
    content: "";
    position: absolute;
    left: 4px;
    top: 6px;
    bottom: 6px;
    width: 1.5px;
    background: linear-gradient(to bottom, transparent, var(--line-strong) 24px, var(--line-strong) calc(100% - 24px), transparent);
}

.entry {
    position: relative;
    display: grid;
    grid-template-columns: 72px 1fr;
    gap: 12px;
    padding: 6px 0;
    font-size: 0.8125rem;
    line-height: 1.35rem;
}

.dot {
    position: absolute;
    left: -18px;
    top: 12px;
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: var(--glass-3);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--bg) 60%, transparent);
}

.entry.info .dot {
    background: var(--accent);
}

.entry.error .dot {
    background: var(--danger);
    box-shadow: 0 0 10px var(--danger);
}

.entry.warning .dot {
    background: var(--warn);
}

.entry.debug .dot {
    background: var(--ok);
}

.time {
    color: var(--faint);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
}

.msg {
    color: var(--ink-2);
    word-break: break-word;
}

.level {
    display: inline-block;
    margin-right: 6px;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    line-height: 1.1rem;
    vertical-align: 1px;
}

.entry.error .level {
    background: var(--danger-soft);
    color: var(--danger);
}

.entry.warning .level {
    background: var(--warn-soft);
    color: var(--warn);
}

.entry.debug .level {
    background: var(--ok-soft);
    color: var(--ok);
}
</style>
