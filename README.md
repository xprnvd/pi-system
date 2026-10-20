# pi-system

Live system overview for [pi](https://pi.dev), the coding agent: CPU, RAM and
disk as a poster that refreshes every 1s or 3s. Run `/system` in interactive
mode; `1` / `3` switches the rate, `r` refreshes now, `Escape`, `Ctrl+C` (or
`q`) closes it.

Minimal snapshot scope, tuned for a small VPS: load averages, per-resource
bars with 70/90% warn/crit colouring, top-3 CPU processes, uptime, and a
no-swap warning when the machine has none.

## Install

From a local checkout (this repo is the source of truth at `/srv/pi-system`):

```bash
pi install /srv/pi-system
```

Later, from git or npm once published:

```bash
pi install git:github.com/xprnvd/pi-system
```

## Use

```
/system      # live poster, 1s refresh
/system 3    # live poster, 3s refresh
```

In headless mode (`ctx.mode !== "tui"`) the command prints one text snapshot
instead of opening the poster.

## How it stays fast

- CPU/RAM/load/disk come from `/proc` + `statfs` read directly in Node —
  zero subprocess spawns per tick, the same approach `pi-sysmon` uses.
- The top-process list is the only spawn and refreshes at most every 3s. It
  prefers [`procs`](https://github.com/dalance/procs) when installed and falls
  back to `ps`.
- Companion tools for manual ssh use (not extension dependencies):
  `btop` (interactive all-in-one), `duf` (`df`), `dust` (`du`), `procs`
  (`ps`), `fastfetch` (header). On Ubuntu 26.04 ARM64:
  `sudo apt install btop duf du-dust procs fastfetch`.

## Layout

One file per job, mirroring `pi-stats-poster`:

- `index.ts` — registers `/system` and hosts the live TUI view
- `poster.ts` — renders the poster at a fixed 17 rows (constant height keeps
  the editor from jumping on refresh)
- `system.ts` — collectors (`/proc`, `statfs`, top processes) + text fallback
- `types.ts` — the snapshot shape
- `verify.mjs` — checks: fixed row count, no line overflow, parsers on
  fixtures

```bash
npm test   # the checks
```

`PI_SYSTEM_INTERVAL=3` changes the default rate.
