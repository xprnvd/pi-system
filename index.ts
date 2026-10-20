/**
 * `/system` for pi — a live system overview poster (CPU, RAM, disk),
 * refreshing every 1s or 3s. Minimal snapshot scope for the small VPS.
 *
 * Data comes from /proc + statfs (no subprocess per tick); the top-process
 * list prefers `procs` when installed and falls back to `ps`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Key, matchesKey } from "@earendil-works/pi-tui"
import { renderSystem } from "./poster.ts"
import { prime, snapshot, textSnapshot } from "./system.ts"
import type { SystemSnapshot } from "./types.ts"
import { emptySnapshot } from "./types.ts"

const DEFAULT_INTERVAL = Number(process.env.PI_SYSTEM_INTERVAL ?? 1) === 3 ? 3000 : 1000

export default function systemExtension(pi: ExtensionAPI): void {
	pi.registerCommand("system", {
		description: "Live system overview: CPU, RAM and disk (1s/3s refresh)",
		handler: async (args, ctx) => {
			let intervalMs = /^\s*3\s*$/.test(args ?? "") ? 3000 : DEFAULT_INTERVAL

			if (ctx.mode !== "tui") {
				await prime()
				await new Promise((r) => setTimeout(r, 600))
				ctx.ui.notify(textSnapshot(await snapshot()), "info")
				return
			}

			await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
				let snap: SystemSnapshot = emptySnapshot()
				let loading = true
				let closed = false
				let cached: { width: number; rows: number; interval: number; loading: boolean; at: number; lines: string[] } | undefined
				const controller = new AbortController()

				const refresh = (): void => {
					cached = undefined
					tui.requestRender()
				}

				const tick = async (): Promise<void> => {
					try {
						snap = await snapshot()
						if (!closed) loading = false
					} catch {
						// keep the last good snapshot; the next tick retries
					}
					if (!closed) refresh()
				}

				void (async () => {
					await prime()
					// Small delay lets the CPU delta exist before first paint.
					await new Promise((r) => setTimeout(r, 500))
					if (!closed) await tick()
				})()
				const timerHolder: { current: ReturnType<typeof setInterval> } = {
					current: setInterval(() => {
						if (!closed) void tick()
					}, intervalMs),
				}
				controller.signal.addEventListener("abort", () => clearInterval(timerHolder.current))

				const render = (width: number): string[] => {
					const rows = tui.terminal.rows
					const key = `${snap.at}`
					if (cached?.width === width && cached.rows === rows && cached.interval === intervalMs && cached.loading === loading && cached.at === key) {
						return cached.lines
					}
					const intervalSecs = intervalMs / 1000
					const lines = renderSystem(snap, theme, width, rows, intervalSecs, loading)
					cached = { width, rows, interval: intervalMs, loading, at: key, lines }
					return lines
				}

				return {
					render,
					invalidate: () => {
						cached = undefined
					},
					handleInput: (data: string) => {
						if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data === "q") {
							closed = true
							controller.abort()
							done(undefined)
							return
						}
						if (data === "1" || data === "3") {
							const next = data === "3" ? 3000 : 1000
							if (next !== intervalMs) {
								intervalMs = next
								clearInterval(timerHolder.current)
								timerHolder.current = setInterval(() => {
									if (!closed) void tick()
								}, intervalMs)
								void tick()
							}
							return
						}
						if (data === "r") {
							void tick()
						}
					},
					dispose: () => {
						closed = true
						controller.abort()
					},
				}
			})
		},
	})
}
