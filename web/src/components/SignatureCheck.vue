<script setup lang="ts">
import { ref } from 'vue'
import type { VerifyResult } from '../types'

defineProps<{ result: VerifyResult | null }>()
const emit = defineEmits<{ verify: [key: string]; reset: [] }>()

const key = ref('')

function submit() {
  emit('verify', key.value)
}
</script>

<template>
  <div class="card">
    <h2 class="text-lg font-semibold mb-4">Signature</h2>

    <div v-if="result" class="mb-4 flex flex-wrap items-center gap-2">
      <span v-if="result.valid" class="pill-on">valid</span>
      <span v-else class="pill-warn">invalid</span>
      <span v-if="result.alg" class="pill-off">alg: {{ result.alg }}</span>
      <span v-if="result.kid" class="pill-off">kid: {{ result.kid }}</span>
      <span v-if="result.key_source" class="pill-off">verified via: {{ result.key_source }}</span>
    </div>

    <p v-if="result?.error" class="text-sm text-rose-700 dark:text-rose-400 mb-4">{{ result.error }}</p>

    <div>
      <label class="label">Override key (PEM or JWK JSON)</label>
      <textarea
        v-model="key"
        class="field font-mono text-xs"
        rows="6"
        placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----&#10;&#10;or  {&quot;kty&quot;:&quot;RSA&quot;,&quot;n&quot;:&quot;...&quot;,&quot;e&quot;:&quot;AQAB&quot;}"
      />
      <div class="mt-3 flex gap-2">
        <button class="btn-primary" :disabled="!key.trim()" @click="submit">Verify with this key</button>
        <button class="btn-secondary" @click="key = ''; emit('reset')">Reset to JWKS</button>
      </div>
    </div>
  </div>
</template>
