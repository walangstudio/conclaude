# conClaude

![tests](https://img.shields.io/badge/tests-31%20passing-brightgreen) ![version](https://img.shields.io/badge/version-0.1.0-blue)

conClaude is a list of every prompt you sent Claude, with a one-line TL;DR of each answer.

It's for people who type the next prompt before Claude finished the last one. Three prompts later you've lost track of what you asked and what came back. conClaude sits in a pane next to your session and keeps that list for you. Press a prompt and the transcript scrolls back to it.

It's a mod: a plugin built on Claude Code's function hooks.

```
conClaude        13 prompts · 2 pending
Find  Saved  Clear  Close
────────────────────────────────────────
10 why is CI red
   ↳ Two flaky tests failed; retry passed
     after pinning Node. · 13:41 · 2m 5s
11 rename Foo to Bar across the repo
   ↳ …summarizing
12 add retries to the uploader
   ↳ …working
13 bump deps
   ↳ queued
```

## Requirements

- Claude Code 2.1.292 or later. Older builds are untested.
- Mods turned on. They're still early access. Add this to the `env` block of `~/.claude/settings.json`:

  ```json
  "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"
  ```

## Install

```
/plugin marketplace add walangstudio/marketplace
/plugin install conclaude@walangstudio
```

Restart Claude Code, then `/conClaude`.

Working from a checkout instead: `claude --plugin-dir path/to/conclaude`, or put the folder in `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`.

## Commands

| Command | Does |
| --- | --- |
| `/conClaude` | Open the pane, or close it if it's open |
| `/conClaude 12` | Scroll the transcript to prompt 12 |

It runs at once, even while Claude is mid-reply.

In fullscreen the pane docks beside the transcript from 110 columns. Narrower than that, it sits above the prompt.

## The pane

Each prompt gets a number, and the newest is at the bottom. Under it is the TL;DR of Claude's answer, or where the answer is at:

- `queued`: Claude hasn't started on it.
- `…working`: Claude is answering.
- `…summarizing`: the answer is done and the TL;DR is being written.
- `(interrupted)` in yellow, or an API error in red.

The dim tail on each TL;DR, `· 14:02 · 1m 4s`, is when you sent the prompt and how long you waited for the answer. The wait includes time spent in the queue. Prompts from an earlier day show the date too.

Press a prompt to jump to it, or Tab to it and press Enter.

## Keys

With the pane focused. Esc hands the keyboard back to the prompt.

| Key | Does |
| --- | --- |
| `f` | Find a prompt by its text, its number (`#12`) or the time you sent it (`14:` or `9:4`). Enter jumps when there's one match |
| `v` | Switch between this session and saved sessions |
| `x` | Clear this session's list (asks first) |
| `q` | Close the pane |

In a saved session:

| Key | Does |
| --- | --- |
| `b` | Back to the list |
| `c` | Copy its `claude --resume` command |
| `d` | Delete it (asks first) |

## Saved sessions

Every session saves itself to `~/.conclaude/sessions/<sessionId>.json`, one file per session. That folder is outside anything Claude Code cleans up. Resume a session with `claude --resume` and its list comes back, TL;DRs included.

Press `v` to browse older sessions by date, prompt count and folder. A session keeps its last 200 prompts.

Slash commands aren't listed, and neither are prompts sent through `claude -p`.

## Cost

The TL;DRs come from Claude Haiku at low effort, through your normal Claude Code login. That's one short call per answer. When a call fails, the TL;DR is the start of the answer instead.

conClaude writes its own TL;DRs. It doesn't need anything in your CLAUDE.md.

## Develop

```
claude plugin validate .
claude plugin test .
```

For type-checking, load the mod once (`--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS`) so Claude Code writes `.claude-plugin/types/`, then run `npx -y -p typescript@5 tsc -p .`.

Everything lives in `hooks/register.tsx`. Its pure helpers are exported, and `tests/conclaude.test.tsx` covers them along with the hooks.

## License

MIT, © walangstudio.
