# regex-rename

A simple tool for renaming files using regular expressions.

## Setup

Install dependencies:

```bash
bun install
```

(Optional) Link the package globally to use the `regex-rename` command from anywhere:

```bash
bun link
```

## Usage

```bash
regex-rename <pattern> <replacement> [--dry-run|-n] [--force|-f]
```

For example, to rename a series of image files starting with `IMG_` to `photo_`:

```bash
regex-rename '^IMG_(\d+)\.jpg' 'photo_$1.jpg'
```

## Tests

Run the CLI integration tests:

```bash
bun test
```

Tests create files in isolated temporary directories and invoke the CLI as a subprocess.

🤖 Built w/ help from AI
