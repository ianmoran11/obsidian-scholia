import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const manifest = json("manifest.json");
const { version, minAppVersion } = manifest;
assert.equal(manifest.id, "scholia-reader", "Plugin ID must not collide with community Scholia");
assert.equal(manifest.name, "Scholia Reader", "Plugin display name regression");
assert.equal(manifest.isDesktopOnly, false, "Plugin must remain mobile-compatible");
assert.equal(manifest.author, "ianmoran11", "Plugin author mismatch");
assert.equal(manifest.authorUrl, "https://github.com/ianmoran11", "Missing author URL");
assert.equal(manifest.homepageUrl, "https://github.com/ianmoran11/obsidian-scholia", "Repository URL mismatch");
assert.equal(minAppVersion, "1.5.0", "Minimum Obsidian version regression");
assert.deepEqual(json(`test-vault/.obsidian/plugins/${manifest.id}/manifest.json`), manifest, "Test vault manifest mismatch");
assert.deepEqual(json("test-vault/.obsidian/community-plugins.json"), [manifest.id], "Test vault enabled ID mismatch");
const readme = readFileSync(new URL("README.md", root), "utf8");
assert.ok(readme.includes(`](releases/${version}.md)`), "README latest release link mismatch");
assert.match(version, /^\d+\.\d+\.\d+$/, "Release version must be stable semver");
assert.equal(json("versions.json")[version], minAppVersion, "Missing compatibility entry");
for (const prefix of ["", "bridge/"]) {
  const pkg = json(`${prefix}package.json`);
  const lock = json(`${prefix}package-lock.json`);
  assert.equal(pkg.version, version, `${prefix}package.json version mismatch`);
  assert.equal(lock.version, version, `${prefix}package-lock.json version mismatch`);
  assert.equal(lock.packages[""].version, version, `${prefix}lock root version mismatch`);
}
const notes = readFileSync(new URL(`releases/${version}.md`, root), "utf8");
assert.ok(notes.startsWith(`# Scholia Reader ${version} `), "Release notes version mismatch");
if (process.env.GITHUB_REF_TYPE === "tag") {
  assert.equal(process.env.GITHUB_REF_NAME, version, "Tag must match manifest version exactly");
}
console.log(`Release ${version}: metadata, compatibility map and release notes match.`);
