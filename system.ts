/**
 * Data layer for /system. Reads Linux /proc directly plus a statfs for the
 * root filesystem, so a 1s refresh costs no subprocess spawns. The top-process
 * list is the only spawn (ps, or procs when it is on PATH) and is refreshed
 * at most every 3s.
 *
 * Non-Linux platforms degrade to zeros rather than throwing, following
 * pi-sysmon's lead.
 */

import { execFile } from "node:child_process"
import { statfs } from "node:fs/promises"
import { cpus, homedir, hostname, uptime } from "node:os"
import { readFile, readlink } from "node:fs/promises"
import type { SystemSnapshot, TopProc } from "./types.ts"
import { emptySnapshot } from "./types.ts"

let lastCpu: { idle: number; total: number } | undefined
let lastProcs: { at: number; list: TopProc[] } = { at: 0, list: [] }
let procsTool: "procs" | "ps" | undefined

async function read(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8")
	} catch {
		return undefined
	}
}

/** Returns 0-100, or NaN on the first call (no delta yet). */
function cpuFromStat(line: string | undefined): number {
	if (!line) return NaN
	const parts = line.trim().split(/\s+/).slice(1).map(Number)
	if (parts.length < 4 || parts.some((n) => !Number.isFinite(n))) return NaN
	const idle = parts[3]! + (parts[4] ?? 0)
	const total = parts.reduce((a, b) => a + b, 0)
	const prev = lastCpu
	lastCpu = { idle, total }
	if (!prev || total <= prev.total) return NaN
	const dt = total - prev.total
	const di = idle - prev.idle
	return Math.max(0, Math.min(100, ((dt - di) / dt) * 100))
}

function memFromMeminfo(text: string | undefined): { total: number; avail: number; swap: number } {
	const get = (key: string): number => {
		const m = text?.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))
		return m ? Number(m[1]) * 1024 : 0
	}
	return { total: get("MemTotal"), avail: get("MemAvailable"), swap: get("SwapTotal") }
}

function run(cmd: string, args: string[]): Promise<string> {
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: 4000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
			resolve(err ? "" : `${stdout}${stderr}`)
		})
	})
}

/** Strip the directory off argv[0] (`/usr/bin/node --import …` → `node --import …`) so the meaningful args survive truncation. */
function shortCmd(full: string): string {
	const m = full.match(/^(\S+)(.*)$/)
	if (!m) return full.slice(0, 48)
	const base = m[1]!.split("/").pop() ?? m[1]!
	return `${base}${m[2]}`.slice(0, 48)
}

/** Best-effort cwd for a pid; pi sets a bare argv so cwd is the distinguisher. */
async function pidCwd(pid: number): Promise<string> {
	try {
		const target = await readlink(`/proc/${pid}/cwd`)
		const home = homedir()
		return target === home ? "~" : target.startsWith(`${home}/`) ? `~${target.slice(home.length)}` : target
	} catch {
		return ""
	}
}

async function topProcs(): Promise<TopProc[]> {
	if (Date.now() - lastProcs.at < 3000 && lastProcs.list.length > 0) return lastProcs.list
	if (procsTool === undefined) {
		const probe = await run("procs", ["--version"])
		procsTool = probe.includes("procs") ? "procs" : "ps"
	}
	let list: TopProc[] = []
	if (procsTool === "procs") {
		const out = await run("procs", ["--sortd", "cpu", "--format", "json"])
		try {
			const rows = JSON.parse(out || "[]") as Array<Record<string, unknown>>
			list = await Promise.all(
				rows.slice(0, 5).map(async (r) => {
				const cmd = String(r["Command"] ?? r["command"] ?? "?")
				const pid = Number(r["PID"] ?? r["pid"] ?? 0)
				return {
					pcpu: Number(r["CPU"] ?? r["cpu"] ?? 0),
					pid,
					comm: cmd.split(" ")[0] ?? "?",
					cmd: shortCmd(cmd),
					cwd: pid > 0 ? await pidCwd(pid) : "",
				}
			}),
			)
		} catch {
			list = []
		}
	}
	if (list.length === 0) {
		const out = await run("ps", ["-eo", "pcpu,pid,args", "--sort=-pcpu"])
		const parsed = out
			.split("\n")
			.slice(1, 6)
			.map((line) => {
				const m = line.trim().match(/^([\d.]+)\s+(\d+)\s+(.+)$/)
				if (!m) return undefined
				return { pcpu: Number(m[1]), pid: Number(m[2]), full: m[3]! }
			})
			.filter((r): r is { pcpu: number; pid: number; full: string } => !!r)
		list = await Promise.all(
			parsed.map(async ({ pcpu, pid, full }) => ({
				pcpu,
				pid,
				comm: full.split(" ")[0] ?? "?",
				cmd: shortCmd(full),
				cwd: await pidCwd(pid),
			})),
		)
	}
	lastProcs = { at: Date.now(), list }
	return list
}

/** Prime the CPU delta so the first rendered frame already has a value. */
export async function prime(): Promise<void> {
	const stat = await read("/proc/stat")
	if (stat) cpuFromStat(stat.split("\n")[0])
}

export async function snapshot(): Promise<SystemSnapshot> {
	const snap = emptySnapshot()
	try {
		const [stat, meminfo, loadavg, cpuinfo] = await Promise.all([
			read("/proc/stat"),
			read("/proc/meminfo"),
			read("/proc/loadavg"),
			read("/proc/cpuinfo"),
		])
		snap.cpuPct = cpuFromStat(stat?.split("\n")[0])
		const loads = (loadavg ?? "").split(" ").map(Number)
		if (loads.length >= 3) {
			snap.load1 = loads[0]!
			snap.load5 = loads[1]!
			snap.load15 = loads[2]!
		}
		const cores = cpus()
		snap.cores = cores.length
		snap.cpuModel =
			cpuinfo?.match(/^model name\s+:\s+(.+)$/m)?.[1]?.trim() ??
			cores[0]?.model ??
			"unknown"
		const mem = memFromMeminfo(meminfo)
		if (mem.total > 0) {
			snap.memTotal = mem.total
			snap.memAvail = mem.avail
			snap.memPct = ((mem.total - mem.avail) / mem.total) * 100
		}
		snap.swapTotal = mem.swap
		try {
			const st = await statfs("/")
			const bsize = Number(st.bsize)
			snap.diskTotal = Number(st.blocks) * bsize
			snap.diskAvail = Number(st.bavail) * bsize
			if (snap.diskTotal > 0) {
				snap.diskPct = ((snap.diskTotal - snap.diskAvail) / snap.diskTotal) * 100
			}
		} catch {
			// keep defaults; df-equivalent unavailable
		}
		snap.uptimeSecs = uptime()
		snap.hostname = hostname()
		snap.procs = await topProcs()
		snap.at = Date.now()
	} catch {
		// degrade to the best partial snapshot we have
	}
	return snap
}

export function formatBytes(n: number): string {
	if (!Number.isFinite(n) || n < 0) return "?"
	const units = ["B", "K", "M", "G", "T"]
	let v = n
	let u = 0
	while (v >= 1024 && u < units.length - 1) {
		v /= 1024
		u++
	}
	return `${v >= 100 ? Math.round(v) : v.toFixed(1)}${units[u]}`
}

export function formatUptime(secs: number): string {
	const d = Math.floor(secs / 86400)
	const h = Math.floor((secs % 86400) / 3600)
	const m = Math.floor((secs % 3600) / 60)
	if (d > 0) return `${d}d ${h}h`
	if (h > 0) return `${h}h ${m}m`
	return `${m}m`
}

/** Plain-text rendering for non-TUI (headless) mode. */
export function textSnapshot(s: SystemSnapshot): string {
	const cpu = Number.isFinite(s.cpuPct) ? `${s.cpuPct.toFixed(0)}%` : "…"
	const lines = [
		`${s.hostname}  uptime ${formatUptime(s.uptimeSecs)}`,
		`CPU  ${cpu}  load 1m ${s.load1.toFixed(2)} 5m ${s.load5.toFixed(2)} 15m ${s.load15.toFixed(2)} (${s.cores > 0 ? (s.load1 / s.cores).toFixed(2) : "?"}/core, ${s.cores} cores)`,
		`     ${s.cpuModel}`,
		`MEM  ${s.memPct.toFixed(0)}%  ${formatBytes(s.memTotal - s.memAvail)}/${formatBytes(s.memTotal)} used  ${formatBytes(s.memAvail)} avail${s.swapTotal === 0 ? "  (no swap)" : ""}`,
		`DISK ${s.diskPct.toFixed(0)}%  ${formatBytes(s.diskTotal - s.diskAvail)}/${formatBytes(s.diskTotal)} used  ${formatBytes(s.diskAvail)} avail  (/)`,
		`TOP  ${s.procs.map((p) => `${p.pcpu.toFixed(1)}% ${p.pid} ${p.cmd}${p.cwd ? ` [${p.cwd}]` : ""}`).join("  ·  ") || "…"}`,
	]
	return lines.join("\n")
}
