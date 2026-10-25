import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const cliPath = path.join(import.meta.dir, "index.ts");
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "regex-rename-test-"));
});

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function run(...args: string[]) {
  const child = Bun.spawn([process.execPath, cliPath, ...args], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function files() {
  return (await readdir(directory)).sort();
}

async function contents(name: string) {
  return readFile(path.join(directory, name), "utf8");
}

async function fixture(name: string, content = name) {
  await writeFile(path.join(directory, name), content);
}

test("renames multiple files", async () => {
  await fixture("IMG_1.jpg", "first image");
  await fixture("IMG_2.jpg", "second image");
  await fixture("IMG_3.jpg", "third image");

  const result = await run("^IMG", "photo");

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("3 renamed, 0 skipped, 0 errors");
  expect(await files()).toEqual(["photo_1.jpg", "photo_2.jpg", "photo_3.jpg"]);
  expect(await contents("photo_1.jpg")).toBe("first image");
  expect(await contents("photo_2.jpg")).toBe("second image");
  expect(await contents("photo_3.jpg")).toBe("third image");
});

test("supports capture groups", async () => {
  await fixture("123IMG.jpg", "first image");
  await fixture("456IMG.jpg", "second image");

  const result = await run("^(\\d+)IMG\\.jpg", "photo_$1.jpg");

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("2 renamed, 0 skipped, 0 errors");
  expect(await files()).toEqual(["photo_123.jpg", "photo_456.jpg"]);
  expect(await contents("photo_123.jpg")).toBe("first image");
  expect(await contents("photo_456.jpg")).toBe("second image");
});

test("preserves unmatched files", async () => {
  await fixture("old-report.txt", "original content");
  await fixture("notes.txt", "keep me");

  const result = await run("old", "new");

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("1 renamed, 0 skipped, 0 errors");
  expect(await files()).toEqual(["new-report.txt", "notes.txt"]);
  expect(await contents("new-report.txt")).toBe("original content");
  expect(await contents("notes.txt")).toBe("keep me");
});

test("supports regex literal syntax with case-insensitive and global flags", async () => {
  await fixture("OLD-old.txt", "original content");

  const result = await run("/old/gi", "new");

  expect(result.exitCode).toBe(0);
  expect(await files()).toEqual(["new-new.txt"]);
  expect(await contents("new-new.txt")).toBe("original content");
});

test("omitting replacement removes matches", async () => {
  await fixture("old-report.txt", "original content");
  await fixture("notes.txt", "keep me");

  const result = await run("^old-");

  expect(result.exitCode).toBe(0);
  expect(await files()).toEqual(["notes.txt", "report.txt"]);
  expect(await contents("report.txt")).toBe("original content");
  expect(await contents("notes.txt")).toBe("keep me");
});

test("omitted replacement removes all matches with the global flag", async () => {
  await fixture("old-old-report.txt");

  const result = await run("/old-/g");

  expect(result.exitCode).toBe(0);
  expect(await files()).toEqual(["report.txt"]);
});

test.each(["--dry-run", "-n"])(
  "%s reports renames without changing files",
  async (flag) => {
    await fixture("old.txt", "original content");

    const result = await run("^old", "new", flag);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("old.txt  ->  new.txt");
    expect(result.stdout).toContain("no files were changed");
    expect(await files()).toEqual(["old.txt"]);
    expect(await contents("old.txt")).toBe("original content");
  },
);

test("skips existing targets by default and preserves both files", async () => {
  await fixture("old.txt", "source content");
  await fixture("new.txt", "target content");

  const result = await run("^old", "new");

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain("target exists and --force not set: new.txt");
  expect(result.stdout).toContain("0 renamed, 1 skipped, 0 errors");
  expect(await files()).toEqual(["new.txt", "old.txt"]);
  expect(await contents("old.txt")).toBe("source content");
  expect(await contents("new.txt")).toBe("target content");
});

test.each(["--force", "-f"])(
  "%s overwrites an existing target",
  async (flag) => {
    await fixture("old.txt", "source content");
    await fixture("new.txt", "target content");

    const result = await run("^old", "new", flag);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1 renamed, 0 skipped, 0 errors");
    expect(await files()).toEqual(["new.txt"]);
    expect(await contents("new.txt")).toBe("source content");
  },
);

test("ignores directories and nested files", async () => {
  await mkdir(path.join(directory, "old-folder"));
  await fixture("old-folder/old.txt", "nested content");
  await fixture("old.txt", "top-level content");

  const result = await run("^old", "new");

  expect(result.exitCode).toBe(0);
  expect(await files()).toEqual(["new.txt", "old-folder"]);
  expect(await readdir(path.join(directory, "old-folder"))).toEqual([
    "old.txt",
  ]);
  expect(await contents("old-folder/old.txt")).toBe("nested content");
  expect(await contents("new.txt")).toBe("top-level content");
});

test("handles an empty directory", async () => {
  const result = await run("old", "new");

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("No files found in current directory.");
  expect(await files()).toEqual([]);
});

test("leaves files unchanged when nothing matches", async () => {
  await fixture("notes.txt", "keep me");

  const result = await run("^old", "new");

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("No files match the pattern");
  expect(await files()).toEqual(["notes.txt"]);
  expect(await contents("notes.txt")).toBe("keep me");
});

test.each(["--help", "-h"])("%s displays help successfully", async (flag) => {
  const result = await run(flag);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: regex-rename");
  expect(result.stderr).toBe("");
  expect(await files()).toEqual([]);
});

test.each([[], ["--dry-run"]])(
  "rejects missing required arguments: %j",
  async (...args) => {
    const result = await run(...args);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("missing required argument <pattern>");
    expect(result.stdout).toContain("Usage: regex-rename");
    expect(await files()).toEqual([]);
  },
);

test.each(["[", "/[/", "/old/z"])(
  "rejects invalid regex %s without changing files",
  async (pattern) => {
    await fixture("old.txt", "keep me");

    const result = await run(pattern, "new");

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Invalid regular expression:");
    expect(await files()).toEqual(["old.txt"]);
    expect(await contents("old.txt")).toBe("keep me");
  },
);
