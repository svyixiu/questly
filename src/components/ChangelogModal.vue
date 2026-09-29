<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseModal from './BaseModal.vue';
import { CHANGE_KINDS, CHANGELOG, ORIGIN, formatReleaseDate, type ChangeKind } from '@/data/changelog';
import { LINKS, openLink } from '@/data/legal';

/** Every change in Questly, newest first, filterable by kind. */
const props = defineProps<{ open: boolean; currentVersion?: string }>();
const emit = defineEmits<{ close: [] }>();

const filter = ref<ChangeKind | 'all'>('all');
watch(() => props.open, open => { if (open) filter.value = 'all'; });

const counts = computed(() => {
    const c: Record<string, number> = { all: 0 };
    for (const release of CHANGELOG) {
        for (const change of release.changes) {
            c[change.kind] = (c[change.kind] ?? 0) + 1;
            c.all++;
        }
    }
    return c;
});

const kinds = computed(() => CHANGE_KINDS.filter(k => counts.value[k.id]));
const label = (kind: ChangeKind) => CHANGE_KINDS.find(k => k.id === kind)?.label ?? kind;

const releases = computed(() =>
    CHANGELOG
        .map(r => ({ ...r, changes: filter.value === 'all' ? r.changes : r.changes.filter(c => c.kind === filter.value) }))
        .filter(r => r.changes.length > 0)
);
</script>

<template>
    <BaseModal :open="open" eyebrow="Changelog" title="Everything that changed." width="46rem" @close="emit('close')">
        <!-- filters: every kind of change -->
        <div class="filters">
            <button :class="{ on: filter === 'all' }" @click="filter = 'all'">All <span>{{ counts.all }}</span></button>
            <button v-for="k in kinds" :key="k.id" :class="['k-' + k.id, { on: filter === k.id }]" @click="filter = k.id">
                {{ k.label }} <span>{{ counts[k.id] }}</span>
            </button>
        </div>

        <TransitionGroup name="list" tag="ol" class="relative mt-2">
            <li v-for="release in releases" :key="release.version" class="release">
                <div class="flex items-baseline gap-2.5 flex-wrap">
                    <span class="version">{{ release.version }}</span>
                    <span v-if="release.version === currentVersion" class="badge current">You have this</span>
                    <span v-else-if="release.preview" class="badge">Preview</span>
                    <span class="font-semibold text-ink text-[15px]">{{ release.title }}</span>
                    <span class="ml-auto text-xs text-muted tabular-nums">{{ formatReleaseDate(release.date) }}</span>
                </div>
                <ul class="mt-2.5 space-y-1.5">
                    <li v-for="(change, i) in release.changes" :key="i" class="change">
                        <span class="kind" :class="'k-' + change.kind">{{ label(change.kind) }}</span>
                        <span class="text-[13.5px] text-ink-2 leading-snug">{{ change.text }}</span>
                    </li>
                </ul>
            </li>
        </TransitionGroup>

        <div v-if="filter === 'all'" class="origin">
            <div class="eyebrow mb-1">Where it started</div>
            <div class="font-semibold text-ink">{{ ORIGIN.name }} <span class="font-normal text-muted">by {{ ORIGIN.author }}</span></div>
            <p class="text-[13.5px] text-ink-2 leading-snug mt-1">{{ ORIGIN.text }}</p>
            <button class="btn btn-link btn-sm !px-0 !h-7 mt-1" @click="openLink(LINKS.original)">See the original project</button>
        </div>

        <template #footer>
            <button class="btn btn-glass" @click="openLink(LINKS.releases)">Releases on GitHub</button>
            <button class="btn btn-primary" @click="emit('close')">Done</button>
        </template>
    </BaseModal>
</template>

<style scoped>
.filters {
    position: sticky;
    top: -12px;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 12px 0 10px;
    margin-top: -12px;
    background: var(--paper);
}

.filters button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--line-strong);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--ink-2);
    transition: background-color 180ms ease, color 180ms ease, border-color 180ms ease, transform 220ms var(--ease-spring);
}

.filters button span {
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.65;
}

.filters button:hover {
    color: var(--ink);
    background: var(--glass-2);
}

.filters button:active {
    transform: scale(0.95);
}

.filters button.on {
    background: var(--btn);
    border-color: var(--btn);
    color: var(--btn-ink);
}

.release {
    position: relative;
    padding: 16px 0 14px 18px;
    border-left: 1.5px solid var(--line);
    margin-left: 5px;
}

.release::before {
    content: "";
    position: absolute;
    left: -6px;
    top: 21px;
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: var(--paper);
    border: 2px solid var(--ink);
}

.version {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 1.15rem;
    letter-spacing: -0.02em;
    color: var(--ink);
}

.badge {
    height: 20px;
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    border: 1px solid var(--line-strong);
}

.badge.current {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--paper);
}

.change {
    display: flex;
    align-items: flex-start;
    gap: 10px;
}

.kind {
    flex-shrink: 0;
    width: 88px;
    margin-top: 1px;
    padding: 2px 0;
    border-radius: 999px;
    text-align: center;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--k);
    background: color-mix(in srgb, var(--k) 13%, transparent);
}

/* one color per kind of change (the paper card flips ok/warn/danger for contrast) */
.k-new { --k: var(--ok); }
.k-improved { --k: #3478b8; }
.k-fixed { --k: var(--warn); }
.k-design { --k: #8e54c0; }
.k-performance { --k: #1d8f84; }
.k-security { --k: var(--danger); }

.filters button[class*="k-"]:not(.on) {
    border-color: color-mix(in srgb, var(--k) 40%, transparent);
}

.origin {
    margin-top: 10px;
    padding: 14px 16px;
    border-radius: 16px;
    border: 1px dashed var(--line-strong);
}
</style>
