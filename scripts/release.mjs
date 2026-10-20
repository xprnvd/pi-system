#!/usr/bin/env node
// Prepare a release: bump the version, refresh the lockfile and the pinned
// tag in the README, and print the commands that publish it.
//
//   node scripts/release.mjs 0.1.9
//   node scripts/release.mjs 0.1.9 --dry-run
//
// It stops before the git commands on purpose: the commit, the tag and the
// push stay a human decision.

import { readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const version = args.find((arg) => !arg.startsWith("--"))

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
	console.error("usage: node scripts/release.mjs <version> [--dry-run]")
	process.exit(1)
}

const read = (file) => readFileSync(join(root, file), "utf8")
const write = (file, content) => writeFileSync(join(root, file), content)

const manifest = JSON.parse(read("package.json"))
const current = manifest.version
if (compareVersions(version, current) <= 0) {
	console.error(`version ${version} is not newer than ${current}`)
	process.exit(1)
}

// The package version.
manifest.version = version
if (!dryRun) write("package.json", `${JSON.stringify(manifest, null, "\t")}\n`)

// The pinned tag in the README, in both spellings: @v0.1.8 for git and
// @0.1.8 for the npm spec.
const readme = read("README.md")
const before = readme
const pinned = readme
	.replace(new RegExp(`@v${current.replace(/\./g, "\\.")}`, "g"), `@v${version}`)
	.replace(new RegExp(`@${current.replace(/\./g, "\\.")}\\b`, "g"), `@${version}`)
if (pinned === before) {
	console.error(`README.md does not mention @v${current} - update the pinned tag by hand`)
	process.exit(1)
}
if (!dryRun) write("README.md", pinned)

// The lockfile records the version too.
if (!dryRun) {
	execFileSync("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"], {
		cwd: root,
		stdio: "ignore",
	})
}

console.log(`${dryRun ? "[dry run] " : ""}prepared ${current} -> ${version}`)
console.log(`  package.json  ${version}`)
console.log(`  package-lock.json  ${version}`)
console.log(`  README.md  @v${version} / @${version}`)
console.log("")
console.log("next:")
console.log(`  git -C ${root} add -A && git commit -m "Release v${version}"`)
console.log(`  git -C ${root} tag -a v${version} -m "v${version}"`)
console.log(`  git -C ${root} push origin main --follow-tags`)
console.log("")
console.log("the tag fires CI, which tests, checks the tag against package.json,")
console.log("and publishes to npm. then update the version in the vault note:")
console.log("  vault:30-knowledge/references/pi-system.md")

function compareVersions(a, b) {
	const pa = a.split(".").map(Number)
	const pb = b.split(".").map(Number)
	for (let i = 0; i < 3; i++) {
		if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
	}
	return 0
}
