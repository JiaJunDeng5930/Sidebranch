import { chatGPTSignInPath } from "./chatgpt-auth";
import "./landing.css";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="xanadu-intro">
      <header className="intro-masthead">
        {/* Native navigation keeps this public page independent of the client router. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          className="intro-wordmark"
          href="/"
          aria-label="Xanadu Sidebranch 首页"
        >
          xanadu<span>sidebranch</span>
        </a>
        <span className="intro-index">私人文档空间 / 01</span>
        <a
          className="intro-signin"
          href={chatGPTSignInPath("/space")}
          target="_top"
        >
          用 ChatGPT 登录 <span aria-hidden="true">↗</span>
        </a>
      </header>

      <section className="intro-reading">
        <div className="intro-statement">
          <p className="intro-kicker">文字有来处，也有去处。</p>
          <h1>
            读到这里，
            <br />
            还可以去<span>那里。</span>
          </h1>
          <p className="intro-description">
            从一段文字走向另一份文档。让原文、解释与反例同时留在眼前，让连接落在它们真正相关的地方。
          </p>
          <div className="intro-number">
            <span>01 — 02</span>
            <i aria-hidden="true" />
            <span>两段文字，一个关系。</span>
          </div>
        </div>

        <figure
          className="intro-space"
          aria-label="文档在空间中并排展开，连接指向两边的具体文字"
        >
          <div className="intro-depth-sheet" aria-hidden="true">
            <span>03 / 另一个角度</span>
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <article className="intro-paper intro-source">
            <div className="intro-paper-heading">
              <span>01</span>
              <span>阅读笔记 / 原文</span>
            </div>
            <h2>
              理解发生在
              <br />
              文档之间。
            </h2>
            <p>读一篇文章时，解释可能在别处，反例可能在昨天的笔记里。</p>
            <p>
              <mark>把相关的文字并排放在眼前。</mark>{" "}
              不必离开原文，也不必记住返回的路。
            </p>
            <div className="intro-paper-rule" />
            <small>当前文档</small>
          </article>
          <svg
            className="intro-beam"
            viewBox="0 0 180 340"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d="M0 186 C60 186 115 113 180 113 L180 159 C110 159 65 211 0 211 Z" />
            <path d="M0 186 C60 186 115 113 180 113 M0 211 C65 211 110 159 180 159" />
          </svg>
          <article className="intro-paper intro-companion">
            <div className="intro-paper-heading">
              <span>02</span>
              <span>旁文 / 解释</span>
            </div>
            <h2>让来处可见。</h2>
            <p>
              <mark>
                连接属于文字，
                <br />
                而不只是两个文件。
              </mark>
            </p>
            <p>
              回答可以独立成文，也可以与更多文档相连。修改后，旧的连接仍记得当时的文字。
            </p>
            <div className="intro-paper-rule" />
            <small>关联文档</small>
          </article>
          <figcaption>并排阅读 · 文字连接 · 保留语境</figcaption>
        </figure>
      </section>

      <section className="intro-colophon" aria-label="关于这个空间">
        <p>
          TXT、Markdown、PDF 与新写下的文字，进入同一个持久文档空间。在 ChatGPT
          中划选、提问，继续阅读与写作。
        </p>
        <p>
          受{" "}
          <a
            href="https://www.xanadu.net/XanaduSpace/btf.htm"
            target="_blank"
            rel="noreferrer"
          >
            Project Xanadu
          </a>{" "}
          启发。
          <br />
          此页公开；文档仅向所有者开放。
        </p>
        <a href="https://github.com/JiaJunDeng5930/Sidebranch">
          Sidebranch / GitHub ↗
        </a>
      </section>
    </main>
  );
}
