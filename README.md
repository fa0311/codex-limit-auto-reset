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
| `CODEX_BIN` | `codex` | Codex CLI command or path |

Local runs also load variables from a `.env` file in the project root.

## Reset history

The background worker writes one JSON object per line to standard output. Each
record includes an ISO 8601 UTC `timestamp`, `level`, and `event`:

```json
{"timestamp":"2026-11-01T01:23:45.000Z","level":"info","event":"credit_redemption_result","credit_id":"example-credit","attempt":1,"outcome":"reset"}
```

Events:

- `credit_redemption_attempt`: `credit_id` and one-based `attempt` before each RPC attempt.
- `credit_redemption_result`: `credit_id`, `attempt`, and the returned `outcome`.
- `credit_redemption_error`: `credit_id`, `attempt`, and `error_type: "operation_failed"` for each failed RPC attempt.
- `check_failed`: `operation` (`initialize` or `check`) and the safe error type when the worker terminates unsuccessfully.
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
