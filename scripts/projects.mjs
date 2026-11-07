import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projects = [
  { dir: "byoa-extension", manager: "pnpm" },
  { dir: "demos/margin", manager: "npm" },
  { dir: "demos/boardwalk", manager: "pnpm" },
];
const root = new URL("../", import.meta.url);
const children = new Set();
const windows = process.platform === "win32";
function stop() {
  for (const child of children) {
    try {
      if (windows) child.kill();
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Child already exited. */
    }
  }
}
process.once("SIGINT", () => {
  stop();
  process.exitCode = 0;
});
process.once("SIGTERM", () => {
  stop();
  process.exitCode = 0;
});
function run(project, args) {
  console.log(`\n[${project.dir}] ${project.manager} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(project.manager + (windows ? ".cmd" : ""), args, {
      cwd: fileURLToPath(new URL(`${project.dir}/`, root)),
      stdio: "inherit",
      detached: !windows,
      env: { ...process.env, HUSKY: "0" },
    });
    children.add(child);
    child.once("error", (error) => {
      children.delete(child);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      children.delete(child);
      if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") resolve();
      else reject(new Error(`${project.dir} failed (${code ?? signal}).`));
    });
  });
}
const action = process.argv[2];
try {
  if (action === "dev") {
    console.log(
      "Margin: http://localhost:5173/\nBoardwalk: http://localhost:5174/\nPress Ctrl+C to stop both demo servers.",
    );
    const jobs = projects
      .slice(1)
      .map((project) => run(project, ["run", "dev"]));
    await Promise.race(jobs);
    stop();
    await Promise.all(jobs);
  } else if (action === "setup") {
    for (const project of projects) {
      await run(
        project,
        project.manager === "npm"
          ? ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]
          : ["install", "--frozen-lockfile", "--ignore-scripts"],
      );
    }
  } else if (action === "check") {
    await run(projects[0], ["run", "check"]);
    for (const project of projects.slice(1)) {
      await run(project, ["run", "test"]);
      await run(project, ["run", "build"]);
    }
  } else if (action === "build" || action === "test") {
    for (const project of projects) await run(project, ["run", action]);
  } else throw new Error("Use setup, dev, build, test, or check.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop();
  process.exitCode = 1;
}
