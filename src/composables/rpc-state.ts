import { createGlobalState } from '@vueuse/core'
import { ref } from 'vue'

/** Experimental RPC mode: only one RPC client can be active at a time. */
export const useRpcState = createGlobalState(() => ({
    gameId: ref<string | null>(null),
    connecting: ref(false),
    /** the Activity page's RPC test is showing an activity */
    testConnected: ref(false),
}))
