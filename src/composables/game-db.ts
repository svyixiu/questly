import { createGlobalState } from '@vueuse/core'
import { useFetchGameList } from './fetch-gamelist'

/**
 * Shares one game list fetch across the whole app (header status pill,
 * search). Call it first from App.vue so the on-mount fetch is tied to the
 * root component.
 */
export const useGameDB = createGlobalState(() => useFetchGameList())
