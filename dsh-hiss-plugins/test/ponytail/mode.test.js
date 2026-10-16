/**
 * The ponytail level logic: the grammar, the default resolution, and the per-agent
 * override table. `mode.js` imports no host package, so every branch here runs under
 * this repo's own `node --test`.
 * @module dsh-hiss-plugins/test/ponytail/mode
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { LEVELS, currentMode, defaultConfigPath, normalizeMode, parseLevel, resolveDefaultMode, setMode } from "../../lib/ponytail/mode.js";

/** Write one config fixture and return its path. */
function configWith(content) {
	const root = mkdtempSync(join(tmpdir(), "ponytail-"));
	const path = join(root, "config.json");
	writeFileSync(path, content);
	return path;
}

/** The upstream config path under the real home, for the fallback branches. */
const HOME_CONFIG = join(homedir(), ".config", "ponytail", "config.json");

/**
 * Run `body` with `process.platform` forced, restoring the real value afterwards.
 * @param platform - the platform the branch under test reads.
 * @param body - the assertions to run while it is in force.
 */
function withPlatform(platform, body) {
	const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
	assert.equal(descriptor?.configurable, true, "process.platform must be stubbable to exercise the other platform's branch");
	Object.defineProperty(process, "platform", { value: platform, configurable: true });
	try {
		body();
	} finally {
		Object.defineProperty(process, "platform", descriptor);
	}
}

test("the level vocabulary is the three intensities plus off", () => {
	assert.deepEqual([...LEVELS].sort(), ["full", "lite", "off", "ultra"]);
});

test("parseLevel reads a bare or blank invocation as full", () => {
	assert.equal(parseLevel(""), "full");
	assert.equal(parseLevel("   "), "full");
	assert.equal(parseLevel("\t\n "), "full");
});

test("parseLevel accepts each level and normalizes case and padding", () => {
	for (const level of ["lite", "full", "ultra", "off"]) {
		assert.equal(parseLevel(level), level);
		assert.equal(parseLevel(`  ${level.toUpperCase()}  `), level, `${level} is case-insensitive and padded`);
	}
});

test("parseLevel rejects anything outside the grammar", () => {
	for (const raw of ["fast", "offf", "0", "lite full", "ponytail", "-"]) {
		assert.equal(parseLevel(raw), undefined, `parseLevel(${JSON.stringify(raw)}) must reject`);
	}
});

test("parseLevel rejects a non-string argument instead of defaulting to full", () => {
	// `invocation.rawInput` is typed as a string, so this branch is defensive only: a
	// missing argument must not silently turn the mode on.
	for (const raw of [undefined, null, 42, true, {}, ["lite"]]) {
		assert.equal(parseLevel(raw), undefined, `parseLevel(${JSON.stringify(raw)}) must reject`);
	}
});

test("normalizeMode accepts a padded, mixed-case string level", () => {
	for (const level of ["lite", "full", "ultra", "off"]) {
		assert.equal(normalizeMode(level), level);
		assert.equal(normalizeMode(` ${level.toUpperCase()} `), level);
	}
});

test("normalizeMode rejects a non-string or an unknown level", () => {
	// Unlike parseLevel, a blank string is not a level: a config candidate must name one.
	for (const value of [undefined, null, 3, true, {}, ["lite"], "fast", ""]) {
		assert.equal(normalizeMode(value), undefined, `normalizeMode(${JSON.stringify(value)}) must reject`);
	}
});

test("defaultConfigPath prefers %APPDATA% on Windows", () => {
	withPlatform("win32", () => {
		const appData = "C:\\Users\\someone\\AppData\\Roaming";
		assert.equal(defaultConfigPath({ APPDATA: appData }), join(appData, "ponytail", "config.json"));
	});
});

test("defaultConfigPath falls back to the XDG home when APPDATA is missing or blank", () => {
	withPlatform("win32", () => {
		assert.equal(defaultConfigPath({}), HOME_CONFIG, "a missing APPDATA falls through");
		assert.equal(defaultConfigPath({ APPDATA: "" }), HOME_CONFIG, "a blank APPDATA falls through");
		const xdg = "C:\\xdg";
		assert.equal(defaultConfigPath({ APPDATA: "", XDG_CONFIG_HOME: xdg }), join(xdg, "ponytail", "config.json"));
	});
});

test("defaultConfigPath uses $XDG_CONFIG_HOME off Windows", () => {
	withPlatform("linux", () => {
		const xdg = "/home/someone/.config";
		assert.equal(defaultConfigPath({ XDG_CONFIG_HOME: xdg }), join(xdg, "ponytail", "config.json"));
	});
});

test("defaultConfigPath falls back to ~/.config off Windows", () => {
	withPlatform("darwin", () => {
		assert.equal(defaultConfigPath({}), HOME_CONFIG);
		assert.equal(defaultConfigPath({ XDG_CONFIG_HOME: "" }), HOME_CONFIG);
	});
});

test("resolveDefaultMode lets the environment override the config file", () => {
	const path = configWith(JSON.stringify({ defaultMode: "lite" }));
	assert.equal(resolveDefaultMode({ PONYTAIL_DEFAULT_MODE: "ultra" }, path), "ultra");
	assert.equal(resolveDefaultMode({ PONYTAIL_DEFAULT_MODE: "  ULTRA " }, path), "ultra", "the environment value is normalized");
});

test("resolveDefaultMode falls through an invalid environment value to the file", () => {
	const path = configWith(JSON.stringify({ defaultMode: "lite" }));
	assert.equal(resolveDefaultMode({ PONYTAIL_DEFAULT_MODE: "fast" }, path), "lite");
	assert.equal(resolveDefaultMode({ PONYTAIL_DEFAULT_MODE: "" }, path), "lite");
});

test("resolveDefaultMode reads the file when the environment names no level", () => {
	assert.equal(resolveDefaultMode({}, configWith(JSON.stringify({ defaultMode: "off" }))), "off");
	assert.equal(resolveDefaultMode({}, configWith(JSON.stringify({ defaultMode: " ultra " }))), "ultra");
});

test("resolveDefaultMode defaults to full", () => {
	assert.equal(resolveDefaultMode({}, configWith("{}")), "full", "a file without defaultMode");
	assert.equal(resolveDefaultMode({}, configWith('{"defaultMode": 3}')), "full", "a non-string defaultMode");
	assert.equal(resolveDefaultMode({}, configWith('{"defaultMode": null}')), "full");
	assert.equal(resolveDefaultMode({}, configWith('{"defaultMode": "fast"}')), "full", "an unknown defaultMode");
	assert.equal(resolveDefaultMode({}, configWith("null")), "full", "a JSON null document");
	assert.equal(resolveDefaultMode({}, configWith('["lite"]')), "full", "an array document carries no defaultMode");
});

test("resolveDefaultMode falls through a malformed, missing, or unreadable file", () => {
	assert.equal(resolveDefaultMode({}, configWith("{ not json")), "full", "malformed JSON never throws");
	assert.equal(resolveDefaultMode({}, join(tmpdir(), "ponytail-absent", "config.json")), "full", "a missing file never throws");
	const directory = mkdtempSync(join(tmpdir(), "ponytail-dir-"));
	assert.equal(resolveDefaultMode({}, directory), "full", "a directory is not readable as a config file");
});

test("setMode records one agent's override and currentMode reads it back", () => {
	const agent = {};
	assert.equal(currentMode(agent, "full"), "full", "an agent with no override reports the fallback");
	setMode(agent, "ultra");
	assert.equal(currentMode(agent, "full"), "ultra");
	setMode(agent, "off");
	assert.equal(currentMode(agent, "full"), "off", "the newest level wins");
});

test("the override table is per agent, and a missing scope reports the fallback", () => {
	const first = {};
	const second = {};
	setMode(first, "lite");
	assert.equal(currentMode(first, "full"), "lite");
	assert.equal(currentMode(second, "full"), "full", "another agent keeps the default");
	assert.equal(currentMode(undefined, "off"), "off");
	assert.equal(currentMode(undefined, "ultra"), "ultra");
});
