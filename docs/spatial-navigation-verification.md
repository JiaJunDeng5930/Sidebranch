# Spatial navigation browser regression

`tests/spatial-navigation.browser.mjs` checks the complete Reader and the embedded
App through the local AppBridge harness. It uses Chrome DevTools Protocol and
the project's existing QA fixtures; no additional test dependency is required.

## Run locally

Run these commands from the repository root with the project dependencies
installed:

```sh
pnpm build
pnpm build:qa
pnpm dev
```

Leave the development server running. In a separate terminal, start an isolated
Chrome instance. On macOS:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --no-first-run --no-default-browser-check \
  --user-data-dir="$(mktemp -d)" \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9227 about:blank
```

On other systems, use the installed Chrome or Chromium executable with the same
flags. With both processes running, execute:

```sh
node tests/spatial-navigation.browser.mjs
```

`SIDEBRANCH_QA_URL` overrides the default `http://localhost:5173` development
server. `CHROME_DEBUG_URL` overrides `http://127.0.0.1:9227`. The test creates and
closes its own browser tab, prints each completed scenario, and saves screenshots
in a temporary directory whose path appears in the output. Failures also save
the mounted paper identities, focus markers, relation label, and browser errors.

## Assertions

On both the website and embedded App, native pointer selection opens selection
actions. Escape dismisses those actions while retaining the current document
and camera. Following a relation must change the active document and select the
relation before the test checks both paper bounds, loaded bodies, and unchanged
paper poses.

The test also opens and follows the relation at 390 × 844 and 900 × 360 pixels.
The opening document must have projected body text of at least 15.5 pixels;
after navigation, both endpoint papers must be inside the scene and the scene
must fit its own viewport. Papers outside the camera view need not have mounted
DOM elements before navigation.

These are local Chrome/AppBridge checks. They do not exercise the production
ChatGPT host or physical touch hardware.

## Verified on 2026-09-20

Both modes passed at outer browser sizes of 1440 × 1000, 390 × 844, and
900 × 360 pixels, with no browser exceptions. The embedded App uses the height
remaining below the QA host controls, so its short-window case also checks a
scene substantially shorter than the outer browser window.

Type checking, lint, all 94 tests, the production build, and the complete and
spatial QA builds passed. The original interaction sequence also passed paper
dragging, modifier-wheel zoom, orbiting over text, native scrolling, and native
selection before following the relation.
