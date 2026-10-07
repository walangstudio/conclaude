export type Asked = {
  id: number
  text: string
  uuid?: string
  turnId?: string
  isIdle: boolean
  tldr?: string
  at?: number
  tookMs?: number
}

export type SummaryJob = { turnId: string; answer: string; sessionId: string }

export type SavedSession = { version: 1; sessionId: string; cwd: string; savedAt: number; asked: Asked[] }

export type SavedMeta = { sessionId: string; cwd: string; savedAt: number; count: number; title: string }

export type PaneView = {
  mode: 'current' | 'saved' | 'detail'
  query?: string
  confirm?: 'clear' | 'delete'
  detail?: SavedSession
}

export type PaneStatus = { text: string }

declare module 'claude-code' {
  interface PluginState {
    conclaude: {
      asked: Asked[]
      turn: Shaped<{ turnId: string; sessionId: string | null; isFinished?: boolean } | null>
      jobs: SummaryJob[]
      view: PaneView
      saved: SavedMeta[]
      status: PaneStatus | null
      unsaved: SavedSession[]
      session: string | null
      isDirty: boolean
      locked: string | null
    }
  }
}
