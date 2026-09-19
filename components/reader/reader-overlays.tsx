"use client";

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  FilePlus2,
  History,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  PenLine,
  Send,
  Upload,
  X,
} from "lucide-react";
import "./selection-composer.css";
import {
  ReaderMenu,
  ReaderMenuItem,
  ReaderMenuLink,
  ReaderMenuSeparator,
} from "./workspace-controls";
import type {
  AnswerNotification,
  ConnectionDraft,
  QuestionDraftId,
  ReaderSession,
  ReaderSessionAction,
} from "../../lib/reader/session";
import {
  answerNotificationKey,
  canSendQuestion,
  isQuestionDirty,
} from "../../lib/reader/session";
import { relationNames } from "../../lib/reader/relations";
import type { Connection, DocumentRevision } from "../../lib/domain/model";

type Relation = Connection["relation"];

/**
 * A quiet topbar entry for answer arrivals.  The live status is deliberately
 * separate from the button so an arrival never creates an interactive layer
 * over the document or moves focus away from the current selection.
 */
export function AnswerArrivalEntry({
  answers,
  onOpen,
}: {
  answers: readonly AnswerNotification[];
  onOpen: () => void;
}) {
  const announcedKeys = useRef(new Set<string>());
  const [announcement, setAnnouncement] = useState("");
  const unseenCount = answers.reduce(
    (count, answer) => count + (answer.status === "unseen" ? 1 : 0),
    0,
  );

  useEffect(() => {
    const newUnseen = answers.filter(
      (answer) =>
        answer.status === "unseen" &&
        !announcedKeys.current.has(answerNotificationKey(answer)),
    );
    if (!newUnseen.length) return;
    newUnseen.forEach((answer) =>
      announcedKeys.current.add(answerNotificationKey(answer)),
    );
    setAnnouncement(`收到 ${newUnseen.length} 份新回答，可从顶部“回答”查看。`);
  }, [answers]);

  return (
    <>
      {answers.length > 0 && (
        <button
          type="button"
          className="topbar-button answer-arrival-entry"
          aria-label={
            unseenCount > 0 ? `查看回答，${unseenCount} 个待阅读` : "查看回答"
          }
          onClick={onOpen}
        >
          <span className="answer-arrival-label">回答</span>
          {unseenCount > 0 && (
            <>
              <span className="answer-arrival-dot" aria-hidden="true" />
              <span className="answer-arrival-separator" aria-hidden="true">
                ·
              </span>
              <span className="answer-arrival-count" aria-hidden="true">
                {unseenCount > 99 ? "99+" : unseenCount}
              </span>
            </>
          )}
        </button>
      )}
      <span className="reader-sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </>
  );
}

export function PlaneMenu({
  document,
  onEdit,
  onHistory,
  onRename,
  onArchive,
  onDownload,
  website,
}: {
  document: DocumentRevision;
  onEdit: () => void;
  onHistory: () => void;
  onRename: () => void;
  onArchive: () => void;
  onDownload: () => void;
  website: boolean;
}) {
  return (
    <ReaderMenu
      trigger={(toggle, open) => (
        <button
          type="button"
          className="plane-menu"
          aria-label="文档操作"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
        >
          <MoreHorizontal size={17} />
        </button>
      )}
    >
      <ReaderMenuItem onSelect={onEdit} disabled={!document.isCurrent}>
        <PenLine size={15} /> 编辑原文
      </ReaderMenuItem>
      <ReaderMenuItem onSelect={onHistory}>
        <History size={15} /> 版本历史
      </ReaderMenuItem>
      <ReaderMenuItem onSelect={onRename}>移动 / 重命名</ReaderMenuItem>
      <ReaderMenuItem onSelect={onDownload}>下载当前文本</ReaderMenuItem>
      {website && document.assetId && (
        <ReaderMenuLink href={`/api/assets/${document.assetId}`}>
          下载导入文件
        </ReaderMenuLink>
      )}
      <ReaderMenuSeparator />
      <ReaderMenuItem onSelect={onArchive}>
        <Archive size={15} /> {document.archived ? "恢复文档" : "归档文档"}
      </ReaderMenuItem>
    </ReaderMenu>
  );
}

export function EmptyWorkspace({
  loading,
  onCreate,
  onImport,
}: {
  loading: boolean;
  onCreate: () => void;
  onImport: () => void;
}) {
  if (loading)
    return (
      <div className="workspace-empty loading">
        <LoaderCircle size={22} className="spin" />
        <p>正在读取空间…</p>
      </div>
    );
  return (
    <div className="workspace-empty">
      <div className="empty-mark">X / S</div>
      <p className="empty-kicker">A PRIVATE DOCUMENT SPACE</p>
      <h1>让阅读从一份文档开始。</h1>
      <p>文字可以并行、连接，也可以沿着问题继续生长。</p>
      <div className="empty-actions">
        <button type="button" className="solid-button" onClick={onImport}>
          <Upload size={16} /> 导入文档
        </button>
        <button type="button" className="quiet-button" onClick={onCreate}>
          <FilePlus2 size={16} /> 写一份新文档
        </button>
      </div>
    </div>
  );
}

export function SelectionComposer({
  session,
  dispatch,
  onOpenQuestion,
  onSendQuestion,
  onStartConnection,
  onSaveConnection,
  onDismiss,
  onDiscardQuestion,
}: {
  session: ReaderSession;
  dispatch: (action: ReaderSessionAction) => void;
  onOpenQuestion: () => void;
  onSendQuestion: () => void;
  onStartConnection: () => void;
  onSaveConnection: () => void;
  onDismiss: () => void;
  onDiscardQuestion: () => void;
}) {
  const selection = session.selection;
  const question = session.question;
  const connection: ConnectionDraft = session.connection;
  const first = connection.kind === "closed" ? null : connection.first;
  const second =
    connection.kind === "second" ||
    connection.kind === "saving" ||
    connection.kind === "failed"
      ? connection.second
      : null;
  const [restoredQuestion, setRestoredQuestion] = useState<{
    draftId: QuestionDraftId;
    kind: string;
  } | null>(null);
  const [expandedQuoteKey, setExpandedQuoteKey] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLElement>(null);

  const source =
    first ??
    (question.kind !== "closed"
      ? { document: question.document, anchor: question.anchor }
      : selection.kind === "selected"
        ? { document: selection.document, anchor: selection.anchor }
        : null);

  const quote =
    question.kind !== "closed"
      ? question.anchor.quote
      : selection.kind === "selected"
        ? selection.preview || selection.anchor.quote
        : (source?.anchor.quote ?? "");
  const hasExpandableQuote =
    quote.length > 180 || quote.split(/\r?\n/).length > 3;
  const quoteKey = [
    source?.document.id ?? "",
    source?.anchor.revisionId ?? "",
    source?.anchor.start ?? "",
    source?.anchor.end ?? "",
    quote,
  ].join(":");
  const quoteExpanded = expandedQuoteKey === quoteKey;
  const showingConnection = connection.kind !== "closed";
  const showingQuestion =
    !showingConnection &&
    question.kind !== "closed" &&
    (question.kind === "draft" ||
      (restoredQuestion?.draftId === question.draftId &&
        restoredQuestion.kind === question.kind));
  const showingPending =
    !showingConnection && question.kind !== "closed" && !showingQuestion;
  const showingSelectionAction =
    !showingConnection &&
    question.kind === "closed" &&
    selection.kind === "selected";

  useEffect(() => {
    if (!showingQuestion) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [question.kind, showingQuestion]);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!composerRef.current?.contains(event.target as Node))
        setMoreOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [moreOpen]);

  const viewportWidth =
    typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined" ? 720 : window.innerHeight;
  const anchorTop =
    (selection.kind === "selected" ? (selection.rect?.top ?? 90) : 90) +
    (selection.kind === "selected" ? (selection.rect?.height ?? 0) : 0) +
    12;
  const estimatedHeight = showingConnection
    ? 480
    : showingQuestion
      ? 380
      : showingPending
        ? 116
        : 74;
  const narrowViewport = viewportWidth <= 640;
  const useSheet =
    narrowViewport || anchorTop + estimatedHeight > viewportHeight - 20;
  const panelWidth = showingConnection ? 410 : 360;
  const selectionRect = selection.kind === "selected" ? selection.rect : null;
  const left = Math.max(
    16,
    Math.min(selectionRect?.left ?? 24, viewportWidth - panelWidth - 16),
  );
  const top = Math.max(
    16,
    Math.min(anchorTop, viewportHeight - estimatedHeight - 16),
  );
  const className = [
    "selection-composer-v2",
    useSheet && "selection-composer-v2--sheet",
    showingSelectionAction && "selection-composer-v2--selection",
    showingQuestion && "selection-composer-v2--question",
    showingPending && "selection-composer-v2--pending",
    showingConnection && "selection-composer-v2--connection",
  ]
    .filter(Boolean)
    .join(" ");

  const questionMenuItem = (
    <>
      <button
        type="button"
        className="selection-composer-v2__menu-item"
        role="menuitem"
        onClick={() => {
          setMoreOpen(false);
          onStartConnection();
        }}
      >
        <Link2 size={14} /> 连接文字
      </button>
      <button
        type="button"
        className="selection-composer-v2__menu-item"
        role="menuitem"
        onClick={() => {
          setMoreOpen(false);
          onDismiss();
        }}
      >
        关闭
      </button>
    </>
  );

  if (!source) return null;

  return (
    <aside
      ref={composerRef}
      className={className}
      style={useSheet ? undefined : { left, top }}
      role="dialog"
      aria-label={
        showingConnection
          ? "连接选中文字"
          : showingQuestion
            ? "提问"
            : showingPending
              ? "问题状态"
              : "选中文字操作"
      }
    >
      {showingConnection ? (
        <section className="selection-composer-v2__connection-body">
          <header className="selection-composer-v2__header">
            <div>
              <strong>连接文字</strong>
              <span className="selection-composer-v2__source">
                {source.document.title}
              </span>
            </div>
            <button
              type="button"
              className="selection-composer-v2__icon-button"
              aria-label="关闭连接操作"
              onClick={onDismiss}
            >
              <X size={15} />
            </button>
          </header>
          <div className="selection-composer-v2__endpoints">
            <p>
              <strong>第一端</strong> {first?.document.title}
              <span>{first?.anchor.quote.slice(0, 120)}</span>
            </p>
            {second && (
              <p>
                <strong>第二端</strong> {second.document.title}
                <span>{second.anchor.quote.slice(0, 120)}</span>
              </p>
            )}
          </div>
          <p className="selection-composer-v2__hint">
            {second ? "确认两段文字后建立连接。" : "再选择另一份文档中的文字。"}
          </p>
          <label className="selection-composer-v2__field">
            <span>关系</span>
            <select
              value={connection.relation}
              onChange={(event) =>
                dispatch({
                  type: "connection/relation",
                  relation: event.target.value as Relation,
                })
              }
            >
              {Object.entries(relationNames).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="selection-composer-v2__field">
            <span>标签（可选）</span>
            <input
              value={connection.label}
              onChange={(event) =>
                dispatch({
                  type: "connection/label",
                  label: event.target.value,
                })
              }
            />
          </label>
          {connection.error && (
            <p className="selection-composer-v2__error">{connection.error}</p>
          )}
          <button
            type="button"
            className="selection-composer-v2__primary selection-composer-v2__full-button"
            disabled={
              connection.kind !== "second" && connection.kind !== "failed"
            }
            onClick={onSaveConnection}
          >
            <Link2 size={15} />
            {connection.kind === "failed" ? "重试连接" : "建立连接"}
          </button>
          {isQuestionDirty(question) && (
            <button
              type="button"
              className="selection-composer-v2__secondary selection-composer-v2__full-button"
              onClick={onDiscardQuestion}
            >
              放弃问题草稿
            </button>
          )}
        </section>
      ) : showingSelectionAction ? (
        <div className="selection-composer-v2__selection-action">
          <button
            type="button"
            className="selection-composer-v2__primary"
            onClick={onOpenQuestion}
          >
            提问
          </button>
          <div className="selection-composer-v2__menu-wrap">
            <button
              type="button"
              className="selection-composer-v2__icon-button"
              aria-label="更多选文操作"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <MoreHorizontal size={17} />
            </button>
            {moreOpen && (
              <div className="selection-composer-v2__menu" role="menu">
                {questionMenuItem}
              </div>
            )}
          </div>
        </div>
      ) : showingQuestion ? (
        <section className="selection-composer-v2__question-body">
          <header className="selection-composer-v2__header">
            <div>
              <strong>提问</strong>
              <span className="selection-composer-v2__source">
                {source.document.title}
              </span>
            </div>
            <div className="selection-composer-v2__menu-wrap">
              <button
                type="button"
                className="selection-composer-v2__icon-button"
                aria-label="更多提问操作"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((open) => !open)}
              >
                <MoreHorizontal size={17} />
              </button>
              {moreOpen && (
                <div className="selection-composer-v2__menu" role="menu">
                  {questionMenuItem}
                  {(question.kind === "draft" ||
                    question.kind === "saving" ||
                    question.kind === "send_failed") && (
                    <button
                      type="button"
                      className="selection-composer-v2__menu-item"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpen(false);
                        onDiscardQuestion();
                      }}
                    >
                      放弃问题草稿
                    </button>
                  )}
                </div>
              )}
            </div>
          </header>
          <blockquote
            className="selection-composer-v2__quote"
            data-expanded={quoteExpanded}
          >
            {quote}
          </blockquote>
          {hasExpandableQuote && (
            <button
              type="button"
              className="selection-composer-v2__quote-toggle"
              aria-expanded={quoteExpanded}
              onClick={() =>
                setExpandedQuoteKey((expanded) =>
                  expanded === quoteKey ? null : quoteKey,
                )
              }
            >
              {quoteExpanded ? "收起引用" : "展开引用"}
            </button>
          )}
          <label
            className="selection-composer-v2__question-field"
            htmlFor="selection-question-input"
          >
            <span>你的问题</span>
            <textarea
              ref={inputRef}
              id="selection-question-input"
              value={question.body}
              placeholder="你想从这段文字了解什么？"
              disabled={
                question.kind === "saving" || question.kind === "sending"
              }
              onChange={(event) =>
                dispatch({ type: "question/body", body: event.target.value })
              }
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  onSendQuestion();
                }
              }}
            />
          </label>
          {question.error && (
            <p className="selection-composer-v2__error">{question.error}</p>
          )}
          <div className="selection-composer-v2__question-actions">
            <span className="selection-composer-v2__shortcut">⌘↵ 发送</span>
            <button
              type="button"
              className="selection-composer-v2__primary"
              disabled={!canSendQuestion(question)}
              onClick={onSendQuestion}
            >
              <Send size={15} />
              {question.kind === "send_failed"
                ? "重试发送"
                : question.kind === "saving" || question.kind === "sending"
                  ? "发送中…"
                  : "提问"}
            </button>
          </div>
        </section>
      ) : showingPending ? (
        <div className="selection-composer-v2__pending-body">
          <div className="selection-composer-v2__pending-copy">
            <span
              className="selection-composer-v2__pending-dot"
              aria-hidden="true"
            >
              {question.kind === "send_failed"
                ? "!"
                : question.kind === "answered"
                  ? "✓"
                  : ""}
            </span>
            <div>
              <strong>
                {question.kind === "send_failed"
                  ? "发送失败"
                  : question.kind === "answered"
                    ? "回答已到达"
                    : "问题已发送"}
              </strong>
              <span>{question.body.trim() || "问题草稿"}</span>
            </div>
          </div>
          <div className="selection-composer-v2__pending-actions">
            {question.kind === "send_failed" && (
              <button
                type="button"
                className="selection-composer-v2__primary"
                onClick={onSendQuestion}
              >
                <LoaderCircle size={14} /> 重试
              </button>
            )}
            <button
              type="button"
              className="selection-composer-v2__secondary"
              onClick={() =>
                setRestoredQuestion({
                  draftId: question.draftId,
                  kind: question.kind,
                })
              }
            >
              恢复问题
            </button>
            <button
              type="button"
              className="selection-composer-v2__icon-button"
              aria-label="关闭问题状态"
              onClick={onDismiss}
            >
              <X size={15} />
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
