<script setup lang="ts">
import { ref, watch } from 'vue';
import TypingInput from './TypingInput.vue';

/** A color swatch (opens the system picker) with its hex code, which can be typed too. */
const model = defineModel<string>({ required: true });
defineProps<{ label: string }>();

const text = ref(model.value.toUpperCase());
watch(model, v => { text.value = v.toUpperCase(); });
watch(text, v => {
    const clean = ('#' + v.replace(/[^0-9a-f]/gi, '')).slice(0, 7).toUpperCase();
    if (clean !== v) text.value = clean;
    if (/^#[0-9A-F]{6}$/.test(clean)) model.value = clean.toLowerCase();
});

function commit() {
    let v = text.value.replace('#', '');
    // #abc → #aabbcc
    if (v.length === 3) v = v.split('').map(c => c + c).join('');
    if (/^[0-9a-f]{6}$/i.test(v)) model.value = `#${v.toLowerCase()}`;
    text.value = model.value.toUpperCase();
}

function onPick(e: Event) {
    model.value = (e.target as HTMLInputElement).value;
}
</script>

<template>
    <div class="cf">
        <label class="swatch" :style="{ background: model }" :data-tip="`Pick ${label.toLowerCase()} color`">
            <input type="color" class="sr-only" :value="model" @input="onPick" />
        </label>
        <div class="min-w-0 flex-1">
            <div class="text-[12.5px] font-semibold text-ink leading-4 truncate">{{ label }}</div>
            <TypingInput v-model="text" spellcheck="false" maxlength="7" :aria-label="`${label} hex color`"
                class="hex font-mono text-[11.5px] text-muted" @blur="commit" @keydown.enter="commit" />
        </div>
    </div>
</template>

<style scoped>
.cf {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
    padding: 0.45rem 0.55rem;
    border-radius: 14px;
    border: 1px solid var(--line);
    transition: border-color 150ms ease, background-color 150ms ease;
}

.cf:hover,
.cf:focus-within {
    border-color: var(--line-strong);
    background: var(--glass-2);
}

.swatch {
    position: relative;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    border-radius: 10px;
    box-shadow: inset 0 0 0 1px rgba(128, 128, 128, 0.35);
    transition: transform 280ms var(--ease-spring);
}

.swatch:hover {
    transform: scale(1.08);
}

.swatch:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}

.hex {
    height: 1.1rem;
    margin-top: 1px;
}
</style>
