/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REPARTEE_MODE?: string
  readonly VITE_REPARTEE_BASE?: string
  readonly VITE_REPARTEE_REDIRECT_URI?: string
  /** Full URL of the config endpoint, e.g. https://bff.example.com/config */
  readonly VITE_CONFIG_URL?: string
  /** Base URL of the BFF, e.g. https://bff.example.com — /config is appended */
  readonly VITE_BFF_BASE_URL?: string
  /** Base URL of the Cloudflare Worker, e.g. https://worker.example.com — /config is appended as fallback */
  readonly VITE_WORKER_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
