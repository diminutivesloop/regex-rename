#!/usr/bin/env bun

import fs from "fs";
import path from "path";

type Options = {
  dryRun: boolean;
  force: boolean;
  patternRaw?: string;
  replacement?: string;
};

function printHelp() {
  console.log(`Usage: regex-rename <pattern> <replacement> [--dry-run|-n] [--force|-f]

- <pattern>: JavaScript-style regex. Either write as /pattern/flags or just pattern (no flags).
  Examples:
    /foo(\\d+)/i  -> matches foo1, foo2
    ^old-(.*)$     -> matches start of filename "old-..."

- <replacement>: Replacement string using $1, $2 etc for capture groups.

Options:
  --dry-run, -n   : Show planned renames without applying them
  --force, -f     : Overwrite existing files if target name exists
  --help, -h      : Show this help

Examples:
  regex-rename '/old-(.*)\.txt/' '$1.txt' --dry-run
  regex-rename '^IMG_(\\d+)' 'photo_$1' -n
`);
}

function parseArgs(
  argv: string[]
): Options & { pattern?: RegExp; replacement?: string } {
  const opts: Options = { dryRun: false, force: false };
  const args: string[] = [];

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run" || a === "-n") opts.dryRun = true;
    else if (a === "--force" || a === "-f") opts.force = true;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else args.push(a);
  }

  if (args.length < 2) {
    console.error(
      "Error: missing required arguments <pattern> and <replacement>.\n"
    );
    printHelp();
    process.exit(2);
  }

  const patternRaw = args[0];
  const replacement = args[1];

  let regex: RegExp;
  // If pattern is like /pattern/flags
  if (patternRaw.startsWith("/") && patternRaw.lastIndexOf("/") > 0) {
    const lastSlash = patternRaw.lastIndexOf("/");
    const body = patternRaw.slice(1, lastSlash);
    const flags = patternRaw.slice(lastSlash + 1);
    try {
      regex = new RegExp(body, flags);
    } catch (err) {
      console.error(
        "Invalid regular expression:",
        err instanceof Error ? err.message : err
      );
      process.exit(2);
    }
  } else {
    // treat as raw pattern with no flags
    try {
      regex = new RegExp(patternRaw);
    } catch (err) {
      console.error(
        "Invalid regular expression:",
        err instanceof Error ? err.message : err
      );
      process.exit(2);
    }
  }

  return { ...opts, pattern: regex, replacement };
}

async function main() {
  const { dryRun, force, pattern, replacement } = parseArgs(
    process.argv
  ) as any;
  if (!pattern || typeof replacement !== "string") {
    console.error("Internal error: missing pattern or replacement");
    process.exit(2);
  }

  const cwd = process.cwd();
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(cwd, { withFileTypes: true });
  } catch (err) {
    console.error(
      "Failed to read current directory:",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  }

  const files = entries.filter((d) => d.isFile()).map((d) => d.name);
  if (files.length === 0) {
    console.log("No files found in current directory.");
    return;
  }

  const planned: Array<{ from: string; to: string }> = [];

  for (const f of files) {
    const to = f.replace(pattern, replacement);
    if (to !== f) planned.push({ from: f, to });
  }

  if (planned.length === 0) {
    console.log("No files match the pattern; nothing to rename.");
    return;
  }

  console.log(dryRun ? "Dry run — planned renames:" : "Planned renames:");
  for (const p of planned) console.log(`- ${p.from}  ->  ${p.to}`);

  if (dryRun) {
    console.log(
      `\nDry-run mode: no files were changed. Use without --dry-run to apply.`
    );
    return;
  }

  // Apply renames
  let success = 0;
  let skipped = 0;
  let errors = 0;

  for (const p of planned) {
    const fromPath = path.join(cwd, p.from);
    const toPath = path.join(cwd, p.to);

    try {
      const exists = fs.existsSync(toPath);
      if (exists && !force) {
        console.warn(
          `Skipping rename: target exists and --force not set: ${p.to}`
        );
        skipped++;
        continue;
      }

      // Ensure target directory exists (should be same dir) and then rename.
      await fs.promises.rename(fromPath, toPath);
      success++;
    } catch (err) {
      console.error(
        `Failed to rename ${p.from} -> ${p.to}:`,
        err instanceof Error ? err.message : err
      );
      errors++;
    }
  }

  console.log(
    `\nResult: ${success} renamed, ${skipped} skipped, ${errors} errors.`
  );
  if (errors > 0) process.exit(1);
}

if (import.meta.main)
  main().catch((err) => {
    console.error("Unhandled error:", err);
    process.exit(1);
  });
