import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const manifest = json("manifest.json");
const { version, minAppVersion } = manifest;
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
assert.ok(notes.startsWith(`# Scholia ${version} `), "Release notes version mismatch");
if (process.env.GITHUB_REF_TYPE === "tag") {
  assert.equal(process.env.GITHUB_REF_NAME, version, "Tag must match manifest version exactly");
}
console.log(`Release ${version}: metadata, compatibility map and release notes match.`);
