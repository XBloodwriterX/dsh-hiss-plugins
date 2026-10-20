/**
 * The `/init` instruction's contract: the target, the evidence rules, every
 * section the prompt promises, and the working directory it names.
 *
 * `prompt.js` imports no host package, so this file runs wherever `node --test` does.
 *
 * @module dsh-hiss-plugins/test/init/prompt
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SECTIONS, TARGET, buildInitPrompt } from "../../lib/init/prompt.js";

/** The prompt for a known session directory, shared by the assertions below. */
const PROMPT = buildInitPrompt("C:/work/project");

test("the target is AGENTS.md and a known session directory is named", () => {
	assert.equal(TARGET, "AGENTS.md");
	assert.ok(PROMPT.startsWith("Generate or update `AGENTS.md` for this repository."));
	assert.ok(PROMPT.includes("`C:/work/project`"), "the model is told where the session starts");
});

test("the target is found from the git root and an existing file is merged", () => {
	assert.match(PROMPT, /nearest ancestor that contains `\.git`/u);
	assert.match(PROMPT, /update it in place/u, "an existing AGENTS.md is updated, not replaced");
	assert.match(PROMPT, /Keep accurate content and rules written by the maintainers/u);
	assert.match(PROMPT, /CLAUDE\.md/u, "a tool-specific predecessor is read, never rewritten");
	assert.match(PROMPT, /Do not delete or rewrite the other file/u);
});

test("every suggested section is rendered, in order", () => {
	let cursor = -1;
	for (const section of SECTIONS) {
		const heading = `**${section.heading}**`;
		const at = PROMPT.indexOf(heading);
		assert.ok(at > cursor, `${heading} must appear after the previous section`);
		cursor = at;
	}
});

test("commands must be evidenced, never invented", () => {
	assert.match(PROMPT, /Never invent a command, path, script name, or version/u);
	assert.match(PROMPT, /manifest, script, Makefile, CI file, or documentation/u);
	assert.match(PROMPT, /Do not run installs, builds, test suites, network calls, or destructive commands/u);
	assert.match(PROMPT, /Change only `AGENTS\.md`/u);
	assert.match(PROMPT, /Do not commit anything/u);
});

test("the quality bar caps size and rejects generic advice", () => {
	assert.match(PROMPT, /80–150 lines/u);
	assert.match(PROMPT, /about 200 as a hard ceiling/u);
	assert.match(PROMPT, /No generic advice/u);
	assert.match(PROMPT, /Write for any future agent, not just this run/u);
	assert.match(PROMPT, /no copying the README/u);
	assert.match(PROMPT, /one root `AGENTS\.md` is still the default/u);
});

test("commands come early and boundaries are triaged", () => {
	// The GitHub 2,500-file study's highest-signal rules: runnable commands near the
	// top, concrete stack versions, and always/ask-first/never boundaries.
	assert.match(PROMPT, /Put the commands early/u);
	assert.match(PROMPT, /stack and key versions/u);
	assert.match(PROMPT, /always done, what needs asking first, and what is never done/u);
	assert.match(PROMPT, /one short real example/u);
});

test("the file language follows the repository and secrets stay out", () => {
	assert.match(PROMPT, /language of the repository's existing documentation/u);
	assert.match(PROMPT, /language of this conversation/u);
	assert.match(PROMPT, /Never include secrets, tokens, personal paths/u);
});

test("the finished file is verified on disk before completion is claimed", () => {
	assert.match(PROMPT, /Re-read the file from disk/u);
	assert.match(PROMPT, /Do not claim the file was written until it exists on disk/u);
	assert.match(PROMPT, /evidence behind each command/u);
});

test("an unknown or blank working directory falls back without printing undefined", () => {
	for (const cwd of [undefined, "", null]) {
		const prompt = buildInitPrompt(cwd);
		assert.match(prompt, /Start from the current session working directory\./u);
		assert.ok(!prompt.includes("undefined"), "the fallback never leaks the missing value");
	}
});
