/**
 * Checks for pi-system. No pi runtime needed: exercises the pure data layer
 * (system.ts) against fixtures plus a live snapshot, and validates the
 * poster's fixed-height/no-overflow contract with a stub theme.
 */
import { strict as assert } from "node:assert"

const system = await import("./system.ts")
const poster = await import("./poster.ts")
const types = await import("./types.ts")

// 1. Live snapshot on this machine.
await system.prime()
await new Promise((r) => setTimeout(r, 600))
const live = await system.snapshot()
assert.ok(live.cores >= 1, "cores >= 1")
assert.ok(live.memTotal > 0, "memTotal > 0")
assert.ok(live.diskTotal > 0, "diskTotal > 0")
assert.ok(Number.isFinite(live.cpuPct), "cpuPct filled after prime")
assert.ok(live.procs.length > 0, "top procs non-empty")
assert.ok(live.procs.some((p) => p.cwd), "proc cwd resolved")
console.log(
	`live: cpu ${live.cpuPct.toFixed(0)}% mem ${(live.memPct).toFixed(0)}% disk ${live.diskPct.toFixed(0)}% procs=${live.procs.length}`,
)

// 2. Headless text renders.
const text = system.textSnapshot(live)
assert.ok(text.includes("CPU") && text.includes("MEM") && text.includes("DISK"), "text has all blocks")

// 3. Poster contract with a stub theme.
const stubTheme = {
	fg: ( _k, s) => s,
	bold: (s) => s,
	colors: {},
	getColorMode: () => "dark",
	style: (s) => s,
}
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "")
for (const termWidth of [40, 80, 120]) {
	for (const termRows of [24, 50]) {
		const lines = poster.renderSystem(live, stubTheme, termWidth, termRows, 1, false)
		assert.equal(lines.length, poster.PANEL_ROWS + 1, `rows at ${termWidth}x${termRows}`)
		for (const line of lines) {
			assert.ok(
				[...stripAnsi(line)].length <= termWidth,
				`line fits at ${termWidth}: ${JSON.stringify(stripAnsi(line).slice(0, 60))}`,
			)
		}
	}
}
// Tall terminals show the pi mark, short ones skip it — same height either way.
const tall = poster.renderSystem(live, stubTheme, 80, 50, 1, false)
const short = poster.renderSystem(live, stubTheme, 80, 24, 1, false)
assert.ok(tall.some((l) => l.includes("▀") || l.includes("Pi")), "mark on tall terminals")
assert.ok(!short.some((l) => l.includes("▀")), "no mark on short terminals")
// Loading state keeps the same height.
const loading = poster.renderSystem(types.emptySnapshot(), stubTheme, 80, 50, 3, true)
assert.equal(loading.length, poster.PANEL_ROWS + 1, "loading rows match")
// TOP rows carry pid + command, so same-name procs are distinguishable.
assert.ok(tall.some((l) => /\d+%\s+\d+\s+\S/.test(l)), "top rows have pid + cmd")

// 4. Helpers.
assert.equal(system.formatBytes(0), "0.0B")
assert.equal(system.formatBytes(1536), "1.5K")
assert.equal(system.formatUptime(90), "1m")
assert.equal(system.formatUptime(3700), "1h 1m")
assert.equal(system.formatUptime(90000), "1d 1h")

console.log("verify: all checks passed")
