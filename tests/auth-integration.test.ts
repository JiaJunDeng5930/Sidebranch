import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { handleMcp, APP_RESOURCE_URI } from "../lib/server/mcp-server";
import { DocumentStore } from "../lib/server/document-store";
import { authorizeIdentity, READ_SCOPE } from "../lib/server/owner-auth";
import { commandSchemas } from "../lib/domain/commands";
import type { RuntimeEnv } from "../lib/server/env";
import {
  DEFAULT_FILE_DOWNLOAD_ORIGIN,
  MAX_IMPORT_BYTES,
  normalizeImportFileInput,
} from "../lib/server/file-reference";
import { DomainError } from "../lib/domain/model";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");

type Fixture = {
  mf: { dispose: () => Promise<void> };
  env: RuntimeEnv;
  owner: Awaited<ReturnType<typeof authorizeIdentity>>;
  store: DocumentStore;
};
type JsonSchema = {
  type?: string;
  enum?: string[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  [key: string]: unknown;
};
type ToolDescriptor = {
  name?: string;
  outputSchema?: JsonSchema;
  inputSchema?: JsonSchema;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};
type StructuredContent = {
  status?: string;
  documents?: unknown[];
  view?: {
    document?: { id?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};
type McpResult = {
  tools?: ToolDescriptor[];
  structuredContent?: StructuredContent;
  isError?: boolean;
  content?: Array<{ text?: string }>;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
};
type McpResponse = { result?: McpResult; [key: string]: unknown };

let fixture: Fixture;

async function migrationPath(name: string): Promise<string> {
  for (const path of [`drizzle/${name}`, `../service/drizzle/${name}`]) {
    try {
      await access(path);
      return path;
    } catch {
      // The service migration is copied into the root checkout during merge;
      // the sibling fallback keeps this staging test runnable before that.
    }
  }
  throw new Error(`Missing migration ${name}`);
}

async function applyMigrations(DB: D1Database): Promise<void> {
  for (const name of [
    "0000_curvy_human_torch.sql",
    "0001_service_query_indexes.sql",
    "0002_oauth_scopes.sql",
  ]) {
    const sql = await readFile(await migrationPath(name), "utf8");
    for (const statement of sql.split("--> statement-breakpoint"))
      if (statement.trim()) await DB.prepare(statement).run();
  }
}

async function makeFixture(): Promise<Fixture> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    d1Databases: ["DB"],
    r2Buckets: ["BUCKET"],
    compatibilityDate: "2026-05-15",
  }) as Fixture["mf"];
  const env: RuntimeEnv = {
    DB: await (mf as typeof Miniflare.prototype).getD1Database("DB"),
    BUCKET: await (mf as typeof Miniflare.prototype).getR2Bucket("BUCKET"),
    SITE_ORIGIN: "https://sidebranch.test",
    OWNER_BOOTSTRAP_EMAIL: "owner@example.test",
  };
  await applyMigrations(env.DB);
  const owner = await authorizeIdentity(env, {
    userId: "owner-id",
    email: "owner@example.test",
  });
  return { mf, env, owner, store: new DocumentStore(env, owner) };
}

beforeEach(async () => {
  fixture = await makeFixture();
});

afterEach(async () => {
  await fixture.mf.dispose();
});

async function callMcp(
  store: DocumentStore,
  env: RuntimeEnv,
  method: string,
  params: Record<string, unknown>,
  getStore: () => Promise<DocumentStore> = async () => store,
): Promise<McpResponse> {
  const body = { jsonrpc: "2.0", id: 1, method, params };
  const response = await handleMcp(
    new Request(env.SITE_ORIGIN + "/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    }),
    env,
    "<!doctype html><p>auth integration test resource</p>",
    getStore,
  );
  assert.equal(response.status, 200);
  return (await response.json()) as McpResponse;
}

test("MCP tools expose output schemas and the exact empty/ready union", async () => {
  const list = await callMcp(fixture.store, fixture.env, "tools/list", {});
  const tools = list.result?.tools ?? [];
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    [...Object.keys(commandSchemas), "open_reader"].sort(),
  );
  for (const tool of tools) {
    assert.equal(tool.outputSchema?.type, "object", tool.name);
  }
  const open = tools.find((tool) => tool.name === "open_document");
  assert.deepEqual(open?.outputSchema?.properties?.status?.enum, [
    "empty",
    "ready",
  ]);
  assert.deepEqual(open?.outputSchema?.required, ["status"]);
  const importTool = tools.find((tool) => tool.name === "import_file");
  assert.deepEqual(importTool?._meta?.["openai/fileParams"], ["file"]);

  const empty = await callMcp(fixture.store, fixture.env, "tools/call", {
    name: "open_document",
    arguments: {},
  });
  assert.deepEqual(empty.result?.structuredContent, { status: "empty" });
  assert.equal(empty.result?.isError, undefined);

  const document = (
    await fixture.store.execute("write", {
      path: "/auth/ready.md",
      title: "Ready",
      content: "A ready document.",
      format: "markdown",
    })
  ).document;
  const ready = await callMcp(fixture.store, fixture.env, "tools/call", {
    name: "open_document",
    arguments: { documentId: document.id },
  });
  assert.equal(ready.result?.structuredContent?.status, "ready");
  assert.equal(
    ready.result?.structuredContent?.view?.document?.id,
    document.id,
  );
  assert.equal(
    Object.hasOwn(ready.result?.structuredContent?.view ?? {}, "documents"),
    false,
  );
});

test("a read-only Owner cannot invoke a write MCP tool", async () => {
  const readOnlyOwner = { ...fixture.owner, scopes: [READ_SCOPE] };
  const readOnlyStore = new DocumentStore(fixture.env, readOnlyOwner);
  const denied = await callMcp(readOnlyStore, fixture.env, "tools/call", {
    name: "write",
    arguments: {
      path: "/auth/denied.md",
      title: "Denied",
      content: "must not write",
      format: "markdown",
    },
  });
  assert.equal(denied.result?.isError, true);
  assert.match(String(denied.result?.content?.[0]?.text), /INSUFFICIENT_SCOPE/);
  assert.equal(denied.result?._meta?.["mcp/www_authenticate"], undefined);
  const read = await callMcp(readOnlyStore, fixture.env, "tools/call", {
    name: "ls",
    arguments: {},
  });
  assert.equal(read.result?.isError, undefined);
  assert.ok(Array.isArray(read.result?.structuredContent?.documents));
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function withFetch<T>(
  implementation: typeof fetch,
  operation: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    return await operation();
  } finally {
    globalThis.fetch = original;
  }
}

function fileInput(downloadUrl: string) {
  return {
    path: "/imports/from-chatgpt.txt",
    file: {
      file_id: "file_test_123",
      download_url: downloadUrl,
      file_name: "from-chatgpt.txt",
      mime_type: "text/plain",
    },
  };
}

test("file reference accepts the current official host and a configured exact host", async () => {
  const seen: string[] = [];
  const official = await withFetch(
    async (input) => {
      seen.push(requestUrl(input));
      const body = "来自 ChatGPT 文件";
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
          "Content-Length": String(new TextEncoder().encode(body).byteLength),
        },
      });
    },
    () =>
      normalizeImportFileInput(
        fileInput(DEFAULT_FILE_DOWNLOAD_ORIGIN + "/file_test_123"),
        fixture.env,
      ),
  );
  assert.deepEqual(seen, [DEFAULT_FILE_DOWNLOAD_ORIGIN + "/file_test_123"]);
  assert.equal(official.mime, "text/plain");
  assert.equal(official.title, "from-chatgpt");
  assert.equal(
    official.base64,
    Buffer.from("来自 ChatGPT 文件").toString("base64"),
  );

  const configuredEnv = {
    ...fixture.env,
    MCP_FILE_DOWNLOAD_ORIGINS: "https://signed.example",
  };
  const configured = await withFetch(
    async () =>
      new Response("configured", { headers: { "Content-Type": "text/plain" } }),
    () =>
      normalizeImportFileInput(
        fileInput("https://signed.example/file_test_123"),
        configuredEnv,
      ),
  );
  assert.equal(configured.base64, Buffer.from("configured").toString("base64"));
  await assert.rejects(
    () =>
      normalizeImportFileInput(fileInput("https://127.0.0.1/private.txt"), {
        ...configuredEnv,
        MCP_FILE_DOWNLOAD_ORIGINS: "https://127.0.0.1",
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "FILE_URL_DENIED",
  );
});

test("file reference rejects unapproved URLs, unsafe redirects and oversized responses", async () => {
  for (const url of [
    "https://evil.example/file.txt",
    "http://files.oaiusercontent.com/file.txt",
    "https://127.0.0.1/file.txt",
  ]) {
    await assert.rejects(
      () => normalizeImportFileInput(fileInput(url), fixture.env),
      (error: unknown) =>
        error instanceof DomainError && error.code === "FILE_URL_DENIED",
    );
  }

  let calls = 0;
  await assert.rejects(
    () =>
      withFetch(
        async () => {
          calls += 1;
          return new Response(null, {
            status: 302,
            headers: { Location: "https://evil.example/file.txt" },
          });
        },
        () =>
          normalizeImportFileInput(
            fileInput(DEFAULT_FILE_DOWNLOAD_ORIGIN + "/redirect"),
            fixture.env,
          ),
      ),
    (error: unknown) =>
      error instanceof DomainError && error.code === "FILE_URL_DENIED",
  );
  assert.equal(calls, 1);

  await assert.rejects(
    () =>
      withFetch(
        async () =>
          new Response(null, {
            status: 302,
            headers: { Location: DEFAULT_FILE_DOWNLOAD_ORIGIN + "/loop" },
          }),
        () =>
          normalizeImportFileInput(
            fileInput(DEFAULT_FILE_DOWNLOAD_ORIGIN + "/loop"),
            fixture.env,
          ),
      ),
    (error: unknown) =>
      error instanceof DomainError && error.code === "FILE_REDIRECT_LIMIT",
  );

  await assert.rejects(
    () =>
      withFetch(
        async () =>
          new Response("x", {
            status: 200,
            headers: {
              "Content-Type": "text/plain",
              "Content-Length": String(MAX_IMPORT_BYTES + 1),
            },
          }),
        () =>
          normalizeImportFileInput(
            fileInput(DEFAULT_FILE_DOWNLOAD_ORIGIN + "/too-large"),
            fixture.env,
          ),
      ),
    (error: unknown) =>
      error instanceof DomainError && error.code === "FILE_TOO_LARGE",
  );
});

test("public MCP discovery and UI resources never resolve document access", async () => {
  let resolutions = 0;
  const unavailable = async (): Promise<DocumentStore> => {
    resolutions++;
    throw new DomainError("AUTH_REQUIRED", "Missing platform identity", 401);
  };
  const privateDocument = await fixture.store.execute("write", {
    path: "/auth/private.md",
    title: "Private owner title",
    content: "private-owner-content",
  });
  for (const [method, params] of [
    [
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "discovery", version: "1" },
      },
    ],
    ["tools/list", {}],
    ["resources/list", {}],
    ["resources/read", { uri: APP_RESOURCE_URI }],
  ] as const) {
    const response = await callMcp(
      fixture.store,
      fixture.env,
      method,
      params,
      unavailable,
    );
    assert.ok(response.result, method);
    const serialized = JSON.stringify(response);
    assert.equal(
      serialized.includes(privateDocument.document.id),
      false,
      method,
    );
    assert.equal(serialized.includes("private-owner-content"), false, method);
    assert.equal(serialized.includes("Private owner title"), false, method);
    if (method === "resources/read") {
      const contents = response.result.contents as Array<{
        text: string;
        _meta: Record<string, unknown>;
      }>;
      assert.match(contents[0].text, /auth integration test resource/);
      assert.deepEqual(contents[0]._meta["openai/ui"], {
        preferredDisplayMode: "fullscreen",
        availableDisplayModes: ["inline", "fullscreen"],
      });
    }
  }
  assert.equal(resolutions, 0);
});

test("open_reader exposes both ChatGPT entrypoints and authorizes its empty input", async () => {
  const tools =
    (await callMcp(fixture.store, fixture.env, "tools/list", {})).result
      ?.tools ?? [];
  const reader = tools.find((tool) => tool.name === "open_reader");
  assert.ok(reader);
  assert.equal(reader.inputSchema?.type, "object");
  assert.deepEqual(reader.inputSchema?.properties, {});
  assert.deepEqual(reader._meta?.["openai/ui"], {
    entrypoints: [{ type: "global" }, { type: "thread" }],
  });
  assert.equal(
    (reader._meta?.ui as { resourceUri?: string })?.resourceUri,
    APP_RESOURCE_URI,
  );
  assert.equal(reader.annotations?.readOnlyHint, true);
  assert.equal(reader.annotations?.destructiveHint, false);
  assert.equal(reader._meta?.securitySchemes, undefined);
  let resolutions = 0;
  const opened = await callMcp(
    fixture.store,
    fixture.env,
    "tools/call",
    { name: "open_reader", arguments: {} },
    async () => {
      resolutions++;
      return fixture.store;
    },
  );
  assert.equal(resolutions, 1);
  assert.equal(opened.result?.isError, undefined);
  assert.deepEqual(opened.result?.structuredContent, { entrypoint: "reader" });
});

test("all data entrypoints fail closed without an authorized platform Owner", async () => {
  for (const identity of [
    null,
    { userId: "other-user", email: "owner@example.test" },
  ]) {
    for (const name of ["open_reader", "ls", "write"]) {
      const arguments_ =
        name === "write"
          ? {
              path: "/auth/forbidden.md",
              title: "Forbidden",
              content: "must not exist",
            }
          : {};
      const response = await callMcp(
        fixture.store,
        fixture.env,
        "tools/call",
        { name, arguments: arguments_ },
        async () =>
          new DocumentStore(
            fixture.env,
            await authorizeIdentity(fixture.env, identity),
          ),
      );
      assert.equal(response.result?.isError, true, name);
      assert.match(
        String(response.result?.content?.[0]?.text),
        identity ? /OWNER_ONLY/ : /AUTH_REQUIRED/,
      );
      assert.equal(response.result?._meta?.["mcp/www_authenticate"], undefined);
    }
  }
  assert.equal((await fixture.store.execute("ls", {})).documents.length, 0);
  const write = await callMcp(
    fixture.store,
    fixture.env,
    "tools/call",
    {
      name: "write",
      arguments: {
        path: "/auth/allowed.md",
        title: "Allowed",
        content: "owner document",
      },
    },
    async () =>
      new DocumentStore(
        fixture.env,
        await authorizeIdentity(fixture.env, {
          userId: "owner-id",
          email: "changed@example.test",
        }),
      ),
  );
  assert.equal(write.result?.isError, undefined);
  const read = await callMcp(fixture.store, fixture.env, "tools/call", {
    name: "ls",
    arguments: {},
  });
  assert.equal(read.result?.structuredContent?.documents?.length, 1);
});

test("first-owner bootstrap atomically pins one platform identity", async () => {
  await fixture.env.DB.prepare("DELETE FROM owner").run();
  const attempts = await Promise.allSettled([
    authorizeIdentity(fixture.env, {
      userId: "bootstrap-a",
      email: "owner@example.test",
    }),
    authorizeIdentity(fixture.env, {
      userId: "bootstrap-b",
      email: "owner@example.test",
    }),
  ]);
  assert.equal(
    attempts.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const bound = await fixture.env.DB.prepare(
    "SELECT user_id FROM owner WHERE singleton=1",
  ).first<{ user_id: string }>();
  assert.ok(bound);
  const winner = attempts.find((result) => result.status === "fulfilled");
  assert.equal(
    winner?.status === "fulfilled" ? winner.value.userId : null,
    bound.user_id,
  );
  const loser = attempts.find((result) => result.status === "rejected");
  assert.ok(
    loser?.status === "rejected" && loser.reason instanceof DomainError,
  );
  assert.equal(loser.reason.code, "OWNER_ONLY");
});
