// Install step for hosted Margin deploys (vercel.json). Margin depends on the local
// @byoagent/browser and @byoagent/react packages, so build those before installing it.
// pnpm is pinned through npx so the host's preinstalled pnpm version doesn't matter.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const run = (command, args) =>
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
const pnpm = ["--yes", "pnpm@10.28.0", "--dir", "packages/react"];

run("npm", ["ci", "--prefix", "packages/browser", "--ignore-scripts", "--no-audit", "--no-fund"]);
run("npm", ["run", "build", "--prefix", "packages/browser"]);
run("npx", [...pnpm, "install", "--frozen-lockfile", "--ignore-scripts"]);
run("npx", [...pnpm, "run", "build"]);
run("npm", ["ci", "--prefix", "demos/margin"]);
