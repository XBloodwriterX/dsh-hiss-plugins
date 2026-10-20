/**
 * The `/init` instruction: the evidence the model must collect, the sections a
 * useful AGENTS.md carries, and the checks that keep it honest.
 *
 * Kept free of host imports so the text is testable under this repo's own
 * `node --test` (the same split `lib/ponytail/mode.js` and
 * `lib/project-mcp/config.js` use).
 *
 * @module dsh-hiss-plugins/init/prompt
 */

/** The file this command produces. */
export const TARGET = "AGENTS.md";

/**
 * The sections the prompt suggests, in order. Each entry is one source of truth:
 * the prompt renders the same headings, and the tests assert every one survives.
 */
export const SECTIONS = [
	{ heading: "Project overview", guidance: "what the project is, the stack and key versions, and the top-level layout (2–3 sentences)." },
	{ heading: "Setup", guidance: "install and first-run commands, required runtime and tool versions, environment-file steps." },
	{ heading: "Build, test, and lint", guidance: "exact commands, including how to run one test or one file, and what must pass before a change is done." },
	{ heading: "Architecture", guidance: "where the core code lives and the rules that keep the parts separate." },
	{ heading: "Conventions", guidance: "repository-specific style and patterns, not universal advice; one short real example when it beats prose." },
	{ heading: "Testing", guidance: "what to add or update, fixtures, and the checks CI runs." },
	{ heading: "Git and pull requests", guidance: "branch, commit message, pull request, and release or migration rules." },
	{ heading: "Security and gotchas", guidance: "secrets, dangerous commands, generated files, and do-not-touch areas; state what is always done, what needs asking first, and what is never done." },
];

/**
 * Build the user message `/init` hands the model.
 *
 * @param {string | undefined} cwd the session working directory, when the host resolved one.
 * @returns {string} the complete instruction.
 */
export function buildInitPrompt(cwd) {
	const start = typeof cwd === "string" && cwd !== ""
		? `\`${cwd}\``
		: "the current session working directory";
	const sections = SECTIONS
		.map((section, index) => `${index + 1}. **${section.heading}** — ${section.guidance}`)
		.join("\n");
	return [
		"Generate or update `AGENTS.md` for this repository.",
		"",
		"DSH loads this file at the start of future sessions, so write it to be read cold: the reader is a capable coding agent with no prior context. After reading this one file it should know how to set the project up, run the checks that matter, find the code, follow the house rules, and avoid the traps. Write for that reader, not for a human browsing the README.",
		"",
		"## 1. Locate the target",
		`- Start from ${start}.`,
		"- The project root is the nearest ancestor that contains `.git`; if there is none, use the working directory itself.",
		"- The target is `<project root>/AGENTS.md`.",
		"- If it already exists, read it first and update it in place. Keep accurate content and rules written by the maintainers; remove only what is wrong or redundant, and say what you removed.",
		"- If it does not exist but `AGENT.md` or `CLAUDE.md` does, read that file for context and write a new `AGENTS.md`. Do not delete or rewrite the other file.",
		"",
		"## 2. Gather evidence",
		"Read the files that tell a new teammate what to do. Check what exists:",
		"- README and contributor docs; package manifests and workspace config (`package.json`, `pnpm-workspace.yaml`, `pyproject.toml`, `Cargo.toml`, `go.mod`, ...); lockfiles and toolchain pins; `Makefile` / `Taskfile` / `justfile` / `scripts/`; CI workflows; lint, format, type-check, and test config.",
		"- The entry points, one or two representative source files, and the tests around them.",
		"- Release, migration, and deployment notes when the repository has them.",
		"",
		"Extract:",
		"- The exact install, setup, build, test, lint, and single-test commands the repository really uses. A command may appear only if it is written in a manifest, script, Makefile, CI file, or documentation, or you ran it successfully and it is cheap and safe. Never invent a command, path, script name, or version.",
		"- The small set of directories and files that carry the core behavior, and the boundaries between them. Write a map, not a full tree.",
		"- Conventions a newcomer cannot infer from a glance: module system and language level, formatting and lint rules, naming, error handling, layering, generated code, migrations, platform assumptions.",
		"- The traps: setup steps that are easy to miss, ordering constraints, checks CI runs that differ from local ones, environment variables, platform quirks, known failures, generated files, and paths that must not be edited by hand.",
		"",
		"Change only `AGENTS.md` files — no source, configuration, or other documentation edits. Do not commit anything. Do not run installs, builds, test suites, network calls, or destructive commands merely to discover facts; inspect the repository instead.",
		"",
		"## 3. Write the file",
		"Use only the sections this repository needs; omit empty ones. A useful order:",
		sections,
		"",
		"Quality bar:",
		"- Put the commands early: setup and build/test before deeper explanation, so the reader does not have to hunt.",
		"- Be specific: `pnpm --filter web test` beats a vague instruction to run the tests; name the package, file, or test when it matters.",
		"- Keep it tight: aim for 80–150 lines and treat about 200 as a hard ceiling unless the repository genuinely needs more. Prefer bullets and short tables to prose.",
		"- Include only what is true for this repository. No generic advice, no marketing, no full API documentation, and no copying the README.",
		"- Prefer facts the agent cannot get from one quick look; leave out obvious file lists.",
		"- Write for any future agent, not just this run: no references to this conversation, the `/init` command, or the fact that the file was generated.",
		"- Write in the language of the repository's existing documentation. If there is none, use the language of this conversation.",
		"- In a monorepo, one root `AGENTS.md` is still the default. Add a short per-package section instead of creating nested files unless a package genuinely needs its own file.",
		"- Never include secrets, tokens, personal paths, or values that only work on your machine.",
		"",
		"## 4. Verify before you finish",
		"- Re-read the file from disk.",
		"- Check every command, path, environment variable, and config name against the repository; fix or delete anything you cannot confirm.",
		"- Check that the file answers: how to set up, how to run the relevant checks, where the core code lives, and what not to touch.",
		"- Do not claim the file was written until it exists on disk.",
		"",
		"Finish with a short report: the absolute path, the line count, the evidence behind each command, and anything you could not verify or deliberately left out.",
	].join("\n");
}
