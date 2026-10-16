/**
 * The resolver is the only logic the publish workflow runs before touching the
 * registry, so every rejection path it can take is pinned here.
 * @module dsh-hiss-plugins/scripts/resolve-tag.test
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { parseTag, resolveTag } from "./resolve-tag.mjs";

/** @returns {string} a throwaway workspace holding one package. */
function workspace(version = "1.2.3") {
	const root = mkdtempSync(join(tmpdir(), "dsh-resolve-tag-"));
	mkdirSync(join(root, "dsh-hiss-plugins"));
	writeFileSync(
		join(root, "dsh-hiss-plugins", "package.json"),
		JSON.stringify({ name: "dsh-hiss-plugins", version }),
	);
	return root;
}

test("parses a directory@version tag", () => {
	assert.deepEqual(parseTag("dsh-hiss-plugins@1.2.3"), { dir: "dsh-hiss-plugins", version: "1.2.3" });
	assert.deepEqual(parseTag("dsh-other-tool@2.0.0"), { dir: "dsh-other-tool", version: "2.0.0" });
	assert.deepEqual(parseTag("dsh-hiss-plugins@1.0.3-rc.1"), { dir: "dsh-hiss-plugins", version: "1.0.3-rc.1" });
});

test("rejects tags that are not <directory>@<version>", () => {
	for (const tag of ["", "v1.2.3", "dsh-hiss-plugins", "dsh-hiss-plugins@", "@1.2.3", "dsh-hiss-plugins@1.2.3@extra"]) {
		assert.throws(() => parseTag(tag), /is not <directory>@<version>/u, "tag " + JSON.stringify(tag));
	}
});

test("rejects a tag that is not a dsh-* directory or not a semver", () => {
	// A scope prefix has a second "@", so it is rejected as a malformed tag before the directory rule applies.
	assert.throws(() => parseTag("@someone/dsh-hiss-plugins@1.2.3"), /is not <directory>@<version>/u);
	assert.throws(() => parseTag("packages/colgrep@1.2.3"), /dsh-\* package directory/u);
	assert.throws(() => parseTag("dsh-hiss-plugins@latest"), /semver version/u);
	assert.throws(() => parseTag("dsh-hiss-plugins@1.2"), /semver version/u);
});

test("resolves the tagged package against its manifest", () => {
	assert.deepEqual(resolveTag(workspace(), "dsh-hiss-plugins@1.2.3"), {
		dir: "dsh-hiss-plugins",
		name: "dsh-hiss-plugins",
		version: "1.2.3",
	});
});

test("rejects a tag for a package this workspace does not have", () => {
	assert.throws(() => resolveTag(workspace(), "dsh-ponytail@1.1.0"), /not a package in this workspace/u);
});

test("rejects a tag whose version disagrees with the manifest", () => {
	assert.throws(() => resolveTag(workspace("1.2.3"), "dsh-hiss-plugins@1.2.4"), /package\.json is 1\.2\.3 but the tag says 1\.2\.4/u);
});

test("rejects a package directory without a readable manifest", () => {
	const root = mkdtempSync(join(tmpdir(), "dsh-resolve-tag-"));
	mkdirSync(join(root, "dsh-broken"));
	assert.throws(() => resolveTag(root, "dsh-broken@1.0.0"), /not a package in this workspace/u);
});
