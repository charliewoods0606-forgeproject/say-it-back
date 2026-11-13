# say-it-back

A Claude Code mod for people who talk to Claude in long, dictated messages.

When you send a long message, Claude doesn't start work straight away. It plays the message back to you in four short lines and waits:

```
**Playback**
- **Asking:** what you want done now
- **Decided:** only what you said clearly
- **Not sure yet:** your "I don't know"s and maybes, kept as maybes
- **Changed:** where this differs from something you said before

Reply yes, or correct me.
```

You say **yes**, or correct it. Claude plays it back again until it's right, and only then starts the work.

## Why

Voice notes ramble. They change direction and mix decisions with half-thoughts, and Claude tends to grab the wrong bit and rush ahead. A rule in CLAUDE.md asking it to check first gets forgotten. This mod runs every time, because it's code rather than a request.

## What it does

| When | What happens |
| --- | --- |
| You send a message of 150+ words | Claude gets the playback instruction and the session is marked "waiting". The status line shows `Playback: waiting for your yes`. |
| While it waits | Claude can read files, but anything that edits, writes or runs is refused, so it can't rush ahead. |
| You correct it | Claude plays it back again with your correction. |
| You say yes | The confirmed playback is saved, and Claude starts the work. |
| Next time you ramble in the same project | Your last 5 confirmed playbacks are passed in, so the **Changed** line can spot where you changed your mind. |

Short messages, slash commands, scheduled jobs and messages from other sessions are never played back.

**Skip it once:** start a message with `go:`, or write "no playback" anywhere in it.

## The record

Every playback you confirm is saved as a dated Markdown file, one per month:

```
~/.claude/say-it-back/2026-11.md

## 13 Nov 2026, 18:29 · my-project
- **Asking:** ...
- **Decided:** ...
- **Not sure yet:** ...
```

It's a clean record of what you meant, not what you rambled. Everything stays on your computer: the mod sends nothing anywhere.

## Install

At the prompt of a Claude Code session in a terminal:

```
/plugin install say-it-back --marketplace charliewoods0606-forgeproject/say-it-back
```

Or from a shell:

```bash
claude plugin install say-it-back --marketplace charliewoods0606-forgeproject/say-it-back
```

Answer `y` to add the marketplace, then pick a scope (user scope = every project). It's active straight away.

**Desktop app:** click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `charliewoods0606-forgeproject/say-it-back`, then **Add plugin**.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `min_words` | `150` | Messages at least this long get a playback. |
| `log_folder` | `~/.claude/say-it-back` | Where confirmed playbacks are saved. |

Change them in `/config` under the plugin's settings.

## Files

```
.claude-plugin/plugin.json        the mod's name, description and settings
.claude-plugin/marketplace.json   makes this repo installable with one line
hooks/hooks.json                  points Claude Code at the hooks module
hooks/register.ts                 the mod: three hooks (prompt, tool check, session end)
hooks/say-it-back.test.ts         tests: run `claude plugin test .`
```

## Licence

MIT
