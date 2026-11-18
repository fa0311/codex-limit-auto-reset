# Working on this repository

The code follows [typescript-design](https://github.com/fa0311/typescript-design-skill).
Read its `skills/typescript-design/SKILL.md` before changing anything here;
pull requests are reviewed against it. What that means in this repository:

- **Breaking changes are fine.** No migration paths, compatibility aliases, or
  fallbacks for old settings and log records. When a requirement changes,
  redesign the code it touches instead of adding to it, and say what broke in
  the pull request.
- **Where things live.** Effects are at the leaves (`codex-client.ts` talks to
  `codex app-server`), pure decisions are in the core (`schedule.ts`), and
  policy is at the roots (`main.ts` for the worker, `command.ts` for the
  one-shot commands). Errors are thrown and caught only at a root. The worker is
  resident: its root catches per check and carries on.
- **Facts go out through an `EventEmitter`**, not through callback arguments.
  `worker.ts` emits what happened; `main.ts` decides how to record it.
- **Tests.** Cover the pure logic exhaustively. Do not unit-test the wiring; the
  entry points and the client run against `test/fixtures/fake-codex.mjs`, a
  scripted stand-in for `codex app-server`. Do not change the design to make
  something testable.
- **Never spend real credits to test.** Do not run the worker or `reset` against
  a logged-in Codex account while developing.

`pnpm check` must pass.
