/**
 * Ponytail level logic: the level grammar, the default-level resolution, and the
 * per-agent override table.
 *
 * Deliberately free of host imports, so every branch here runs under this repo's own
 * `node --test` without a DSH context (the same split `lib/gitbash/resolve.js` and
 * `lib/project-mcp/config.js` use).
 *
 * @module dsh-hiss-plugins/ponytail/mode
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The levels the upstream skill documents, plus `off`. */
export const LEVELS = new Set(["lite", "full", "ultra", "off"]);

/**
 * Per-agent level overrides.
 *
 * In-process and keyed by the agent object, exactly like the plugin this replaces:
 * the level is a property of the running session, while the *default* is the
 * durable value and comes from the environment or the upstream config file.
 */
const modes = new WeakMap();

/**
 * The level currently in force for one agent.
 *
 * @param {object | undefined} agent the agent (an assembly scope) or nothing.
 * @param {"off" | "lite" | "full" | "ultra"} fallback the resolved default level.
 * @returns {"off" | "lite" | "full" | "ultra"} the override, or the fallback.
 */
export function currentMode(agent, fallback) {
	return modes.get(agent) ?? fallback;
}

/**
 * Record one agent's level override.
 *
 * @param {object} agent the agent whose level changes.
 * @param {"off" | "lite" | "full" | "ultra"} level the new level.
 */
export function setMode(agent, level) {
	modes.set(agent, level);
}

/**
 * Parse the `/ponytail` argument.
 *
 * @param {string} rawInput the exact text following the command name.
 * @returns {"off" | "lite" | "full" | "ultra" | undefined} the level, a bare
 *   invocation meaning `full`, or `undefined` for anything the grammar rejects.
 */
export function parseLevel(rawInput) {
	if (typeof rawInput !== "string") return undefined;
	const input = rawInput.trim().toLowerCase();
	if (input.length === 0) return "full";
	return LEVELS.has(input) ? input : undefined;
}

/**
 * Normalize one candidate level from an environment variable or config file.
 *
 * @param {unknown} value the raw candidate.
 * @returns {"off" | "lite" | "full" | "ultra" | undefined} the level, or nothing.
 */
export function normalizeMode(value) {
	if (typeof value !== "string") return undefined;
	const mode = value.trim().toLowerCase();
	return LEVELS.has(mode) ? mode : undefined;
}

/**
 * The upstream-compatible config path: `%APPDATA%\ponytail\config.json` on Windows,
 * `$XDG_CONFIG_HOME/ponytail/config.json` (default `~/.config`) elsewhere.
 *
 * @param {Record<string, string | undefined>} [env] environment to read.
 * @returns {string} absolute path to the config file.
 */
export function defaultConfigPath(env = process.env) {
	if (process.platform === "win32" && typeof env.APPDATA === "string" && env.APPDATA !== "") {
		return join(env.APPDATA, "ponytail", "config.json");
	}
	const xdg = typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME !== ""
		? env.XDG_CONFIG_HOME
		: join(homedir(), ".config");
	return join(xdg, "ponytail", "config.json");
}

/**
 * Resolve the default level the way upstream does: `PONYTAIL_DEFAULT_MODE` first,
 * then the config file's `defaultMode`, then `full`. An unreadable, missing, or
 * malformed config file is not an error — it just falls through.
 *
 * @param {Record<string, string | undefined>} [env] environment to read.
 * @param {string} [configPath] config file to read.
 * @returns {"off" | "lite" | "full" | "ultra"} the resolved default.
 */
export function resolveDefaultMode(env = process.env, configPath = defaultConfigPath(env)) {
	const fromEnv = normalizeMode(env.PONYTAIL_DEFAULT_MODE);
	if (fromEnv !== undefined) return fromEnv;
	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf8"));
		if (parsed !== null && typeof parsed === "object") {
			const fromFile = normalizeMode(parsed.defaultMode);
			if (fromFile !== undefined) return fromFile;
		}
	} catch {
		// Missing, unreadable, or malformed config: fall through to the default.
	}
	return "full";
}
