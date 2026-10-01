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
  await pause(400);
}

function assertReadable(state, expectedPaired = false) {
  const active = state.papers.filter((paper) =>
    paper.role === "primary" || paper.role === "companion",
  );
  assert.equal(active.filter((paper) => paper.role === "primary").length, 1);
  if (expectedPaired && state.layout !== 'collapsed')
    assert.equal(active.filter((paper) => paper.role === "companion").length, 1);
  for (const paper of active) {
    assert.equal(paper.resident, "resident", `${paper.title}: missing body`);
    assert.equal(paper.hidden, "false", `${paper.title}: hidden paper`);
    assert.ok(paper.rect.width > 0 && paper.rect.height > 0);
    if (state.layout === "collapsed" && paper.role === "companion") continue;
    assert.ok(paper.projectedFont >= 16,
      `${paper.title}: projected body font ${paper.projectedFont}px`);
    assert.ok(paper.rect.left >= state.scene.left - 2 &&
      paper.rect.right <= state.scene.right + 2,
      `${paper.title}: active reading width escapes the scene`);
  }
}

const readingSnapshot = () => read(`(() => {
  const scene = doc.querySelector('.spatial-scene');
  const highlights = [...(doc.defaultView.CSS.highlights?.entries() ?? [])]
    .filter(([name]) => name.endsWith('-focus'))
    .flatMap(([, highlight]) => [...highlight].map(range => ({
      text: range.toString(),
      surface: range.startContainer.parentElement.closest('[data-paper]')?.dataset.surfaceKey,
      rects: [...range.getClientRects()].map(rect => rect.toJSON()),
    })));
  return {
    layout: scene.dataset.readingLayout,
    scene: scene.getBoundingClientRect().toJSON(),
    focus: doc.querySelector('[data-focused=true]')?.dataset.surfaceKey,
    relation: doc.querySelector('.spatial-relations')?.textContent,
    highlights,
    papers: [...doc.querySelectorAll('[data-paper]')].map(paper => {
      const body = paper.querySelector('.document-content');
      const scroll = paper.querySelector('[data-document-scroll]');
      return {
        id: paper.dataset.surfaceKey, role: paper.dataset.readingRole,
        title: paper.getAttribute('aria-label'), resident: paper.dataset.residency,
        hidden: paper.getAttribute('aria-hidden'),
        rect: paper.getBoundingClientRect().toJSON(),
        scrollRect: scroll?.getBoundingClientRect().toJSON(),
        scrollTop: scroll?.scrollTop,
        projectedFont: body ? parseFloat(doc.defaultView.getComputedStyle(body).fontSize)
          * paper.getBoundingClientRect().width / paper.offsetWidth : 0,
        contextControls: [...paper.querySelectorAll('button')].filter(button =>
          !button.disabled && /继续阅读/.test(button.textContent + button.getAttribute('aria-label'))
          && button.getBoundingClientRect().width > 0).length,
      };
    }),
  };
})()`);

async function settledReading() {
  await waitFor("!!doc.querySelector('.spatial-scene[data-reading-layout]')", "reading layout");
  // The coordinated transition lasts 280ms. Measure only its settled DOM result.
  await pause(400);
  return readingSnapshot();
}

function assertRangeVisible(state, title, quote) {
  const paper = state.papers.find((entry) => entry.title === title);
  assert.ok(paper, `Missing ${title}`);
  const focused = state.highlights.filter((entry) => entry.surface === paper.id);
  assert.equal(focused.map((entry) => entry.text).join('').replaceAll('\n', ''), quote.replaceAll('\n', ''),
    `${title}: exact selected source range changed`);
  const rects = focused.flatMap((entry) => entry.rects).filter((rect) => rect.width > 0);
  assert.ok(rects.length > 0, `${title}: selected range has no visible text rectangles`);
  const viewport = paper.scrollRect;
  assert.ok(viewport, `${title}: missing scrollable body`);
  for (const rect of rects) {
    assert.ok(rect.left >= viewport.left - 2 && rect.right <= viewport.right + 2 &&
      rect.top >= viewport.top - 2 && rect.bottom <= viewport.bottom + 2,
      `${title}: selected range ${JSON.stringify(rect)} clipped by ${JSON.stringify(viewport)}`);
  }
}

async function searchCenter() {
  await click('button[aria-label="搜索文档"]');
  await waitFor("!!doc.querySelector('.search-field')", "search field");
  await read(`(() => {
    const input = doc.querySelector('.search-field');
    Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype, 'value').set.call(input, '为何存在');
    input.dispatchEvent(new doc.defaultView.Event('input', {bubbles: true}));
  })()`);
  await waitFor("[...doc.querySelectorAll('.search-results button')].some(button => button.textContent.includes('/qa/reading/center.md'))", "center result");
  await read("[...doc.querySelectorAll('.search-results button')].find(button => button.textContent.includes('/qa/reading/center.md')).click()");
  await waitFor("doc.querySelector('[data-focused=true]')?.getAttribute('aria-label') === '中心论述'", "center reading");
  await waitFor("doc.querySelector('[data-focused=true] [data-document-scroll]')?.scrollTop > 0", "searched source scroll position");
}

async function followSource() {
  // Three relations share the same cross-line source anchor; choose the actual
  // passage relation rather than assuming random connection IDs sort alike.
  const pointInText = await read(`(() => {
    const paper = doc.querySelector('[data-focused=true]');
    const range = [...doc.defaultView.CSS.highlights.entries()]
      .filter(([name]) => name.endsWith('-focus'))
      .flatMap(([, highlight]) => [...highlight])
      .find(range => paper.contains(range.startContainer));
    const rect = [...range.getClientRects()].find(rect => rect.width > 0);
    return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
  })()`);
  const offset = embedded
    ? await evaluate("document.querySelector('iframe').getBoundingClientRect().toJSON()")
    : {x: 0, y: 0};
  await mouse('mousePressed', pointInText.x + offset.x, pointInText.y + offset.y);
  await mouse('mouseReleased', pointInText.x + offset.x, pointInText.y + offset.y);
  await waitFor("[...doc.querySelectorAll('.passage-choice-items button')].some(button => button.textContent.includes('原始材料支撑中心论述'))", 'shared-range relation choices');
  await read("[...doc.querySelectorAll('.passage-choice-items button')].find(button => button.textContent.includes('原始材料支撑中心论述')).click()");
  await waitFor("doc.querySelector('[data-focused=true]')?.getAttribute('aria-label') === '原始材料'", 'relation to source');
  return settledReading();
}

async function followNext(title) {
  await click('button[aria-label="下一个关联"]');
  await waitFor(`doc.querySelector('[data-focused=true]')?.getAttribute('aria-label') === ${JSON.stringify(title)}`, `relation to ${title}`);
  return settledReading();
}

function assertRestored(actual, expected, title) {
  assert.equal(actual.focus, expected.focus, `${title}: focus was not restored`);
  assert.equal(actual.relation, expected.relation, `${title}: selected relation was not restored`);
  const before = expected.papers.find((paper) => paper.id === expected.focus);
  const after = actual.papers.find((paper) => paper.id === actual.focus);
  assert.ok(Math.abs(after.scrollTop - before.scrollTop) <= 2,
    `${title}: scroll ${before.scrollTop} was restored as ${after.scrollTop}`);
  assert.deepEqual(actual.highlights.filter((entry) => entry.surface === actual.focus).map(({text}) => text),
    expected.highlights.filter((entry) => entry.surface === expected.focus).map(({text}) => text),
    `${title}: source range was not restored`);
}

async function readingJourney(mode, width, height) {
  await open(mode, width, height);
  await searchCenter();
  const initial = await settledReading();
  assertReadable(initial);
  const initialPaper = initial.papers.find((paper) => paper.id === initial.focus);
  assert.ok(initialPaper.scrollTop > 0, 'Fixture must exercise nonzero scroll restoration');
  const paired = await followSource();
  assertReadable(paired, true);
  if (paired.layout === 'collapsed') {
    const companion = paired.papers.find((paper) => paper.title === '中心论述' && paper.role === 'context');
    assert.ok(companion.contextControls > 0 && companion.rect.height >= 20,
      'Collapsed companion must remain an identifiable, operable context');
  } else {
    assertRangeVisible(paired, '原始材料', '读者先确认来处');
    assertRangeVisible(paired, '中心论述', '为何存在，\n然后才能决定');
  }
  await capture(`${mode}-${width}x${height}-relation`);
  const continued = await followNext('进一步说明');
  assertReadable(continued, true);
  if (continued.layout !== 'collapsed') {
    assertRangeVisible(continued, '进一步说明', '先回到原始材料');
    assertRangeVisible(continued, '原始材料', '雨停之后，纸页边缘仍然潮湿');
  }
  if (height > 360) {
    const trail = continued.papers.find((paper) => paper.title === '中心论述');
    assert.ok(trail && trail.role === 'context' && trail.hidden === 'false' &&
      trail.rect.width > 0 && trail.rect.height > 0 &&
      trail.rect.bottom > continued.scene.top && trail.rect.top < continued.scene.bottom,
      'Earlier A must remain identifiable in the visible trail');
  }
  await capture(`${mode}-${width}x${height}-continued`);
  await click('button[aria-label="返回上一个阅读上下文"]');
  await waitFor("doc.querySelector('[data-focused=true]')?.getAttribute('aria-label') === '原始材料'", 'restored B');
  assertRestored(await settledReading(), paired, 'B');
  await click('button[aria-label="返回上一个阅读上下文"]');
  await waitFor("doc.querySelector('[data-focused=true]')?.getAttribute('aria-label') === '中心论述'", 'restored A');
  const restored = await settledReading();
  assertReadable(restored);
  assertRestored(restored, initial, 'A');
  await capture(`${mode}-${width}x${height}-restored`);
  if (paired.layout === 'collapsed') {
    await followSource();
    await read("[...[...doc.querySelectorAll('[data-reading-role=context]')].find(paper => paper.getAttribute('aria-label') === '中心论述').querySelectorAll('button')].find(button => /继续阅读/.test(button.textContent + button.getAttribute('aria-label'))).click()");
    await waitFor("doc.querySelector('[data-reading-role=primary]')?.getAttribute('aria-label') === '中心论述'", 'collapsed endpoint exchange');
    assertReadable(await settledReading(), true);
  }
  const readable = [initial, paired, continued, restored].flatMap(state => state.papers.filter(paper => paper.role === 'primary' || (paper.role === 'companion' && state.layout !== 'collapsed')));
  console.log(`${mode} ${width}x${height}: A → B → C → A restores range, scroll and relation; layout ${paired.layout}; minimum projected font ${Math.min(...readable.map(paper => paper.projectedFont)).toFixed(2)}px`);
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
    assertReadable(await settledReading(), true);
    await capture(`${mode}-comparison`);
    console.log(`${mode}: selection dismissal preserves focus and camera; relation content remains readable`);
  }
  const fixtureResponse = await fetch(new URL('/__qa-api', origin), {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name: '__reading_fixture'}),
  });
  if (!fixtureResponse.ok) throw new Error(`Reading fixture seed failed: ${await fixtureResponse.text()}`);
  for (const mode of ['website', 'app']) {
    for (const [width, height] of mode === 'website'
      ? [[1440, 1000], [390, 844], [900, 360], [390, 250]]
      : [[1440, 1000], [390, 844], [900, 360]])
      await readingJourney(mode, width, height);
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
    JSON.stringify({ state, reading: await readingSnapshot().catch(() => null), errors }, null, 2),
  );
  console.error(`Browser evidence: ${evidence}`);
  throw error;
} finally {
  socket.close();
  for (const request of pending.values()) clearTimeout(request.timeout);
  await fetch(new URL(`/json/close/${target.id}`, debug));
}
