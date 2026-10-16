#!/usr/bin/env node
/**
 * Map a release tag to the one package it releases.
 *
 * The repo tags a package as `<directory>@<version>` (for example
 * `dsh-colgrep@1.2.3`), which is what the publish workflow triggers on. The
 * tag has to agree with the manifest it names: a typo would otherwise publish
 * whatever version happened to sit in `package.json`, so every mismatch is a
 * hard failure here instead of a surprise on the registry.
 *
 * Printing `key=value` lines makes the output directly appendable to
 * `$GITHUB_OUTPUT`; `--json` is for humans and tests.
 *
 *     node scripts/resolve-tag.mjs dsh-colgrep@1.2.3
 *     node scripts/resolve-tag.mjs dsh-colgrep@1.2.3 --json
 *
 * @module dsh-hiss-plugins/scripts/resolve-tag
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Split a release tag into the package directory and version it names.
 * @param {string} tag - the pushed tag, e.g. `dsh-colgrep@1.2.3`.
 * @returns {{ dir: string, version: string }} the directory and version the tag names.
 * @throws when the tag is not `dsh-<name>@<semver>`.
 */
export function parseTag(tag) {
	const [dir, version, ...rest] = String(tag).split("@");
	if (dir === undefined || dir === "" || version === undefined || rest.length > 0 || version === "") {
		throw new Error(`tag ${JSON.stringify(tag)} is not <directory>@<version>`);
	}
	if (!/^dsh-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(dir)) {
		throw new Error(`tag ${JSON.stringify(tag)} must name a dsh-* package directory, not ${JSON.stringify(dir)}`);
	}
	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
		throw new Error(`tag ${JSON.stringify(tag)} must carry a semver version, not ${JSON.stringify(version)}`);
	}
	return { dir, version };
}

/**
 * Resolve a tag against the workspace on disk.
 * @param {string} root - repository root holding the package directories.
 * @param {string} tag - the pushed tag.
 * @returns {{ dir: string, name: string, version: string }} what to publish.
 * @throws when the named package is missing or its manifest disagrees with the tag.
 */
export function resolveTag(root, tag) {
	const { dir, version } = parseTag(tag);
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
	} catch {
		throw new Error(`tag ${JSON.stringify(tag)} names ${dir}/, which is not a package in this workspace`);
	}
	if (manifest.version !== version) {
		throw new Error(`${dir}/package.json is ${manifest.version} but the tag says ${version}`);
	}
	return { dir, name: manifest.name, version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		const target = resolveTag(ROOT, process.argv[2] ?? "");
		if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(target)}\n`);
		else process.stdout.write(`dir=${target.dir}\nname=${target.name}\nversion=${target.version}\n`);
	} catch (error) {
		process.stderr.write(`::error::${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
