<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { refDebounced } from '@vueuse/core';
import type { Game } from '@/types/types';
import { useGameDB } from '@/composables/game-db';
import { useGameLibrary } from '@/composables/game-library';
import { useGameSearch } from '@/composables/game-search';
import { getFilename, platformExecutables, validExecutables } from '@/utils/executables';
import { smoothScrollIntoView, vSmooth } from '@/directives/smooth-scroll';
import GameAvatar from './GameAvatar.vue';
import BaseModal from './BaseModal.vue';
import TypingInput from './TypingInput.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { gameDB, allFetchDone } = useGameDB();
const library = useGameLibrary();

const inputRef = useTemplateRef<InstanceType<typeof TypingInput>>('inputRef');
const listRef = useTemplateRef<HTMLElement>('listRef');

const query = shallowRef('');
const debouncedQuery = refDebounced(query, 70);
const activeIndex = ref(0);
/** ids that were just added: they stay visible briefly to show the checkmark */
const justAdded = ref(new Set<string>());

watch(() => props.open, open => {
    if (open) nextTick(() => { inputRef.value?.focus(); inputRef.value?.select(); });
    else lastRandom.value = null;
});

// The fuzzy search over ~25k games runs in a background worker, so typing
// stays smooth; results then appear one after another (see .result below).
const gameSearch = useGameSearch();
const results = shallowRef<Game[]>([]);
const searching = ref(false);
let searchSeq = 0;
watch(debouncedQuery, async q => {
    const mine = ++searchSeq;
    if (!q.trim()) {
        results.value = [];
        searching.value = false;
        return;
    }
    searching.value = true;
    // over-fetch, since games already in the library are filtered out below
    const found = await gameSearch.search(q, 40);
    if (mine !== searchSeq) return;
    results.value = found;
    searching.value = false;
});

const visibleResults = computed(() =>
    results.value
        .filter(game => !library.addedIds.value.has(game.id) || justAdded.value.has(game.id))
        .slice(0, 9)
);

const hiddenAddedCount = computed(() =>
    results.value.slice(0, 9).filter(g => library.addedIds.value.has(g.id) && !justAdded.value.has(g.id)).length
);

watch(debouncedQuery, () => { activeIndex.value = 0; });
watch(visibleResults, list => {
    if (activeIndex.value >= list.length) activeIndex.value = Math.max(0, list.length - 1);
});

function exeSummary(game: Game) {
    const names = platformExecutables(game).map(e => getFilename(e)).filter(Boolean) as string[];
    const unique = [...new Set(names)];
    return unique.length > 2 ? `${unique.slice(0, 2).join(', ')} +${unique.length - 2}` : unique.join(', ');
}

// Games without any launchable executable need confirmation before adding
const pendingNoExe = ref<Game | null>(null);
const confirmBtnRef = useTemplateRef<HTMLButtonElement>('confirmBtnRef');

function add(game: Game, andPlay = false) {
    if (justAdded.value.has(game.id)) return;
    if (validExecutables(game).length === 0) {
        pendingNoExe.value = game;
        nextTick(() => confirmBtnRef.value?.focus());
        return;
    }
    commitAdd(game, andPlay);
}

async function commitAdd(game: Game, andPlay = false) {
    const added = library.addGame(game);
    justAdded.value.add(game.id);
    setTimeout(() => justAdded.value.delete(game.id), 900);
    if (andPlay) await library.launch(added);
}

function resolveNoExe(proceed: boolean) {
    const game = pendingNoExe.value;
    pendingNoExe.value = null;
    if (proceed && game) commitAdd(game);
    nextTick(() => inputRef.value?.focus());
}

// ----- random games -----
// With the search empty, from every game; otherwise from every game the search
// matches (not just the few shown). Only new games that can be launched count,
// since the others couldn't do anything for a quest.
const RANDOM_COUNTS = [1, 5, 10, 50, 100] as const;
const randomBusy = ref(false);
/** the last random add: its summary, and what Undo removes */
const lastRandom = ref<{ uids: string[]; names: string[]; asked: number; query: string } | null>(null);

function pickRandom<T>(pool: T[], count: number): T[] {
    const copy = pool.slice();
    const n = Math.min(count, copy.length);
    for (let i = 0; i < n; i++) {
        const j = i + Math.floor(Math.random() * (copy.length - i));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
}

async function addRandom(count: number) {
    if (randomBusy.value || gameDB.value.length === 0) return;
    randomBusy.value = true;
    const q = query.value.trim();
    try {
        const matches = await gameSearch.searchAll(q);
        const pool = matches.filter(g => !library.addedIds.value.has(g.id) && validExecutables(g).length > 0);
        const added = library.addGames(pickRandom(pool, count));
        lastRandom.value = { uids: added.map(g => g.uid!), names: added.map(g => g.name), asked: count, query: q };
    } finally {
        randomBusy.value = false;
    }
}

async function undoRandom() {
    const last = lastRandom.value;
    lastRandom.value = null;
    if (last?.uids.length) await library.removeGames(last.uids);
    nextTick(() => inputRef.value?.focus());
}

const plural = (n: number) => `${n} random game${n === 1 ? '' : 's'}`;
const randomSummary = computed(() => {
    const last = lastRandom.value;
    if (!last) return '';
    const n = last.uids.length;
    const where = last.query ? ` matching “${last.query}”` : '';
    if (n === 0) return last.query ? `No new games match “${last.query}” that can be launched.` : 'There are no new games left to add.';
    if (n < last.asked) return `Added ${plural(n)}${where}: that's every new one.`;
    return `Added ${plural(n)}${where}.`;
});
const randomNames = computed(() => {
    const names = lastRandom.value?.names ?? [];
    return names.length > 4 ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more` : names.join(', ');
});

function move(delta: number) {
    const n = visibleResults.value.length;
    if (n === 0) return;
    activeIndex.value = (activeIndex.value + delta + n) % n;
    nextTick(() => {
        const row = listRef.value?.querySelector<HTMLElement>(`[data-index="${activeIndex.value}"]`);
        if (row && listRef.value) smoothScrollIntoView(listRef.value, row);
    });
}

function onKeydown(e: KeyboardEvent) {
    // Alt+1 to Alt+5: add 1, 5, 10, 50 or 100 random games
    const randomIndex = e.altKey && !e.ctrlKey && !e.metaKey ? ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code) : -1;
    if (randomIndex >= 0) {
        e.preventDefault();
        addRandom(RANDOM_COUNTS[randomIndex]);
        return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') {
        const game = visibleResults.value[activeIndex.value];
        if (game) {
            e.preventDefault();
            add(game, e.ctrlKey || e.metaKey);
        }
    }
}

const examples = ['VALORANT', 'Genshin Impact', 'Minecraft', 'Fortnite', 'Rocket League', 'Apex Legends'];
</script>

<template>
    <BaseModal :open="open" bare placement="top" width="40rem" @close="emit('close')">
        <div class="flex items-center gap-3 h-16 px-5 border-b border-line">
            <svg viewBox="0 0 24 24" class="w-5 h-5 text-muted shrink-0" fill="none" stroke="currentColor" stroke-width="2.2"
                stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <TypingInput ref="inputRef" v-model="query" type="text" spellcheck="false" autocomplete="off"
                aria-label="Search games" placeholder="Search games to add…"
                class="flex-1 text-xl text-ink display" @keydown="onKeydown" />
            <span class="kbd">esc</span>
        </div>

        <!-- random games: from everything, or from what the search matches -->
        <div class="flex items-center gap-3 px-5 h-12 border-b border-line">
            <svg viewBox="0 0 24 24" class="w-[18px] h-[18px] text-muted shrink-0" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
                <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
                <circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" stroke="none" /></svg>
            <span class="text-sm font-semibold text-ink-2 shrink-0">Add random</span>
            <div class="seg !p-[2px] shrink-0" role="group" aria-label="Add random games">
                <button v-for="(n, i) in RANDOM_COUNTS" :key="n" class="!h-7 !px-3 tabular-nums disabled:opacity-40"
                    :disabled="randomBusy || gameDB.length === 0" :data-tip="`Add ${n} random game${n === 1 ? '' : 's'} (Alt+${i + 1})`"
                    @click="addRandom(n)">{{ n }}</button>
            </div>
            <span v-if="randomBusy" class="spinner !w-3.5 !h-3.5 text-muted"></span>
            <span class="ml-auto text-xs text-muted truncate">
                {{ query.trim() ? `from games matching “${query.trim()}”` : 'from every game' }}
            </span>
        </div>

        <div ref="listRef" v-smooth class="relative max-h-[22rem] overflow-y-auto p-2">
            <Transition name="rise">
                <div v-if="lastRandom" class="random-note flex items-center gap-3 rounded-xl px-3 py-2.5 mb-1.5">
                    <div class="min-w-0 flex-1">
                        <div class="text-sm font-semibold text-ink">{{ randomSummary }}</div>
                        <div v-if="randomNames" class="text-xs text-muted truncate">{{ randomNames }}</div>
                    </div>
                    <button v-if="lastRandom.uids.length" class="btn btn-glass btn-sm !h-8 shrink-0" @click="undoRandom">Undo</button>
                </div>
            </Transition>

            <div v-if="!query" class="px-3 py-3 text-sm text-muted">
                Search Discord's list of detectable games, or add random ones above. Games already in your library are hidden.
            </div>

            <div v-else-if="gameDB.length === 0 && !allFetchDone" class="px-3 py-3 flex items-center gap-2 text-sm text-muted">
                <span class="spinner"></span> Loading the game list…
            </div>

            <template v-else>
                <TransitionGroup name="list" tag="div" class="relative">
                    <div v-for="(game, i) in visibleResults" :key="game.id" :data-index="i"
                        class="result flex items-center gap-3 h-12 px-3 rounded-xl"
                        :class="{ 'is-active': i === activeIndex, 'is-added': justAdded.has(game.id) }"
                        :style="{ '--stagger': `${i * 38}ms` }"
                        @mouseenter="activeIndex = i" @click="add(game)">
                        <GameAvatar :game="game" :size="30" />
                        <div class="min-w-0 flex-1">
                            <div class="text-[15px] font-medium text-ink truncate">{{ game.name }}</div>
                        </div>
                        <span class="text-xs text-muted truncate font-mono max-w-[40%]">
                            <template v-if="validExecutables(game).length">{{ exeSummary(game) }}</template>
                            <span v-else class="text-warn font-sans">no executable</span>
                        </span>
                        <Transition name="pop" mode="out-in">
                            <span v-if="justAdded.has(game.id)" key="added" class="chip !text-ok">
                                <svg viewBox="0 0 16 16" class="w-3.5 h-3.5 added-check" fill="none" stroke="currentColor"
                                    stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
                                Added
                            </span>
                            <span v-else-if="i === activeIndex" key="hint" class="flex items-center gap-1 shrink-0">
                                <button class="icon-btn w-7 h-7" data-tip="Add & play (Ctrl+Enter)" @click.stop="add(game, true)">
                                    <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="currentColor"><path d="M7 5.5v13L18 12z" /></svg>
                                </button>
                                <span class="kbd">↵</span>
                            </span>
                        </Transition>
                    </div>
                </TransitionGroup>

                <div v-if="visibleResults.length === 0" class="px-3 py-3 flex items-center gap-2 text-sm text-muted">
                    <template v-if="searching || query !== debouncedQuery">
                        <span class="spinner !w-3.5 !h-3.5"></span>
                        {{ gameSearch.ready.value ? 'Searching…' : 'Getting the game list ready…' }}
                    </template>
                    <template v-else-if="hiddenAddedCount > 0">Everything matching is already in your library.</template>
                    <template v-else>No games match “{{ query }}”.</template>
                </div>
            </template>
        </div>

        <div class="flex items-center gap-4 px-5 h-11 border-t border-line text-xs text-muted">
            <span><span class="kbd">↑</span> <span class="kbd">↓</span> navigate</span>
            <span><span class="kbd">↵</span> add</span>
            <span><span class="kbd">Ctrl</span> <span class="kbd">↵</span> add &amp; play</span>
            <span><span class="kbd">Alt</span> <span class="kbd">1-5</span> random</span>
            <span v-if="hiddenAddedCount > 0" class="ml-auto">{{ hiddenAddedCount }} already added</span>
        </div>
    </BaseModal>

    <BaseModal :open="!!pendingNoExe" eyebrow="Heads up" title="This one can't be launched." @close="resolveNoExe(false)">
        <div v-if="pendingNoExe" class="flex items-center gap-3 rounded-2xl bg-glass p-3 mb-4 border border-line">
            <GameAvatar :game="pendingNoExe" :size="42" />
            <div class="min-w-0">
                <div class="font-semibold text-ink truncate">{{ pendingNoExe.name }}</div>
                <div class="text-xs text-muted font-mono">{{ pendingNoExe.id }}</div>
            </div>
        </div>
        <p class="text-sm text-ink-2 leading-relaxed">
            Discord hasn't registered an executable for this game, so it
            <span class="text-warn font-semibold">can't be launched</span> and won't count toward a quest.
            Launch all and timed runs will skip it.
        </p>
        <p class="text-sm text-ink-2 mt-3">Add it to your library anyway?</p>
        <template #footer>
            <button class="btn btn-glass" @click="resolveNoExe(false)">Cancel</button>
            <button ref="confirmBtnRef" class="btn btn-primary" @click="resolveNoExe(true)">Add anyway</button>
        </template>
    </BaseModal>
</template>

<style scoped>
.result {
    transition: background-color 120ms ease;
}

/* new results come in one after another instead of all at once */
.result.list-enter-active {
    transition: opacity 260ms ease, transform 480ms var(--ease-quint), background-color 120ms ease;
    transition-delay: var(--stagger, 0ms), var(--stagger, 0ms), 0ms;
}

.result.list-move {
    transition: transform 420ms var(--ease-quint), background-color 120ms ease;
}

.result.list-leave-active {
    transition: opacity 140ms ease, transform 180ms ease;
}

.result.is-active {
    background: var(--glass-3);
}

.result.is-added {
    background: var(--ok-soft);
}

.random-note {
    background: var(--ok-soft);
    border: 1px solid color-mix(in srgb, var(--ok) 35%, transparent);
}

.added-check path {
    stroke-dasharray: 16;
    animation: draw 380ms var(--ease-quint) both;
}

@keyframes draw {
    from {
        stroke-dashoffset: 16;
    }
    to {
        stroke-dashoffset: 0;
    }
}
</style>
