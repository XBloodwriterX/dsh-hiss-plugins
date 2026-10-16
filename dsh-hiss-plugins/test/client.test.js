/**
 * The browser half's contract: the module-loader registration, the Plugins-page tab it
 * contributes, and the ordering, refusal and rendering behaviour of that tab.
 * @module dsh-hiss-plugins/test/client
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The registration key: the client module system matches it against the Loader row's package. */
const PACKAGE_ID = "dsh-hiss-plugins";
/** Dictionary namespace the tab registers and binds. */
const NS = "hissPlugins";
/** The four feature rows the tab manages, in the order it lists them. */
const FEATURE_KEYS = ["colgrep", "codegraph", "project-mcp", "gitbash"];
/** Refusal codes the page explains in its own words. */
const READ_ONLY_CODES = ["management-required", "unaddressable"];

/** The render pass in flight; the bundle's `require("react")` reaches these hooks. */
let activePass = null;
const react = {
	useState(initial) {
		if (activePass === null) throw new Error("useState called outside a render pass");
		return activePass.useState(initial);
	},
	useEffect(effect, deps) {
		if (activePass === null) throw new Error("useEffect called outside a render pass");
		return activePass.useEffect(effect, deps);
	},
};

/** Elements as plain records, so a test can read the tree a component returned. */
function jsx(type, props, key) {
	return { type, props: key === undefined ? (props ?? {}) : { ...props, key } };
}
const jsxRuntime = { jsx, jsxs: jsx };

let captured;
globalThis.window = { __ModuleLoader__: { load: (record) => { captured = record; } } };
await import("../lib/client.js");

/** Materialize the lazily registered bundle through the client baseline's module table. */
function loadBundle() {
	return captured.factory((specifier) => {
		if (specifier === "react") return react;
		if (specifier === "react/jsx-runtime") return jsxRuntime;
		throw new Error(`the client baseline has no module ${specifier}`);
	});
}

/** One running-profile row as pluginManager/listPlugins reports it, shuffled on purpose. */
const ROWS = [
	{ entryId: "core-tools", moduleName: "@deepseek-ai/dsh-tools", enabled: true, fiberPhase: "active", patchId: "core-tools" },
	{ entryId: "hiss-plugins", moduleName: PACKAGE_ID, enabled: true, fiberPhase: "active", patchId: "dsh-hiss-plugins" },
	{ entryId: "hiss-gitbash", moduleName: `${PACKAGE_ID}/gitbash`, enabled: false, fiberPhase: null, patchId: "dsh-hiss-plugins-gitbash" },
	{ entryId: "hiss-colgrep", moduleName: `${PACKAGE_ID}/colgrep`, enabled: true, fiberPhase: "active", patchId: "dsh-hiss-plugins-colgrep" },
	{ entryId: "hiss-project-mcp", moduleName: `${PACKAGE_ID}/project-mcp`, enabled: true, fiberPhase: "active", readOnlyReason: "unaddressable" },
	{ entryId: "hiss-codegraph", moduleName: `${PACKAGE_ID}/codegraph`, enabled: false, fiberPhase: "pending", patchId: "dsh-hiss-plugins-codegraph" },
];

/** What those rows must become: this package's four features, in the tab's fixed order. */
const MAPPED = [
	{ entryId: "hiss-colgrep", key: "colgrep", enabled: true, toggleable: true, reason: undefined },
	{ entryId: "hiss-codegraph", key: "codegraph", enabled: false, toggleable: true, reason: undefined },
	{ entryId: "hiss-project-mcp", key: "project-mcp", enabled: true, toggleable: false, reason: "unaddressable" },
	{ entryId: "hiss-gitbash", key: "gitbash", enabled: false, toggleable: true, reason: undefined },
];

/** A successful read answer. */
function listOk(rows = ROWS) {
	return { ok: true, value: rows };
}

/** A successful change answer. */
function changeOk(application = "applied", error = undefined) {
	return {
		ok: true,
		value: { changed: true, application, stage: "enable", target: "hiss-colgrep", ...(error === undefined ? {} : { error }) },
	};
}

/**
 * Run the bundle's apply against a fake context.
 * @param options - scripted manager answers and the language the bound lookup resolves.
 * @returns the recorded calls, the inject face and the registered component.
 */
function applyBundle(options = {}) {
	const list = options.list ?? (() => listOk());
	const setEnabled = options.setEnabled ?? (() => changeOk());
	const calls = { effects: [], injected: [], registered: [], toggled: [], listed: 0, dictionaries: null };
	const manager = {
		async listPlugins() {
			calls.listed += 1;
			return list();
		},
		async setPluginEnabled(entryId, enabled) {
			calls.toggled.push([entryId, enabled]);
			return setEnabled(entryId, enabled);
		},
	};
	const language = options.language ?? "en";
	const ctx = {
		effect(callback, name) {
			calls.effects.push(name);
			return callback();
		},
		locale: {
			register(namespace, dictionaries) {
				calls.dictionaries = { namespace, dictionaries };
				return () => {};
			},
			bind(namespace) {
				return (key, params) => {
					assert.equal(namespace, NS);
					const text = calls.dictionaries?.dictionaries?.[language]?.[key];
					assert.equal(typeof text, "string", `dictionary key ${key} is missing`);
					return params === undefined ? text : text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
				};
			},
			resolveText(value) {
				return typeof value === "string" ? value : String(value?.en ?? value);
			},
		},
		slots: {
			inject(name, callback) {
				calls.injected.push(name);
				return callback();
			},
			register(registration, component) {
				calls.registered.push({ registration, component });
				return () => {};
			},
		},
		remote: { pluginManager: manager },
		logger: { error() {}, warn() {}, info() {} },
	};
	const exported = loadBundle();
	exported.apply(ctx);
	return { calls };
}

/** The inject face the one registration exposes. */
function faceOf(calls) {
	const { registration } = calls.registered[0];
	return registration.inject();
}

/** Flatten a stub tree into its element records and text leaves. */
function flatten(node) {
	if (Array.isArray(node)) return node.flatMap(flatten);
	if (node === null || node === undefined || typeof node === "boolean") return [];
	if (typeof node === "object") return [node, ...flatten(node.props?.children)];
	return [node];
}

/** The text a stub tree renders, joined for one assertion. */
function textOf(tree) {
	return flatten(tree).filter((node) => typeof node === "string").join(" ");
}

/** Mount the tab with the props a slot renderer passes: the inject face plus the owner props. */
function mount(calls) {
	const { registration, component } = calls.registered[0];
	const props = { ...registration.inject(), install() {}, openPackage() {} };
	const slots = new Map();
	let tree;
	/** Set by any state write, including the ones an awaited request resolves after a pass. */
	let dirty = true;
	/** Let awaited work settle before deciding the tree is stable. */
	const flush = () => new Promise((resolve) => setImmediate(resolve));
	/** Re-render until no state write is left, running effects whose dependencies changed. */
	const settle = async () => {
		for (let pass = 0; pass < 12; pass += 1) {
			let cursor = 0;
			dirty = false;
			activePass = {
				useState(initial) {
					const at = cursor;
					cursor += 1;
					const slot = slots.get(at) ?? { value: initial };
					slots.set(at, slot);
					return [slot.value, (next) => {
						const value = typeof next === "function" ? next(slot.value) : next;
						if (!Object.is(value, slot.value)) {
							slot.value = value;
							dirty = true;
						}
					}];
				},
				useEffect(effect, deps) {
					const at = cursor;
					cursor += 1;
					const slot = slots.get(at);
					if (slot !== undefined && deps !== undefined && slot.deps !== undefined && deps.length === slot.deps.length && deps.every((value, index) => Object.is(value, slot.deps[index]))) return;
					slot?.cleanup?.();
					slots.set(at, { deps, cleanup: effect() });
				},
			};
			try {
				tree = component(props);
			} finally {
				activePass = null;
			}
			await flush();
			if (!dirty) break;
		}
		return tree;
	};
	return { settle };
}

test("the bundle registers a lazy factory under the package id", () => {
	assert.equal(captured.id, PACKAGE_ID);
	assert.equal(typeof captured.factory, "function");
});

test("the bundle exports apply and the client services it uses", () => {
	const exported = loadBundle();
	assert.equal(typeof exported.apply, "function");
	assert.deepEqual(exported.inject, ["slots", "locale", "remote", "remote.pluginManager"]);
});

test("apply registers the dictionaries and one plugins.tab entry", () => {
	const { calls } = applyBundle();
	assert.deepEqual(calls.effects, ["hiss-plugins: dictionaries"]);
	assert.equal(calls.dictionaries.namespace, NS);
	assert.deepEqual(calls.injected, ["plugins.tab"]);
	assert.equal(calls.registered.length, 1);
	const { registration, component } = calls.registered[0];
	assert.equal(registration.name, "plugins.tab");
	assert.equal(registration.id, "dsh-hiss-plugins");
	assert.equal(registration.order, 20);
	assert.equal(registration.locale, NS);
	assert.equal(typeof registration.label, "function");
	assert.equal(registration.label(), "dsh-hiss-plugins");
	assert.equal(typeof registration.inject, "function");
	assert.equal(typeof component, "function");
});

test("the inject face exposes the four feature keys in the tab's order", () => {
	const { calls } = applyBundle();
	const face = faceOf(calls);
	assert.deepEqual(face.features, FEATURE_KEYS);
	assert.equal(typeof face.list, "function");
	assert.equal(typeof face.setEnabled, "function");
	assert.equal(typeof face.t, "function");
});

test("list keeps this package's rows and returns them in the fixed order", async () => {
	const { calls } = applyBundle();
	const rows = await faceOf(calls).list();
	assert.deepEqual(rows, MAPPED);
	assert.deepEqual(rows.map((row) => row.key), FEATURE_KEYS);
});

test("list drops every foreign module name", async () => {
	const { calls } = applyBundle({
		list: () => listOk([
			{ entryId: "core-tools", moduleName: "@deepseek-ai/dsh-tools", enabled: true, fiberPhase: "active", patchId: "core-tools" },
			{ entryId: "hiss-plugins", moduleName: PACKAGE_ID, enabled: true, fiberPhase: "active", patchId: "dsh-hiss-plugins" },
			{ entryId: "other", moduleName: `${PACKAGE_ID}/colgrep-extra`, enabled: true, fiberPhase: "active", patchId: "other" },
			{ entryId: "hiss-colgrep", moduleName: `${PACKAGE_ID}/colgrep`, enabled: true, fiberPhase: "active", patchId: "dsh-hiss-plugins-colgrep" },
		]),
	});
	const rows = await faceOf(calls).list();
	assert.deepEqual(rows.map((row) => row.key), ["colgrep"]);
});

test("list throws a readable error when the manager refuses to answer", async () => {
	const { calls } = applyBundle({ list: () => ({ ok: false, error: { code: "gateway/internal", message: "socket closed" } }) });
	await assert.rejects(faceOf(calls).list(), /socket closed/);
});

for (const code of READ_ONLY_CODES) {
	test(`setEnabled explains a ${code} refusal carried by the answer`, async () => {
		const { calls } = applyBundle({ setEnabled: () => ({ ok: false, error: { code, message: code } }) });
		const face = faceOf(calls);
		await assert.rejects(face.setEnabled("hiss-colgrep", false), (error) => {
			assert.equal(error.code, code);
			assert.equal(error.message, face.t(code === "management-required" ? "reasonManagementRequired" : "reasonUnaddressable"));
			assert.ok(!error.message.includes(code), "readable copy must not leak the raw code");
			return true;
		});
	});

	test(`setEnabled explains a ${code} refusal carried by a failed change`, async () => {
		const { calls } = applyBundle({ setEnabled: () => changeOk("failed", { code }) });
		const face = faceOf(calls);
		await assert.rejects(face.setEnabled("hiss-plugins", true), (error) => {
			assert.equal(error.code, code);
			assert.ok(error.message.length > 0);
			assert.ok(!error.message.includes(code), "readable copy must not leak the raw code");
			return true;
		});
	});
}

test("setEnabled forwards both arguments and returns the application", async () => {
	const { calls } = applyBundle({ setEnabled: (entryId, enabled) => changeOk(enabled ? "applied" : "restart-required") });
	const face = faceOf(calls);
	assert.equal(await face.setEnabled("hiss-colgrep", false), "restart-required");
	assert.equal(await face.setEnabled("hiss-codegraph", true), "applied");
	assert.deepEqual(calls.toggled, [["hiss-colgrep", false], ["hiss-codegraph", true]]);
});

test("the tab renders one labelled switch per feature once the list arrives", async () => {
	const { calls } = applyBundle();
	const tab = mount(calls);
	const tree = await tab.settle();
	const inputs = flatten(tree).filter((node) => node.type === "input");
	assert.deepEqual(inputs.map((node) => node.props["aria-label"]), FEATURE_KEYS.map((key) => `Toggle ${key}`));
	assert.deepEqual(inputs.map((node) => node.props.type), ["checkbox", "checkbox", "checkbox", "checkbox"]);
	assert.deepEqual(inputs.map((node) => node.props.checked), [true, false, true, false]);
	assert.deepEqual(inputs.map((node) => node.props.disabled), [false, false, true, false]);
	const text = textOf(tree);
	for (const copy of ["semantic code search tool", "CodeGraph MCP tools", "mounts the project's .mcp.json per session", "Git Bash shell on Windows"]) {
		assert.ok(text.includes(copy), `the card copy ${copy} is missing`);
	}
	assert.ok(text.includes("Enabled"));
	assert.ok(text.includes("Disabled"));
	assert.ok(text.includes("cannot be addressed"), "a read-only row states why it cannot move");
});

test("the Chinese dictionary resolves the tab copy too", async () => {
	const { calls } = applyBundle({ language: "zh" });
	const tab = mount(calls);
	const tree = await tab.settle();
	const text = textOf(tree);
	assert.ok(text.includes("语义代码检索工具"));
	assert.ok(text.includes("代码图 MCP 工具"));
	assert.ok(text.includes("按会话挂载项目 .mcp.json"));
	assert.ok(text.includes("Windows 上的 Git Bash shell"));
});

test("the tab shows the loading line until the manager answers", async () => {
	const { calls } = applyBundle({ list: () => new Promise(() => {}) });
	const tab = mount(calls);
	const tree = await tab.settle();
	assert.ok(textOf(tree).includes("Reading plugins…"));
	assert.equal(flatten(tree).filter((node) => node.type === "input").length, 0);
});

test("a roster without this package's rows renders the empty line and no list", async () => {
	const { calls } = applyBundle({
		list: () => listOk([{ entryId: "core-tools", moduleName: "@deepseek-ai/dsh-tools", enabled: true, fiberPhase: "active", patchId: "core-tools" }]),
	});
	const tab = mount(calls);
	const tree = await tab.settle();
	assert.equal(flatten(tree).filter((node) => node.type === "input").length, 0);
	assert.equal(flatten(tree).filter((node) => node.type === "ul").length, 0);
	assert.ok(textOf(tree).includes("This bundle declares no plugin rows."));
});

test("toggling a switch persists through the manager and re-reads the host", async () => {
	const { calls } = applyBundle();
	const tab = mount(calls);
	const inputs = flatten(await tab.settle()).filter((node) => node.type === "input");
	await inputs[0].props.onChange({ currentTarget: { checked: false } });
	await tab.settle();
	assert.deepEqual(calls.toggled, [["hiss-colgrep", false]]);
	assert.equal(calls.listed, 2, "the page re-reads the host after a toggle");
});

test("a change that waits for a restart is reported to the reader", async () => {
	const { calls } = applyBundle({ setEnabled: () => changeOk("restart-required") });
	const tab = mount(calls);
	const inputs = flatten(await tab.settle()).filter((node) => node.type === "input");
	await inputs[1].props.onChange({ currentTarget: { checked: true } });
	const text = textOf(await tab.settle());
	assert.ok(text.includes("codegraph"));
	assert.ok(text.includes("after DSH restarts"));
});

test("a refused toggle reports why and still re-reads the host", async () => {
	const { calls } = applyBundle({ setEnabled: () => changeOk("failed", { code: "management-required" }) });
	const tab = mount(calls);
	const inputs = flatten(await tab.settle()).filter((node) => node.type === "input");
	await inputs[0].props.onChange({ currentTarget: { checked: false } });
	const text = textOf(await tab.settle());
	assert.ok(text.includes("DSH manages this plugin itself"));
	assert.ok(!text.includes("management-required"));
	assert.equal(calls.listed, 2);
});

test("a failed read shows the diagnostic and a retry that re-reads", async () => {
	let answer = { ok: false, error: { code: "gateway/offline", message: "offline" } };
	const { calls } = applyBundle({ list: () => answer });
	const tab = mount(calls);
	const tree = await tab.settle();
	assert.ok(textOf(tree).includes("offline"));
	const retry = flatten(tree).find((node) => node.type === "button");
	assert.equal(retry.props.type, "button");
	answer = listOk();
	await retry.props.onClick();
	const recovered = await tab.settle();
	assert.equal(calls.listed, 2);
	assert.equal(flatten(recovered).filter((node) => node.type === "input").length, 4);
});

test("the inlined dictionaries stay in sync with the locale JSON files", () => {
	const { calls } = applyBundle();
	const { namespace, dictionaries } = calls.dictionaries;
	assert.equal(namespace, NS);
	assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.zh).sort());
	for (const language of ["en", "zh"]) {
		const parsed = JSON.parse(readFileSync(join(HERE, "..", "locale", `${language}.json`), "utf8"));
		assert.equal(typeof parsed.meta?.title, "string", `locale/${language}.json carries meta.title`);
		assert.equal(typeof parsed.meta?.description, "string", `locale/${language}.json carries meta.description`);
		delete parsed.meta;
		assert.deepEqual(parsed, dictionaries[language], `locale/${language}.json mirrors the inlined dictionary`);
		for (const [key, value] of Object.entries(dictionaries[language])) {
			assert.equal(typeof value, "string", `dictionary entry ${key} is a string`);
			assert.notEqual(value, "", `dictionary entry ${key} is not empty`);
		}
	}
});
