/**
 * The superpowers row's contract: one always-on system-prompt section carrying the
 * adoption mandate, and nothing else. The module imports no host package, so this file
 * runs wherever `node --test` does.
 * @module dsh-hiss-plugins/test/superpowers
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BOOTSTRAP, apply, inject, name } from "../../lib/superpowers/index.js";

/**
 * A fake context holding only the service the row declares.
 * @param captures - the record the registered sections land in.
 * @returns the fake host context.
 */
function makeContext(captures) {
	return {
		systemPrompt: {
			section(registration) {
				captures.sections.push(registration);
			},
		},
	};
}

test("the row is a host half that injects only the system prompt", () => {
	assert.equal(name, "superpowers");
	assert.deepEqual(inject, ["systemPrompt"]);
});

test("apply registers exactly one section and reaches for nothing else", () => {
	// The fake context exposes `systemPrompt` alone, so a row that also registered a
	// command, a tool, or a skill provider would throw here instead of passing.
	const captures = { sections: [] };
	apply(makeContext(captures));
	assert.equal(captures.sections.length, 1, "the row registers one section");
	const [section] = captures.sections;
	assert.equal(section.name, "superpowers:adoption");
	assert.equal(section.order, 5, "the mandate must precede every policy and tool section");
	assert.equal(section.text, BOOTSTRAP, "the section carries the exported text verbatim");
	assert.equal(typeof BOOTSTRAP, "string");
});

test("the text is a single well-formed EXTREMELY_IMPORTANT block", () => {
	assert.ok(BOOTSTRAP.startsWith("<EXTREMELY_IMPORTANT>"), "the block opens with its marker");
	assert.ok(BOOTSTRAP.endsWith("</EXTREMELY_IMPORTANT>"), "the block closes with its marker");
	assert.equal(BOOTSTRAP.split("<EXTREMELY_IMPORTANT>").length - 1, 1, "exactly one opening marker");
	assert.equal(BOOTSTRAP.split("</EXTREMELY_IMPORTANT>").length - 1, 1, "exactly one closing marker");
});

test("the text states the rule that keeps the mandate actionable", () => {
	assert.match(BOOTSTRAP, /Before ANY response or action/u, "the check-before-answering rule");
	assert.match(BOOTSTRAP, /`skill` tool/u, "the model is told which tool loads a skill");
});

test("the text states the bare-name rule this harness requires", () => {
	// DSH skill names are bare kebab-case, so it must redirect the model away from the
	// upstream `superpowers:<name>` spelling rather than let it guess for every load.
	assert.match(BOOTSTRAP, /bare kebab-case name/u);
	assert.match(BOOTSTRAP, /not the upstream `superpowers:<name>` form/u);
});

test("the text stands down when the collection is not installed", () => {
	assert.match(BOOTSTRAP, /If the skill catalog lists no superpowers skills, ignore this section/u);
	assert.match(BOOTSTRAP, /not installed/u);
});
