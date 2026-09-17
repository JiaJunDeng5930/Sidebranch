"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  MoreHorizontal,
  X,
  ArrowUpRight,
  ArrowLeft,
  Expand,
  Link2,
  FileText,
  Upload,
  History,
  Archive,
  PenLine,
  Check,
  Copy,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { Passage } from "./passage";
import { ConnectionLines } from "./connection-lines";
import { registerReadingTools } from "../../lib/client/webmcp";
import type { ReaderClient } from "../../lib/client/reader-client";
import { questionPrompt } from "../../lib/client/reader-client";
import {
  Path,
  RevisionId,
  type DocumentSummary,
  type DocumentRevision,
  type ReadingView,
  type AnchorInput,
  type Connection,
  type Question,
  type DocumentId,
} from "../../lib/domain/model";
import type { CommandResults } from "../../lib/domain/commands";
import "./reader.css";
type Selection = {
  anchor: AnchorInput;
  document: DocumentRevision;
  x: number;
  y: number;
};
type DialogState =
  | { kind: "closed" }
  | { kind: "search" }
  | { kind: "create" }
  | { kind: "edit"; document: DocumentRevision }
  | { kind: "history"; document: DocumentRevision }
  | { kind: "settings" }
  | { kind: "rename"; document: DocumentRevision };
const relationNames: Record<Connection["relation"], string> = {
  reference: "引用",
  explanation: "解释",
  question: "提问",
  contrast: "对照",
  continuation: "延伸",
};
function IconAction({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="icon-action"
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
export function Reader({
  client,
  initialView,
  onReady,
}: {
  client: ReaderClient;
  initialView?: ReadingView | null;
  onReady?: (open: (view: ReadingView) => void) => void;
}) {
  const [documents, setDocuments] = useState<DocumentSummary[]>(
      initialView?.documents ?? [],
    ),
    [view, setView] = useState<ReadingView | null>(initialView ?? null),
    [comparison, setComparison] = useState<DocumentRevision | null>(null),
    [focus, setFocus] = useState<AnchorInput | null>(null),
    [comparisonFocus, setComparisonFocus] = useState<AnchorInput | null>(null),
    [activeLink, setActiveLink] = useState<Connection | null>(null),
    [sidebar, setSidebar] = useState(
      typeof window === "undefined" || window.innerWidth >= 760,
    ),
    [dialog, setDialog] = useState<DialogState>({ kind: "closed" }),
    [selection, setSelection] = useState<Selection | null>(null),
    [question, setQuestion] = useState(""),
    [savedQuestion, setSavedQuestion] = useState<Question | null>(null),
    [linkStart, setLinkStart] = useState<Selection | null>(null),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(!initialView),
    [showArchived, setShowArchived] = useState(false),
    [query, setQuery] = useState(""),
    [matches, setMatches] = useState<
      { document: DocumentSummary; excerpt: string }[]
    >([]),
    [history, setHistory] = useState<Omit<DocumentRevision, "content">[]>([]),
    [path, setPath] = useState(""),
    [title, setTitle] = useState(""),
    [content, setContent] = useState("");
  const fileInput = useRef<HTMLInputElement>(null),
    openSequence = useRef(0),
    comparisonSequence = useRef(0),
    searchSequence = useRef(0);
  const applyView = useCallback((next: ReadingView) => {
    setView(next);
    setDocuments(next.documents);
    setComparison(null);
    setActiveLink(null);
    setFocus(null);
    setComparisonFocus(null);
    setSelection(null);
    setSavedQuestion(null);
    setLoading(false);
  }, []);
  useEffect(() => {
    onReady?.((next) => {
      ++openSequence.current;
      applyView(next);
    });
  }, [onReady, applyView]);
  useEffect(
    () =>
      client.mode === "website"
        ? registerReadingTools(client, applyView)
        : undefined,
    [client, applyView],
  );
  async function reloadList(archived = showArchived) {
    const all: DocumentSummary[] = [];
    let offset: number | null = 0;
    do {
      const result: CommandResults["ls"] = await client.invoke("ls", {
        limit: 200,
        offset: offset ?? 0,
        archived,
      });
      all.push(...result.documents);
      offset = result.nextOffset;
    } while (offset !== null && all.length < 5000);
    setDocuments(all);
    return all;
  }
  async function openDoc(
    doc?: { id: DocumentId; revisionId?: DocumentRevision["revisionId"] },
    anchor?: AnchorInput,
  ) {
    const seq = ++openSequence.current;
    setLoading(true);
    setError("");
    try {
      const next = await client.invoke(
        "open_document",
        doc ? { documentId: doc.id, revisionId: doc.revisionId } : {},
      );
      if (seq !== openSequence.current) return;
      applyView(next);
      if (anchor) setFocus(anchor);
      if (client.mode === "website") {
        historyReplace(next.document.id, next.document.revisionId);
        localStorage.setItem("xanadu-current-document", next.document.id);
      }
      setShowArchived(false);
      if (window.innerWidth < 760) setSidebar(false);
    } catch (e) {
      if (seq === openSequence.current) {
        setError(message(e));
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    if (initialView) return;
    let alive = true;
    (async () => {
      try {
        const list = await client.invoke("ls", { limit: 200 });
        if (!alive) return;
        setDocuments(list.documents);
        if (list.documents.length) {
          const params = new URLSearchParams(window.location.search),
            desired =
              params.get("document") ??
              (client.mode === "website"
                ? localStorage.getItem("xanadu-current-document")
                : null),
            doc =
              list.documents.find((d) => d.id === desired) ?? list.documents[0];
          const revision = RevisionId.safeParse(params.get("revision"));
          if (openSequence.current === 0)
            await openDoc({
              id: doc.id,
              revisionId:
                desired === doc.id && revision.success
                  ? revision.data
                  : undefined,
            });
        } else setLoading(false);
      } catch (e) {
        if (alive) {
          setError(message(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [client]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setDialog({ kind: "search" });
      }
      if (e.key === "Escape") {
        setSelection(null);
        setLinkStart(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (dialog.kind !== "search") return;
    const seq = ++searchSequence.current;
    const timer = setTimeout(async () => {
      try {
        if (query.trim()) {
          const result = await client.invoke("grep", { query, limit: 50 });
          if (seq === searchSequence.current) setMatches(result.matches);
        } else
          setMatches(documents.map((document) => ({ document, excerpt: "" })));
      } catch (e) {
        if (seq === searchSequence.current) setError(message(e));
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, dialog.kind, client, documents]);
  useEffect(() => {
    if (dialog.kind === "edit") {
      setContent(dialog.document.content);
    }
    if (dialog.kind === "create") {
      setPath("/notes/");
      setTitle("");
      setContent("");
    }
    if (dialog.kind === "rename") setPath(dialog.document.path);
    if (dialog.kind === "history") {
      client
        .invoke("history", { documentId: dialog.document.id, limit: 100 })
        .then((r) => setHistory(r.revisions))
        .catch((e) => setError(message(e)));
    }
  }, [dialog, client]);
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function showConnection(c: Connection) {
    if (!view) return;
    const seq = ++comparisonSequence.current;
    const from = c.from.documentId === view.document.id ? c.from : c.to,
      to = from === c.from ? c.to : c.from;
    try {
      const [a, b] = await Promise.all([
        client.invoke("cat", {
          documentId: from.documentId,
          revisionId: from.revisionId,
        }),
        client.invoke("cat", {
          documentId: to.documentId,
          revisionId: to.revisionId,
        }),
      ]);
      if (seq !== comparisonSequence.current) return;
      setView((v) => (v ? { ...v, document: a.document } : v));
      setFocus(from);
      setComparison(b.document);
      setComparisonFocus(to);
      setActiveLink(c);
      setSelection(null);
    } catch (e) {
      setError(message(e));
    }
  }
  function select(anchor: AnchorInput, doc: DocumentRevision, rect: DOMRect) {
    setSelection({
      anchor,
      document: doc,
      x: Math.min(Math.max(rect.left, 20), window.innerWidth - 370),
      y: Math.min(rect.bottom + 10, window.innerHeight - 245),
    });
    setQuestion("");
    setSavedQuestion(null);
  }
  async function ask() {
    if (!selection || !question.trim()) return;
    const selected = selection;
    await action(async () => {
      const q =
        savedQuestion ??
        (
          await client.invoke("ask", {
            anchor: selected.anchor,
            body: question,
          })
        ).question;
      setSavedQuestion(q);
      if (client.sendQuestion) {
        await client.sendQuestion(q);
        setStatus("问题已发送到当前对话。");
        setSelection(null);
      } else {
        await navigator.clipboard.writeText(questionPrompt(q));
        setStatus(
          "问题已保存，提问内容已复制。粘贴到已连接 Sidebranch 的 ChatGPT 对话即可。",
        );
        setSelection(null);
      }
      if (view) {
        const qs = await client.invoke("questions", {
          documentId: view.document.id,
        });
        setView((v) => (v ? { ...v, questions: qs.questions } : v));
      }
    });
  }
  async function createConnection() {
    if (!selection || !linkStart) return;
    await action(async () => {
      const c = (
        await client.invoke("link", {
          from: linkStart.anchor,
          to: selection.anchor,
          relation: "reference",
        })
      ).connection;
      setLinkStart(null);
      setSelection(null);
      if (view) {
        const next = await client.invoke("open_document", {
          documentId: view.document.id,
        });
        setView(next);
        await showConnection(c);
      }
      setStatus("连接已建立。");
    });
  }
  async function upload(files: FileList | null) {
    if (!files) return;
    await action(async () => {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024)
          throw new Error("单个文件上限为 10 MiB。");
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (!["txt", "md", "markdown", "pdf"].includes(ext ?? ""))
          throw new Error("请选择 TXT、Markdown 或 PDF 文件。");
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const result = await client.invoke("import_file", {
          path: Path.parse(
            "/imports/" + file.name.replace(/[\\/\x00-\x1f]/g, "_"),
          ),
          mime:
            ext === "pdf"
              ? "application/pdf"
              : ext === "txt"
                ? "text/plain"
                : "text/markdown",
          base64: btoa(binary),
        });
        await openDoc({ id: result.document.id });
      }
      await reloadList(false);
      setShowArchived(false);
      setStatus("文件已导入。");
    });
    if (fileInput.current) fileInput.current.value = "";
  }
  function documentMenu(doc: DocumentRevision) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="icon-action" aria-label="文档操作">
            <MoreHorizontal size={19} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => setDialog({ kind: "edit", document: doc })}
            disabled={!doc.isCurrent}
          >
            <PenLine size={16} />
            编辑原文
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setDialog({ kind: "history", document: doc })}
          >
            <History size={16} />
            版本历史
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setDialog({ kind: "rename", document: doc })}
          >
            移动 / 重命名
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              const blob = new Blob([doc.content], {
                type: "text/plain;charset=utf-8",
              });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = doc.path.split("/").pop() ?? "document.md";
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }}
          >
            下载当前文本
          </DropdownMenuItem>
          {doc.assetId && client.mode === "website" && (
            <DropdownMenuItem asChild>
              <a href={`/api/assets/${doc.assetId}`}>下载导入文件</a>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              action(async () => {
                await client.invoke("archive", {
                  documentId: doc.id,
                  archived: !doc.archived,
                });
                await reloadList();
                setView(null);
                setComparison(null);
                setStatus(doc.archived ? "文档已恢复。" : "文档已移入归档。");
              })
            }
          >
            <Archive size={16} />
            {doc.archived ? "恢复文档" : "归档文档"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  function paper(doc: DocumentRevision, secondary = false) {
    return (
      <section
        className={`paper ${secondary ? "comparison-paper" : ""}`}
        key={doc.revisionId}
      >
        <div className="paper-toolbar">
          <span className="document-path" title={doc.path}>
            {doc.path}
          </span>
          <span className="revision-label">v{doc.sequence}</span>
          {secondary ? (
            <IconAction
              label="关闭并排文档"
              onClick={() => {
                setComparison(null);
                setActiveLink(null);
              }}
            >
              <X size={17} />
            </IconAction>
          ) : (
            documentMenu(doc)
          )}
        </div>
        {!doc.isCurrent && (
          <div className="historical-notice">
            连接指向保留的历史版本。
            <button
              onClick={() =>
                secondary
                  ? action(async () =>
                      setComparison(
                        (await client.invoke("cat", { documentId: doc.id }))
                          .document,
                      ),
                    )
                  : openDoc({ id: doc.id })
              }
            >
              查看最新版
            </button>
          </div>
        )}
        <div className="paper-inner">
          <div className="document-byline">
            {secondary ? "CONNECTED DOCUMENT" : "CURRENT DOCUMENT"}
            <span>{new Date(doc.updatedAt).toLocaleDateString("zh-CN")}</span>
          </div>
          <h1>{doc.title}</h1>
          <Passage
            doc={doc}
            focus={secondary ? comparisonFocus : focus}
            onSelect={(a, r) => select(a, doc, r)}
          />
          {secondary && (
            <button
              className="make-current"
              onClick={() =>
                openDoc(
                  { id: doc.id, revisionId: doc.revisionId },
                  comparisonFocus ?? undefined,
                )
              }
            >
              设为当前文档 <ArrowUpRight size={16} />
            </button>
          )}
        </div>
      </section>
    );
  }
  return (
    <TooltipProvider>
      <main
        className={`reader ${client.mode === "app" ? "embedded" : ""} ${sidebar ? "with-sidebar" : ""}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void upload(e.dataTransfer.files);
        }}
      >
        <header className="reader-header">
          <a
            className="reader-wordmark"
            href={client.mode === "website" ? "/" : "#"}
            onClick={(e) => client.mode === "app" && e.preventDefault()}
          >
            Xanadu<span>Sidebranch</span>
          </a>
          <div className="workspace-identity">
            个人文档空间<span>/</span>
            {documents.length} 份文档
          </div>
          <div className="header-actions">
            <button
              className="search-trigger"
              onClick={() => setDialog({ kind: "search" })}
            >
              <Search size={16} />
              <span>查找文档</span>
              <kbd>⌘ K</kbd>
            </button>
            {client.fullscreen && (
              <IconAction
                label="展开阅读空间"
                onClick={() => void client.fullscreen?.()}
              >
                <Expand size={18} />
              </IconAction>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="avatar" aria-label="空间设置">
                  A
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setDialog({ kind: "settings" })}
                >
                  连接 ChatGPT
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setShowArchived(!showArchived);
                    void reloadList(!showArchived);
                  }}
                >
                  {showArchived ? "全部文档" : "已归档文档"}
                </DropdownMenuItem>
                {client.mode === "website" && (
                  <DropdownMenuItem asChild>
                    <a href="/signout-with-chatgpt?return_to=/" target="_top">
                      退出登录
                    </a>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="reader-body">
          <aside className="document-index" aria-label="文档目录">
            <div className="index-heading">
              <span>{showArchived ? "已归档" : "文档"}</span>
              <div>
                <IconAction
                  label="导入文件"
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={15} />
                </IconAction>
                <IconAction
                  label="新建文档"
                  onClick={() => setDialog({ kind: "create" })}
                >
                  <Plus size={17} />
                </IconAction>
              </div>
            </div>
            <nav>
              {documents.map((doc, i) => (
                <button
                  key={doc.id}
                  className={`index-document ${view?.document.id === doc.id ? "active" : ""}`}
                  onClick={() => void openDoc({ id: doc.id })}
                >
                  <span className="index-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <strong>{doc.title}</strong>
                    <small>{doc.path}</small>
                  </span>
                </button>
              ))}
            </nav>
            <div className="index-footer">
              <span>阅读不必沿着一条线。</span>
              <button onClick={() => fileInput.current?.click()}>
                拖入 TXT、MD 或 PDF
              </button>
            </div>
          </aside>
          <div className="reading-area">
            <div className="reading-toolbar">
              <IconAction
                label={sidebar ? "收起目录" : "展开目录"}
                onClick={() => setSidebar(!sidebar)}
              >
                {sidebar ? (
                  <PanelLeftClose size={17} />
                ) : (
                  <PanelLeftOpen size={17} />
                )}
              </IconAction>
              <span>
                {linkStart
                  ? "再选择另一段文字，连接到这里。"
                  : comparison
                    ? "沿着文字之间的连接阅读"
                    : "选择一段文字，让问题从这里生长。"}
              </span>
              {linkStart && (
                <button onClick={() => setLinkStart(null)}>取消连接</button>
              )}
              <span className="toolbar-right">
                {view ? `${view.connections.length} 条连接` : ""}
              </span>
            </div>
            {error && (
              <div className="reader-error" role="alert">
                {error}
                <button aria-label="关闭错误" onClick={() => setError("")}>
                  <X size={16} />
                </button>
              </div>
            )}
            {status && (
              <div className="reader-status" role="status">
                {status}
                <button aria-label="关闭提示" onClick={() => setStatus("")}>
                  <X size={16} />
                </button>
              </div>
            )}
            {loading && !view ? (
              <div className="empty-space">正在打开文档…</div>
            ) : !view ? (
              <div className="empty-space">
                <div className="empty-mark">X / S</div>
                <h1>从一份文档开始。</h1>
                <p>
                  拖入文件，或写下第一段文字。
                  <br />
                  文档间的连接，会从这里长出来。
                </p>
                <button
                  className="primary-action"
                  onClick={() => fileInput.current?.click()}
                >
                  导入文档 <ArrowUpRight size={17} />
                </button>
                <button
                  className="plain-action"
                  onClick={() => setDialog({ kind: "create" })}
                >
                  写一份新文档
                </button>
              </div>
            ) : (
              <>
                <div className={`papers ${comparison ? "paired" : ""}`}>
                  {paper(view.document)}
                  {comparison && (
                    <>
                      <ConnectionLines
                        revisionKey={`${view.document.revisionId}-${comparison.revisionId}-${activeLink?.id}`}
                        label={
                          activeLink
                            ? relationNames[activeLink.relation]
                            : "连接"
                        }
                      />
                      {paper(comparison, true)}
                    </>
                  )}
                </div>
                <section className="connections-strip" aria-label="连接与问题">
                  <div className="section-label">
                    <Link2 size={15} />
                    <span>文字之间</span>
                    <small>{view.connections.length}</small>
                  </div>
                  {!view.connections.length && !view.questions.length ? (
                    <p className="empty-connections">
                      还没有连接。选中文字提问，或连接到另一段文字。
                    </p>
                  ) : (
                    <div className="connection-items">
                      {view.connections.map((c) => {
                        const own =
                            c.from.documentId === view.document.id
                              ? c.from
                              : c.to,
                          other = own === c.from ? c.to : c.from;
                        const target = documents.find(
                          (d) => d.id === other.documentId,
                        );
                        return (
                          <div
                            key={c.id}
                            className={`connection-item ${activeLink?.id === c.id ? "active" : ""}`}
                          >
                            <button onClick={() => void showConnection(c)}>
                              <span className="connection-relation">
                                {relationNames[c.relation]}
                              </span>
                              <strong>
                                {c.label || target?.title || "关联文档"}
                              </strong>
                              <span className="connection-quote">
                                {own.quote.slice(0, 70)}
                              </span>
                              <ArrowUpRight size={16} />
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="icon-action"
                                  aria-label="连接操作"
                                >
                                  <MoreHorizontal size={15} />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                <DropdownMenuItem
                                  onClick={() =>
                                    action(async () => {
                                      await client.invoke("unlink", {
                                        connectionId: c.id,
                                      });
                                      setView((v) =>
                                        v
                                          ? {
                                              ...v,
                                              connections: v.connections.filter(
                                                (x) => x.id !== c.id,
                                              ),
                                            }
                                          : v,
                                      );
                                      if (activeLink?.id === c.id) {
                                        setComparison(null);
                                        setActiveLink(null);
                                      }
                                    })
                                  }
                                >
                                  移除连接
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        );
                      })}
                      {view.questions.map((q) => (
                        <div className="question-item" key={q.id}>
                          <span className="connection-relation">
                            {q.answers.length ? "已回答" : "待回答"}
                          </span>
                          <button
                            onClick={() => {
                              setQuestion(q.body);
                              setSavedQuestion(q);
                              setSelection({
                                anchor: q.anchor,
                                document: view.document,
                                x: Math.max(20, window.innerWidth / 2 - 170),
                                y: window.innerHeight / 2 - 120,
                              });
                            }}
                          >
                            {q.body}
                          </button>
                          {q.answers.map((id) => (
                            <button
                              key={id}
                              className="answer-link"
                              onClick={() => void openDoc({ id })}
                            >
                              阅读回答 ↗
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.md,.markdown,.pdf"
          multiple
          hidden
          onChange={(e) => void upload(e.target.files)}
        />
        {selection && (
          <div
            className="selection-popover"
            style={{ left: selection.x, top: selection.y }}
            role="dialog"
            aria-label="对选中文字提问"
          >
            <div className="selection-head">
              <span>{selection.anchor.quote.slice(0, 90)}</span>
              <button aria-label="关闭提问" onClick={() => setSelection(null)}>
                <X size={16} />
              </button>
            </div>
            {linkStart ? (
              <>
                <p>连接到「{linkStart.document.title}」中的文字</p>
                <button
                  className="primary-action"
                  disabled={busy}
                  onClick={() => void createConnection()}
                >
                  建立连接 <Link2 size={15} />
                </button>
              </>
            ) : (
              <>
                <textarea
                  autoFocus
                  aria-label="关于这段文字的问题"
                  placeholder="这段文字，让你想到了什么？"
                  value={question}
                  onChange={(e) => {
                    setQuestion(e.target.value);
                    setSavedQuestion(null);
                  }}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                      void ask();
                  }}
                />
                <div className="selection-actions">
                  <button
                    onClick={() => {
                      setLinkStart(selection);
                      setSelection(null);
                      window.getSelection()?.removeAllRanges();
                    }}
                  >
                    <Link2 size={15} />
                    连接文字
                  </button>
                  <button
                    className="ask-action"
                    disabled={busy || !question.trim()}
                    onClick={() => void ask()}
                  >
                    {savedQuestion
                      ? "重新发送"
                      : client.mode === "app"
                        ? "问 ChatGPT"
                        : "保存并复制提问"}
                    <ArrowUpRight size={16} />
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <Dialog
          open={dialog.kind !== "closed"}
          onOpenChange={(open) => !open && setDialog({ kind: "closed" })}
        >
          <DialogContent
            className={`reader-dialog ${dialog.kind === "edit" || dialog.kind === "create" ? "editor-dialog" : ""}`}
          >
            <DialogTitle>
              {dialog.kind === "search"
                ? "查找文档"
                : dialog.kind === "create"
                  ? "新建文档"
                  : dialog.kind === "edit"
                    ? "编辑文档"
                    : dialog.kind === "history"
                      ? "版本历史"
                      : dialog.kind === "rename"
                        ? "移动文档"
                        : "连接 ChatGPT"}
            </DialogTitle>
            <DialogDescription>
              {dialog.kind === "edit"
                ? "保存时创建新版本，已建立的连接保留原来的文字。"
                : dialog.kind === "search"
                  ? "搜索路径、标题和全文。"
                  : dialog.kind === "settings"
                    ? "在 ChatGPT 中连接后，即可跨会话使用同一个文档空间。"
                    : " "}
            </DialogDescription>
            {dialog.kind === "search" && (
              <>
                <input
                  className="search-input"
                  autoFocus
                  aria-label="搜索文档"
                  placeholder="搜索文档中的文字…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="search-results">
                  {matches.map((m) => (
                    <button
                      key={m.document.id}
                      onClick={() => {
                        setDialog({ kind: "closed" });
                        void openDoc({ id: m.document.id });
                      }}
                    >
                      <strong>{m.document.title}</strong>
                      <small>{m.document.path}</small>
                      {m.excerpt && <p>{m.excerpt}</p>}
                    </button>
                  ))}
                  {!matches.length && <p>没有找到匹配的文档。</p>}
                </div>
              </>
            )}
            {(dialog.kind === "create" || dialog.kind === "rename") && (
              <label className="field-label">
                绝对路径
                <input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/notes/idea.md"
                />
              </label>
            )}
            {dialog.kind === "create" && (
              <label className="field-label">
                标题
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="文档标题"
                />
              </label>
            )}
            {(dialog.kind === "create" || dialog.kind === "edit") && (
              <textarea
                className="document-editor"
                aria-label="文档内容"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="用 Markdown 写下你的想法…"
                spellCheck={false}
              />
            )}
            {["create", "edit", "rename"].includes(dialog.kind) && (
              <div className="dialog-actions">
                <button
                  className="primary-action"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      if (dialog.kind === "create") {
                        const d = (
                          await client.invoke("write", {
                            path: Path.parse(path),
                            title,
                            content,
                          })
                        ).document;
                        setDialog({ kind: "closed" });
                        await openDoc({ id: d.id });
                      } else if (dialog.kind === "edit") {
                        const d = dialog.document;
                        const next = (
                          await client.invoke("edit", {
                            documentId: d.id,
                            expectedRevisionId: d.revisionId,
                            start: 0,
                            end: d.content.length,
                            expectedText: d.content,
                            replacement: content,
                          })
                        ).document;
                        setDialog({ kind: "closed" });
                        await openDoc({ id: next.id });
                        setStatus("新版本已保存。");
                      } else if (dialog.kind === "rename") {
                        const next = (
                          await client.invoke("mv", {
                            documentId: dialog.document.id,
                            newPath: Path.parse(path),
                          })
                        ).document;
                        setDialog({ kind: "closed" });
                        await openDoc({ id: next.id });
                      }
                    })
                  }
                >
                  <Check size={16} />
                  {busy ? "保存中…" : "保存"}
                </button>
              </div>
            )}
            {dialog.kind === "history" && (
              <div className="revision-list">
                {history.map((r) => (
                  <button
                    key={r.revisionId}
                    onClick={() => {
                      setDialog({ kind: "closed" });
                      void openDoc({ id: r.id, revisionId: r.revisionId });
                    }}
                  >
                    <span>
                      v{r.sequence}
                      {r.isCurrent ? " · 当前版本" : ""}
                    </span>
                    <span>{new Date(r.updatedAt).toLocaleString("zh-CN")}</span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              </div>
            )}
            {dialog.kind === "settings" && (
              <div className="connection-settings">
                <p>
                  在 ChatGPT 设置中添加自定义 MCP，填入以下地址，并选择 OAuth
                  登录。
                </p>
                <code>
                  {typeof window !== "undefined" && client.mode === "website"
                    ? window.location.origin
                    : "https://xanadu-sidebranch.atticusdeng.chatgpt.site"}
                  /api/mcp
                </code>
                <p>
                  连接后，请 ChatGPT「打开 Xanadu
                  Sidebranch」。在文档中划选文字并提问，回答可以保存为新文档，再与原文建立连接。
                </p>
                <p className="settings-note">
                  网站支持独立阅读与编辑。直接发送到当前对话的提问功能位于
                  ChatGPT 内的 App UI。
                </p>
              </div>
            )}
            {error && (
              <p className="dialog-error" role="alert">
                {error}
              </p>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </TooltipProvider>
  );
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}
function historyReplace(id: string, revision: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("document", id);
  url.searchParams.set("revision", revision);
  window.history.replaceState(null, "", url);
}
