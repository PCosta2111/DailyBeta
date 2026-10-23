# Daily Beta

Daily Beta is a vibecoded, V2-only bouldering puzzle. Drag each hand and foot, choose grips and hooks, launch one- or two-hand dynos, and find the daily beta. It also includes endless seeds, Easy dyno guidance, fixed-length animation, and optimal-beta replay.

The game runs entirely in the browser. It has no account system, backend, analytics, CDN assets, or third-party runtime dependencies. Attempts and preferences stay in browser storage. Sharing a result uses the browser's share or clipboard controls only when you choose it.

## Run locally

Use Node.js 22 or later. No dependency installation is needed. From the project root, run:

```powershell
npm start
```

Open http://127.0.0.1:3001/daily-beta-pages/. The preview binds only to `127.0.0.1` and serves the game assets, not project files or tooling.

## Build and test

```powershell
npm test
npm run build
```

The build recreates `dist` from an explicit list of browser assets in `scripts/build.mjs`. It contains only the game files needed to run the site, not development scripts, tests, this README, package metadata, Git history, or local configuration. `dist` is generated and ignored by Git.

The HTML Content Security Policy allows local scripts and workers and blocks fetch and WebSocket connections from the page. Inline style attributes are allowed because the game positions holds and limbs dynamically.

## Saves

Daily and each Endless seed have separate saves. Progress is separate between browser origins because browser storage belongs to an origin. Nothing is uploaded or synchronized by the game.

## Development

Browser sources are in `public`. Change those files, then rebuild or restart the preview.

Tests replay 365 daily walls and 1,000 Endless seeds, exercise hand-based catches and fixed limb lengths, check optimal-beta solutions against a small exhaustive reference, and check the exact build file list and repository-subpath serving.
