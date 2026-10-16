/**
 * The ponytail row's contract: the mode-aware prompt section, the `/ponytail` command,
 * and the host seams it uses (`skills.get`, `workingDirectory.ensure`, `agent.followup`).
 * The fake host is deliberately narrow, so a row that reached for another service
 * would throw here instead of passing silently.
 * @module dsh-hiss-plugins/test/ponytail
 */
import test from "node:test";
import assert from "node:assert/strict";
import { renderSkillContent } from "@deepseek-ai/dsh-skill";
import { HINT_TEXT, apply, hintFor, inject, name } from "../../lib/ponytail/index.js";
import { currentMode, setMode } from "../../lib/ponytail/mode.js";

/** The skill the row loads, shaped the way a filesystem provider returns it. */
const SKILL = {
	name: "ponytail",
	provider: "filesystem",
	description: "lazy senior dev mode",
	invocation: { modelInvocable: true, userInvocable: true },
	resourceBase: { kind: "directory", path: "C:/skills/ponytail" },
	content: "# Ponytail\n\nBe lazy.",
};

/**
 * A fake host context plus the calls it recorded.
 * @param options - `options.get` scripts the skill lookup; the default answers with SKILL.
 * @returns the fake context and its call record.
 */
function makeContext(options = {}) {
	const calls = { sections: [], commands: [], lookups: [], ensured: [] };
	return {
		calls,
		ctx: {
			systemPrompt: {
				section(registration) {
					calls.sections.push(registration);
				},
			},
			commands: {
				register(definition) {
					calls.commands.push(definition);
				},
			},
			skills: {
				async get(skillName, lookup) {
					calls.lookups.push({ skillName, lookup });
					if (options.get !== undefined) return options.get(skillName, lookup);
					return SKILL;
				},
			},
			workingDirectory: {
				async ensure(agent, signal) {
					calls.ensured.push({ agent, signal });
					return "C:/ws";
				},
			},
		},
	};
}

/**
 * Register the row against a fake host with `PONYTAIL_DEFAULT_MODE` forced, so the
 * default the section captures is the one the test names.
 * @param options - `defaultMode` for the environment, plus the lookup script.
 * @returns the recorded calls, the registered command, the sent messages, and `run`.
 */
function setup(options = {}) {
	const previous = process.env.PONYTAIL_DEFAULT_MODE;
	process.env.PONYTAIL_DEFAULT_MODE = options.defaultMode ?? "full";
	const { calls, ctx } = makeContext(options);
	try {
		apply(ctx);
	} finally {
		if (previous === undefined) delete process.env.PONYTAIL_DEFAULT_MODE;
		else process.env.PONYTAIL_DEFAULT_MODE = previous;
	}
	const definition = calls.commands[0];
	const sent = [];
	const agent = { followup: (message) => { sent.push(message); } };
	return {
		calls,
		definition,
		sent,
		agent,
		/**
		 * Run one command invocation.
		 * @param rawInput - the text following the command name.
		 * @param invocationAgent - the agent to invoke for; the shared fake by default.
		 * @returns the command result plus the invocation it saw.
		 */
		async run(rawInput, invocationAgent = agent) {
			const invocation = { agent: invocationAgent, rawInput, signal: new AbortController().signal };
			return { result: await definition.handler(invocation), invocation };
		},
	};
}

test("the row declares the four services it consumes", () => {
	assert.equal(name, "ponytail");
	assert.deepEqual(inject, ["commands", "skills", "systemPrompt", "workingDirectory"]);
});

test("apply registers one mode-aware section and the /ponytail command", () => {
	const { calls, definition } = setup({ defaultMode: "lite" });
	assert.equal(calls.sections.length, 1);
	const [section] = calls.sections;
	assert.equal(section.name, "ponytail:adoption");
	assert.equal(section.order, 5);
	assert.equal(typeof section.text, "function", "the level is read at assembly time, not load time");
	assert.equal(calls.commands.length, 1, "the row registers exactly one command");
	assert.equal(definition.name, "ponytail");
	assert.match(definition.description, /ponytail/u);
	assert.deepEqual(definition.input, { hint: "[lite|full|ultra|off]" });
	assert.equal(typeof definition.handler, "function");
});

test("the section text is empty while ponytail is off", () => {
	const { calls } = setup({ defaultMode: "off" });
	const scope = {};
	assert.equal(calls.sections[0].text({ scope }), "");
	assert.equal(hintFor(scope, "off"), "");
});

test("the section text names the level in force", () => {
	for (const level of ["lite", "full", "ultra"]) {
		const { calls } = setup({ defaultMode: level });
		assert.equal(calls.sections[0].text({ scope: {} }), `${HINT_TEXT} Current level: ${level}.`);
	}
});

test("the section follows the per-agent override, not the captured default", () => {
	const { calls } = setup({ defaultMode: "full" });
	const scope = {};
	setMode(scope, "ultra");
	assert.equal(calls.sections[0].text({ scope }), `${HINT_TEXT} Current level: ultra.`);
	setMode(scope, "off");
	assert.equal(calls.sections[0].text({ scope }), "", "the override silences the section like the default does");
});

test("an unknown level is refused with usage and changes nothing", async () => {
	const { run, sent, agent, calls } = setup();
	setMode(agent, "lite");
	const { result } = await run("fast");
	assert.deepEqual(result, { kind: "error", text: "Usage: /ponytail [lite|full|ultra|off]" });
	assert.equal(calls.lookups.length, 0, "the grammar rejects before any host call");
	assert.equal(sent.length, 0, "a refused invocation injects nothing");
	assert.equal(currentMode(agent, "full"), "lite", "the level that was in force survives");
	assert.equal(hintFor(agent, "full"), `${HINT_TEXT} Current level: lite.`);
});

test("/ponytail off turns the section off without loading the skill", async () => {
	const { run, sent, agent, calls } = setup({ defaultMode: "full" });
	const { result } = await run("off");
	assert.deepEqual(result, { kind: "success", text: "Ponytail off." });
	assert.equal(sent.length, 1, "the model is told to stop applying the skill");
	const [message] = sent;
	assert.equal(message.role, "user");
	assert.deepEqual(message.source, { kind: "skill-invocation", name: "ponytail", form: "instructions" });
	assert.equal(message.content.length, 1);
	assert.equal(message.content[0].type, "text");
	assert.match(message.content[0].text, /^Ponytail off/u);
	assert.equal(hintFor(agent, "full"), "", "the section goes silent");
	assert.equal(calls.lookups.length, 0, "turning off loads no skill");
});

test("a level loads the skill, records it, and injects the rendered instructions", async () => {
	const { run, sent, agent, calls } = setup({ defaultMode: "full" });
	const { result, invocation } = await run("ultra");
	assert.deepEqual(result, { kind: "success", text: "Ponytail mode set to ultra." });
	assert.equal(calls.ensured.length, 1, "the workspace is resolved exactly once");
	assert.equal(calls.ensured[0].agent, agent);
	assert.equal(calls.ensured[0].signal, invocation.signal, "the invocation signal reaches the workspace lookup");
	assert.equal(calls.lookups.length, 1);
	const [lookup] = calls.lookups;
	assert.equal(lookup.skillName, "ponytail");
	assert.deepEqual(Object.keys(lookup.lookup).sort(), ["cwd", "scope", "signal"], "the lookup carries exactly these options");
	assert.equal(lookup.lookup.cwd, "C:/ws");
	assert.equal(lookup.lookup.signal, invocation.signal);
	assert.equal(lookup.lookup.scope, agent, "the skill is scoped to the invoking agent");
	assert.equal(sent.length, 1);
	const [message] = sent;
	assert.equal(message.role, "user");
	assert.deepEqual(message.source, { kind: "skill-invocation", name: "ponytail", form: "instructions" });
	assert.equal(message.content.length, 1);
	assert.equal(message.content[0].type, "text");
	const expected = `${renderSkillContent(SKILL)}\n\nPonytail level: ultra. Apply the ultra column of the Intensity table from now on.`;
	assert.equal(message.content[0].text, expected);
	assert.ok(expected.startsWith('<skill_content name="ponytail">'), "the message carries the rendered SKILL.md");
	assert.equal(currentMode(agent, "full"), "ultra", "the level is recorded for this agent");
	assert.equal(hintFor(agent, "full"), `${HINT_TEXT} Current level: ultra.`);
});

test("a bare invocation means full", async () => {
	const { run, agent } = setup({ defaultMode: "off" });
	const { result } = await run("");
	assert.deepEqual(result, { kind: "success", text: "Ponytail mode set to full." });
	assert.equal(currentMode(agent, "off"), "full", "the bare form overrides a default of off");
});

test("a missing ponytail skill is reported and leaves the level untouched", async () => {
	const { run, sent, agent, calls } = setup({ get: async () => undefined });
	setMode(agent, "lite");
	const { result } = await run("ultra");
	assert.equal(result.kind, "error");
	assert.match(result.text, /The "ponytail" skill is not available/u, "the answer names the skill");
	assert.equal(sent.length, 0, "nothing is injected when the skill did not load");
	assert.equal(currentMode(agent, "full"), "lite", "the level stays where it was");
	assert.equal(hintFor(agent, "full"), `${HINT_TEXT} Current level: lite.`);
	assert.equal(calls.lookups.length, 1, "the lookup still happened");
});

test("a failing skills.get is answered, never propagated", async () => {
	const { run, sent, agent } = setup({ get: async () => { throw new Error("registry exploded"); } });
	const { result } = await run("ultra");
	assert.equal(result.kind, "error", "the handler answers instead of rejecting");
	assert.match(result.text, /Could not load the "ponytail" skill/u);
	assert.match(result.text, /registry exploded/u);
	assert.equal(sent.length, 0);
	assert.equal(currentMode(agent, "full"), "full", "a failed load does not change the level");
	assert.equal(hintFor(agent, "full"), `${HINT_TEXT} Current level: full.`);
});

test("a non-Error rejection is stringified into the answer", async () => {
	const { run } = setup({ get: async () => { throw "boom"; } });
	const { result } = await run("lite");
	assert.equal(result.kind, "error");
	assert.match(result.text, /boom/u);
});

test("the injection uses the agent's followup seam and nothing else", async () => {
	// §4's seam guard: the message must travel through `agent.followup` — the method
	// first-party `/goal` uses — so a renamed seam fails loudly here instead of
	// silently dropping the instructions the command promises.
	const { run, agent, sent } = setup();
	assert.ok("followup" in agent, "the fake agent exposes the seam the host provides");
	const { result } = await run("lite");
	assert.equal(result.kind, "success");
	assert.equal(sent.length, 1, "the message travelled through that exact seam");
	const bare = {};
	await assert.rejects(() => run("lite", bare), (error) => {
		assert.equal(error.constructor, TypeError, "a missing seam fails loudly rather than skipping the injection");
		assert.match(error.message, /followup/u, "the seam is the method the row calls by name");
		return true;
	});
});
