import { bffRuntime } from './api'
import { browserRuntime } from './browserRuntime'
import type { OidcRuntime } from './types'

const mode = import.meta.env.VITE_REPARTEE_MODE === 'browser' ? 'browser' : 'bff'

export const oidcRuntime: OidcRuntime = mode === 'browser' ? browserRuntime : bffRuntime
