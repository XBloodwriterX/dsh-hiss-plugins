import { SandboxBashExecutor } from "@deepseek-ai/dsh-bash-sandbox";
import * as BashTool from "@deepseek-ai/dsh-tool-bash";
import { createGitBashExecutor } from "./gitbash-executor.js";

/**
 * The `dsh-hiss-plugins/gitbash` row: this machine's Git Bash as a
 * first-class shell on Windows.
 *
 * A composition root rather than an executor. The bundle patch gives this one row its own
 * realm (`isolate: {shell, settings}`) and this module mounts both halves into it:
 *
 * 1. `createGitBashExecutor(SandboxBashExecutor)` registers `ctx.shell` — DSH's own
 *    sandbox-consuming bash executor, running the resolved `bash.exe` instead of PATH's
 *    `bash` (the WSL launcher on Windows) and reporting MSYS2's startup failure as a
 *    sandbox denial. It inherits `dsh-bash-sandbox` → `dsh-bash-local`, whose constructor
 *    installs the shared `shell` settings namespace; the host's Windows executor already
 *    registered it and `ctx.settings.register` fails loud on a duplicate, so the row
 *    isolates `settings` too and this executor registers nothing.
 * 2. `tool-bash` sits next to its provider, which is the only place it resolves this
 *    realm's executor. Left outside the realm it would silently resolve the host's pwsh
 *    executor and the `bash` tool would run PowerShell.
 *
 * Both halves hang off ONE top-level row because children of a `cordis:group` are
 * unaddressable for the plugin manager: a nested row can never be switched on or off from
 * the Plugins page (`test/patch.test.js` guards that shape). The host's own
 * `pwsh-sandbox` row keeps providing the root `shell`, so every pre-existing row and
 * preset resolves exactly as before.
 *
 * The rest of the rationale — why the host `shell` row is not replaced, and why a confined
 * `bash` call is reported as a sandbox denial — lives in `cordis.patch.yml` and
 * `gitbash-executor.js`.
 *
 * @module dsh-hiss-plugins/gitbash
 */
const GitBashExecutor = createGitBashExecutor(SandboxBashExecutor);

export const name = "dsh-hiss-plugins-gitbash";
export const inject = [];

/**
 * Mount the executor and its consumer into this row's realm.
 * @param {object} ctx - the row's context.
 * @param {object} [config] - the row's config, forwarded to the executor.
 * @returns {void}
 */
export function apply(ctx, config) {
	ctx.plugin(GitBashExecutor, config);
	ctx.plugin(BashTool);
}
