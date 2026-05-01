<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { fetchConfig } from './api'
import { oidcRuntime } from './runtime'
import type { DiscoverResponse, Flow, TokensState, VerifyResult } from './types'
import TokenView from './components/TokenView.vue'
import SignatureCheck from './components/SignatureCheck.vue'
import ExtrasPanel from './components/ExtrasPanel.vue'

type Stage = 'idle' | 'discovering' | 'discovered' | 'starting' | 'tokens'

const stage = ref<Stage>('idle')
const error = ref<string>('')
const browserMode = oidcRuntime.mode === 'browser'

const issuer = ref('http://localhost:8080')
const clientId = ref('')
const clientSecret = ref('')

const discovery = ref<DiscoverResponse | null>(null)
const selectedScopes = ref<string[]>([])
const flow = ref<Flow>('auth_code')
const usePKCE = ref(false)

const tokensState = ref<TokensState | null>(null)
const verifyResult = ref<VerifyResult | null>(null)
const rpRedirectUri = ref<string>('')

type Theme = 'light' | 'dark'
const THEME_KEY = 'repartee:theme'
const theme = ref<Theme>('light')

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
}

function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY) as Theme | null
  if (saved === 'light' || saved === 'dark') {
    theme.value = saved
  } else {
    theme.value = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  applyTheme(theme.value)
}

function toggleTheme() {
  theme.value = theme.value === 'light' ? 'dark' : 'light'
  localStorage.setItem(THEME_KEY, theme.value)
  applyTheme(theme.value)
}

const STORAGE_KEY = 'repartee:creds'

function loadSavedCreds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const v = JSON.parse(raw) as { issuer?: string; clientId?: string; clientSecret?: string }
    if (v.issuer) issuer.value = v.issuer
    if (v.clientId) clientId.value = v.clientId
    if (!browserMode && v.clientSecret) clientSecret.value = v.clientSecret
  } catch {
    // corrupt entry — leave defaults in place
  }
}

function forgetSavedCreds() {
  localStorage.removeItem(STORAGE_KEY)
  issuer.value = 'http://localhost:8080'
  clientId.value = ''
  clientSecret.value = ''
}

function clearCallbackParams() {
  history.replaceState(null, '', window.location.pathname)
}

watch([issuer, clientId, clientSecret], ([i, id, sec]) => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(browserMode ? { issuer: i, clientId: id } : { issuer: i, clientId: id, clientSecret: sec }),
  )
})

watch(discovery, (d) => {
  if (!d) return
  const supported = d.doc.scopes_supported || []
  selectedScopes.value = supported.includes('openid') ? ['openid'] : (supported.length ? [supported[0]] : [])
  usePKCE.value = browserMode || d.capabilities.pkce
  flow.value = 'auth_code'
})

async function onDiscover() {
  if (!issuer.value.trim()) {
    error.value = 'an issuer URL would be lovely'
    return
  }
  error.value = ''
  stage.value = 'discovering'
  try {
    discovery.value = await oidcRuntime.discover(issuer.value)
    stage.value = 'discovered'
  } catch (e) {
    error.value = (e as Error).message
    stage.value = 'idle'
  }
}

async function onGo() {
  error.value = ''
  stage.value = 'starting'
  try {
    const res = await oidcRuntime.start({
      issuer: issuer.value,
      client_id: clientId.value,
      client_secret: clientSecret.value,
      scopes: selectedScopes.value,
      flow: flow.value,
      use_pkce: usePKCE.value,
    })
    if (res.redirect) {
      window.location.href = res.redirect
      return
    }
    if (res.tokens) {
      tokensState.value = await oidcRuntime.tokens()
      await autoVerify()
      stage.value = 'tokens'
    }
  } catch (e) {
    error.value = (e as Error).message
    stage.value = 'discovered'
  }
}

async function autoVerify() {
  const idt = tokensState.value?.tokens?.id_token
  if (!idt) {
    verifyResult.value = null
    return
  }
  try {
    verifyResult.value = await oidcRuntime.verify(idt)
  } catch (e) {
    verifyResult.value = { valid: false, error: (e as Error).message }
  }
}

async function onVerifyWithKey(key: string) {
  const idt = tokensState.value?.tokens?.id_token
  if (!idt) return
  try {
    verifyResult.value = await oidcRuntime.verify(idt, key)
  } catch (e) {
    verifyResult.value = { valid: false, error: (e as Error).message }
  }
}

async function onRefresh() {
  try {
    await oidcRuntime.refresh()
    tokensState.value = await oidcRuntime.tokens()
    await autoVerify()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function onLogout() {
  try {
    const res = await oidcRuntime.logout()
    window.location.href = res.redirect
  } catch (e) {
    error.value = (e as Error).message
  }
}

function reset() {
  tokensState.value = null
  verifyResult.value = null
  discovery.value = null
  stage.value = 'idle'
  clearCallbackParams()
}

onMounted(async () => {
  loadTheme()
  loadSavedCreds()
  if (!browserMode) {
    try {
      const cfg = await fetchConfig()
      rpRedirectUri.value = cfg.rp_redirect_uri || ''
    } catch {
      // not fatal — leave as empty string
    }
  }
  const params = new URLSearchParams(window.location.search)
  if (params.get('error')) {
    error.value = params.get('error') || 'unknown error'
    clearCallbackParams()
    return
  }
  if (browserMode && params.get('code')) {
    try {
      tokensState.value = await oidcRuntime.completeCallback(new URL(window.location.href))
      if (tokensState.value.issuer) issuer.value = tokensState.value.issuer
      clearCallbackParams()
      await autoVerify()
      stage.value = 'tokens'
    } catch (e) {
      error.value = (e as Error).message
      clearCallbackParams()
    }
    return
  }
  if (params.get('ok')) {
    clearCallbackParams()
    try {
      const t = await oidcRuntime.completeCallback(new URL(window.location.href))
      if (t.tokens) {
        tokensState.value = t
        if (t.issuer) issuer.value = t.issuer
        await autoVerify()
        stage.value = 'tokens'
      }
    } catch (e) {
      error.value = (e as Error).message
    }
  }
})

const heading = computed(() => {
  switch (stage.value) {
    case 'tokens':     return 'tokens, freshly minted'
    case 'discovered': return 'pick your flavour'
    case 'starting':   return 'off we go…'
    case 'discovering': return 'rummaging through the OP…'
    default: return 'a friendly relying party'
  }
})

function toggleScope(s: string) {
  const i = selectedScopes.value.indexOf(s)
  if (i === -1) selectedScopes.value.push(s)
  else selectedScopes.value.splice(i, 1)
}

const discoveryView = ref<'summary' | 'raw'>('summary')

const noIdTokenReason = computed(() => {
  const f = tokensState.value?.flow
  const scopes = tokensState.value?.scopes || []
  if (f === 'client_credentials') return "Client Credentials doesn't issue one."
  if (!scopes.includes('openid')) return 'Tick the openid scope to receive one.'
  return 'The OP returned no ID token, despite openid being requested.'
})

const canStart = computed(() => !browserMode || !!discovery.value?.capabilities.pkce)
</script>

<template>
  <main class="max-w-4xl mx-auto px-4 py-10">
    <header class="mb-8 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-3xl font-bold tracking-tight flex items-baseline gap-3">
          <span>RePartee</span>
          <span class="text-slate-300 dark:text-slate-700 font-normal">·</span>
          <span class="text-slate-500 dark:text-slate-400 text-xl font-medium">{{ heading }}</span>
        </h1>
        <p class="text-slate-500 dark:text-slate-400 mt-2 text-sm">
          Point me at any OpenID Provider and I'll happily run the dance, lay the tokens
          on the table, and tell you whether the signatures pass muster.
        </p>
      </div>
      <button
        class="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full
               text-slate-600 hover:bg-slate-100
               dark:text-slate-300 dark:hover:bg-slate-800
               focus:outline-none focus:ring-2 focus:ring-indigo-500"
        :title="theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'"
        :aria-label="theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'"
        @click="toggleTheme"
      >
        <svg v-if="theme === 'light'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
          <path fill-rule="evenodd" d="M9.528 1.718a.75.75 0 0 1 .162.819A8.97 8.97 0 0 0 9 6a9 9 0 0 0 9 9 8.97 8.97 0 0 0 3.463-.69.75.75 0 0 1 .981.98 10.503 10.503 0 0 1-9.694 6.46c-5.799 0-10.5-4.7-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 0 1 .818.162Z" clip-rule="evenodd"/>
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
          <path d="M12 2.25a.75.75 0 0 1 .75.75v2.25a.75.75 0 0 1-1.5 0V3a.75.75 0 0 1 .75-.75ZM7.5 12a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM18.894 6.166a.75.75 0 0 0-1.06-1.06l-1.591 1.59a.75.75 0 1 0 1.06 1.061l1.591-1.59ZM21.75 12a.75.75 0 0 1-.75.75h-2.25a.75.75 0 0 1 0-1.5H21a.75.75 0 0 1 .75.75ZM17.834 18.894a.75.75 0 0 0 1.06-1.06l-1.59-1.591a.75.75 0 1 0-1.061 1.06l1.59 1.591ZM12 18a.75.75 0 0 1 .75.75V21a.75.75 0 0 1-1.5 0v-2.25A.75.75 0 0 1 12 18ZM7.758 17.303a.75.75 0 0 0-1.061-1.06l-1.591 1.59a.75.75 0 0 0 1.06 1.061l1.591-1.59ZM6 12a.75.75 0 0 1-.75.75H3a.75.75 0 0 1 0-1.5h2.25A.75.75 0 0 1 6 12ZM6.697 7.757a.75.75 0 0 0 1.06-1.06l-1.59-1.591a.75.75 0 0 0-1.061 1.06l1.59 1.591Z"/>
        </svg>
      </button>
    </header>

    <div v-if="error" class="mb-6 rounded-md bg-rose-50 dark:bg-rose-900/20 p-4 ring-1 ring-rose-200 dark:ring-rose-800">
      <p class="text-sm font-medium text-rose-900 dark:text-rose-200">{{ error }}</p>
      <button class="mt-2 text-xs text-rose-700 dark:text-rose-300 underline" @click="error = ''">dismiss</button>
    </div>

    <!-- Idle: issuer + credentials -->
    <section v-if="stage === 'idle' || stage === 'discovering'" class="card space-y-4">
      <div class="rounded-md bg-amber-50 dark:bg-amber-900/20 ring-1 ring-amber-200 dark:ring-amber-800 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
        <strong class="font-semibold">A friendly suggestion:</strong>
        create a client in your OP <em>just for this tool</em> and delete it when you're
        done poking around. {{ browserMode ? 'The issuer and client ID' : 'The client secret you enter here' }} will be saved in this
        browser's <code class="font-mono">localStorage</code> until you hit
        <span class="font-medium">Forget saved credentials</span>.
      </div>
      <div>
        <label class="label">Issuer URL</label>
        <input v-model="issuer" class="field" placeholder="http://localhost:8080" />
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="label">Client ID</label>
          <input v-model="clientId" class="field" placeholder="my-test-client" />
        </div>
        <div v-if="!browserMode">
          <label class="label">Client secret</label>
          <input v-model="clientSecret" type="password" class="field" placeholder="••••••" />
        </div>
      </div>
      <div v-if="browserMode" class="rounded-md bg-sky-50 dark:bg-sky-900/20 ring-1 ring-sky-200 dark:ring-sky-800 px-4 py-3 text-sm text-sky-900 dark:text-sky-200">
        Static browser mode is active. This uses a public client with Authorization Code + PKCE;
        client secrets, client credentials, and confidential introspection stay in BFF mode.
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <button class="btn-primary" :disabled="stage === 'discovering'" @click="onDiscover">
          {{ stage === 'discovering' ? 'Discovering…' : 'Discover' }}
        </button>
        <span class="text-xs text-slate-500 dark:text-slate-400">
          Fetches <code class="font-mono">/.well-known/openid-configuration</code> to see what's on offer.
        </span>
        <span v-if="!browserMode" class="text-xs text-slate-500 dark:text-slate-400">
          RP_REDIRECT_URI: <code class="font-mono">{{ rpRedirectUri || '(unknown)' }}</code>
        </span>
        <button
          class="ml-auto text-xs text-slate-500 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 underline"
          title="Remove the issuer and client credentials saved in this browser."
          @click="forgetSavedCreds"
        >
          Forget saved credentials
        </button>
      </div>
    </section>

    <!-- Discovered: scopes + flow -->
    <section v-if="(stage === 'discovered' || stage === 'starting') && discovery" class="space-y-6">
      <div class="card">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-lg font-semibold">{{ discovery.doc.issuer }}</h2>
            <p class="text-sm text-slate-500 dark:text-slate-400">Here's what this OP advertises.</p>
          </div>
          <button class="btn-secondary" @click="reset">Change issuer</button>
        </div>

        <div class="flex items-center gap-2 mb-4 text-xs">
          <button
            class="px-2 py-1 rounded"
            :class="discoveryView === 'summary' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
            @click="discoveryView = 'summary'"
          >Summary</button>
          <button
            class="px-2 py-1 rounded"
            :class="discoveryView === 'raw' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'"
            @click="discoveryView = 'raw'"
          >Raw</button>
        </div>

        <div v-if="discoveryView === 'summary'" class="flex flex-wrap gap-2">
          <span :class="discovery.capabilities.pkce ? 'pill-on' : 'pill-off'">PKCE (S256)</span>
          <span :class="discovery.capabilities.client_credentials ? 'pill-on' : 'pill-off'">client_credentials</span>
          <span :class="discovery.capabilities.refresh ? 'pill-on' : 'pill-off'">refresh_token</span>
          <span :class="discovery.capabilities.userinfo ? 'pill-on' : 'pill-off'">userinfo</span>
          <span :class="discovery.capabilities.logout ? 'pill-on' : 'pill-off'">end_session</span>
          <span :class="discovery.capabilities.introspect ? 'pill-on' : 'pill-off'">introspection</span>
        </div>
        <pre v-else class="json max-h-96 overflow-auto">{{ JSON.stringify(discovery.raw, null, 2) }}</pre>
      </div>

      <div class="card space-y-4">
        <div>
          <label class="label">Flow</label>
          <div class="flex flex-wrap gap-3">
            <label class="flex items-center gap-2 text-sm">
              <input type="radio" v-model="flow" value="auth_code" />
              {{ browserMode ? 'Authorization Code + PKCE' : 'Authorization Code' }}
            </label>
            <label
              v-if="!browserMode && discovery.capabilities.client_credentials"
              class="flex items-center gap-2 text-sm"
            >
              <input type="radio" v-model="flow" value="client_credentials" />
              Client Credentials
            </label>
          </div>
        </div>

        <div v-if="flow === 'auth_code' && discovery.capabilities.pkce">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" v-model="usePKCE" :disabled="browserMode" />
            {{ browserMode ? 'PKCE (S256) required in browser mode' : 'Use PKCE (S256) — this OP advertises it' }}
          </label>
        </div>
        <p v-if="browserMode && !discovery.capabilities.pkce" class="text-sm text-rose-700 dark:text-rose-400">
          Browser mode requires PKCE S256. Use BFF mode for this provider.
        </p>

        <div>
          <label class="label">Scopes</label>
          <div class="flex flex-wrap gap-2">
            <label
              v-for="s in (discovery.doc.scopes_supported || [])"
              :key="s"
              class="inline-flex items-center gap-2 text-sm px-3 py-1 rounded-full cursor-pointer transition select-none ring-1 ring-inset"
              :class="selectedScopes.includes(s)
                ? 'bg-indigo-600 text-white ring-indigo-600 hover:bg-indigo-500 font-medium'
                : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700'"
            >
              <input
                type="checkbox"
                class="hidden"
                :checked="selectedScopes.includes(s)"
                @change="toggleScope(s)"
              />
              <span v-if="selectedScopes.includes(s)" aria-hidden="true">✓</span>
              {{ s }}
            </label>
          </div>
          <p v-if="!(discovery.doc.scopes_supported || []).length" class="text-xs text-slate-400 dark:text-slate-500 mt-2">
            (No scopes advertised — odd, but we'll forge ahead.)
          </p>
        </div>

        <div>
          <button class="btn-primary" :disabled="stage === 'starting' || !canStart" @click="onGo">
            {{ stage === 'starting' ? 'Going…' : 'Go' }}
          </button>
        </div>
      </div>
    </section>

    <!-- Tokens -->
    <section v-if="stage === 'tokens' && tokensState?.tokens" class="space-y-6">
      <div class="card">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold">ID token</h2>
          <span class="text-xs text-slate-500 dark:text-slate-400">
            flow: {{ tokensState.flow }}{{ tokensState.used_pkce ? ' + PKCE' : '' }}
          </span>
        </div>
        <TokenView
          v-if="tokensState.tokens.id_token"
          :token="tokensState.tokens.id_token"
          :decode="true"
        />
        <p v-else class="text-sm text-slate-500 dark:text-slate-400">
          No ID token in this response. {{ noIdTokenReason }}
        </p>
      </div>

      <SignatureCheck
        v-if="tokensState.tokens.id_token"
        :result="verifyResult"
        @verify="onVerifyWithKey"
        @reset="autoVerify"
      />

      <div class="card">
        <h2 class="text-lg font-semibold mb-4">Access token</h2>
        <TokenView :token="tokensState.tokens.access_token || ''" :decode="false" />
      </div>

      <div v-if="tokensState.tokens.refresh_token" class="card">
        <h2 class="text-lg font-semibold mb-4">Refresh token</h2>
        <pre class="token">{{ tokensState.tokens.refresh_token }}</pre>
      </div>

      <ExtrasPanel
        :tokens-state="tokensState"
        @refresh="onRefresh"
        @logout="onLogout"
      />

      <div>
        <button class="btn-secondary" @click="reset">Start over</button>
      </div>
    </section>

    <footer class="mt-16 text-center text-xs text-slate-400 dark:text-slate-500">
      RePartee · a smoke-test relying party · not for production, but always for fun
    </footer>
  </main>
</template>
