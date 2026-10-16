import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
	CONFINED_STARTUP_NOTE,
	MSYS_STARTUP_SIGNATURE,
	createGitBashExecutor,
	explainConfinedStartupFailure,
	withResolvedBash,
} from "../../lib/gitbash/gitbash-executor.js";

const BASH = join("C:", "Software", "Git", "bin", "bash.exe");
const POLICY = { mode: "workspace-write", workspaceRoot: join("C:", "Mine", "repo") };
/** The exact line Git Bash prints when a write-restricted token denies its startup. */
const MSYS_STDERR =
	"      0 [main] bash (16432) C:\\Software\\Git\\bin\\..\\usr\\bin\\bash.exe: *** fatal error - couldn't create signal pipe, Win32 error 5\n";
/** Mirrors the classifier's rule: lowercase substring match on non-zero exits. */
const matchesSignature = (exitCode, stderr, signatures) =>
	exitCode !== null && exitCode !== 0 && signatures.some((s) => stderr.toLowerCase().includes(s.toLowerCase()));

/** A fake context exposing only what the executor touches. */
function fakeContext() {
	const logs = [];
	const calls = [];
	return {
		logs,
		calls,
		logger: { info: (line) => logs.push(line) },
		sandboxPolicy: { defaultMode: "workspace-write" },
		sandbox: {
			confine: async (argv, policy, signal) => {
				calls.push({ argv, policy, signal });
				return { argv: ["runner", "--", ...argv], policy, enforcement: "partial", denialSignatures: ["access is denied"], runnerFailureRules: [] };
			},
		},
	};
}

/**
 * A stand-in for the sandbox-consuming base class, mirroring the 0.1.7 seams: every
 * execution funnels through `executeArgv`, the public `execute` resolves with a process
 * handle whose `result()` carries the settled outcome, and `confine` is asynchronous and
 * receives the preparation signal. Full access runs the local executor unconfined with
 * the literal `bash` argv; every other mode confines first and runs the provider's argv.
 */
function fakeBase(runResult) {
	const clean = { exitCode: 0, stdout: { text: "" }, stderr: { text: "" } };
	return class FakeBase {
		static inject = ["subprocess", "sandbox", "sandboxPolicy"];
		constructor(ctx, config) {
			this.ctx = ctx;
			this.config = config;
			this.seenSpec = undefined;
			this.argv = undefined;
			this.result = runResult ?? clean;
		}
		async executeArgv(spec, argvOrPrepare, onStarted) {
			this.seenSpec = spec;
			this.argv = typeof argvOrPrepare === "function" ? await argvOrPrepare(spec.signal) : argvOrPrepare;
			const handle = { status: "running", exitCode: null, signal: null, result: async () => this.result };
			onStarted?.(handle);
			return handle;
		}
		async execute(spec) {
			const { mode } = spec.sandboxPolicy;
			if (mode === "danger-full-access") return this.decorate(await this.executeArgv(spec, ["bash", "-c", spec.command]), { mode, denied: false });
			const confined = await this.confine(spec.command, { ...spec.sandboxPolicy, mode }, spec.signal);
			const settled = this.result;
			return this.decorate(await this.executeArgv(spec, confined.argv), {
				mode,
				denied: matchesSignature(settled.exitCode, settled.stderr?.text ?? "", confined.denialSignatures),
			});
		}
		/** Mirrors the host executor: the settled sandbox facts ride on `result()`. */
		decorate(handle, sandbox) {
			const base = handle.result.bind(handle);
			handle.result = async () => ({ ...(await base()), sandbox });
			return handle;
		}
	};
}

function build(runResult = undefined, options = {}) {
	const ctx = fakeContext();
	const Base = fakeBase(runResult);
	const Executor = createGitBashExecutor(Base, { resolveBash: () => BASH, platform: "win32", ...options });
	return { Executor, executor: new Executor(ctx, { timeoutMs: 1000 }), ctx };
}

test("the row resolves Git Bash and reports it at boot", () => {
	const { ctx, executor } = build();
	assert.equal(executor.bashPath, BASH);
	assert.deepEqual(
		ctx.logs.map((line) => line.includes(BASH)),
		[true],
	);
});

test("the base class's injection contract is preserved", () => {
	const { Executor } = build();
	assert.deepEqual(Executor.inject, ["subprocess", "sandbox", "sandboxPolicy"]);
});

test("a non-Windows platform refuses to construct the row", () => {
	const ctx = fakeContext();
	const Executor = createGitBashExecutor(fakeBase(), { resolveBash: () => BASH, platform: "linux" });
	assert.throws(() => new Executor(ctx, {}), /Windows-only/u);
});

test("confine runs the resolved bash.exe through the sandbox and keeps its facts", async () => {
	const { executor, ctx } = build();
	const signal = new AbortController().signal;
	const confined = await executor.confine("echo hi", POLICY, signal);
	assert.deepEqual(confined.argv, ["runner", "--", BASH, "-c", "echo hi"]);
	assert.equal(confined.enforcement, "partial");
	assert.deepEqual(confined.runnerFailureRules, []);
	assert.equal(ctx.calls[0].signal, signal, "the preparation signal reaches the provider");
});

test("confine teaches the classifier MSYS2's startup failure", async () => {
	const { executor } = build();
	const confined = await executor.confine("echo hi", POLICY, undefined);
	assert.ok(confined.denialSignatures.includes("access is denied"), "the provider's own dialect survives");
	assert.ok(confined.denialSignatures.includes(MSYS_STARTUP_SIGNATURE));
	assert.equal(matchesSignature(3221225794, MSYS_STDERR, confined.denialSignatures), true);
});

test("confine tolerates a provider that reports no denial dialect", async () => {
	const ctx = fakeContext();
	ctx.sandbox.confine = async (argv) => ({ argv, enforcement: "full" });
	const Base = fakeBase();
	const Executor = createGitBashExecutor(Base, { resolveBash: () => BASH, platform: "win32" });
	assert.deepEqual((await new Executor(ctx, {}).confine("x", POLICY, undefined)).denialSignatures, [MSYS_STARTUP_SIGNATURE]);
});

test("a denied MSYS2 startup failure explains itself", () => {
	const result = {
		exitCode: 3221225794,
		signal: null,
		timedOut: false,
		aborted: false,
		timeoutMs: 1000,
		stdout: { text: "", truncated: false },
		stderr: { text: MSYS_STDERR, truncated: true, spillPath: "C:\\spill\\err.txt" },
		sandbox: { mode: "workspace-write", denied: true, enforcement: "partial" },
	};
	const explained = explainConfinedStartupFailure(result);
	assert.equal(explained.stderr.text, `${MSYS_STDERR}${CONFINED_STARTUP_NOTE}\n`);
	assert.equal(explained.stderr.truncated, true, "the subprocess facts survive");
	assert.equal(explained.stderr.spillPath, "C:\\spill\\err.txt");
	assert.equal(explained.stdout, result.stdout, "stdout is untouched");
	assert.equal(explained.sandbox, result.sandbox);
});

test("stderr without a trailing newline is not glued to the note", () => {
	const trimmed = MSYS_STDERR.trimEnd();
	assert.equal(
		explainConfinedStartupFailure({ sandbox: { denied: true }, stderr: { text: trimmed } }).stderr.text,
		`${trimmed}\n${CONFINED_STARTUP_NOTE}\n`,
	);
});

test("only a denied MSYS2 startup failure is annotated", () => {
	const cases = {
		"full access keeps its raw stderr": { sandbox: { mode: "danger-full-access", denied: false }, stderr: { text: MSYS_STDERR } },
		"an ordinary policy denial is left alone": { sandbox: { mode: "workspace-write", denied: true }, stderr: { text: "bash: /etc/x: Permission denied\n" } },
		"an unrelated failure is left alone": { sandbox: { mode: "workspace-write", denied: true }, stderr: { text: "ls: cannot access 'nope'\n" } },
		"a run with no sandbox facts is left alone": { exitCode: 2, stderr: { text: MSYS_STDERR } },
	};
	for (const [name, result] of Object.entries(cases)) {
		assert.equal(explainConfinedStartupFailure(result), result, name);
	}
});

test("execute() annotates a denied startup failure exactly once", async () => {
	const result = { exitCode: 3221225794, stdout: { text: "" }, stderr: { text: MSYS_STDERR }, sandbox: { mode: "workspace-write", denied: true } };
	const { executor } = build(result);
	const handle = await executor.execute({ command: "echo hi", sandboxPolicy: POLICY });
	const settled = await handle.result();
	assert.equal(settled.stderr.text, `${MSYS_STDERR}${CONFINED_STARTUP_NOTE}\n`);
	assert.equal(settled.stderr.text.split(CONFINED_STARTUP_NOTE).length - 1, 1);
});

test("execute() passes a working result straight through", async () => {
	const result = { exitCode: 0, stdout: { text: "hi\n" }, stderr: { text: "" } };
	const { executor } = build(result);
	const handle = await executor.execute({ command: "echo hi", sandboxPolicy: POLICY });
	const settled = await handle.result();
	assert.equal(settled.exitCode, 0);
	assert.equal(settled.stdout.text, "hi\n");
	assert.equal(settled.stderr.text, "", "a run that started fine is not annotated");
});

test("full access runs the resolved bash.exe, never PATH's bash", async () => {
	const { executor } = build();
	await executor.execute({ command: "echo hi", sandboxPolicy: { mode: "danger-full-access", workspaceRoot: POLICY.workspaceRoot } });
	assert.deepEqual(executor.argv, [BASH, "-c", "echo hi"]);
});

test("a prepared argv is left to the confinement path, never rewritten", async () => {
	const { executor } = build();
	const prepared = async () => ["runner", "--", "bash", "-c", "echo hi"];
	await executor.executeArgv({ command: "echo hi", sandboxPolicy: POLICY }, prepared);
	assert.deepEqual(executor.argv, ["runner", "--", "bash", "-c", "echo hi"], "the sandbox runner's own argv is not ours to rewrite");
});

test("a confined run keeps the sandbox runner's own argv untouched", async () => {
	const { executor } = build();
	await executor.execute({ command: "echo hi", sandboxPolicy: POLICY });
	assert.deepEqual(executor.argv, ["runner", "--", BASH, "-c", "echo hi"]);
});

test("withResolvedBash rewrites only the base's bare bash argv", () => {
	assert.deepEqual(withResolvedBash(["bash", "-c", "echo hi"], BASH), [BASH, "-c", "echo hi"]);
	const wrapped = ["runner", "--", "bash", "-c", "echo hi"];
	assert.equal(withResolvedBash(wrapped, BASH), wrapped, "a runner-wrapped argv is not ours to rewrite");
	const other = ["node", "-e", "1"];
	assert.equal(withResolvedBash(other, BASH), other);
	assert.equal(withResolvedBash(["bash", "-lc", "echo hi"], BASH).length, 3, "an unknown bash flag still runs PATH's bash");
});

/**
 * The hooks below ran in the per-package `dsh-gitbash/test/manifest.test.js` before the four
 * plugins were merged. They drive the *installed* host executor rather than a fake base
 * class, which is the only way to catch a renamed or no-longer-called seam (see AGENTS.md
 * §4); the merged bundle exports no executor module of its own — the row's composition root
 * builds the class from `createGitBashExecutor` at load time — so they live next to the class
 * they exercise.
 */

/**
 * The executor seams are host API, and a prerelease harness renames them without notice:
 * 0.1.7 turned `run`/`start`/`runArgv`/`startArgv` into `execute`/`executeArgv` and made
 * `confine` asynchronous with a third `signal` argument. Overriding a name the host no
 * longer calls is silent at import time and surfaces only as the wrong shell at run time,
 * so this asserts the names against the generation installed here.
 */
test("the seams this plugin overrides still exist on the installed host executor", async () => {
	const { SandboxBashExecutor } = await import("@deepseek-ai/dsh-bash-sandbox");
	for (const seam of ["execute", "executeArgv", "confine"]) {
		assert.equal(typeof SandboxBashExecutor.prototype[seam], "function", `the host executor must still expose ${seam}()`);
	}
	assert.equal(SandboxBashExecutor.prototype.confine.length, 3, "confine() must still take (command, policy, signal)");
	const { createGitBashExecutor } = await import("../../lib/gitbash/gitbash-executor.js");
	const GitBashExecutor = createGitBashExecutor(SandboxBashExecutor, { resolveBash: () => BASH, platform: "win32" });
	for (const seam of ["execute", "executeArgv", "confine"]) {
		assert.ok(Object.hasOwn(GitBashExecutor.prototype, seam), `GitBashExecutor must override ${seam}()`);
	}
});

/**
 * Run one command through the *installed* executor with the subprocess seam faked.
 *
 * A seam can be lost without any rename: a host refactor that stops calling `executeArgv`,
 * or hands `confine` a different contract, leaves the override in place and the wrong shell
 * on the wire — which is exactly how 0.1.7 shipped a `bash` tool that ran WSL. Only the real
 * base class can show that, so everything below `ctx.subprocess` is faked and everything
 * above it is the host's own code.
 *
 * The instance is built from the prototype rather than the constructor because cordis's
 * `Service` base needs a live fiber; the executor seams under test do not.
 * @param {string} mode - the sandbox mode to run under.
 * @returns {Promise<{spawned: object[], result: object}>} the spawn the host built and the settled outcome.
 */
async function runThroughHost(mode) {
	const { SandboxBashExecutor } = await import("@deepseek-ai/dsh-bash-sandbox");
	const { createGitBashExecutor } = await import("../../lib/gitbash/gitbash-executor.js");
	const GitBashExecutor = createGitBashExecutor(SandboxBashExecutor, { resolveBash: () => BASH, platform: "win32" });

	const spawned = [];
	const reader = (text) => ({ readFrom: () => ({ text, lossy: false, nextOffset: text.length }) });
	const executor = Object.create(GitBashExecutor.prototype);
	Object.assign(executor, {
		bashPath: BASH,
		mode,
		processFacts: new Map(),
		ctx: {
			logger: { info() {}, warn() {} },
			subprocess: { spawn(spec) { spawned.push(spec); return { collected: { stdout: reader("ok\n"), stderr: reader("") }, done: Promise.resolve({ exitCode: 0, signal: null }), terminate() {} }; } },
			sandboxPolicy: { defaultMode: mode, resolve: () => ({ mode, workspaceRoot: "C:/tmp" }) },
			sandbox: { confine: async (argv, policy, signal) => ({ argv: ["runner", "--", ...argv], policy, signal, enforcement: "partial", denialSignatures: ["access is denied"], runnerFailureRules: [] }) },
		},
		config: {
			cwd: { get: () => "C:/tmp" },
			timeoutMs: { get: () => 5_000 },
			maxTimeoutMs: { get: () => 60_000 },
			maxOutputBytes: { get: () => 64 * 1024 },
			maxSpillBytes: { get: () => 1024 * 1024 },
			graceMs: { get: () => 3_000 },
		},
	});

	const handle = await executor.execute({
		command: "echo hi",
		workdir: "C:/tmp",
		timeoutMs: 5_000,
		onExpiry: "kill",
		stdoutMaxBytes: 64 * 1024,
		sandboxPolicy: { mode, workspaceRoot: "C:/tmp" },
	});
	return { spawned, result: await handle.result() };
}

test("full access runs Git Bash through the installed executor's own call flow", async () => {
	const { spawned, result } = await runThroughHost("danger-full-access");
	assert.equal(spawned.length, 1, "exactly one process is spawned");
	assert.deepEqual(spawned[0].argv, [BASH, "-c", "echo hi"], "PATH's bare `bash` must never reach the subprocess");
	assert.equal(result.exitCode, 0, "the settled outcome still comes back");
	assert.equal(result.sandbox.mode, "danger-full-access");
});

test("a confined run keeps the sandbox runner's argv around the resolved Git Bash", async () => {
	const { spawned, result } = await runThroughHost("workspace-write");
	assert.deepEqual(spawned[0].argv, ["runner", "--", BASH, "-c", "echo hi"]);
	assert.equal(result.sandbox.enforcement, "partial", "the provider's facts survive the override");
});
