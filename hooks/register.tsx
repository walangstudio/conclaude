import { atom, read, update } from 'claude-code'
import type { CommandRunInput, EngineInterface, Register } from 'claude-code'

import type { Asked, PaneStatus, PaneView, SavedMeta, SavedSession } from '../types'

const PANE = 'conclaude'
const TITLE = 'conClaude'
const COMMAND = 'conClaude'
const KEEP = 200
const SUMMARIZING = '…summarizing'
const MAX_TEXT = 2000
const PENDING = new Set([undefined, SUMMARIZING])
const DELETED = '{"deleted":true}'
// A restored row's turn is gone; this id matches no new turn, so stampTurn and fillTldr leave the row alone.
const RESTORED = 'restored'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const asked = atom({ plugin: 'conclaude', key: 'asked' } as const, [])
const turn = atom({ plugin: 'conclaude', key: 'turn' } as const, null, { shape: 'v2' })
const jobs = atom({ plugin: 'conclaude', key: 'jobs' } as const, [])
const view = atom({ plugin: 'conclaude', key: 'view' } as const, { mode: 'current' })
const saved = atom({ plugin: 'conclaude', key: 'saved' } as const, [])
const status = atom({ plugin: 'conclaude', key: 'status' } as const, null)
const unsaved = atom({ plugin: 'conclaude', key: 'unsaved' } as const, [])
const session = atom({ plugin: 'conclaude', key: 'session' } as const, null)
const dirty = atom({ plugin: 'conclaude', key: 'isDirty' } as const, false)
const locked = atom({ plugin: 'conclaude', key: 'locked' } as const, null)

export const oneLine = (text: string, width: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= width ? flat : `${flat.slice(0, Math.max(1, width - 1))}…`
}

// A queued prompt's row can carry framing around the typed text.
export const isRowOf = (rowText: string, prompt: string) => {
  const head = prompt.trim().slice(0, 200)
  return head.length > 0 && rowText.includes(head)
}

// Exact match first; else the longest prompt the row contains, so "yes" never takes "yes, and also ..."'s row.
const bestMatch = (list: Asked[], text: string, isOpen: (one: Asked) => boolean) => {
  const open = list.map((one, at) => ({ one, at })).filter(({ one }) => isOpen(one) && isRowOf(text, one.text))
  const exact = open.find(({ one }) => one.text.trim() === text.trim())
  return (exact ?? open.sort((a, b) => b.one.text.length - a.one.text.length)[0])?.at ?? -1
}

export const attachRow = (list: Asked[], rowText: string, uuid: string, running: string | null) => {
  const at = bestMatch(list, rowText, one => !one.uuid && one.turnId !== RESTORED)
  if (at < 0) return list
  const copy = [...list]
  copy[at] = { ...copy[at]!, uuid, turnId: copy[at]!.turnId ?? running ?? undefined }
  return copy
}

// The turn belongs to the idle prompt that started it, plus queued prompts whose rows landed while idle.
export const stampTurn = (list: Asked[], turnId: string, text: string) => {
  const idle = (one: Asked) => one.isIdle && !one.turnId
  const named = bestMatch(list, text, idle)
  const starter = named >= 0 ? named : list.findLastIndex(idle)
  return list.map((one, at) => (at === starter || (!one.turnId && !one.isIdle && one.uuid) ? { ...one, turnId } : one))
}

export const fillTldr = (list: Asked[], turnId: string, tldr: string) =>
  list.map(one => (one.turnId === turnId && PENDING.has(one.tldr) ? { ...one, tldr } : one))

export const endNote = (reason: string, answer: string) =>
  reason === 'aborted' ? '(interrupted)'
  : reason !== 'answer' ? `(${reason})`
  : !answer.trim() ? '(no text reply)'
  : undefined

// "#12" is a number only; bare "12" is row 12 first, then rows whose text or TL;DR holds it.
export const filterAsked = (list: Asked[], query: string) => {
  const q = query.trim()
  const n = parseNum(q)
  const byId = n === undefined ? [] : list.filter(one => one.id === n)
  if (q.startsWith('#') || !q) return q ? byId : list
  const needle = q.toLowerCase()
  const isTime = /^\d{1,2}:\d{0,2}$/.test(q)
  const byText = list.filter(one => !byId.includes(one) && (isTime
    ? one.at !== undefined && clock(one.at).startsWith(q.padStart(q.indexOf(':') === 1 ? q.length + 1 : q.length, '0'))
    : `${one.text}\n${one.tldr ?? ''}`.toLowerCase().includes(needle)))
  return [...byId, ...byText]
}

const isAsked = (one: unknown): one is Asked => {
  const a = one as Asked
  return typeof a?.id === 'number' && typeof a.text === 'string' && typeof a.isIdle === 'boolean'
    && (a.uuid === undefined || typeof a.uuid === 'string') && (a.tldr === undefined || typeof a.tldr === 'string')
    && (a.at === undefined || typeof a.at === 'number') && (a.tookMs === undefined || typeof a.tookMs === 'number')
}

// Files are the user's own, but hand-edited or half-written ones must not break the pane.
// Rows whose summary is still queued in this process keep their turn, so it can land.
export const parseSaved = (text: string, pending: ReadonlySet<string> = new Set()): SavedSession | undefined => {
  try {
    const raw = JSON.parse(text) as SavedSession
    const isValid = raw?.version === 1 && typeof raw.sessionId === 'string' && typeof raw.cwd === 'string'
      && typeof raw.savedAt === 'number' && Array.isArray(raw.asked) && raw.asked.every(isAsked)
    if (!isValid) return undefined
    const asked = raw.asked.slice(-KEEP).map(one => (one.turnId && pending.has(one.turnId) ? one
      : { ...one, turnId: RESTORED, tldr: PENDING.has(one.tldr) ? '(no summary saved)' : one.tldr }))
    return { ...raw, asked }
  } catch {
    return undefined
  }
}

const clock = (ms: number) => {
  const t = new Date(ms)
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}

export const dayLabel = (at: number, now: number) => {
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const day = new Date(at).toDateString()
  if (day === new Date(now).toDateString()) return `today ${clock(at)}`
  if (day === yesterday.toDateString()) return 'yesterday'
  return `${MONTHS[new Date(at).getMonth()]} ${new Date(at).getDate()}`
}

export const parseNum = (query: string) => {
  const num = /^#?(\d+)$/.exec(query.trim())
  return num ? Number(num[1]) : undefined
}

export const noPrompt = (n: number, list: Asked[]) =>
  list.length ? `no prompt ${n} (${list[0]!.id}-${list.at(-1)!.id})` : 'no prompts yet'

// Every read and write of the saved files runs one at a time, so Clear, a session switch and the tick never interleave.
let chain: Promise<unknown> = Promise.resolve()
function serial<T>(work: () => Promise<T>) {
  const run = chain.then(work)
  chain = run.catch(() => undefined)
  return run
}

export const took = (ms: number) => {
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

export const stamp = (one: Asked, now: number) => {
  const sent = one.at === undefined ? ''
    : new Date(one.at).toDateString() === new Date(now).toDateString() ? clock(one.at)
    : `${dayLabel(one.at, now)} ${clock(one.at)}`
  return [sent, one.tookMs === undefined ? '' : took(one.tookMs)].filter(Boolean).join(' · ')
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

async function sessionsDir($: EngineInterface) {
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  return home ? `${home.replace(/\\/g, '/')}/.conclaude/sessions` : undefined
}

async function edit($: EngineInterface, fn: (list: Asked[]) => Asked[]) {
  await update($, asked, fn)
  await update($, dirty, () => true)
}

// Runs inside serial(). Dirty clears before the list is read, so an edit during the write, or a failed write, marks it again.
// Resolves to the file it failed to write, else undefined.
async function flush($: EngineInterface): Promise<SavedSession | undefined> {
  if (!(await read($, dirty))) return
  const dir = await sessionsDir($)
  const id = await read($, session)
  if (!dir || !id || (await read($, locked)) === id) return
  await update($, dirty, () => false)
  const list = await read($, asked)
  const path = `${dir}/${id}.json`
  const file: SavedSession = { version: 1, sessionId: id, cwd: '', savedAt: await $.clock.now(), asked: list }
  try {
    file.cwd = await $.session.cwd()
    const isNothingToSave = list.length === 0 && (!(await $.fs.exists(path)) || (await $.fs.read(path)) === DELETED)
    if (!isNothingToSave) await $.fs.write(path, list.length ? JSON.stringify(file) : DELETED)
    if (await read($, status)) await update($, status, () => null)
  } catch (err) {
    await update($, dirty, () => true)
    await update($, status, () => ({ text: `autosave failed: ${(err as Error).message}` }))
    return file
  }
  return undefined
}

// /clear and an in-app /resume change the session without a session.start. Runs inside serial().
async function syncSession($: EngineInterface) {
  const id = await $.session.id()
  const was = await read($, session)
  if (id === was) return
  // A failed save must not hold the switch (new prompts would land in the old session) or drop the old rows: they wait in `unsaved`.
  const failed = was === null ? undefined : await flush($)
  if (failed) await update($, unsaved, list => [...list.filter(one => one.sessionId !== failed.sessionId), failed])
  const dir = await sessionsDir($)
  const file = `${dir}/${id}.json`
  // Rows parked by a failed save are newer than the file on disk.
  const parked = (await read($, unsaved)).find(one => one.sessionId === id)
  let found: SavedSession | undefined = parked
  let failure: string | undefined
  try {
    if (!parked && dir && (await $.fs.exists(file))) {
      const text = await $.fs.read(file)
      const running = await read($, turn)
      const pending = new Set((await read($, jobs)).filter(job => job.sessionId === id).map(job => job.turnId))
      if (running && running.sessionId === id) pending.add(running.turnId)
      found = parseSaved(text, pending)
      if (!found && text !== DELETED) failure = 'unreadable'
    }
  } catch (err) {
    failure = (err as Error).message
  }
  await update($, session, () => id)
  await update($, dirty, () => parked !== undefined)
  if (parked) await update($, unsaved, list => list.filter(one => one.sessionId !== id))
  await update($, locked, () => (failure ? id : null))
  await update($, asked, () => found?.asked ?? [])
  await update($, status, () => (failure ? { text: `couldn't read the saved session (${failure}); autosave is off for it` } : null))
  if (found?.asked.length) void $.ui.toast(`restored ${plural(found.asked.length, 'prompt')}${parked ? ' (not saved to disk yet)' : ' from the saved session'}`)
}

// A turn or summary that lands after its session was switched away patches that session's file instead.
async function patchSaved($: EngineInterface, sessionId: string, fn: (list: Asked[]) => Asked[]) {
  const dir = await sessionsDir($)
  const file = `${dir}/${sessionId}.json`
  if (!dir || !(await $.fs.exists(file))) return
  const text = await $.fs.read(file)
  if (!parseSaved(text)) return
  const raw = JSON.parse(text) as SavedSession
  await $.fs.write(file, JSON.stringify({ ...raw, asked: fn(raw.asked) }))
}

async function isPaneShown($: EngineInterface) {
  return (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)
}

// The pane follows its end only until something moves it, so each new prompt asks again.
async function followEnd($: EngineInterface) {
  const v = await read($, view)
  if (v.mode !== 'current' || v.query !== undefined || v.confirm || !(await isPaneShown($))) return
  await $.ui.scroll({ in: PANE, to: 'end' })
}

async function retryUnsaved($: EngineInterface) {
  const files = await read($, unsaved)
  const dir = files.length ? await sessionsDir($) : undefined
  if (!dir) return
  for (const file of files) {
    try {
      await $.fs.write(`${dir}/${file.sessionId}.json`, file.asked.length ? JSON.stringify(file) : DELETED)
      await update($, unsaved, list => list.filter(one => one.sessionId !== file.sessionId))
    } catch {
      // Still failing; the next tick tries again.
    }
  }
}

// Every row write goes through here, one at a time. /clear and an in-app /resume give no event, so it syncs the session
// first, then edits the live list, or the rows of a session no longer shown (waiting in `unsaved`, else its file).
async function write($: EngineInterface, fn: (list: Asked[], running: string | null) => Asked[], sessionId?: string | null) {
  return serial(async () => {
    await syncSession($)
    const current = await read($, session)
    const target = sessionId ?? current
    const now = await read($, turn)
    const running = now && !now.isFinished ? now.turnId : null
    const apply = (list: Asked[]) => fn(list, running)
    if (target === current) await edit($, apply)
    else if (target && (await read($, unsaved)).some(one => one.sessionId === target)) {
      await update($, unsaved, list => list.map(one => (one.sessionId === target ? { ...one, asked: apply(one.asked) } : one)))
    } else if (target) await patchSaved($, target, apply).catch(() => undefined)
    return target
  })
}

async function jumpTo($: EngineInterface, one: Asked) {
  if (!one.uuid) return 'that prompt is not in the transcript yet'
  const moved = await $.ui.scroll({ to: { requestId: one.uuid }, block: 'start' }).catch((err: Error) => ({ deny: err.message }))
  if (!moved.deny) return undefined
  // The desktop app keeps its transcript to itself; only the terminal lets a plugin scroll it.
  return /not scrollable/.test(moved.deny) ? "this app doesn't let plugins scroll the transcript; jumping works in the terminal" : `can't jump there (${moved.deny})`
}

// The ↳ glyph carries the state's color; the words still say it, so color is never the only cue.
export const tldrColor = (tldr: string | undefined) =>
  tldr === undefined || tldr === SUMMARIZING || tldr === '(no text reply)' || tldr === '(no summary saved)' ? { glyph: 'inactive', text: { color: 'inactive', italic: true } }
  : tldr === '(interrupted)' ? { glyph: 'warning', text: { color: 'warning' } }
  : /^\(\w+\)$/.test(tldr) ? { glyph: 'error', text: { color: 'error' } }
  : { glyph: 'success', text: {} }

async function runCommand($: EngineInterface, e: CommandRunInput) {
  const arg = e.args.trim()
  if (!arg) {
    if (await isPaneShown($)) {
      await $.ui.close({ id: PANE })
      return {}
    }
    await update($, view, () => ({ mode: 'current' }))
    await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
    void $.ui.scroll({ in: PANE, to: 'end' }).catch(() => undefined)
    return { text: 'conClaude opened. Press a prompt, or press f to find one.' }
  }
  const n = parseNum(arg)
  if (n === undefined) return { text: 'usage: /conClaude [n]' }
  const list = await read($, asked)
  const one = list.find(row => row.id === n)
  if (!one) return { text: noPrompt(n, list) }
  return { text: (await jumpTo($, one)) ?? `jumped to prompt ${one.id}` }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      immediate: true,
      description: 'Toggle the pane of prompts you sent, with the TL;DR of each answer; /conClaude <n> jumps to prompt n',
      argumentHint: '[n]',
    }).catch(() => undefined)

    // Summaries run off the turn's path; a reload picks up what was left.
    let isBusy = false
    const drain = async () => {
      if (isBusy) return
      isBusy = true
      try {
        for (let job = (await read($, jobs))[0]; job; job = (await read($, jobs))[0]) {
          const { turnId, answer, sessionId } = job
          let summary = oneLine(answer, 120)
          try {
            const reply = await $.model.complete({
              model: 'haiku',
              effort: 'low',
              maxTokens: 120,
              timeoutMs: 20_000,
              system: 'Summarize the reply in one plain sentence of at most 20 words. Output only the sentence.',
              prompt: answer.slice(0, 20_000),
            })
            if (reply.isAnswered && reply.text.trim()) summary = reply.text.trim()
          } catch {
            // A refused model (blocked by policy) keeps the trimmed reply as the TL;DR.
          }
          const done = summary
          await write($, list => fillTldr(list, turnId, done), sessionId)
          await update($, jobs, list => list.filter(one => one.turnId !== turnId))
        }
      } finally {
        isBusy = false
      }
    }

    const tick = () => serial(async () => {
      await syncSession($)
      await retryUnsaved($)
      await flush($)
    }).catch(() => undefined)
    $.clock.every(1000, () => {
      void tick()
      void drain()
    })
    await tick()

    return next(e)
  })

  // The autosave tick is a second away; a quit right after a prompt must not lose it.
  on('session.end', async ($, e, next) => {
    await serial(async () => {
      await retryUnsaved($)
      await flush($)
    }).catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, runCommand)

  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!isPerson || !e.text.trim()) return next(e)
    let id = 0
    const at = await $.clock.now()
    const sessionId = await write($, list => {
      id = (list.at(-1)?.id ?? 0) + 1
      return [...list, { id, text: e.text.slice(0, MAX_TEXT), isIdle: e.turnId === undefined, at }].slice(-KEEP)
    })
    void followEnd($).catch(() => undefined)
    const entered = await next(e)
    if (entered.drop !== undefined) await write($, list => list.filter(one => one.id !== id), sessionId)

    return entered
  }).catch(($, e, next) => next(e))

  // Rows a prompt can land in: typed at idle, folded into a running turn, or a queued command.
  for (const door of ['prompt', 'delivery', 'attachment'] as const) {
    on('session.append', { door }, async ($, e, next) => {
      const stored = await next(e)
      const isPromptRow = e.message.type === 'user' || (e.message.type === 'attachment' && e.message.name === 'queued_command')
      if (e.agentId || !isPromptRow || !stored.uuid) return stored
      const rowText = e.message.content.map(block => (block.type === 'text' ? block.text : '')).join('\n')
      await write($, (list, running) => attachRow(list, rowText, stored.uuid, running))

      return stored
    }).catch(($, e, next) => next(e))
  }

  on('turn.start', async ($, e, next) => {
    // Marked running first, so a queued row that lands meanwhile joins this turn; the write then names its real session.
    const was = await read($, session)
    await update($, turn, () => ({ turnId: e.turnId, sessionId: was }))
    const sessionId = await write($, list => stampTurn(list, e.turnId, e.text))
    await update($, turn, now => (now?.turnId === e.turnId ? { ...now, sessionId } : now))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    const running = await read($, turn)
    await update($, turn, now => (now?.turnId === e.turnId ? { ...now, isFinished: true } : now))
    const sessionId = running?.turnId === e.turnId ? running.sessionId : null
    const note = endNote(e.reason, e.answer)
    const endedAt = await $.clock.now()
    // The job is queued before the rows are written, so a session switch in between still sees the turn as pending.
    if (note === undefined) {
      const owner = sessionId ?? (await read($, session))
      if (owner) await update($, jobs, list => [...list, { turnId: e.turnId, answer: e.answer, sessionId: owner }])
    }
    await write($, list => fillTldr(list, e.turnId, note ?? SUMMARIZING)
      .map(one => (one.turnId === e.turnId && one.tookMs === undefined && one.at !== undefined ? { ...one, tookMs: endedAt - one.at } : one)), sessionId)
    await update($, turn, now => (now?.turnId === e.turnId ? null : now))

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : undefined
    const width = Math.max(1, e.props.bodyColumns)
    const gap = e.props.placement === 'dock' ? 1 : 0
    const rule = <Text color="subtle">{'─'.repeat(width)}</Text>
    const toast = (text: string) => void $.ui.toast(text)
    const setView = (next: PaneView) => update($, view, () => next)
    const v = await read($, view)
    const list = await read($, asked)
    const now = await $.clock.now()
    const sessionId = await read($, session)
    const dir = await sessionsDir($)

    const header = (title: string, counter: string, pending = 0) => (
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color="claude">{title}</Text>
        <Text color="inactive" wrap="truncate-end">
          {counter}
          {pending > 0 && <Text color="suggestion" bold>{` · ${pending} pending`}</Text>}
        </Text>
      </Box>
    )

    const rows = (shown: Asked[], isButton: boolean, focusLast: boolean) => {
      const numW = String(Math.max(0, ...shown.map(one => one.id))).length
      const w = Math.max(4, width - numW - 1)
      return shown.map((one, at) => {
        const label = oneLine(one.text, w)
        const tldr = one.tldr ?? (one.turnId ? '…working' : 'queued')
        const meta = stamp(one, now)
        const tone = tldrColor(one.tldr)
        return (
          <Box key={`row-${one.id}`} flexDirection="column" marginBottom={gap}>
            <Box flexDirection="row">
              <Text color="suggestion">{`${String(one.id).padStart(numW)} `}</Text>
              {isButton
                ? <Button key={`jump-${one.id}`} plain label={label} hover={{ underline: true }} autoFocus={focusLast && at === shown.length - 1 ? true : undefined} onPress={() => jump(one)} />
                : <Text>{label}</Text>}
            </Box>
            <Text wrap="wrap">
              {' '.repeat(numW + 1)}
              <Text color={tone.glyph}>↳ </Text>
              <Text {...tone.text}>{oneLine(tldr, Math.max(Math.min(8, w), 2 * (w - 2) - 1 - (meta ? meta.length + 3 : 0)))}</Text>
              {meta && <Text color="inactive">{` · ${meta}`}</Text>}
            </Text>
          </Box>
        )
      })
    }

    const jump = async (one: Asked) => {
      const problem = await jumpTo($, one)
      if (problem) toast(problem)
    }

    const loadSaved = async () => {
      if (!dir || !(await $.fs.exists(dir))) return []
      const metas: SavedMeta[] = []
      for (const entry of await $.fs.list(dir)) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
        const one = parseSaved(await $.fs.read(`${dir}/${entry.name}`).catch(() => DELETED))
        if (!one || one.sessionId === sessionId || one.asked.length === 0) continue
        metas.push({ sessionId: one.sessionId, cwd: one.cwd, savedAt: one.savedAt, count: one.asked.length, title: one.asked[0]!.text })
      }
      return metas.sort((a, b) => b.savedAt - a.savedAt)
    }

    const confirmBlock = (question: string, detail: string[], yes: string, onYes: () => Promise<unknown>) => (
      <Box flexDirection="column">
        <Text bold wrap="wrap">{question}</Text>
        {detail.map((line, at) => <Text key={`detail-${at}`} color="inactive" wrap="wrap">{line}</Text>)}
        <Text> </Text>
        <Box flexDirection="row" gap={2}>
          <Button key="yes" hotkey="y" label={yes} variant="primary" onPress={() => void onYes()} />
          <Button key="no" hotkey="n" label="Keep" autoFocus onPress={() => void setView({ ...v, confirm: undefined })} />
        </Box>
        {rule}
      </Box>
    )

    const close = <Button key="close" hotkey="q" plain label="Close" onPress={() => void $.ui.close({ id: PANE })} />

    if (v.mode === 'current' && v.confirm === 'clear') {
      const isLocked = (await read($, locked)) === sessionId
      return confirmBlock(`Clear all ${plural(list.length, 'prompt')} from this list?`, [isLocked ? "The saved copy couldn't be read, so it stays as it is." : 'The saved copy is deleted too.'], 'Clear', async () => {
        const count = list.length
        const isCleared = await serial(async () => {
          const id = await read($, session)
          if (id !== sessionId) return false
          await update($, jobs, list => list.filter(job => job.sessionId !== id))
          await edit($, () => [])
          await flush($)
          return true
        })
        await setView({ mode: 'current' })
        toast(isCleared ? `cleared ${plural(count, 'prompt')}` : 'the session changed; nothing was cleared')
      })
    }

    if (v.mode === 'detail' && v.detail && v.confirm === 'delete') {
      const d = v.detail
      return confirmBlock('Delete this saved session?', [`"${oneLine(d.asked[0]?.text ?? '', width - 2)}"`, `${plural(d.asked.length, 'prompt')} · ${dayLabel(d.savedAt, now)}. This cannot be undone.`], 'Delete', async () => {
        try {
          await serial(async () => {
            await $.fs.write(`${dir}/${d.sessionId}.json`, DELETED)
            await update($, unsaved, list => list.filter(one => one.sessionId !== d.sessionId))
          })
          const metas = await loadSaved()
          await update($, saved, () => metas)
          await setView({ mode: 'saved' })
          toast('deleted saved session')
        } catch (err) {
          toast(`couldn't delete: ${(err as Error).message}`)
        }
      })
    }

    if (v.mode === 'detail' && v.detail) {
      const d = v.detail
      const command = `claude --resume ${d.sessionId}`
      return (
        <Box flexDirection="column">
          <Text bold color="claude" wrap="truncate-end">{`‹ Saved · ${oneLine(d.asked[0]?.text ?? '', width)}`}</Text>
          <Box flexDirection="row" gap={2}>
            <Button key="back" hotkey="b" plain label="Back" autoFocus onPress={() => void setView({ mode: 'saved' })} />
            <Button key="copy" hotkey="c" plain label="Copy" onPress={async press => {
              const copied = await $.ui.copy({ text: command, surface: press.surface })
              toast(copied.isCopied ? `copied: ${oneLine(command, 30)}` : "couldn't copy - select the command in the pane")
            }} />
            <Button key="delete" hotkey="d" plain label="Delete" onPress={() => {
              void setView({ ...v, confirm: 'delete' })
              void $.ui.scroll({ in: PANE, to: 'start' }).catch(() => undefined)
            }} />
            {close}
          </Box>
          {rule}
          {rows(d.asked, false, false)}
          {rule}
          <Text color="suggestion" wrap="wrap">{command}</Text>
          <Text color="inactive" wrap="wrap">{`Read-only · ${dayLabel(d.savedAt, now)} · ${plural(d.asked.length, 'prompt')}`}</Text>
        </Box>
      )
    }

    if (v.mode === 'saved') {
      const metas = await read($, saved)
      const open = async (meta: SavedMeta) => {
        const one = parseSaved(await $.fs.read(`${dir}/${meta.sessionId}.json`).catch(err => `${(err as Error).message}`))
        if (!one) return toast("couldn't read that saved session (unreadable or deleted)")
        await setView({ mode: 'detail', detail: one })
      }
      return (
        <Box flexDirection="column">
          {header(TITLE, `Saved · ${plural(metas.length, 'session')}`)}
          <Box flexDirection="row" gap={2}>
            <Button key="view" hotkey="v" plain label="Current" onPress={() => void setView({ mode: 'current' })} />
            {close}
          </Box>
          {rule}
          {metas.length === 0 && <Text color="inactive">No saved sessions yet.</Text>}
          {metas.length === 0 && <Text color="inactive">Sessions autosave as you work.</Text>}
          {metas.map((meta, at) => (
            <Box key={`saved-${meta.sessionId}`} flexDirection="column" marginBottom={gap}>
              <Button key={`open-${meta.sessionId}`} plain label={oneLine(meta.title, width)} autoFocus={at === 0 ? true : undefined} onPress={() => void open(meta)} />
              <Text color="inactive" wrap="truncate-start">
                {'  '}
                <Text color="suggestion">{dayLabel(meta.savedAt, now)}</Text>
                {` · ${plural(meta.count, 'prompt')} · ${meta.cwd}`}
              </Text>
            </Box>
          ))}
          {rule}
          <Text color="inactive">Enter opens a session, read-only.</Text>
        </Box>
      )
    }

    const isFinding = v.query !== undefined
    const shown = isFinding ? filterAsked(list, v.query!) : list
    const pending = list.filter(one => PENDING.has(one.tldr)).length
    const counter = isFinding && v.query!.trim()
      ? `${shown.length} of ${list.length} match "${oneLine(v.query!, 12)}"`
      : plural(list.length, 'prompt')
    const waiting = (await read($, unsaved)).length
    const st: PaneStatus | null = (await read($, status)) ?? (waiting ? { text: `${plural(waiting, 'earlier session')} not saved yet; retrying` } : null)

    const submit = (query: string) => {
      const found = filterAsked(list, query)
      const n = parseNum(query)
      const exact = found.find(one => one.id === n)
      if (exact) return void jump(exact)
      if (n !== undefined && query.trim().startsWith('#')) return toast(noPrompt(n, list))
      if (found.length === 1) return void jump(found[0]!)
      toast(found.length === 0 ? `no prompt matches "${oneLine(query, 20)}"` : `${found.length} matches - Tab to pick one`)
    }

    return (
      <Box flexDirection="column">
        {header(TITLE, counter, isFinding ? 0 : pending)}
        <Box flexDirection="row" gap={2}>
          {list.length > 0 && Input && <Button key="find" hotkey="f" plain label="Find" onPress={() => void setView({ mode: 'current', query: isFinding ? undefined : '' })} />}
          <Button key="view" hotkey="v" plain label="Saved" onPress={async () => {
            try {
              const metas = await loadSaved()
              await update($, saved, () => metas)
              await setView({ mode: 'saved' })
            } catch (err) {
              toast(`couldn't list saved sessions: ${(err as Error).message}`)
            }
          }} />
          {list.length > 0 && <Button key="clear" hotkey="x" plain label="Clear" onPress={() => {
            void setView({ mode: 'current', confirm: 'clear' })
            void $.ui.scroll({ in: PANE, to: 'start' }).catch(() => undefined)
          }} />}
          {close}
        </Box>
        {isFinding && Input && (
          <Input key="find-input" label="Find" placeholder="text or #n" submitLabel="Jump" value={v.query} autoFocus
            onInput={(value: string) => void setView({ mode: 'current', query: value })} onSubmit={submit} />
        )}
        {rule}
        {list.length === 0 && <Text color="inactive">No prompts yet.</Text>}
        {list.length === 0 && <Text color="inactive" wrap="wrap">Everything you send shows up here, with a one-line TL;DR of each answer.</Text>}
        {list.length > 0 && shown.length === 0 && <Text color="inactive" wrap="wrap">{`No prompt matches "${oneLine(v.query ?? '', 20)}".`}</Text>}
        {list.length > 0 && shown.length === 0 && <Text color="inactive" wrap="wrap">Try a word from the prompt or its summary, or #12 for a number.</Text>}
        {rows(shown, true, !isFinding)}
        {(st || !dir) && <Box flexDirection="column">{rule}<Text color="error" wrap="wrap">{`✗ ${st?.text ?? 'autosave off: no home folder'}`}</Text></Box>}
      </Box>
    )
  })
}
