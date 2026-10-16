import test from "node:test";
import assert from "node:assert/strict";
import { SandboxBashExecutor } from "@deepseek-ai/dsh-bash-sandbox";
import * as BashTool from "@deepseek-ai/dsh-tool-bash";
import { apply, inject, name } from "../../lib/gitbash/index.js";

/** A fake context capturing the nested plugins the row mounts. */
function makeContext(captures) {
	return {
		plugin(plugin, config) {
			captures.mounted.push({ plugin, config });
			return { dispose() {} };
		},
	};
}

test("the row is a top-level plugin with no services of its own", () => {
	assert.equal(name, "dsh-hiss-plugins-gitbash");
	assert.deepEqual(inject, [], "the children declare the services; the row needs none");
});

test("apply mounts the executor and the host bash tool, in that order", () => {
	const captures = { mounted: [] };
	const config = { timeoutMs: 1000 };
	apply(makeContext(captures), config);

	assert.equal(captures.mounted.length, 2, "the row mounts exactly the executor and its consumer");
	const [executor, tool] = captures.mounted;
	assert.equal(typeof executor.plugin, "function", "the provider half is a plugin class");
	assert.equal(executor.config, config, "the row's own config reaches the executor");
	assert.equal(tool.plugin, BashTool, "the consumer half is the host's bash tool module");
	assert.equal(tool.config, undefined, "the host tool keeps its own config");
});

test("the mounted executor is wired to the host's sandbox-consuming executor", () => {
	const captures = { mounted: [] };
	apply(makeContext(captures));
	const [executor] = captures.mounted;

	assert.ok(executor.plugin.prototype instanceof SandboxBashExecutor, "it must extend the host's executor");
	assert.deepEqual(executor.plugin.inject, SandboxBashExecutor.inject, "the host executor's injection contract carries over");
	assert.ok(
		Object.hasOwn(executor.plugin.prototype, "confine"),
		"the resolved bash.exe must be substituted at the confinement boundary",
	);
});
