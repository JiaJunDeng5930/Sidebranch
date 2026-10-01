import {
  ReaderContextSchema,
  readerContextKey,
  readerContextText,
  type ReaderContext,
} from "../lib/client/reader-context";

interface ModelContext {
  getCurrent():
    | { updateId: string; structuredContent?: Record<string, unknown> }
    | null
    | undefined;
  update(params: {
    content: { type: "text"; text: string }[];
    structuredContent?: Record<string, unknown>;
  }): Promise<{ updateId: string } | undefined>;
}

export function createReaderContextBridge(options: {
  getModelContext: () => ModelContext | undefined;
  supportsStructuredContent: () => boolean;
  onRestore: (context: ReaderContext | null) => void;
}) {
  let latestKey: string | null = null;
  let pending: ReaderContext | undefined;
  let sending: ReaderContext | undefined;
  let running: Promise<void> | undefined;
  const ownUpdateIds = new Set<string>();

  async function drain(): Promise<void> {
    let failure: unknown;
    while (pending) {
      const context = pending;
      pending = undefined;
      const modelContext = options.getModelContext();
      if (!modelContext) return;
      sending = context;
      try {
        const result = await modelContext.update({
          content: [{ type: "text", text: readerContextText(context) }],
          ...(options.supportsStructuredContent()
            ? { structuredContent: context }
            : {}),
        });
        failure = undefined;
        if (result) {
          ownUpdateIds.add(result.updateId);
          if (ownUpdateIds.size > 32)
            ownUpdateIds.delete(ownUpdateIds.values().next().value!);
        }
      } catch (error) {
        failure = error;
      } finally {
        sending = undefined;
      }
    }
    if (failure) throw failure;
  }

  return {
    publish(context: ReaderContext): Promise<void> {
      if (!options.getModelContext()) return Promise.resolve();
      const key = readerContextKey(context);
      if (key === latestKey) return running ?? Promise.resolve();
      latestKey = key;
      pending = context;
      if (!running)
        running = drain().finally(() => {
          running = undefined;
        });
      return running;
    },
    syncFromHost(): void {
      const current = options.getModelContext()?.getCurrent();
      if (current === undefined) return;
      if (current === null) {
        if (latestKey === "cleared") return;
        latestKey = "cleared";
        pending = undefined;
        options.onRestore(null);
        return;
      }
      if (ownUpdateIds.has(current.updateId)) return;
      const parsed = ReaderContextSchema.safeParse(current.structuredContent);
      if (!parsed.success) return;
      const key = readerContextKey(parsed.data);
      if (key === latestKey || (sending && key === readerContextKey(sending)))
        return;
      latestKey = key;
      pending = undefined;
      options.onRestore(parsed.data);
    },
  };
}
