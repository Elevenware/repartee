<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{ token: string; decode: boolean }>()

const view = ref<'raw' | 'decoded'>(props.decode ? 'decoded' : 'raw')

interface Decoded {
  header: unknown
  payload: unknown
  signature: string
  ok: true
}

interface NotJWT { ok: false }

const decoded = computed<Decoded | NotJWT>(() => {
  const parts = props.token.split('.')
  if (parts.length !== 3) return { ok: false }
  try {
    return {
      ok: true,
      header: JSON.parse(b64urlDecode(parts[0])),
      payload: JSON.parse(b64urlDecode(parts[1])),
      signature: parts[2],
    }
  } catch {
    return { ok: false }
  }
})

const isJWT = computed(() => decoded.value.ok)

function b64urlDecode(s: string): string {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return decodeURIComponent(
    atob(s).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
  )
}

function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2)
}
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-3 text-xs">
      <button
        v-if="isJWT"
        class="px-2 py-1 rounded"
        :class="view === 'decoded' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
        @click="view = 'decoded'"
      >Decoded</button>
      <button
        class="px-2 py-1 rounded"
        :class="view === 'raw' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
        @click="view = 'raw'"
      >Raw</button>
      <span v-if="!isJWT" class="text-slate-400 dark:text-slate-500">opaque token (not a JWT)</span>
    </div>

    <pre v-if="view === 'raw'" class="token">{{ token }}</pre>

    <div v-else-if="decoded.ok" class="grid gap-3 md:grid-cols-2">
      <div>
        <div class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Header</div>
        <pre class="json">{{ pretty(decoded.header) }}</pre>
      </div>
      <div>
        <div class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Payload</div>
        <pre class="json">{{ pretty(decoded.payload) }}</pre>
      </div>
      <div class="md:col-span-2">
        <div class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Signature</div>
        <pre class="token">{{ decoded.signature }}</pre>
      </div>
    </div>
  </div>
</template>
