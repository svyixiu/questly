<script setup lang="ts">
import { ref, watch } from 'vue';
import TypingInput from './TypingInput.vue';

/** A small whole-number field: typed freely, clamped when you leave it or press Enter. */
const model = defineModel<number>({ required: true });
const props = withDefaults(defineProps<{
    min?: number;
    max?: number;
    suffix?: string;
    label: string;
    /** width of the number part, in characters */
    chars?: number;
}>(), { min: 0, max: 999, chars: 3 });

const text = ref(String(model.value));
watch(model, v => { text.value = String(v); });
watch(text, v => {
    const clean = v.replace(/\D/g, '').slice(0, 4);
    if (clean !== v) text.value = clean;
});

function commit() {
    const n = parseInt(text.value, 10);
    model.value = Number.isFinite(n) ? Math.min(props.max, Math.max(props.min, n)) : model.value;
    text.value = String(model.value);
}
</script>

<template>
    <label class="field inline-flex items-center gap-1 !h-9 !px-3 shrink-0">
        <TypingInput v-model="text" inputmode="numeric" :aria-label="label"
            class="text-right text-sm font-semibold tabular-nums [--ti-justify:flex-end]"
            :style="{ width: `${chars + 0.5}ch` }" @blur="commit" @keydown.enter="commit" />
        <span v-if="suffix" class="text-xs text-muted">{{ suffix }}</span>
    </label>
</template>
