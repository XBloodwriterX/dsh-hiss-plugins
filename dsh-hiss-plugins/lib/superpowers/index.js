/**
 * The superpowers adoption layer: one always-on system-prompt section.
 *
 * This restores the half of the deleted `@hilariouhiss/dsh-superpowers` plugin that
 * DSH cannot supply natively. The skills themselves are ordinary skills discovered
 * from a scanned root (`~/.agents/skills` by default), so this row vendors nothing
 * and registers no skill provider. What is missing without it is the *mandate*:
 * upstream delivers "check for an applicable skill before you answer" through a
 * SessionStart hook, and a harness that does not read plugin hook files — DSH does
 * not — has no other way to keep that instruction in front of the model.
 *
 * The section re-assembles every turn, so the mandate survives compaction, while
 * the full instructions stay in the `using-superpowers` skill and load on demand.
 *
 * @module dsh-hiss-plugins/superpowers
 */
export const name = "superpowers";
export const inject = ["systemPrompt"];

/**
 * The prior plugin's mandate, verbatim, plus the two facts that changed when the
 * skills moved out of the plugin: DSH addresses skills by their bare name, and the
 * section has to stay honest when the collection is not installed after all.
 */
const MANDATE = [
	"Before ANY response or action, check whether a superpowers skill applies and, if so, invoke it with the `skill` tool first.",
	"Process skills (brainstorming, systematic-debugging) come before implementation skills.",
	"Load the current SKILL.md via the `skill` tool; never follow a skill from memory alone.",
].join(" ");

/** The complete section text. Exported so the text itself is testable. */
export const BOOTSTRAP = [
	"<EXTREMELY_IMPORTANT>",
	"You have superpowers.",
	"",
	MANDATE,
	"",
	"Superpowers skills are ordinary DSH skills: address them by their bare kebab-case name (`brainstorming`, `writing-plans`, `test-driven-development`, `verification-before-completion`), not the upstream `superpowers:<name>` form.",
	"If the skill catalog lists no superpowers skills, ignore this section — the collection is not installed.",
	"For the full instructions, load the `using-superpowers` skill with the `skill` tool.",
	"</EXTREMELY_IMPORTANT>",
].join("\n");

/**
 * Register the global adoption section.
 *
 * `order: 5` places it after the deployment persona prefix (order 0) and before
 * every policy and tool section (`PLAN_POLICY` is 500): an instruction to check for
 * a skill before doing anything else is only useful ahead of the rest.
 *
 * @param {import("@deepseek-ai/cordis").Context} ctx - host context carrying `systemPrompt`.
 */
export function apply(ctx) {
	ctx.systemPrompt.section({
		name: "superpowers:adoption",
		order: 5,
		text: BOOTSTRAP,
	});
}
