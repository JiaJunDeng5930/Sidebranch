import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = process.env.SIDEBRANCH_QA_URL ?? "http://localhost:5173";
const debug = process.env.CHROME_DEBUG_URL ?? "http://127.0.0.1:9227";
const response = await fetch(new URL("/json/new?about:blank", debug), {
  method: "PUT",
});
assert.ok(response.ok, `Chrome target creation failed: ${response.status}`);
const target = await response.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const errors = [];
let sequence = 0;
let embedded = false;
const evidence = await mkdtemp(
  join(tmpdir(), "sidebranch-spatial-navigation-"),
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Runtime.exceptionThrown") errors.push(message.params);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timeout);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function call(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 10000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

function read(expression) {
  return evaluate(`(() => {
    const doc = ${embedded ? "document.querySelector('iframe')?.contentDocument" : "document"};
    return (${expression});
  })()`);
}

async function waitFor(expression, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await read(expression)) return;
    await pause(40);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const snapshot = () =>
  read(`({
  focus: doc.querySelector('[data-focused=true]')?.dataset.surfaceKey,
  camera: doc.querySelector('.spatial-css-renderer>div>div').style.transform,
  scene: doc.querySelector('.spatial-scene').getBoundingClientRect().toJSON(),
  viewport: { width: doc.defaultView.innerWidth, height: doc.defaultView.innerHeight },
  papers: [...doc.querySelectorAll('[data-paper]')].map(paper => ({
    id: paper.dataset.surfaceKey, pose: paper.style.transform,
    resident: paper.dataset.residency, hidden: paper.getAttribute('aria-hidden'),
    rect: paper.getBoundingClientRect().toJSON()
  }))
})`);

async function point(selector) {
  const local = await read(`(() => {
    const rect = doc.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  const offset = embedded
    ? await evaluate(
        "document.querySelector('iframe').getBoundingClientRect().toJSON()",
      )
    : { x: 0, y: 0 };
  return { ...local, x: local.x + offset.x, y: local.y + offset.y };
}

const mouse = (type, x, y) =>
  call("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: "left",
    buttons: type === "mouseReleased" ? 0 : 1,
    clickCount: type === "mouseMoved" ? 0 : 1,
  });

async function click(selector) {
  const rect = await point(selector);
  await mouse(
    "mousePressed",
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await mouse(
    "mouseReleased",
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
}

async function escape() {
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
  });
  await call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
  });
}

async function capture(name) {
  const image = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(
    join(evidence, `${name}.png`),
    Buffer.from(image.data, "base64"),
  );
}

async function open(mode, width, height) {
  embedded = false;
  await call("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const previousDocument = await evaluate("performance.timeOrigin");
  await call("Page.navigate", {
    url: new URL(
      mode === "app" ? "/__qa" : "/__qa?frame=1&qa-performance=off",
      origin,
    ).href,
  });
  await waitFor(
    `performance.timeOrigin !== ${previousDocument}`,
    "new document",
  );
  if (mode === "app") {
    await waitFor(
      "[...doc.querySelectorAll('button')].some(b => b.textContent === 'MCP App bridge')",
      "App launcher",
    );
    await evaluate(
      "[...document.querySelectorAll('button')].find(b => b.textContent === 'MCP App bridge').click()",
    );
    embedded = true;
  }
  await waitFor(
    "!!doc?.querySelector('[data-focused=true] .document-content') && !!doc.querySelector('.spatial-relations')",
    `${mode} reader`,
  );
  await pause(80);
}

function assertFramed({ scene, papers, viewport }) {
  assert.ok(
    scene.left >= -1 &&
      scene.right <= viewport.width + 1 &&
      scene.top >= -1 &&
      scene.bottom <= viewport.height + 1,
  );
  assert.equal(papers.length, 2);
  for (const { id, rect, resident, hidden } of papers) {
    assert.equal(resident, "resident", `${id}: missing body`);
    assert.equal(hidden, "false", `${id}: hidden paper`);
    assert.ok(rect.width > 0 && rect.height > 0);
    assert.ok(
      rect.left >= scene.left - 1 &&
        rect.right <= scene.right + 1 &&
        rect.top >= scene.top - 1 &&
        rect.bottom <= scene.bottom + 1,
      `${id}: paper ${JSON.stringify(rect)} outside scene ${JSON.stringify(scene)}`,
    );
  }
}

try {
  await call("Page.enable");
  await call("Runtime.enable");
  for (const mode of ["website", "app"]) {
    await open(mode, 1440, 1000);
    const before = await snapshot();
    const paragraph = await point("[data-focused=true] .document-content p");
    await mouse("mousePressed", paragraph.x + 5, paragraph.y + 12);
    for (let step = 1; step <= 8; step++)
      await mouse("mouseMoved", paragraph.x + 5 + step * 16, paragraph.y + 12);
    await mouse("mouseReleased", paragraph.x + 133, paragraph.y + 12);
    await waitFor(
      "!!doc.querySelector('.selection-composer-v2')",
      "selection actions",
    );
    assert.ok(await read("String(doc.getSelection()).length > 0"));
    await escape();
    await waitFor(
      "!doc.querySelector('.selection-composer-v2')",
      "dismissed selection actions",
    );
    const dismissed = await snapshot();
    assert.equal(
      dismissed.focus,
      before.focus,
      "Escape must retain the current document",
    );
    assert.equal(
      dismissed.camera,
      before.camera,
      "Escape must retain the camera",
    );
    await read("doc.getSelection().removeAllRanges()");
    await click('button[aria-label="下一个关联"]');
    // A blocked navigation must fail here, before its geometry can be assessed.
    await waitFor(
      "/1\\s*\\/\\s*1/.test(doc.querySelector('.spatial-relations')?.textContent ?? '')",
      "completed relation navigation",
    );
    await pause(100);
    const paired = await snapshot();
    assert.notEqual(paired.focus, before.focus);
    assert.deepEqual(
      paired.papers.map((p) => p.pose),
      before.papers.map((p) => p.pose),
    );
    assertFramed(paired);
    await capture(`${mode}-comparison`);
    console.log(
      `${mode}: selection dismissal preserves focus; relation navigation frames both papers`,
    );

    for (const [width, height] of [
      [390, 844],
      [900, 360],
    ]) {
      await open(mode, width, height);
      const state = await snapshot();
      const focused = state.papers.find((p) => p.id === state.focus);
      const font = await read(
        "parseFloat(getComputedStyle(doc.querySelector('[data-focused=true] .document-content')).fontSize)",
      );
      assert.ok(
        (font * focused.rect.width) / 600 >= 15.5,
        "Unreadable projected body type",
      );
      assert.ok(
        focused.rect.left >= state.scene.left - 1 &&
          focused.rect.right <= state.scene.right + 1 &&
          focused.rect.top >= state.scene.top - 1 &&
          focused.rect.bottom <= state.scene.bottom + 1,
      );
      await click('button[aria-label="下一个关联"]');
      await waitFor(
        "/1\\s*\\/\\s*1/.test(doc.querySelector('.spatial-relations')?.textContent ?? '')",
        "narrow relation navigation",
      );
      await pause(100);
      assertFramed(await snapshot());
      await capture(`${mode}-${width}x${height}`);
      console.log(
        `${mode} ${width}x${height}: readable opening; both relation endpoints framed`,
      );
    }
  }
  assert.deepEqual(errors, [], "Unexpected browser exceptions");
  console.log(`Browser verification passed. Screenshots: ${evidence}`);
} catch (error) {
  await capture("failure");
  const state = await read(`({
    paperCount: doc?.querySelectorAll('[data-paper]').length,
    focused: [...(doc?.querySelectorAll('[data-paper]') ?? [])].map(p => ({id: p.dataset.surfaceKey, focused: p.dataset.focused})),
    relation: doc?.querySelector('.spatial-relations')?.textContent
  })`);
  console.error(JSON.stringify(state));
  await writeFile(
    join(evidence, "state.json"),
    JSON.stringify({ state, errors }, null, 2),
  );
  console.error(`Browser evidence: ${evidence}`);
  throw error;
} finally {
  socket.close();
  for (const request of pending.values()) clearTimeout(request.timeout);
  await fetch(new URL(`/json/close/${target.id}`, debug));
}
