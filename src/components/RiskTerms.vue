<script setup lang="ts">
import AnimatedCheckbox from './AnimatedCheckbox.vue';

/** The rules & risk text, plus the "I understand" checkbox (v-model). */
const agreed = defineModel<boolean>({ required: true });
</script>

<template>
    <div>
        <div class="text-[14px] leading-[1.55] text-ink-2 space-y-2.5">
            <p>
                Questly makes Discord believe you're playing games you aren't running. That goes against
                <span class="text-ink font-semibold">Discord's Terms of Service</span>.
            </p>
            <p>Using it can lead to serious consequences for your account, including:</p>
            <ul class="space-y-1 pl-1">
                <li class="flex gap-2.5"><span class="mt-2 w-1.5 h-1.5 rounded-full bg-ink shrink-0"></span>quest rewards being removed or never granted</li>
                <li class="flex gap-2.5"><span class="mt-2 w-1.5 h-1.5 rounded-full bg-ink shrink-0"></span>warnings, or a temporary suspension of your account</li>
                <li class="flex gap-2.5"><span class="mt-2 w-1.5 h-1.5 rounded-full bg-ink shrink-0"></span>a permanent ban, losing your servers, messages, friends and purchases such as Nitro</li>
            </ul>
            <p>
                Questly isn't affiliated with or endorsed by Discord. Its makers accept
                <span class="text-ink font-semibold">no responsibility</span> for what happens to your account.
                You use it entirely at your own risk and are responsible for everything you do with it.
            </p>
        </div>

        <label class="mt-4 flex items-start gap-3 rounded-2xl border border-line-strong px-4 py-3 cursor-pointer"
            @click.prevent="agreed = !agreed">
            <AnimatedCheckbox :checked="agreed" label="I understand the risks" class="mt-0.5" @toggle="agreed = !agreed" />
            <span class="text-sm text-ink leading-snug">
                I understand that using Questly could get my Discord account suspended or banned, and that I alone am
                responsible for the consequences.
            </span>
        </label>
    </div>
</template>
