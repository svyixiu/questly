<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Game } from '@/types/types';
import { gameIconUrl } from '@/utils/executables';

const props = withDefaults(defineProps<{
    game: Pick<Game, 'id' | 'name' | 'icon_hash'>;
    size?: number;
    /** circle like Discord user avatars, or a rounded square like app icons */
    shape?: 'circle' | 'rounded';
    /** Discord presence dot in the bottom-right corner */
    status?: 'online' | 'idle' | 'offline' | null;
}>(), { size: 40, shape: 'rounded', status: null });

const failed = ref(false);
const loaded = ref(false);
watch(() => props.game.id, () => {
    failed.value = false;
    loaded.value = false;
});

const src = computed(() => failed.value ? null : gameIconUrl(props.game, props.size > 48 ? 128 : 64));

// Stable per-game color for the letter fallback, like Discord's default avatars
const background = computed(() => {
    let hash = 0;
    for (const ch of props.game.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 55% 52%)`;
});

const initial = computed(() => props.game.name.replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?');
const radius = computed(() => props.shape === 'circle' ? '50%' : `${Math.round(props.size * 0.25)}px`);

// Presence dot: like Discord, cut a transparent ring out of the avatar
// (a mask) instead of drawing a border, so it works on any background.
const dot = computed(() => Math.max(10, Math.round(props.size * 0.3)));
const dotOffset = -2;
const mask = computed(() => {
    if (!props.status) return undefined;
    const c = props.size - dotOffset - dot.value / 2;
    const r = dot.value / 2 + 3;
    return `radial-gradient(circle at ${c}px ${c}px, transparent ${r}px, #000 ${r + 0.5}px)`;
});
const dotColor: Record<string, string> = { online: 'var(--ok)', idle: 'var(--warn)', offline: 'var(--faint)' };
</script>

<template>
    <div class="relative shrink-0" :style="{ width: `${size}px`, height: `${size}px` }">
        <div class="absolute inset-0 overflow-hidden grid place-items-center text-white font-semibold select-none"
            :style="{
                borderRadius: radius, background, fontSize: `${Math.round(size * 0.42)}px`,
                maskImage: mask, WebkitMaskImage: mask,
            }">
            <span>{{ initial }}</span>
            <img v-if="src" :src="src" alt="" draggable="false" loading="lazy"
                class="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
                :class="loaded ? 'opacity-100' : 'opacity-0'"
                @load="loaded = true" @error="failed = true" />
        </div>
        <Transition name="pop">
            <span v-if="status" class="absolute rounded-full"
                :style="{
                    width: `${dot}px`, height: `${dot}px`, right: `${dotOffset}px`, bottom: `${dotOffset}px`,
                    background: dotColor[status],
                }"></span>
        </Transition>
    </div>
</template>
