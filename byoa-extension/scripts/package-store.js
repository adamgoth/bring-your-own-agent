#!/usr/bin/env node

// Package a local production build for manual Chrome Web Store upload.
// Unlike package-release.js, this does not require a Git tag or claim tagged provenance.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { RELEASE_METADATA_FILE } from './release-contract.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist');
const manifest = JSON.parse(await fs.readFile(path.join(dist, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3 || manifest.version !== pkg.version) {
  throw new Error('Build must use Manifest V3 and match package.json version.');
}

const entries = [];
async function collect(directory, prefix = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(absolute, relative);
    } else if (entry.isFile()) {
      if (
        entry.name.startsWith('.') ||
        /\.(map|pem|key|zip)$/i.test(entry.name) ||
        relative === RELEASE_METADATA_FILE
      ) {
        throw new Error(`Unexpected file in store build: ${relative}`);
      }
      entries.push({ name: relative, bytes: await fs.readFile(absolute) });
    } else {
      throw new Error(`Unsupported build entry: ${relative}`);
    }
  }
}
await collect(dist);
for (const name of ['LICENSE', 'PRIVACY.md']) {
  if (entries.some((entry) => entry.name === name)) {
    throw new Error(`Duplicate package entry: ${name}`);
  }
  entries.push({ name, bytes: await fs.readFile(path.join(root, name)) });
}
entries.sort((a, b) => a.name.localeCompare(b.name));

const releaseDir = path.join(root, 'release');
await fs.mkdir(releaseDir, { recursive: true });
const filename = `byoa-${pkg.version}-chrome-web-store.zip`;
const destination = path.join(releaseDir, filename);
const output = createWriteStream(destination);
const archive = archiver('zip', { zlib: { level: 9 } });
const completed = new Promise((resolve, reject) => {
  output.on('close', resolve);
  output.on('error', reject);
  archive.on('error', reject);
  archive.on('warning', reject);
});
archive.pipe(output);
for (const entry of entries) archive.append(entry.bytes, { name: entry.name });
try {
  await Promise.all([archive.finalize(), completed]);
} catch (error) {
  output.destroy();
  await fs.rm(destination, { force: true });
  throw error;
}
const bytes = await fs.readFile(destination);
const checksum = createHash('sha256').update(bytes).digest('hex');
await fs.writeFile(`${destination}.sha256`, `${checksum}  ${filename}\n`);
console.log(`Store upload: ${destination}`);
console.log(`Version: ${manifest.version}; files: ${entries.length}; size: ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`SHA-256: ${checksum}`);
