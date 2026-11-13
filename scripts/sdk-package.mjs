import { outputDirectory, saveTarballs } from "./sdk-output.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const output = outputDirectory(args);
// --pack-only builds, checks package contents and saves the archives, skipping the
// installed-consumer verification (registry installs of React 18/19 and demo tooling).
const packOnly = args.includes("--pack-only");
const scratch = mkdtempSync(join(tmpdir(), "byoa-packages-"));
const env = { ...process.env, npm_config_cache: join(scratch, "npm-cache") };
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", env });
try {
  const tarballs = [];
  for (const name of ["browser", "react"]) {
    const directory = join(root, "packages", name);
    run("pnpm", ["run", "build"], directory);
    const packed = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch],
        { cwd: directory, encoding: "utf8", env },
      ),
    )[0];
    const manifest = JSON.parse(
      readFileSync(join(directory, "package.json"), "utf8"),
    );
    for (const dependency of Object.values({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    })) {
      if (/^(file:|link:|workspace:)/.test(dependency))
        throw Error("Published dependency must not reference the repository");
    }
    if (!packed.files.some((file) => file.path === "dist/index.d.ts"))
      throw Error("Missing declarations");
    if (
      name === "react" &&
      !packed.files.some((file) => file.path === "dist/styles.css")
    )
      throw Error("Missing styles");
    if (
      name === "browser" &&
      !packed.files.some((file) => file.path === "prompts/add-byoa.md")
    )
      throw Error("Missing integration prompt");
    for (const file of [
      "dist/elements.js",
      "dist/elements.d.ts",
      "dist/ui.js",
      "dist/ui.d.ts",
      "dist/styles.css",
    ])
      if (
        name === "browser" &&
        !packed.files.some((entry) => entry.path === file)
      )
        throw Error(`Missing browser UI file ${file}`);
    tarballs.push(join(scratch, packed.filename));
  }
  if (packOnly) {
    for (const tarball of saveTarballs(tarballs, output))
      console.log(`Tarball: ${tarball}`);
  } else {
    writeFileSync(
      join(scratch, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    saveTarballs(tarballs, join(scratch, "vendor/byoa"));
    for (const reactVersion of ["19", "18"]) {
      rmSync(join(scratch, "node_modules"), { recursive: true, force: true });
      writeFileSync(
        join(scratch, "package.json"),
        JSON.stringify({ private: true, type: "module" }),
      );
      run(
        "npm",
        [
          "install",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--package-lock=false",
          ...tarballs.map((file) => `./vendor/byoa/${basename(file)}`),
          `react@${reactVersion}`,
          `react-dom@${reactVersion}`,
          `@types/react@${reactVersion}`,
          `@types/react-dom@${reactVersion}`,
        ],
        scratch,
      );
      const consumerManifest = JSON.parse(
        readFileSync(join(scratch, "package.json"), "utf8"),
      );
      for (const name of ["@byoagent/browser", "@byoagent/react"]) {
        if (
          !consumerManifest.dependencies[name].startsWith("file:vendor/byoa/")
        )
          throw Error("Consumer dependency must use a portable vendor path");
      }
      writeFileSync(
        join(scratch, "consumer.tsx"),
        `import { byoa, agentboard, createClient, createAgentSession, type AgentClient, type AgentRequest } from '@byoagent/browser';
import { createRoot } from 'react-dom/client';
import '@byoagent/react/styles.css';
import '@byoagent/browser/styles.css';
import { defineAgentElements, type AgentConnectionDialogElement } from '@byoagent/browser/elements';
import { agentLabels } from '@byoagent/browser/ui';
import { AgentProvider, AgentIndicator, AgentConnectionDialog, AgentPromptPopover, AgentTaskStatus, useConnection, useAgentTask } from '@byoagent/react';
const client: AgentClient = createClient();
const request: AgentRequest = { prompt: 'Read', tools: ['read'] };
const session = createAgentSession(client);
defineAgentElements();
const dialog: AgentConnectionDialogElement | null = document.querySelector('byoa-connection-dialog');
if (dialog) {
  dialog.session = session;
  dialog.labels = { sidebar: agentLabels.sidebar };
  dialog.addEventListener('openchange', (event) => void event.detail.open);
  dialog.open = true;
}
const app = <AgentProvider session={session}><AgentIndicator/><AgentConnectionDialog open={false} onOpenChange={() => {}}/><AgentPromptPopover open={false} onOpenChange={() => {}} tools={request.tools}/><AgentTaskStatus/></AgentProvider>;
void [byoa, agentboard, useConnection, useAgentTask];
createRoot(document.getElementById('root')!).render(app);
`,
      );
      for (const [moduleKind, resolution] of [
        ["NodeNext", "NodeNext"],
        ["ESNext", "bundler"],
        ["ESNext", "node10"],
      ]) {
        run(
          join(root, "packages/browser/node_modules/.bin/tsc"),
          [
            "--noEmit",
            "--strict",
            "--target",
            "ES2022",
            "--module",
            moduleKind,
            "--moduleResolution",
            resolution,
            "--jsx",
            "react-jsx",
            "--lib",
            "ES2022,DOM",
            "consumer.tsx",
          ],
          scratch,
        );
      }
      run(
        "node",
        [
          "--input-type=module",
          "-e",
          `await import('react'); await import('react-dom'); await import('react-dom/server');
Object.defineProperty(globalThis,'window',{get(){throw Error('window accessed during SSR')}});
const sdk = await import('@byoagent/browser');
const ui = await import('@byoagent/react');
const elements = await import('@byoagent/browser/elements');
const shared = await import('@byoagent/browser/ui');
elements.defineAgentElements(); // No registry during SSR: must be a silent no-op.
if (shared.agentLabels.connect !== 'Connect Agent') throw Error('shared labels');
const { createElement: h } = await import('react');
const { renderToString } = await import('react-dom/server');
if(sdk.byoa !== sdk.agentboard) throw Error('alias');
const html = renderToString(h(ui.AgentProvider, null, h(ui.AgentIndicator)));
if (!html.includes('Connect Agent')) throw Error('SSR markup');
console.log('Both packed packages: consumer types, SSR import and render, and SSR-safe custom elements passed');`,
        ],
        scratch,
      );
      writeFileSync(
        join(scratch, "index.html"),
        '<div id="root"></div><script type="module" src="/consumer.tsx"></script>',
      );
      writeFileSync(
        join(scratch, "vite.config.mjs"),
        'export default { esbuild: { jsx: "automatic" } };',
      );
      run(
        join(root, "demos/margin/node_modules/.bin/vite"),
        ["build"],
        scratch,
      );
    }
    if (output)
      for (const tarball of saveTarballs(tarballs, output))
        console.log(`Tarball: ${tarball}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
