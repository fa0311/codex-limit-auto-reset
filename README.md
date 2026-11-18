# codex-limit-auto-reset

A small tool that monitors Codex rate-limit reset credits and automatically redeems them before they expire.

## Run locally

Requires Node.js 24 or later, pnpm, and an authenticated [Codex CLI](https://github.com/openai/codex).

```sh
pnpm install
pnpm start
```

To list the available credits without redeeming them:

```sh
pnpm start:cli
```

## Run with Docker

Mount your Codex CLI credentials into the container:

```sh
docker run -d \
  --name codex-limit-auto-reset \
  --restart unless-stopped \
  -v "$HOME/.codex:/data/codex" \
  ghcr.io/fa0311/codex-limit-auto-reset
```

## Configuration

The following environment variables are available:

| Variable | Default | Description |
| --- | --- | --- |
| `REDEEM_BEFORE_MINUTES` | `360` | How many minutes before expiration a credit should be redeemed |
| `RESET_REMAINING_PERCENT` | unset | Opt in to resetting when either main allowance has this percentage or less remaining (0–20) |
| `USAGE_POLL_SECONDS` | `60` | Poll interval with usage monitoring enabled (10–3600 seconds) |
| `STATE_FILE` | `$XDG_STATE_HOME/codex-limit-auto-reset/recovery.json` | Persistent pending-redemption checkpoint; XDG state defaults to `~/.local/state` |
| `CODEX_BIN` | `codex` | Codex CLI command or path |

Local runs also load variables from a `.env` file in the project root.

## Low-usage resets

Set `RESET_REMAINING_PERCENT=10` to check the main Codex allowance every 60 seconds
and redeem when its primary or secondary window has 10% or less remaining.
Expiry-based redemption remains enabled. Both triggers select at most one available,
unexpired credit per check, earliest expiry first. Credits without an expiration
can be used for low usage, after dated credits, but never for the expiry trigger.
Model-specific allowances and elapsed usage windows do not trigger a full reset.
Missing usage data never triggers a low-usage redemption.

Usage monitoring is opt-in; leaving the threshold unset retains expiry scheduling.
This worker changes the account's allowance, regardless of which client consumes it.
It does not resume tasks that already stopped. A sudden burst can exhaust usage
between polls, so choose a threshold with sufficient headroom.

Run only one worker per account, including across machines. Before a monitored
redemption, the worker atomically saves the selected credit ID. Subsequent checks
retry that same ID (using its idempotency key) if it is still available; otherwise
they wait until the main allowance is observed above the threshold before allowing
another redemption. This survives restarts and avoids spending the next credit
on stale usage. A corrupt checkpoint stops the worker instead of losing this guard.
Use separate state files for separate accounts. If recovery stays pending, inspect
usage and the redemption history before manually clearing the checkpoint; do not
remove it merely to force another reset. Unknown RPC failures retain the checkpoint;
explicit `nothingToReset` and `noCredit` responses clear it for the next check.

## Reset history

The background worker writes one JSON object per line to standard output. Each
record includes an ISO 8601 UTC `timestamp`, `level`, and `event`:

```json
{"timestamp":"2026-11-01T01:23:45.000Z","level":"info","event":"credit_redemption_result","credit_id":"example-credit","attempt":1,"outcome":"reset"}
```

Redemption events include `reason` (`expiry` or `low_usage`).

Events:

- `credit_redemption_attempt`: `credit_id` and one-based `attempt` before each RPC attempt.
- `credit_redemption_result`: `credit_id`, `attempt`, and the returned `outcome`.
- `credit_redemption_error`: `credit_id`, `attempt`, and `error_type: "operation_failed"` for each failed RPC attempt.
- `check_failed`: `operation` (`initialize` or `check`) and the safe error type when the worker terminates unsuccessfully.
- `usage_recovery_pending`: the `credit_id` whose redemption is awaiting observed allowance recovery.
- `next_check`: `delay_ms` until the next scheduled scan, including the daily scan when no credits are eligible.

Count **only** `credit_redemption_result` with `outcome: "reset"` as confirmed
resets. `nothingToReset`, `noCredit`, and `alreadyRedeemed` are separate results;
failed attempts are not resets. Retries keep the credit ID as the idempotency key.
If a reset succeeds remotely but its response is lost, a later `alreadyRedeemed`
response cannot prove that this worker performed the reset; it is not counted as
one. Logs report observed outcomes, not a transactional audit trail.

Errors deliberately omit raw messages, stacks, and RPC payloads, which may
contain authentication data. Codex app-server's own diagnostic stderr remains
separate from the worker's JSON stdout. The interactive CLI commands retain their
human-readable output.

For systemd, the journal captures these records. A collector such as Alloy can
forward them to Loki; the worker does not require a metrics server or a webhook.
Use your desired local timezone when grouping UTC timestamps into calendar days.
Log retention and durable storage are the responsibility of the journal/collector.

## Development

```sh
pnpm check
pnpm build
```

## License

[MIT](./LICENSE)
