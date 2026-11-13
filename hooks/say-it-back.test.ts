import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const LONG = Array.from({ length: 160 }, (_, i) => `word${i}`).join(' ')
const PERSON = { kind: 'composer' } as const

const PLAYBACK_REPLY = [
  '**Playback**',
  '- **Asking:** a playback before work starts.',
  '- **Decided:** it saves what I confirm.',
  '- **Not sure yet:** the panel.',
  '',
  'Reply yes, or correct me.',
].join('\n')

// The world beneath the mod: a session, a home folder and a small file system.
function world(on: On) {
  const files = new Map<string, string>()
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 10, 13, 17, 42) })
  on('env.get', () => ({ value: '/home/test' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.root', () => ({ value: '/work/my-project' }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: LONG, toolUses: [] },
      { role: 'assistant', text: PLAYBACK_REPLY, toolUses: [] },
    ],
  }))
  on('fs.exists', (_, e) => ({ value: files.has(String(e.path)) }))
  on('fs.read', (_, e) => ({ value: files.get(String(e.path)) ?? '' }))
  on('fs.write', (_, e) => {
    files.set(String(e.path), String(e.text))
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('tool.check', () => ({ decision: 'allow' }))
  return files
}

const submit = ($: any, text: string) => $.prompt.submit({ text, wait: false, origin: PERSON })

test('a short message goes through untouched', async ($, on) => {
  world(on)
  const r = await submit($, 'fix the typo please')
  expect(r.context ?? []).toEqual([])
})

test('a long message asks for a playback and blocks edits until yes', async ($, on) => {
  const files = world(on)

  const first = await submit($, LONG)
  expect(first.context?.join('\n')).toContain('**Playback**')

  const edit = await $.tool.check({ tool: 'Edit', input: { file_path: 'a.md' } })
  expect(edit.decision).toBe('deny')
  const read = await $.tool.check({ tool: 'Read', input: { file_path: 'a.md' }, isReadOnly: true })
  expect(read.decision).toBe('allow')

  const fix = await submit($, 'no, the panel is decided, build it too')
  expect(fix.context?.join('\n')).toContain('corrects your playback')
  expect((await $.tool.check({ tool: 'Edit', input: {} })).decision).toBe('deny')

  const yes = await submit($, 'yes')
  expect(yes.context?.join('\n')).toContain('confirmed your playback')
  expect((await $.tool.check({ tool: 'Edit', input: {} })).decision).toBe('allow')

  const log = files.get('/home/test/.claude/say-it-back/2026-11.md') ?? ''
  expect(log).toContain('· my-project')
  expect(log).toContain('**Asking:** a playback before work starts.')
  expect(log).toContain('Corrected 1 time')
  expect(log).not.toContain('Reply yes')
})

test('"right, but..." is a correction, not a yes', async ($, on) => {
  world(on)
  await submit($, LONG)
  const r = await submit($, 'right, but the panel is wrong')
  expect(r.context?.join('\n')).toContain('corrects your playback')
  expect((await $.tool.check({ tool: 'Edit', input: {} })).decision).toBe('deny')
})

test('"go:" skips the playback', async ($, on) => {
  world(on)
  const r = await submit($, `go: ${LONG}`)
  expect(r.context ?? []).toEqual([])
  expect((await $.tool.check({ tool: 'Edit', input: {} })).decision).toBe('allow')
})

test('scheduled jobs never get a playback', async ($, on) => {
  world(on)
  const r = await $.prompt.submit({ text: LONG, wait: false, origin: { kind: 'scheduled-trigger' } as any })
  expect(r.context ?? []).toEqual([])
})

test('earlier confirmed playbacks are passed in for the Changed line', async ($, on) => {
  const files = world(on)
  await submit($, LONG)
  await submit($, 'yep')
  const again = await submit($, LONG)
  expect(again.context?.join('\n')).toContain('Earlier playbacks they confirmed')
  expect(files.size).toBe(1)
})
