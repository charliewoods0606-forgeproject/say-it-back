import type { EngineInterface, Register } from 'claude-code'

// say-it-back: after a long message, Claude plays it back and waits for a yes.
//
// 1. A long message (min_words or more) gets a playback instruction attached,
//    and the session is marked "waiting".
// 2. While waiting, tools that change things are refused, so Claude can't
//    rush ahead. Reading is still allowed.
// 3. A short "yes" saves the last playback to the log and lets work start.
//    Anything else counts as a correction: Claude plays it back again.

const MARK = '**Playback**'

const YES =
  /^\s*(yes|yeah|yep|yup|ya|correct|right|that's right|thats right|exactly|spot on|perfect|go|go ahead|do it|good|ok|okay|sounds good|that's it|thats it)\b/i

// Starting a message with "go:" or writing "no playback" skips the playback.
const SKIP = /^\s*go:|\bno playback\b/i

// Tools Claude may still use while waiting, beyond any read-only tool.
const ALWAYS_ALLOWED = new Set([
  'ToolSearch',
  'Skill',
  'AskUserQuestion',
  'TodoWrite',
  'mcp__ccd_turn__update_plan',
  'mcp__ccd_turn__wrap_up',
])

// Only people typing (terminal, desktop app, phone bridge) get a playback,
// never scheduled jobs, other sessions or notifications.
const FROM_A_PERSON = new Set(['composer', 'bridge', 'sdk'])

type Waiting = { since: number; corrections: number }
type Options = { min_words?: number; log_folder?: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

export const wordCount = (text: string) =>
  text
    .replace(/<\/?pasted_content[^>]*>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length

// "Right, but..." or "yes, except..." is a correction, not a yes.
const BUT = /\b(but|not|no|wrong|change|instead|actually|except|although)\b/i

export const isYes = (text: string) => YES.test(text) && !BUT.test(text) && wordCount(text) <= 12

// Pull the playback block (from the marker to the end) out of a reply.
export const playbackOf = (reply: string) => {
  const at = reply.lastIndexOf(MARK)
  if (at < 0) return undefined
  return reply
    .slice(at + MARK.length)
    .replace(/\n*\s*(reply|say)\s+yes[\s\S]*$/i, '')
    .trim()
}

// Split a month's log into entries ("## " headings) for one project.
export const entriesFor = (log: string, project: string) =>
  log
    .split(/\n(?=## )/)
    .filter(entry => entry.startsWith('## ') && (entry.split('\n')[0] ?? '').endsWith(`· ${project}`))

const instruction = (earlier: string[]) =>
  [
    'say-it-back: this is a long message, probably dictated. Before doing anything else, play it back so the person can check you understood.',
    'Reply with only this block, then stop and wait. Run no tools except to read something you need in order to understand the message.',
    '',
    MARK,
    '- **Asking:** what they want done now, in one or two lines.',
    '- **Decided:** only what they said clearly. Write "Nothing yet" if nothing.',
    '- **Not sure yet:** their "I don\'t know"s, maybes and half-thoughts. Never turn these into decisions.',
    '- **Changed:** only where this differs from something they said earlier (in this conversation or in the earlier playbacks below). Leave the line out if nothing changed.',
    '',
    'Reply yes, or correct me.',
    '',
    'Use their own words where you can. Keep each line short. No suggestions, plans or extra detail in the playback.',
    ...(earlier.length
      ? ['', 'Earlier playbacks they confirmed in this project, oldest first:', '', ...earlier]
      : []),
  ].join('\n')

const REDO =
  'say-it-back: this corrects your playback. Give a new playback in the same format (starting with ' +
  MARK +
  '), with the correction in it, then stop and wait for their yes. Run no tools that change anything.'

const GO = 'say-it-back: they confirmed your playback. Go ahead with the work it describes.'

async function key($: EngineInterface) {
  return `waiting:${await $.session.id()}`
}

async function folder($: EngineInterface, opts: Options) {
  const raw = String(opts.log_folder ?? '~/.claude/say-it-back')
  const home = (await $.env.get('HOME')) ?? ''
  return raw.replace(/^~(?=$|\/)/, home).replace(/\/$/, '')
}

async function project($: EngineInterface) {
  const root = await $.session.root()
  return root.split('/').filter(Boolean).pop() ?? 'home'
}

const monthFile = (dir: string, d: Date) => `${dir}/${d.getFullYear()}-${pad(d.getMonth() + 1)}.md`

async function readOr($: EngineInterface, path: string) {
  return (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
}

// The last five confirmed playbacks in this project, this month and last.
async function earlierPlaybacks($: EngineInterface, opts: Options) {
  const dir = await folder($, opts)
  const name = await project($)
  const now = new Date(await $.clock.now())
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const text = (await readOr($, monthFile(dir, last))) + '\n' + (await readOr($, monthFile(dir, now)))
  return entriesFor(text, name).slice(-5)
}

async function save($: EngineInterface, opts: Options, playback: string, waiting: Waiting) {
  const dir = await folder($, opts)
  const now = new Date(await $.clock.now())
  const path = monthFile(dir, now)
  const when = `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}, ${pad(now.getHours())}:${pad(now.getMinutes())}`
  const fixes = waiting.corrections
    ? `\n_Corrected ${waiting.corrections} time${waiting.corrections > 1 ? 's' : ''} before the yes._`
    : ''
  const entry = `## ${when} · ${await project($)}\n\n${playback}${fixes}\n\n_Session ${await $.session.id()}_\n`
  const before = await readOr($, path)
  await $.fs.write(path, before ? `${before.trimEnd()}\n\n${entry}` : `# Confirmed playbacks\n\n${entry}`)
  return path
}

export const register: Register = (on, options) => {
  const opts = (options ?? {}) as Options
  const minWords = Number(opts.min_words ?? 150) || 150

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || !FROM_A_PERSON.has(e.origin.kind)) return next(e)

    const k = await key($)
    const waiting = (await $.store.get(k)) as Waiting | undefined
    const add = (text: string) => next({ ...e, context: [...(e.context ?? []), text] })

    if (waiting) {
      if (SKIP.test(e.text)) {
        await $.store.delete(k)
        $.ui.status(undefined)
        return next(e)
      }
      if (isYes(e.text)) {
        const replies = (await $.session.messages()).filter(m => m.role === 'assistant')
        const latest = [...replies].reverse().find(m => m.text.includes(MARK))
        const playback = latest && playbackOf(latest.text)
        await $.store.delete(k)
        $.ui.status(undefined)
        if (playback) {
          await save($, opts, playback, waiting)
          $.ui.toast('Playback saved')
        }
        return add(GO)
      }
      await $.store.set(k, { ...waiting, corrections: waiting.corrections + 1 })
      return add(REDO)
    }

    if (SKIP.test(e.text) || wordCount(e.text) < minWords) return next(e)

    await $.store.set(k, { since: await $.clock.now(), corrections: 0 })
    $.ui.status('Playback: waiting for your yes')
    return add(instruction(await earlierPlaybacks($, opts)))
  })

  // While waiting for a yes, refuse anything that changes things.
  on('tool.check', async ($, e, next) => {
    if (e.isReadOnly || ALWAYS_ALLOWED.has(e.tool)) return next(e)
    if (!(await $.store.get(await key($)))) return next(e)
    return {
      decision: 'deny',
      reason:
        'say-it-back: waiting for the person to confirm your playback. Give the playback and stop; work starts after their yes.',
    }
  })

  // A cleared or ended session stops waiting.
  on('session.end', async ($, e, next) => {
    await $.store.delete(await key($))
    $.ui.status(undefined)
    return next(e)
  })
}
