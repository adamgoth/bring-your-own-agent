import { copyFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export function outputDirectory(args, cwd = process.cwd()) {
  const index = args.indexOf("--out");
  if (index !== -1) {
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error("--out requires a directory");
    return resolve(cwd, value);
  }
  return args.includes("--keep") || args.includes("--pack-only")
    ? resolve(cwd, "artifacts/sdk")
    : null;
}

/** Copy only the verified package archives; temporary install/cache files never escape. */
export function saveTarballs(tarballs, directory) {
  mkdirSync(directory, { recursive: true });
  return tarballs.map((source) => {
    const destination = join(directory, basename(source));
    copyFileSync(source, destination);
    return destination;
  });
}
