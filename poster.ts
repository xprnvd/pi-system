/**
 * Poster renderer for /system. Same visual language as pi-stats-poster
 * (theme-derived colours, centred columns, truncateToWidth on every line)
 * but a fixed row count: live refresh must never change the panel height,
 * or the editor jumps and mouse selections break.
 */

import { backgroundAnsi, foregroundAnsi, isAppleTerminalSession, rgbColor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import type { Theme } from "@earendil-works/pi-coding-agent"
import type { SystemSnapshot } from "./types.ts"
import { formatBytes, formatUptime } from "./system.ts"

/** Fixed panel height, excluding the one top spacer. */
export const PANEL_ROWS = 19

/** Compact below the same row count as pi-stats-poster (hides the mark). */
export const COMPACT_ROWS = 38

// pi's brand mark, reproduced from pi-stats-poster (itself reproduced from
// pi's internal `pi-logo` module). Fixed brand colours, not theme-derived;
// Apple Terminal gets the wordmark fallback, same guard as upstream.
const CORAL = rgbColor(228, 138, 122)
const BLUE = rgbColor(79, 142, 179)
const YELLOW = rgbColor(234, 182, 93)

function piMark(theme: Theme): string[] {
	const mode = theme.getColorMode()
	if (isAppleTerminalSession()) {
		return [`${foregroundAnsi(CORAL, mode)}P\x1b[0m${foregroundAnsi(YELLOW, mode)}i\x1b[0m`]
	}
	return [
		`${foregroundAnsi(CORAL, mode)}${backgroundAnsi(BLUE, mode)}▀\x1b[0m${foregroundAnsi(CORAL, mode)}▀█\x1b[0m `,
		`${foregroundAnsi(BLUE, mode)}█▀\x1b[0m ${foregroundAnsi(YELLOW, mode)}█\x1b[0m`,
	]
}

function center(text: string, width: number): string {
	const pad = Math.max(0, Math.floor((width - visibleWidth(text)) / 2))
	return " ".repeat(pad) + text
}

function padRight(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - visibleWidth(text)))
}

function bar(pct: number, width: number): string {
	const w = Math.max(4, width)
	const fill = Math.round((Math.max(0, Math.min(100, pct)) / 100) * w)
	return "█".repeat(fill) + "░".repeat(w - fill)
}

function pctColor(theme: Theme, pct: number): (s: string) => string {
	if (pct >= 90) return (s) => theme.fg("error", s)
	if (pct >= 70) return (s) => theme.fg("warning", s)
	return (s) => theme.fg("text", s)
}

export function posterWidth(termWidth: number): number {
	return Math.max(12, Math.min(110, termWidth - 8))
}

export function renderSystem(
	snap: SystemSnapshot,
	theme: Theme,
	termWidth: number,
	termRows: number,
	intervalSecs: number,
	loading: boolean,
): string[] {
	const width = posterWidth(termWidth)
	const muted = (s: string) => theme.fg("muted", s)
	const base = (s: string) => theme.bold(theme.fg("text", s))
	const cpu = Number.isFinite(snap.cpuPct) ? snap.cpuPct : 0
	const cpuLabel = Number.isFinite(snap.cpuPct) ? `${snap.cpuPct.toFixed(0)}%` : "…"

	const barW = Math.max(10, width - 22)
	const lines: string[] = []
	// Header: pi-stats-poster uses justifyContent="space-between" — title flush
	// left, range flush right, stacking below 44 columns. Same here: title left,
	// uptime right. The pi mark sits under the header when the terminal is tall
	// enough, exactly like the poster; short terminals skip it (compact).
	// No key-hint line: like /stats, Esc/Ctrl+C/q just work. The only chrome
	// beyond the data is the interval, kept in the header's right span.
	const title = theme.bold(theme.fg("text", `${snap.hostname} / system`))
	const span = muted(`up ${formatUptime(snap.uptimeSecs)} · refresh ${intervalSecs}s`)
	if (width < 44) {
		lines.push(padRight(title, width), padRight(span, width))
	} else {
		const gap = Math.max(1, width - visibleWidth(title) - visibleWidth(span))
		lines.push(center(`${title}${" ".repeat(gap)}${span}`, width))
	}
	if (termRows >= COMPACT_ROWS) lines.push(...piMark(theme).map((line) => center(line, width)))
	lines.push("")
	lines.push(base(`CPU ${cpuLabel}   load ${snap.load1.toFixed(2)} ${snap.load5.toFixed(2)} ${snap.load15.toFixed(2)}`))
	lines.push(pctColor(theme, cpu)(bar(cpu, barW)) + muted(`  ${snap.cores} cores`))
	lines.push(muted(snap.cpuModel.slice(0, width)))
	lines.push("")
	const memUsed = snap.memTotal - snap.memAvail
	lines.push(base(`MEM ${snap.memPct.toFixed(0)}%  ${formatBytes(memUsed)}/${formatBytes(snap.memTotal)}`))
	lines.push(
		pctColor(theme, snap.memPct)(bar(snap.memPct, barW)) +
			muted(`  ${formatBytes(snap.memAvail)} avail${snap.swapTotal === 0 ? " · no swap" : ""}`),
	)
	lines.push("")
	const diskUsed = snap.diskTotal - snap.diskAvail
	lines.push(base(`DISK ${snap.diskPct.toFixed(0)}%  ${formatBytes(diskUsed)}/${formatBytes(snap.diskTotal)}`))
	lines.push(pctColor(theme, snap.diskPct)(bar(snap.diskPct, barW)) + muted(`  ${formatBytes(snap.diskAvail)} avail`))
	lines.push("")
	lines.push(muted("TOP · CPU"))
	for (let i = 0; i < 3; i++) {
		const p = snap.procs[i]
		if (!p) {
			lines.push("")
			continue
		}
		// pi sets a bare argv, so the cwd (~/…) is what tells same-name procs apart.
		const head = `${p.pcpu.toFixed(1).padStart(5)}%  ${String(p.pid).padStart(7)}  ${p.cmd}`
		const room = Math.max(0, width - visibleWidth(head) - 2)
		const tail = p.cwd ? muted(`  ${p.cwd.slice(0, room)}`) : ""
		lines.push(head + tail)
	}

	if (loading) lines.push(center(muted("refreshing…"), width))
	else if (!Number.isFinite(snap.cpuPct)) lines.push(center(muted("warming up — next tick fills CPU%"), width))
	else lines.push("")

	// Normalise: exactly PANEL_ROWS rows, every line poster-width, then centred.
	while (lines.length < PANEL_ROWS) lines.push("")
	const body = lines.slice(0, PANEL_ROWS).map((line) => padRight(line, width))
	return ["", ...body.map((line) => truncateToWidth(center(line, termWidth), termWidth))]
}
