# Changelog

## [0.1.1] - 2026-10-08

### Fixed
- Toasts no longer repeat the name: Claude Code already shows them under the plugin's name.
- On Claude Desktop, pressing a prompt explains that the app doesn't let plugins scroll the transcript, instead of a raw engine error. The jump works in the terminal.

## [0.1.0] - 2026-10-07

### Added
- `/conClaude` toggles a pane listing every prompt you sent this session, numbered, newest last. It runs mid-turn.
- A TL;DR under each prompt, written by Haiku: "queued", "…working" and "…summarizing" while it has none, yellow when interrupted, red on an API error.
- Press a prompt, or `/conClaude <n>`, to scroll the transcript to it.
- A small dim tail on each TL;DR: when the prompt was sent and how long you waited for the answer, queue time included (`· 14:02 · 1m 4s`).
- Find (`f`) by text, `#n` or a time like `14:`. Enter jumps on a single match.
- Autosave per session to `~/.conclaude/sessions/<sessionId>.json`. `claude --resume` brings the list back, and a quit right after a prompt still saves.
- Saved sessions (`v`): browse by date, prompt count and folder, copy the `claude --resume` command (`c`), delete with a confirm (`d`).
- Clear (`x`) with a confirm. It also drops the saved copy, unless that file couldn't be read.
- The pane's footer only shows up for problems: a failed autosave, or a saved session it couldn't read.
- Colors come from your Claude Code theme: the ↳ before each TL;DR is green when done, yellow when interrupted, red on an error, muted while pending. Prompt numbers are a colored column, and the pane follows new prompts to the bottom.
