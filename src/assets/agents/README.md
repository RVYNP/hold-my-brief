# Bundled agent icons

Put an agent's animated icon here as `<kind>.json` (`omp.json`, `claude.json`, `codex.json`, `cursor.json`, `other.json`). The app uses it for that
kind unless the user assigned a file of their own in Settings. A kind with no file here draws the fallback, a squircle with the agent's initial.

The file must follow [docs/agent-icons.md](../../../docs/agent-icons.md): Lottie, 96 × 96, the four markers `idle`, `listening`, `acting` and
`arriving`, `.tint` and `.fg` layer names, no expressions, no external assets, at most 512 KB. A file that does not have the four markers is ignored.
