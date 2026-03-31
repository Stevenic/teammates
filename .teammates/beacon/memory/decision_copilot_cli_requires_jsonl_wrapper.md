---
name: copilot_cli_stdin_piping
description: Copilot CLI must use interactive mode (no -p flag) with stdin piping to avoid Windows command-line length limits. -p - does NOT work, but omitting -p entirely and piping stdin does.
type: decision
---
# Copilot CLI Stdin Piping

## Decision
For the Copilot adapter, pipe the prompt via stdin WITHOUT the `-p` flag. Copilot reads from stdin in interactive mode, processes one message, and exits on EOF.

Use:
- `stdinPrompt: true` (pipes prompt from Node.js to copilot's stdin)
- No `-p` flag at all
- JSONL output: `--output-format json --stream off --no-color`
- Same `command: "copilot"` on all platforms (no PowerShell wrapper)

## Why
- `copilot -p <text>` passes the entire prompt as a command-line argument. On Windows, `CreateProcessW` has a ~32K character limit, and teammate prompts easily exceed this.
- `copilot -p -` does NOT read from stdin — it treats `-` as literal prompt text.
- `copilot -p @filepath` does NOT read from a file — it treats `@filepath` as literal prompt text.
- Copilot has no `--prompt-file` or `--stdin` flag.
- Interactive mode (no `-p`) with stdin piping was verified to work: copilot reads the piped text, processes it, returns JSONL output, and exits cleanly.

## History
Previously used a PowerShell `-EncodedCommand` wrapper that read the prompt file into a variable and passed it via `-p $prompt`. This failed with "The filename or extension is too long" when the prompt exceeded Windows' command-line limit.

## Consequences
- `parseOutput()` extracts the last non-empty `assistant.message` from the JSONL stream (unchanged).
- Live activity tails the paired `.teammates\.tmp\debug\*.md` log file for Copilot tool events (unchanged).
