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

## Development

```sh
pnpm check
pnpm build
```

## License

[MIT](./LICENSE)

## Nix

The flake provides a package, worker and read-only credits apps, and a development
shell for x86_64/aarch64 Linux and macOS:

```sh
nix build
nix run .#credits
nix run
nix develop
```

An authenticated Codex CLI must be on `PATH`, or specified with `CODEX_BIN`.
The package uses your existing Codex installation and credentials. Environment
variables such as `CODEX_HOME` and `REDEEM_BEFORE_MINUTES` are passed through;
unlike `pnpm start`, the packaged executables do not load a local `.env` file.

From another flake, use `inputs.codex-limit-auto-reset.packages.${system}.default`
with the input URL `github:fa0311/codex-limit-auto-reset`. The package installs
`codex-limit-auto-reset` and `codex-limit-auto-reset-cli`, which can also be used
in a Home Manager or systemd service. `nix flake check` builds the package for
the current system.

### Home Manager (Linux)

Import `inputs.codex-limit-auto-reset.homeManagerModules.default` and enable:

```nix
services.codex-limit-auto-reset = {
  enable = true;
  redeemBeforeMinutes = 360;
  # codexPackage = pkgs.codex;
  # codexHome = "${config.home.homeDirectory}/.codex";
};
```

This starts a systemd user service and restarts it on failure. `codexPackage`
defaults to the package configured by `programs.codex` when enabled, otherwise
`pkgs.codex`; `codexHome` respects `home.sessionVariables.CODEX_HOME`.
Authenticate with that Codex installation before enabling the service. Use
`journalctl --user -u codex-limit-auto-reset` to inspect the worker.
The package and Home Manager module are maintained here rather than requiring NUR.
