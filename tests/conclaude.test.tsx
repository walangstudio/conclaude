import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { attachRow, dayLabel, endNote, fillTldr, filterAsked, isRowOf, oneLine, parseSaved, stamp, stampTurn, tldrColor, took } from '../hooks/register'

const PANE = {
  component: 'Pane',
  requestId: 'conclaude',
  props: { title: 'conClaude', isFocused: true, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const USAGE = { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const COMPOSER = { kind: 'composer' } as const
const DIR = 'C:/Users/t/.conclaude/sessions'
const norm = (path: string) => path.replace(/\\/g, '/')
const RUN = { command: 'conClaude', origin: COMPOSER, presentation: { isFullscreen: true, columns: 160 } } as const

type World = { files: Map<string, string>; id: { now: string }; isHaikuUp?: boolean; isOpen?: boolean; isDiskFull?: boolean }

const engine = (on: On, world: Partial<World> = {}) => {
  const files = world.files ?? new Map<string, string>()
  const id = world.id ?? { now: 's1' }
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 7, 12) })
  mock.env(on, { USERPROFILE: 'C:\\Users\\t' })
  const scrolled: string[] = []
  const toasts: string[] = []
  const closed: string[] = []
  const registered: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: world.isOpen ? [{ id: 'conclaude', title: 'conClaude', isShown: true, isFocused: true, isPlaced: true }] : [] }))
  on('ui.close', (_$, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('session.id', () => ({ value: id.now }))
  on('session.cwd', () => ({ value: 'F:/projs/api' }))
  on('fs.exists', (_$, e) => ({ value: files.has(norm(e.path)) || [...files.keys()].some(k => k.startsWith(`${norm(e.path)}/`)) }))
  on('fs.read', (_$, e) => {
    const text = files.get(norm(e.path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    if (world.isDiskFull) return { deny: 'ENOSPC' }
    files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('fs.list', (_$, e) => ({
    value: [...files.keys()].filter(k => k.startsWith(`${norm(e.path)}/`)).map(k => ({ name: k.slice(norm(e.path).length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
  }))
  on('prompt.submit', (_$, e) => (e.text === 'blocked' ? { drop: 'policy' } : { text: e.text }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('model.complete', (_$, e) => ({
    value: world.isHaikuUp === false
      ? { isAnswered: false, reason: 'empty-reply', usage: USAGE }
      : { isAnswered: true, text: `Haiku: ${String(e.prompt).slice(0, 5)}`, usage: USAGE },
  }))
  on('ui.scroll', (_$, e) => {
    scrolled.push(JSON.stringify(e))
    return {}
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return { clock, files, id, scrolled, toasts, closed, registered }
}

const answer = (turnId: string, text: string) =>
  ({ answer: text, durationMs: 10, isAborted: false, turnId, reason: 'answer' }) as const

const entry = (id: number, text: string, isIdle: boolean) => ({ id, text, isIdle })

const savedFile = (sessionId: string, asked: object[], savedAt = Date.UTC(2026, 9, 5, 9)) =>
  JSON.stringify({ version: 1, sessionId, cwd: 'F:/projs/upload', savedAt, asked })

test('oneLine flattens and truncates', () => {
  expect(oneLine('a\n  b', 10)).toBe('a b')
  expect(oneLine('abcdefghij', 5)).toBe('abcd…')
})

test('isRowOf matches a framed row and never an empty prompt', () => {
  expect(isRowOf('<queued>fix it</queued>', 'fix it')).toBe(true)
  expect(isRowOf('anything', '   ')).toBe(false)
})

test('a queued prompt joins the turn its row lands in; an idle one waits for the next turn', () => {
  const list = [entry(1, 'fix the login bug', true), entry(2, 'also add a test', false)]
  const started = stampTurn(list, 't1', 'fix the login bug')
  expect(started.map(one => one.turnId)).toEqual(['t1', undefined])
  const landed = attachRow(started, '<queued>also add a test</queued>', 'u2', 't1')
  expect(landed[1]).toEqual({ id: 2, text: 'also add a test', isIdle: false, uuid: 'u2', turnId: 't1' })
  expect(attachRow(landed, 'nothing matches', 'u9', null)).toBe(landed)
  const waiting = attachRow(list, 'also add a test', 'u2', null)
  expect(stampTurn(waiting, 't2', '')[1]?.turnId).toBe('t2')
})

test('a short prompt never takes the row of a longer one that contains it', () => {
  const list = [entry(1, 'yes', false), entry(2, 'yes, and also fix the docs', false)]
  const landed = attachRow(list, '<queued>yes, and also fix the docs</queued>', 'u2', 't1')
  expect(landed.map(one => one.uuid)).toEqual([undefined, 'u2'])
  expect(attachRow(landed, 'yes', 'u1', 't1')[0]?.uuid).toBe('u1')
})

test('a turn stamps only the idle prompt that started it, not older strays', () => {
  const list = [entry(1, 'stray', true), entry(2, 'real one', true)]
  expect(stampTurn(list, 't1', 'real one').map(one => one.turnId)).toEqual([undefined, 't1'])
  expect(stampTurn(list, 't1', 'text the hooks rewrote').map(one => one.turnId)).toEqual([undefined, 't1'])
})

test('fillTldr fills only a pending TL;DR, never a finished one', () => {
  const list = [{ ...entry(1, 'a', true), turnId: 't1', tldr: 'kept' }, { ...entry(2, 'b', true), turnId: 't1', tldr: '…summarizing' }]
  expect(fillTldr(list, 't1', 'new').map(one => one.tldr)).toEqual(['kept', 'new'])
})

test('endNote names turns that have nothing to summarize', () => {
  expect(endNote('aborted', 'partial')).toBe('(interrupted)')
  expect(endNote('error', '')).toBe('(error)')
  expect(endNote('refusal', '')).toBe('(refusal)')
  expect(endNote('answer', '  ')).toBe('(no text reply)')
  expect(endNote('answer', 'hi')).toBeUndefined()
})

test('tldrColor: muted while pending, warning when interrupted, error on refusal and API errors, success when done', () => {
  expect(tldrColor(undefined).glyph).toBe('inactive')
  expect(tldrColor('…summarizing').text).toEqual({ color: 'inactive', italic: true })
  expect(tldrColor('(interrupted)').glyph).toBe('warning')
  expect(tldrColor('(refusal)').glyph).toBe('error')
  expect(tldrColor('(error)').text).toEqual({ color: 'error' })
  expect(tldrColor('Fixed it.')).toEqual({ glyph: 'success', text: {} })
})

test('took and stamp: the send time and how long the answer took, chat-bubble small', () => {
  expect(took(8_400)).toBe('8s')
  expect(took(64_000)).toBe('1m 4s')
  expect(took(3_725_000)).toBe('1h 2m')
  const at = new Date(2026, 9, 7, 14, 2).getTime()
  const now = new Date(2026, 9, 7, 15, 0).getTime()
  expect(stamp({ ...entry(1, 'a', true), at, tookMs: 64_000 }, now)).toBe('14:02 · 1m 4s')
  expect(stamp({ ...entry(1, 'a', true), at }, now)).toBe('14:02')
  expect(stamp(entry(1, 'a', true), now)).toBe('')
  expect(stamp({ ...entry(1, 'a', true), at: new Date(2026, 9, 2, 9, 5).getTime() }, now)).toBe('Oct 2 09:05')
  const rows = [{ ...entry(1, 'a', true), at, tookMs: 12_000 }, { ...entry(2, 'b', true), at: new Date(2026, 9, 7, 9, 41).getTime() }]
  expect(filterAsked(rows, '14:0').map(one => one.id)).toEqual([1])
  expect(filterAsked(rows, '9:4').map(one => one.id)).toEqual([2])
  expect(filterAsked(rows, 's')).toEqual([])
  expect(filterAsked(rows, '12')).toEqual([])
})

test('filterAsked: #n is a number only, bare digits put that row first, text searches prompt and TL;DR', () => {
  const list = [entry(1, 'fix ci', true), { ...entry(2, 'build 12 is slow', true), tldr: 'cache' }, entry(12, 'other', true)]
  expect(filterAsked(list, '#12').map(one => one.id)).toEqual([12])
  expect(filterAsked(list, '#99')).toEqual([])
  expect(filterAsked(list, '12').map(one => one.id)).toEqual([12, 2])
  expect(filterAsked(list, 'CACHE').map(one => one.id)).toEqual([2])
  expect(filterAsked(list, '  ').map(one => one.id)).toEqual([1, 2, 12])
})

test('parseSaved rejects broken or tombstoned files and marks unfinished summaries', () => {
  expect(parseSaved('not json')).toBeUndefined()
  expect(parseSaved('{"deleted":true}')).toBeUndefined()
  expect(parseSaved(savedFile('s', [{ id: 'x' }]))).toBeUndefined()
  const one = parseSaved(savedFile('s', [{ ...entry(1, 'a', true), turnId: 't', tldr: '…summarizing' }, { ...entry(2, 'b', true), tldr: 'done' }]))
  expect(one?.asked.map(a => a.tldr)).toEqual(['(no summary saved)', 'done'])
  expect(one?.asked[0]?.turnId).toBe('restored')
})

test('dayLabel says today, yesterday, or the date', () => {
  const now = new Date(2026, 9, 7, 15, 0).getTime()
  expect(dayLabel(new Date(2026, 9, 7, 9, 5).getTime(), now)).toBe('today 09:05')
  expect(dayLabel(new Date(2026, 9, 6, 9, 5).getTime(), now)).toBe('yesterday')
  expect(dayLabel(new Date(2026, 8, 30).getTime(), now)).toBe('Sep 30')
  expect(dayLabel(new Date(2026, 9, 6, 23, 59).getTime(), new Date(2026, 9, 7, 0, 30).getTime())).toBe('yesterday')
})

test('prompts list in order; Haiku writes each TL;DR off the turn; the list autosaves', async ($, on) => {
  const { clock, files } = engine(on)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })

  await $.prompt.submit({ text: 'fix the login bug', wait: false, origin: COMPOSER })
  await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'conclaude', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /…working/ })).toBeDefined()

  await $.turn.complete(answer('t1', 'Done.\n**TL;DR:** Fixed the null check in auth.'))
  expect(await ui.find({ type: 'Text', text: /…summarizing/ })).toBeDefined()
  await $.prompt.submit({ text: 'also add a test', wait: false, origin: COMPOSER })
  expect(await ui.find({ type: 'Text', text: /queued/ })).toBeDefined()
  await $.turn.start({ text: 'also add a test', turnId: 't2' })
  await $.turn.complete(answer('t2', 'Added tests/auth.test.ts covering it.'))
  await clock.advance(1000)
  await clock.advance(1000)

  expect(await ui.find({ type: 'Button', key: 'jump-1', text: /^fix the login bug$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /↳ Haiku: Done\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ · \d\d:\d\d · 0s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /↳ Haiku: Added/ })).toBeDefined()
  const file = parseSaved(files.get(`${DIR}/s1.json`)!)
  expect(file?.asked.map(one => one.tldr)).toEqual(['Haiku: Done.', 'Haiku: Added'])
})

test('each prompt shows how long it waited for its answer, queued time included', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'first', wait: false, origin: COMPOSER })
  await $.turn.start({ text: 'first', turnId: 't1' })
  await clock.advance(240_000)
  await $.prompt.submit({ text: 'second', wait: false, origin: COMPOSER })
  await clock.advance(60_000)
  await $.turn.complete(answer('t1', 'Done.'))
  await $.turn.start({ text: 'second', turnId: 't2' })
  await clock.advance(10_000)
  await $.turn.complete(answer('t2', 'Also done.'))
  await $.turn.complete(answer('t2', 'Repeat.'))
  const ui = await $.ui.mount({ plugin: 'conclaude', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /· \d\d:\d\d · 5m 0s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /· \d\d:\d\d · 1m 10s$/ })).toBeDefined()
})

test('with Haiku down the TL;DR falls back to the trimmed reply, never stuck summarizing', async ($, on) => {
  const { clock } = engine(on, { isHaikuUp: false })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'q', wait: false, origin: COMPOSER })
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.turn.complete(answer('t1', 'The whole reply.'))
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'conclaude', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /The whole reply\./ })).toBeDefined()
})

test('quitting before the autosave tick still saves', async ($, on) => {
  const { files } = engine(on)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'last words', wait: false, origin: COMPOSER })
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
  expect(parseSaved(files.get(`${DIR}/s1.json`)!)?.asked[0]?.text).toBe('last words')
})

test('a session switch saves the old list first; an unreadable file turns autosave off instead of overwriting it', async ($, on) => {
  const files = new Map([[`${DIR}/s2.json`, '{"version":1,"broken']])
  const { clock, id } = engine(on, { files })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'before clear', wait: false, origin: COMPOSER })
  id.now = 's2'
  await clock.advance(1000)
  expect(parseSaved(files.get(`${DIR}/s1.json`)!)?.asked[0]?.text).toBe('before clear')
  const ui = await $.ui.mount({ plugin: 'conclaude', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /couldn't read the saved session \(unreadable\); autosave is off for it/ })).toBeDefined()
  await $.prompt.submit({ text: 'new session prompt', wait: false, origin: COMPOSER })
  await clock.advance(1000)
  expect(files.get(`${DIR}/s2.json`)).toBe('{"version":1,"broken')
})

test('a summary that finishes after a session switch lands in the old session file', async ($, on) => {
  const { clock, files, id } = engine(on)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'q', wait: false, origin: COMPOSER })
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.turn.complete(answer('t1', 'Reply text.'))
  id.now = 's2'
  await clock.advance(1000)
  await clock.advance(1000)
  expect(parseSaved(files.get(`${DIR}/s1.json`)!)?.asked[0]?.tldr).toBe('Haiku: Reply')
})

test('a resumed session restores its saved list; a new session id starts empty', async ($, on) => {
  const files = new Map([[`${DIR}/s1.json`, savedFile('s1', [{ ...entry(1, 'old prompt', true), uuid: 'u1', tldr: 'old answer' }])]])
  const { clock, id, toasts } = engine(on, { files })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'conclaude', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Button', key: 'jump-1', text: /old prompt/ })).toBeDefined()
  expect(toasts).toContain('restored 1 prompt from the saved session')

  id.now = 's2'
  await clock.advance(1000)
  expect(await ui.find({ type: 'Button', text: /old prompt/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /No prompts yet/ })).toBeDefined()
})

test('/conClaude toggles the pane; /conClaude <n> jumps or explains', async ($, on) => {
  const world = { isOpen: false }
  const { closed, scrolled, registered } = engine(on, world)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual(['conClaude'])
  expect((await $.command.run({ ...RUN, args: '' })).text).toMatch(/conClaude opened/)
  world.isOpen = true
  await $.command.run({ ...RUN, args: '' })
  expect(closed).toEqual(['conclaude'])

  expect((await $.command.run({ ...RUN, args: '3' })).text).toBe('no prompts yet')
  await $.prompt.submit({ text: 'hello', wait: false, origin: COMPOSER })
  expect((await $.command.run({ ...RUN, args: '#9' })).text).toBe('no prompt 9 (1-1)')
  expect((await $.command.run({ ...RUN, args: '1' })).text).toBe('that prompt is not in the transcript yet')
  expect((await $.command.run({ ...RUN, args: 'abc' })).text).toBe('usage: /conClaude [n]')
  expect(scrolled.length).toBe(0)
})

test('find filters by text or #n and keeps real numbers', async ($, on) => {
  const { toasts } = engine(on)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  for (const text of ['fix ci', 'build docs', 'ci again']) await $.prompt.submit({ text, wait: false, origin: COMPOSER })
  const ui = await $.ui.mount({ plugin: 'conclaude', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  await ui.press({ key: 'find' })
  await ui.input({ key: 'find-input', text: 'ci', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /2 of 3 match "ci"/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'jump-3', text: /ci again/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /build docs/ })).toBeUndefined()
  await ui.input({ key: 'find-input', text: 'ci', kind: 'submit' })
  expect(toasts).toContain('2 matches - Tab to pick one')
  await ui.input({ key: 'find-input', text: 'zzz', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /No prompt matches "zzz"/ })).toBeDefined()
})

test('clear asks first, then empties the list and tombstones the saved copy', async ($, on) => {
  const { clock, files, toasts } = engine(on)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hello', wait: false, origin: COMPOSER })
  await clock.advance(1000)
  expect(parseSaved(files.get(`${DIR}/s1.json`)!)).toBeDefined()
  const ui = await $.ui.mount({ plugin: 'conclaude', surface: 'terminal', ...PANE })
  await ui.press({ key: 'clear' })
  expect(await ui.find({ type: 'Text', text: /Clear all 1 prompt from this list\?/ })).toBeDefined()
  await ui.press({ key: 'no' })
  expect(await ui.find({ type: 'Button', text: /hello/ })).toBeDefined()
  await ui.press({ key: 'clear' })
  await ui.press({ key: 'yes' })
  expect(await ui.find({ type: 'Text', text: /No prompts yet/ })).toBeDefined()
  expect(files.get(`${DIR}/s1.json`)).toBe('{"deleted":true}')
  expect(toasts).toContain('cleared 1 prompt')
})

test('saved view lists other sessions, opens one read-only, copies its resume command, deletes with confirm', async ($, on) => {
  const files = new Map([
    [`${DIR}/s0.json`, savedFile('s0', [{ ...entry(1, 'add retries to the uploader', true), tldr: 'Added backoff.' }])],
    [`${DIR}/gone.json`, '{"deleted":true}'],
  ])
  const { toasts } = engine(on, { files })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'conclaude', surface: 'terminal', ...PANE })
  await ui.press({ key: 'view' })
  expect(await ui.find({ type: 'Text', text: /Saved · 1 session$/ })).toBeDefined()
  await ui.press({ key: 'open-s0' })
  expect(await ui.find({ type: 'Text', text: /↳ Added backoff\./ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /add retries/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^claude --resume s0$/ })).toBeDefined()
  await ui.press({ key: 'copy' })
  expect(toasts).toContain('copied: claude --resume s0')
  await ui.press({ key: 'delete' })
  expect(await ui.find({ type: 'Text', text: /Delete this saved session\?/ })).toBeDefined()
  await ui.press({ key: 'yes' })
  expect(files.get(`${DIR}/s0.json`)).toBe('{"deleted":true}')
  expect(await ui.find({ type: 'Text', text: /No saved sessions yet\./ })).toBeDefined()
})

test('a prompt sent right after a session switch files under the new session; switching back keeps a pending summary', async ($, on) => {
  const { clock, files, id } = engine(on)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'q', wait: false, origin: COMPOSER })
  await $.turn.start({ text: 'q', turnId: 't1' })
  await $.turn.complete(answer('t1', 'Reply text.'))
  id.now = 's2'
  await $.prompt.submit({ text: 'other', wait: false, origin: COMPOSER })
  id.now = 's1'
  await $.prompt.submit({ text: 'back', wait: false, origin: COMPOSER })
  await clock.advance(1000)

  expect(parseSaved(files.get(`${DIR}/s2.json`)!)?.asked.map(one => one.text)).toEqual(['other'])
  const ui = await $.ui.mount({ plugin: 'conclaude', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /↳ Haiku: Reply/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'jump-2', text: /back/ })).toBeDefined()
})

test('a turn that ends after a switch sends its summary to the session it started in', async ($, on) => {
  const { clock, files, id } = engine(on)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'q', wait: false, origin: COMPOSER })
  await $.turn.start({ text: 'q', turnId: 't1' })
  id.now = 's2'
  await $.prompt.submit({ text: 'other', wait: false, origin: COMPOSER })
  await $.turn.complete(answer('t1', 'Reply text.'))
  await clock.advance(1000)

  expect(parseSaved(files.get(`${DIR}/s1.json`)!)?.asked[0]?.tldr).toBe('Haiku: Reply')
  expect(parseSaved(files.get(`${DIR}/s2.json`)!)?.asked.map(one => one.text)).toEqual(['other'])
})

test('leaving and returning mid-turn keeps the turn; an interrupted turn after a switch is noted in its own file', async ($, on) => {
  const { clock, files, id } = engine(on)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'q', wait: false, origin: COMPOSER })
  await $.turn.start({ text: 'q', turnId: 't1' })
  id.now = 's2'
  await $.prompt.submit({ text: 'other', wait: false, origin: COMPOSER })
  id.now = 's1'
  await $.prompt.submit({ text: 'back', wait: false, origin: COMPOSER })
  await $.turn.complete(answer('t1', 'Reply text.'))
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'conclaude', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /↳ Haiku: Reply/ })).toBeDefined()

  await $.turn.start({ text: 'back', turnId: 't2' })
  id.now = 's2'
  await $.prompt.submit({ text: 'again', wait: false, origin: COMPOSER })
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 't2', reason: 'aborted' })
  expect(parseSaved(files.get(`${DIR}/s1.json`)!)?.asked.map(one => one.tldr)).toEqual(['Haiku: Reply', '(interrupted)'])
})

test('a save that fails during a session switch still switches, and retries the old rows until they save', async ($, on) => {
  const world: Partial<World> = { isDiskFull: true }
  const { clock, files, id } = engine(on, world)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'unsaved', wait: false, origin: COMPOSER })
  id.now = 's2'
  await $.prompt.submit({ text: 'new session', wait: false, origin: COMPOSER })
  const ui = await $.ui.mount({ plugin: 'conclaude', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Button', key: 'jump-1', text: /new session/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 earlier session not saved yet; retrying/ })).toBeDefined()

  world.isDiskFull = false
  await clock.advance(1000)
  expect(parseSaved(files.get(`${DIR}/s1.json`)!)?.asked.map(one => one.text)).toEqual(['unsaved'])
  expect(parseSaved(files.get(`${DIR}/s2.json`)!)?.asked.map(one => one.text)).toEqual(['new session'])
})

test('a session whose file could not be read still switches away', async ($, on) => {
  const files = new Map([[`${DIR}/s1.json`, 'not json']])
  const { clock, id } = engine(on, { files })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'stuck?', wait: false, origin: COMPOSER })
  id.now = 's2'
  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'conclaude', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /No prompts yet/ })).toBeDefined()
})

test('a restored row never joins a new turn', async ($, on) => {
  const old = { ...entry(1, 'never ran', false), uuid: 'u1', at: 0 }
  const files = new Map([[`${DIR}/s1.json`, savedFile('s1', [old])]])
  engine(on, { files })
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'fresh', wait: false, origin: COMPOSER })
  await $.turn.start({ text: 'fresh', turnId: 't9' })
  await $.turn.complete(answer('t9', 'Done.'))
  const ui = await $.ui.mount({ plugin: 'conclaude', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^ · \w{3} \d+ \d\d:\d\d$/ })).toBeDefined()
})

test('plugin prompts and dropped prompts stay out, an interrupted turn says so', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'from a plugin', wait: false, origin: { kind: 'plugin', name: 'other' } })
  await $.prompt.submit({ text: 'blocked', wait: false, origin: COMPOSER })
  await $.prompt.submit({ text: 'stop me', wait: false, origin: COMPOSER })
  await $.turn.start({ text: 'stop me', turnId: 't1' })
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 't1', reason: 'aborted' })

  const ui = await $.ui.mount({ plugin: 'conclaude', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Button', text: /stop me/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /from a plugin|blocked/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\(interrupted\)/ })).toBeDefined()
})

test('a prompt with no transcript row yet toasts instead of jumping', async ($, on) => {
  const { scrolled, toasts } = engine(on)
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'hello', wait: false, origin: COMPOSER })
  const ui = await $.ui.mount({ plugin: 'conclaude', surface: 'desktop', ...PANE })
  await ui.press({ key: 'jump-1' })
  expect(scrolled.length).toBe(0)
  expect(toasts).toContain('that prompt is not in the transcript yet')
})

