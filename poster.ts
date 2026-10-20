/**
 * Poster renderer for /system. Same visual language as pi-stats-poster
 * (theme-derived colours, centred columns, truncateToWidth on every line)
 * but a fixed row count: live refresh must never change the panel height,
 * or the editor jumps and mouse selections break.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import type { Theme } from "@earendil-works/pi-coding-agent"
import type { SystemSnapshot } from "./types.ts"
import { formatBytes, formatUptime } from "./system.ts"

/** Fixed panel height, excluding the one top spacer. */
export const PANEL_ROWS = 17

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
	return Math.max(24, Math.min(96, termWidth - 8))
}

export function renderSystem(
	snap: SystemSnapshot,
	theme: Theme,
	termWidth: number,
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
	lines.push(center(theme.bold(theme.fg("text", `${snap.hostname} / system`)), width))
	lines.push(center(muted(`up ${formatUptime(snap.uptimeSecs)} · refresh ${intervalSecs}s · 1/3 rate · r now · q quit`), width))
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
	lines.push(base(`DISK ${snap.diskPct.toFixed(0)}%  ${formatBytes(diskUsed)}/${formatBytes(snap.diskTotal)}  (/)`))
	lines.push(pctColor(theme, snap.diskPct)(bar(snap.diskPct, barW)) + muted(`  ${formatBytes(snap.diskAvail)} avail`))
	lines.push("")
	lines.push(muted("TOP"))
	for (let i = 0; i < 3; i++) {
		const p = snap.procs[i]
		lines.push(p ? `${p.pcpu.toFixed(1).padStart(5)}%  ${p.comm.slice(0, width - 10)}` : "")
	}

	if (loading) lines.push(center(muted("refreshing…"), width))
	else if (!Number.isFinite(snap.cpuPct)) lines.push(center(muted("warming up — next tick fills CPU%"), width))
	else lines.push("")

	// Normalise: exactly PANEL_ROWS rows, every line poster-width, then centred.
	while (lines.length < PANEL_ROWS) lines.push("")
	const body = lines.slice(0, PANEL_ROWS).map((line) => padRight(line, width))
	return ["", ...body.map((line) => truncateToWidth(center(line, termWidth), termWidth))]
}
