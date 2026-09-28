import { createGlobalState } from '@vueuse/core'
import { ref } from 'vue'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
    id: number;
    kind: ToastKind;
    title: string;
    detail?: string;
}

export const useToasts = createGlobalState(() => {
    const toasts = ref<Toast[]>([])
    let nextId = 1

    function dismiss(id: number) {
        toasts.value = toasts.value.filter(t => t.id !== id)
    }

    function toast(kind: ToastKind, title: string, detail?: string, duration = 3200) {
        const id = nextId++
        toasts.value.push({ id, kind, title, detail })
        // keep the stack short
        if (toasts.value.length > 4) {
            toasts.value.shift()
        }
        setTimeout(() => dismiss(id), kind === 'error' ? duration + 2500 : duration)
        return id
    }

    return { toasts, toast, dismiss }
})
