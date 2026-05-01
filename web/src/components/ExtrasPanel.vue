<script setup lang="ts">
import { ref } from 'vue'
import { oidcRuntime } from '../runtime'
import type { TokensState } from '../types'

defineProps<{ tokensState: TokensState }>()
const emit = defineEmits<{ refresh: []; logout: [] }>()

const userinfoResult = ref<unknown>(null)
const introspectResult = ref<unknown>(null)
const userinfoErr = ref<string>('')
const introspectErr = ref<string>('')
const refreshing = ref(false)

async function callUserinfo() {
  userinfoErr.value = ''
  try {
    userinfoResult.value = await oidcRuntime.userinfo()
  } catch (e) {
    userinfoErr.value = (e as Error).message
  }
}

async function callIntrospect() {
  introspectErr.value = ''
  try {
    introspectResult.value = await oidcRuntime.introspect()
  } catch (e) {
    introspectErr.value = (e as Error).message
  }
}

async function callRefresh() {
  refreshing.value = true
  try { emit('refresh') } finally { refreshing.value = false }
}
</script>

<template>
  <div class="card">
    <h2 class="text-lg font-semibold mb-4">Extras</h2>
    <div class="flex flex-wrap gap-2 mb-4">
      <button class="btn-secondary" @click="callUserinfo">Call /userinfo</button>
      <button
        class="btn-secondary"
        :disabled="!tokensState.tokens?.refresh_token || refreshing"
        @click="callRefresh"
      >Refresh tokens</button>
      <button class="btn-secondary" @click="callIntrospect">Introspect access token</button>
      <button class="btn-danger ml-auto" @click="emit('logout')">RP-initiated logout</button>
    </div>

    <div v-if="userinfoResult || userinfoErr" class="mb-4">
      <div class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">/userinfo</div>
      <pre v-if="userinfoErr" class="json text-rose-700 dark:text-rose-400">{{ userinfoErr }}</pre>
      <pre v-else class="json">{{ JSON.stringify(userinfoResult, null, 2) }}</pre>
    </div>

    <div v-if="introspectResult || introspectErr">
      <div class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">/introspect</div>
      <pre v-if="introspectErr" class="json text-rose-700 dark:text-rose-400">{{ introspectErr }}</pre>
      <pre v-else class="json">{{ JSON.stringify(introspectResult, null, 2) }}</pre>
    </div>
  </div>
</template>
