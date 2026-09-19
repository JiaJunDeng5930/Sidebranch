"use client";

import { Check, ChevronRight } from "lucide-react";
import type {
  AnchorInput,
  Connection,
  DocumentId,
  DocumentRevision,
  RevisionId,
} from "../../lib/domain/model";
import type {
  AnswerNotification,
  ReaderSession,
  ReaderSessionAction,
  SearchMatch,
} from "../../lib/reader/session";
import { answerNotificationKey } from "../../lib/reader/session";
import {
  ReaderDialog,
  ReaderDialogContent,
  ReaderDialogDescription,
  ReaderDialogTitle,
} from "./workspace-controls";

export interface ReaderDialogsProps {
  session: ReaderSession;
  dispatch: (action: ReaderSessionAction) => void;
  searchOpen: boolean;
  historyOpen: boolean;
  editorOpen: boolean;
  activitiesOpen: boolean;
  historyItems: readonly Omit<DocumentRevision, "content">[];
  onSearch: (query: string) => void;
  onSelectSearchMatch: (match: SearchMatch) => void | Promise<void>;
  onOpenHistoryRevision: (
    item: Omit<DocumentRevision, "content">,
  ) => void | Promise<void>;
  onCloseEditor: () => void;
  onFlushPendingNavigation: () => void;
  onSaveEditor: () => void | Promise<void>;
  onOpenAnswer: (answer: AnswerNotification) => void;
  onFollow: (connectionId: Connection["id"]) => void;
  onOpenDocument: (
    target: { id: DocumentId; revisionId?: RevisionId },
    focus?: AnchorInput | null,
  ) => void | Promise<boolean>;
}

/** Dialogs for search, version history, editing, and saved activity. */
export function ReaderDialogs({
  session,
  dispatch,
  searchOpen,
  historyOpen,
  editorOpen,
  activitiesOpen,
  historyItems,
  onSearch,
  onSelectSearchMatch,
  onOpenHistoryRevision,
  onCloseEditor,
  onFlushPendingNavigation,
  onSaveEditor,
  onOpenAnswer,
  onFollow,
  onOpenDocument,
}: ReaderDialogsProps) {
  return (
    <>
      <ReaderDialog
        open={searchOpen}
        onOpenChange={(open) => !open && dispatch({ type: "dialog/close" })}
      >
        <ReaderDialogContent className="reader-dialog search-dialog">
          <ReaderDialogTitle>搜索文档</ReaderDialogTitle>
          <ReaderDialogDescription>
            按路径、标题和全文进行区分大小写的字面搜索；打开结果会定位到返回的版本。
          </ReaderDialogDescription>
          <input
            className="workspace-input search-field"
            autoFocus
            value={session.search.query}
            placeholder="搜索文字…"
            onChange={(event) => onSearch(event.target.value)}
          />
          {session.search.kind === "querying" && (
            <p className="search-hint">正在搜索…</p>
          )}
          {session.search.kind === "failed" && (
            <p className="dialog-error">{session.search.error}</p>
          )}
          <div className="search-results">
            {(session.search.kind === "querying" ||
              session.search.kind === "results" ||
              session.search.kind === "failed") &&
              session.search.matches.map((match) => (
                <button
                  type="button"
                  key={`${match.document.id}:${match.revisionId}:${match.start}`}
                  onClick={() => void onSelectSearchMatch(match)}
                >
                  <strong>{match.document.title}</strong>
                  <small>
                    {match.document.path} · v{match.document.sequence}
                  </small>
                  <p>{match.excerpt}</p>
                </button>
              ))}
            {session.search.kind === "results" &&
              session.search.query &&
              !session.search.matches.length && (
                <p className="search-hint">没有找到匹配的文档。</p>
              )}
          </div>
        </ReaderDialogContent>
      </ReaderDialog>

      <ReaderDialog
        open={historyOpen}
        onOpenChange={(open) => !open && dispatch({ type: "dialog/close" })}
      >
        <ReaderDialogContent className="reader-dialog">
          <ReaderDialogTitle>版本历史</ReaderDialogTitle>
          <ReaderDialogDescription>
            旧版本可读；连接仍指向它建立时的精确文字。
          </ReaderDialogDescription>
          <div className="history-list">
            {historyItems.map((item) => (
              <button
                type="button"
                key={item.revisionId}
                onClick={() => void onOpenHistoryRevision(item)}
              >
                <span>
                  v{item.sequence}
                  {item.isCurrent ? " · 当前" : ""}
                </span>
                <small>
                  {new Date(item.updatedAt).toLocaleString("zh-CN")}
                </small>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        </ReaderDialogContent>
      </ReaderDialog>

      <ReaderDialog open={editorOpen} onOpenChange={onCloseEditor}>
        <ReaderDialogContent className="reader-dialog editor-dialog">
          <ReaderDialogTitle>
            {session.editor.kind === "create"
              ? "新建文档"
              : session.editor.kind === "rename"
                ? "移动 / 重命名"
                : "编辑文档"}
          </ReaderDialogTitle>
          <ReaderDialogDescription>
            {session.editor.kind === "edit"
              ? `正在编辑 v${session.editor.document.sequence}；保存会创建新版本。`
              : session.editor.kind === "rename"
                ? "此处只改变文档路径；正文和版本保持不变。"
                : "保存后文档仍属于空间，是否旁读由你决定。"}
          </ReaderDialogDescription>
          <label className="workspace-label">
            路径
            <input
              className="workspace-input"
              readOnly={session.editor.kind === "edit"}
              value={
                session.editor.kind === "closed" ? "" : session.editor.path
              }
              onChange={(event) =>
                dispatch({ type: "editor/path", path: event.target.value })
              }
            />
          </label>
          {session.editor.kind !== "rename" && (
            <label className="workspace-label">
              标题
              <input
                className="workspace-input"
                readOnly={session.editor.kind === "edit"}
                value={
                  session.editor.kind === "closed" ? "" : session.editor.title
                }
                onChange={(event) =>
                  dispatch({ type: "editor/title", title: event.target.value })
                }
              />
            </label>
          )}
          {session.editor.kind !== "rename" && (
            <textarea
              className="workspace-editor"
              aria-label="文档正文"
              value={
                session.editor.kind === "closed" ? "" : session.editor.content
              }
              onChange={(event) =>
                dispatch({
                  type: "editor/content",
                  content: event.target.value,
                })
              }
            />
          )}
          {session.editor.kind !== "closed" && session.editor.error && (
            <p className="dialog-error" role="alert">
              {session.editor.error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                dispatch({ type: "editor/close" });
                onFlushPendingNavigation();
              }}
            >
              放弃草稿
            </button>
            <button
              type="button"
              className="solid-button"
              disabled={
                session.editor.kind === "closed" || session.editor.saving
              }
              onClick={() => void onSaveEditor()}
            >
              <Check size={15} />{" "}
              {session.editor.kind !== "closed" && session.editor.saving
                ? "保存中…"
                : "保存"}
            </button>
          </div>
        </ReaderDialogContent>
      </ReaderDialog>

      <ReaderDialog
        open={activitiesOpen}
        onOpenChange={(open) => !open && dispatch({ type: "dialog/close" })}
      >
        <ReaderDialogContent className="reader-dialog activities-dialog">
          <ReaderDialogTitle>连接与问题</ReaderDialogTitle>
          <ReaderDialogDescription>
            这些入口只改变阅读意图，不会把答案或提示自动设为当前。
          </ReaderDialogDescription>
          <div className="activity-list">
            {session.answers.map((answer) => (
              <button
                type="button"
                className="activity-item"
                key={answerNotificationKey(answer)}
                onClick={() => {
                  dispatch({ type: "dialog/close" });
                  onOpenAnswer(answer);
                }}
              >
                <strong>回答 · {answer.title}</strong>
                <small>
                  {answer.status === "unseen" ? "已有回答" : "稍后阅读"}
                </small>
              </button>
            ))}
            {session.connections.map((connection) => (
              <button
                type="button"
                className="activity-item"
                key={connection.id}
                onClick={() => {
                  dispatch({ type: "dialog/close" });
                  onFollow(connection.id);
                }}
              >
                <strong>{connection.label || "文字连接"}</strong>
                <small>{connection.from.quote.slice(0, 100)}</small>
              </button>
            ))}
            {session.questions.map((question) => (
              <button
                type="button"
                className="activity-item"
                key={question.id}
                onClick={() => {
                  dispatch({ type: "dialog/close" });
                  void onOpenDocument(
                    {
                      id: question.anchor.documentId,
                      revisionId: question.anchor.revisionId,
                    },
                    null,
                  );
                }}
              >
                <strong>
                  {question.answers.length ? "已答" : "待答"} · {question.body}
                </strong>
                <small>{question.anchor.quote.slice(0, 100)}</small>
              </button>
            ))}
            {!session.answers.length &&
              !session.connections.length &&
              !session.questions.length && (
                <p className="tray-empty">选择文字后可以提问或连接。</p>
              )}
          </div>
        </ReaderDialogContent>
      </ReaderDialog>

      <ReaderDialog
        open={session.dialog.kind === "settings"}
        onOpenChange={(open) => !open && dispatch({ type: "dialog/close" })}
      >
        <ReaderDialogContent className="reader-dialog">
          <ReaderDialogTitle>连接 ChatGPT</ReaderDialogTitle>
          <ReaderDialogDescription>
            网站可以独立阅读；ChatGPT App 中可把已保存的问题发送到当前对话。
          </ReaderDialogDescription>
          <div className="settings-copy">
            <p>在 ChatGPT 设置中添加自定义 MCP：</p>
            <code>
              {typeof window !== "undefined" ? window.location.origin : ""}
              /api/mcp
            </code>
            <p>回答文档会独立保存；只有真实建立的文字连接才会显示关系线。</p>
          </div>
        </ReaderDialogContent>
      </ReaderDialog>
    </>
  );
}
