"use client";

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
import {
  ReaderMenu,
  ReaderMenuItem,
  ReaderMenuLink,
  ReaderMenuSeparator,
} from "./workspace-controls";
import type {
  ConnectionDraft,
  ReaderSession,
  ReaderSessionAction,
} from "../../lib/reader/session";
import { isQuestionDirty } from "../../lib/reader/session";
import { relationNames } from "../../lib/reader/relations";
import type { Connection, DocumentRevision } from "../../lib/domain/model";

type Relation = Connection["relation"];

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
  const visible =
    selection.kind === "selected" ||
    question.kind !== "closed" ||
    connection.kind !== "closed";
  const displayDocument =
    selection.kind === "selected"
      ? selection.document
      : (first?.document ??
        (question.kind !== "closed" ? question.document : null));
  const displayAnchor =
    selection.kind === "selected"
      ? selection.anchor
      : (first?.anchor ??
        (question.kind !== "closed" ? question.anchor : null));
  if (!visible || !displayDocument || !displayAnchor) return null;
  const left = Math.max(
    14,
    Math.min(
      selection.kind === "selected" ? (selection.rect?.left ?? 24) : 24,
      (typeof window === "undefined" ? 420 : window.innerWidth) - 390,
    ),
  );
  const top = Math.max(
    14,
    Math.min(
      (selection.kind === "selected" ? (selection.rect?.top ?? 90) : 90) +
        (selection.kind === "selected" ? (selection.rect?.height ?? 0) : 0) +
        12,
      (typeof window === "undefined" ? 560 : window.innerHeight) - 300,
    ),
  );
  return (
    <aside
      className="selection-composer"
      style={{ left, top }}
      role="dialog"
      aria-label="选中文字操作"
    >
      <div className="composer-heading">
        <div>
          <span>SELECTED PASSAGE</span>
          <p>
            {(selection.kind === "selected"
              ? selection.preview
              : displayAnchor.quote
            ).slice(0, 180)}
          </p>
          <small>
            {displayDocument.title} · v{displayDocument.sequence}
          </small>
        </div>
        <button
          type="button"
          className="quiet-icon"
          aria-label="关闭"
          onClick={onDismiss}
        >
          <X size={15} />
        </button>
      </div>
      {connection.kind !== "closed" ? (
        <div className="connection-draft">
          <div className="connection-endpoints">
            <p>
              <strong>第一端</strong> {first?.document.title} · v
              {first?.document.sequence}
              <span>{first?.anchor.quote.slice(0, 120)}</span>
            </p>
            {second && (
              <p>
                <strong>第二端</strong> {second.document.title} · v
                {second.document.sequence}
                <span>{second.anchor.quote.slice(0, 120)}</span>
              </p>
            )}
          </div>
          <p>
            {second ? "确认两段文字后建立连接。" : "再选择另一份文档中的文字。"}
          </p>
          <label className="workspace-label">
            关系
            <select
              className="workspace-input"
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
          <label className="workspace-label">
            标签（可选）
            <input
              className="workspace-input"
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
            <p className="dialog-error">{connection.error}</p>
          )}
          <button
            type="button"
            className="solid-button full-button"
            disabled={connection.kind !== "second"}
            onClick={onSaveConnection}
          >
            <Link2 size={15} /> 建立连接
          </button>
          {isQuestionDirty(question) && (
            <button
              type="button"
              className="quiet-button full-button"
              onClick={onDiscardQuestion}
            >
              放弃问题草稿
            </button>
          )}
        </div>
      ) : question.kind === "closed" ? (
        <div className="composer-actions">
          <button
            type="button"
            className="quiet-button"
            onClick={onOpenQuestion}
          >
            提问
          </button>
          <button
            type="button"
            className="quiet-button"
            onClick={onStartConnection}
          >
            <Link2 size={15} /> 连接文字
          </button>
        </div>
      ) : (
        <>
          <textarea
            className="question-input"
            autoFocus
            value={question.body}
            placeholder="这段文字，让你想到了什么？"
            onChange={(event) =>
              dispatch({ type: "question/body", body: event.target.value })
            }
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
                onSendQuestion();
            }}
          />
          {question.error && <p className="dialog-error">{question.error}</p>}
          <div className="composer-actions">
            <button
              type="button"
              className="quiet-button"
              onClick={onStartConnection}
            >
              <Link2 size={15} /> 连接文字
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={
                question.kind === "draft" ||
                question.kind === "saving" ||
                question.kind === "send_failed"
                  ? onDiscardQuestion
                  : onDismiss
              }
            >
              {question.kind === "draft" ||
              question.kind === "saving" ||
              question.kind === "send_failed"
                ? "放弃问题草稿"
                : "收起问题"}
            </button>
            <button
              type="button"
              className="solid-button"
              disabled={
                !question.body.trim() ||
                question.kind === "saving" ||
                question.kind === "sending" ||
                question.kind === "awaiting"
              }
              onClick={onSendQuestion}
            >
              <Send size={15} />{" "}
              {question.kind === "send_failed"
                ? "重试发送"
                : question.kind === "awaiting"
                  ? "等待回答"
                  : "问 ChatGPT"}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
