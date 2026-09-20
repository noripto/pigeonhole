import { execFileSync } from "node:child_process";
import fs from "node:fs";

const version = process.argv[2];

function die(message) {
  console.error(message);
  process.exit(1);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) die("usage: pnpm release <x.y.z>");
if (git("status", "--porcelain") !== "") die("working tree is not clean");
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") die("not on main");
if (git("tag", "-l", version) !== "") die(`tag ${version} already exists`);

execFileSync("pnpm", ["build"], { stdio: "inherit", shell: true });

for (const file of ["manifest.json", "package.json"]) {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  json.version = version;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
}

git("add", "manifest.json", "package.json");
git("commit", "-m", `Release ${version}`);
git("tag", version);
git("push", "origin", "main", version);

execFileSync(
  "gh",
  [
    "release",
    "create",
    version,
    "main.js",
    "manifest.json",
    "styles.css",
    "--title",
    version,
    "--generate-notes",
  ],
  { stdio: "inherit", shell: true },
);
