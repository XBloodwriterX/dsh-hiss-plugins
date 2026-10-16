/**
 * The ponytail adoption layer: the mode-aware prompt section and the `/ponytail`
 * level switch.
 *
 * This restores the half of the deleted `@hilariouhiss/dsh-ponytail` plugin that DSH
 * cannot supply natively. The six ponytail skills are discovered from a scanned root
 * (`~/.agents/skills` by default) and `/ponytail-review` and friends already work
 * through the harness's own user-invocation path, so this row vendors nothing and
 * registers no skill provider and no per-skill commands. What is missing without it
 * is the *level*: an always-on hint that keeps the skill in play, and a switch that
 * changes how hard it applies.
 *
 * @module dsh-hiss-plugins/ponytail
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { renderSkillContent } from "@deepseek-ai/dsh-skill";
import { currentMode, parseLevel, resolveDefaultMode, setMode } from "./mode.js";

export const name = "ponytail";
export const inject = ["commands", "skills", "systemPrompt", "workingDirectory"];

/** The skill this layer adopts. */
const SKILL = "ponytail";

/** The adoption hint, unchanged from the plugin this replaces. */
export const HINT_TEXT = [
	"Ponytail lazy-mode is available for coding work. ",
	"Before any coding task — writing, editing, refactoring, fixing, reviewing, or choosing libraries/dependencies — ",
	"load the `ponytail` skill with the `skill` tool (unless already loaded) and follow it: ",
	"the simplest solution that works, reuse what already exists, standard library and platform features before new dependencies, ",
	"fewest files, shortest working diff. ",
	"Switch intensity with /ponytail lite|full|ultra; turn off with /ponytail off or by saying \"stop ponytail\".",
].join("");

/**
 * The section text for one assembly scope.
 *
 * The level is part of the hint so the text stays true after a restart, when the
 * per-agent override is gone and the default is back in force.
 *
 * @param {object | undefined} scope the assembling agent, when there is one.
 * @param {"off" | "lite" | "full" | "ultra"} fallback the resolved default level.
 * @returns {string} the hint, or `''` when ponytail is off.
 */
export function hintFor(scope, fallback) {
	const level = currentMode(scope, fallback);
	return level === "off" ? "" : `${HINT_TEXT} Current level: ${level}.`;
}

/**
 * Register the global adoption section and the `/ponytail` command.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx - host context carrying
 *   `systemPrompt`, `commands`, `skills`, and `workingDirectory`.
 */
export function apply(ctx) {
	const defaultMode = resolveDefaultMode();
	ctx.systemPrompt.section({
		name: "ponytail:adoption",
		order: 5,
		text: (context) => hintFor(context.scope, defaultMode),
	});
	ctx.commands.register({
		name: SKILL,
		description: "switch ponytail lazy-mode intensity (lite|full|ultra|off)",
		input: { hint: "[lite|full|ultra|off]" },
		handler: (invocation) => runPonytail(ctx, invocation),
	});
}

/**
 * Execute one `/ponytail` invocation.
 *
 * The skill loads *before* the level changes: a level the model cannot act on is
 * worse than no level at all, so a missing or unreadable skill leaves the state
 * untouched.
 *
 * @param {object} ctx host context.
 * @param {object} invocation the command invocation.
 * @returns {Promise<{ kind: "success" | "error", text: string }>} the command result.
 */
async function runPonytail(ctx, invocation) {
	const level = parseLevel(invocation.rawInput);
	if (level === undefined) {
		return { kind: "error", text: "Usage: /ponytail [lite|full|ultra|off]" };
	}
	if (level === "off") {
		setMode(invocation.agent, "off");
		followup(invocation, "Ponytail off — revert to normal mode. Ignore the ponytail instructions until it is turned back on with /ponytail.");
		return { kind: "success", text: "Ponytail off." };
	}
	let skill;
	try {
		skill = await ctx.skills.get(SKILL, {
			cwd: await ctx.workingDirectory.ensure(invocation.agent, invocation.signal),
			signal: invocation.signal,
			scope: invocation.agent,
		});
	} catch (error) {
		return { kind: "error", text: `Could not load the "${SKILL}" skill: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (skill === undefined) {
		return {
			kind: "error",
			text: `The "${SKILL}" skill is not available. Install it into a skills root DSH scans (for example the shared ~/.agents/skills root) and retry.`,
		};
	}
	setMode(invocation.agent, level);
	followup(invocation, `${renderSkillContent(skill)}\n\nPonytail level: ${level}. Apply the ${level} column of the Intensity table from now on.`);
	return { kind: "success", text: `Ponytail mode set to ${level}.` };
}

/**
 * Hand the model a durable user message through the same seam `/goal` uses, so the
 * instructions are read on the very next step.
 *
 * @param {object} invocation the command invocation.
 * @param {string} text the message text.
 */
function followup(invocation, text) {
	invocation.agent.followup(createUserMessage({
		content: [{ type: "text", text }],
		source: { kind: "skill-invocation", name: SKILL, form: "instructions" },
	}));
}
