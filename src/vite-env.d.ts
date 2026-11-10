/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  /** Where Profile's "Send feedback" link mails to; the link is hidden without it. */
  readonly VITE_FEEDBACK_EMAIL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
