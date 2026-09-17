import { chatGPTSignInPath } from "./chatgpt-auth";
export const dynamic = "force-dynamic";
export default function Home() {
  return (
    <main className="landing">
      <header className="masthead">
        <a className="wordmark" href="/">
          Xanadu<span>Sidebranch</span>
        </a>
        <span className="edition">A PERSONAL HYPERTEXT SPACE</span>
        <a
          className="text-link"
          href={chatGPTSignInPath("/space")}
          target="_top"
        >
          用 ChatGPT 登录 ↗
        </a>
      </header>
      <section className="introduction">
        <p className="eyebrow">READ BETWEEN DOCUMENTS</p>
        <h1>
          思想有分支。
          <br />
          <em>阅读也应该有。</em>
        </h1>
        <p className="intro-copy">
          把文章、问题和回答放在同一个空间。沿着一段文字，走向另一份文档；循着连接，随时回到思考发生的地方。
        </p>
        <a
          className="enter-link"
          href={chatGPTSignInPath("/space")}
          target="_top"
        >
          进入我的文档空间 <span>↗</span>
        </a>
      </section>
      <section className="specimen" aria-label="并排阅读示意">
        <article className="specimen-page">
          <div className="paper-meta">01 / 原文</div>
          <h2>
            文字之外，
            <br />
            还有关系。
          </h2>
          <p>
            一篇文章从来不只属于它自己。它回应别人的问题，引用另一个声音，又成为后来思考的起点。
          </p>
          <p>
            <mark>让这些关系留在文字之间。</mark>
          </p>
          <div className="paper-foot">阅读 · 划选 · 连接</div>
        </article>
        <svg
          className="specimen-connection"
          viewBox="0 0 140 320"
          aria-label="文字之间的连接"
        >
          <path
            d="M0 180 C70 180 50 90 140 90 M0 214 C70 214 60 144 140 144"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
        <article className="specimen-page second">
          <div className="paper-meta">02 / 延伸</div>
          <h2>
            一次提问，
            <br />
            一条新的去路。
          </h2>
          <p>
            <mark>每份文档都有自己的位置。</mark>
          </p>
          <p>回答可以独立成文；连接指向具体的文字，带你在文档间往返。</p>
          <div className="paper-foot">保留原文 · 自由生长</div>
        </article>
      </section>
      <footer className="landing-footer">
        <span>X / S</span>
        <p>公开的是这页介绍。文档空间仅向所有者开放。</p>
        <a href="https://github.com/JiaJunDeng5930/Sidebranch">GitHub ↗</a>
      </footer>
    </main>
  );
}
