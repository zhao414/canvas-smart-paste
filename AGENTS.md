# Reformat Windows Title — Agent Instructions

This is an Obsidian plugin project. Reference `@vault` for Obsidian API conventions.

## Vault setup for contributors

The `@vault` reference is defined locally in `opencode.json` (not tracked in this repo).
To set it up:

1. `git clone https://github.com/obsidianmd/obsidian-developer-docs`
2. Add a `references` entry to your local `opencode.json`:

```json
"references": {
  "vault": {
    "path": "<path-to-cloned-repo>",
    "description": "Obsidian plugin development docs"
  }
}
```

## Build
- `npm run dev` — watch mode development build
- `npm run build` — production build (type-check + minify)
- Output: `main.js` at project root

## Code Conventions (from @vault)
- Use `this.app` not global `app`/`window.app`
- Prefer `const`/`let` over `var`
- Prefer `async`/`await` over raw Promises
- Use `createEl()` / `createDiv()` instead of `innerHTML`
- Use Obsidian CSS variables for styling
- Use Sentence case in UI text
- Command IDs: do not prefix with plugin ID
- Do not set default hotkeys
- Use `registerEvent()` for event cleanup
- Do not detach leaves in `onunload()`
