/** Shared data shapes for the /system live overview. */

export interface TopProc {
	pcpu: number
	pid: number
	comm: string
	/** Truncated command line (comm + leading args), for telling apart same-name procs. */
	cmd: string
}

export interface SystemSnapshot {
	/** 0-100, from /proc/stat delta. NaN on first sample. */
	cpuPct: number
	load1: number
	load5: number
	load15: number
	cores: number
	cpuModel: string
	memTotal: number
	memAvail: number
	memPct: number
	swapTotal: number
	/** Root filesystem, via statfs. */
	diskTotal: number
	diskAvail: number
	diskPct: number
	uptimeSecs: number
	hostname: string
	procs: TopProc[]
	at: number
}

export function emptySnapshot(): SystemSnapshot {
	return {
		cpuPct: NaN,
		load1: 0,
		load5: 0,
		load15: 0,
		cores: 0,
		cpuModel: "…",
		memTotal: 1,
		memAvail: 1,
		memPct: 0,
		swapTotal: 0,
		diskTotal: 1,
		diskAvail: 1,
		diskPct: 0,
		uptimeSecs: 0,
		hostname: "…",
		procs: [],
		at: Date.now(),
	}
}
