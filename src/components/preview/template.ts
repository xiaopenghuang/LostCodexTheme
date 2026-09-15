export const PREVIEW_HTML = `<!doctype html><html data-lct-part="root" lang="zh-CN"><head>
<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'">
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}body{isolation:isolate;position:relative;display:flex;background:transparent}
aside{flex-shrink:0;height:100%;padding:24px 15px;display:flex;flex-direction:column;font-size:12px;overflow:hidden}
.brand{font-size:16px;font-weight:700;display:flex;align-items:center;gap:9px;margin-bottom:29px;padding:0 10px}
.brand svg{width:22px;height:22px}.nav{padding:10px;border-radius:8px;display:flex;align-items:center;gap:9px;opacity:.75;white-space:nowrap}
.nav.active{background:color-mix(in srgb,var(--lct-accent) 13%,transparent);color:var(--lct-accent);opacity:1}
.nav svg{width:15px;height:15px}.heading{font-size:10px;opacity:.4;letter-spacing:1px;margin:27px 10px 9px}.thread{padding:9px 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;opacity:.6}
.thread.current{opacity:1;background:color-mix(in srgb,var(--lct-accent) 8%,transparent);border-radius:6px}.profile{margin-top:auto;display:flex;align-items:center;gap:8px;padding:15px 10px 0;opacity:.65;font-size:11px}
.avatar{width:24px;height:24px;border-radius:8px;background:color-mix(in srgb,var(--lct-accent) 22%,transparent);display:grid;place-items:center;font-size:10px}
main{min-width:0;flex:1;display:flex;flex-direction:column;height:100%}.topbar{height:56px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 26px;border-bottom:1px solid #8882;font-size:11px;color:inherit}.topbar span:last-child{opacity:.45}
.conversation{overflow:auto;flex:1;min-height:0;padding:22px clamp(22px,5vw,58px) 10px;scrollbar-width:thin;scrollbar-color:#8884 transparent}
.date{text-align:center;font-size:9px;opacity:.4;letter-spacing:.4px;margin:0 0 12px}
.user{margin-left:auto;padding:12px 16px;width:fit-content;font-size:.92em}.assistant{padding:2px 0}.assistant p{margin:8px 0 16px;line-height:inherit}.assistant h3{font-size:1em;font-weight:650;margin:18px 0 8px}.assistant .eyebrow{display:flex;align-items:center;gap:8px;color:var(--lct-accent);font-size:10px;letter-spacing:.8px;font-weight:650;margin-bottom:14px}.eyebrow .star{font-size:18px}
pre{overflow:auto;white-space:pre;padding:12px 16px;margin:12px 0 8px;position:relative}pre .lang{display:block;opacity:.4;font-size:9px;letter-spacing:.8px;margin-bottom:8px}.syntax{color:var(--lct-accent)}.comment{opacity:.4}.codeLine{display:block}.caption{font-size:10px;opacity:.5;display:flex;gap:14px;margin-top:10px}
.composer-wrap{padding:12px clamp(22px,5vw,58px) 17px;flex-shrink:0}.composer{width:100%;color:inherit}.placeholder{font-size:.88em;opacity:.55;line-height:1.5;min-height:38px}.tools{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:13px;font-size:10px}.tools span{opacity:.55}.send{width:26px;height:26px;background:var(--lct-accent);color:#142218;display:grid;place-items:center;border-radius:50%;font-size:18px}.footnote{text-align:center;opacity:.35;font-size:9px;margin-top:11px}
.work-preview{display:none;position:absolute;right:12px;top:66px;bottom:15px;width:min(320px,calc(100% - 24px));z-index:2;overflow:auto;scrollbar-width:thin;gap:12px;flex-direction:column}
html[data-work-panels="true"] .work-preview{display:flex}html[data-work-panels="true"] :is(.conversation,.composer-wrap){visibility:hidden}.work-preview section{padding:16px;font-size:12px;flex-shrink:0}.work-preview h3{font-size:12px;margin:0 0 12px}.work-preview p{margin:10px 0}.work-preview pre{font:12px/1.7 Consolas,monospace;padding:10px 0;background:transparent}.topbar button{font:inherit;color:inherit;width:28px;height:28px;cursor:pointer}.panel-tree{border-top:1px solid #8884;padding-top:12px}
@media(max-width:650px){aside{display:none}.topbar{padding:0 22px}.conversation{padding-top:18px}.date{margin-bottom:18px}}
</style><style id="lct-generated"></style><style id="lct-custom"></style><style id="lct-selection"></style>
</head><body><div data-lct-part="background"></div>
<aside data-lct-part="sidebar"><div class="brand"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18"/></svg>Codex</div>
<div class="nav active"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 3v14M3 10h14"/></svg>新建任务</div>
<div class="nav"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5"/><path d="m12 12 5 5"/></svg>搜索任务</div>
<div class="heading">工作空间</div><div class="thread">⌁ &nbsp; personal-website</div><div class="thread">⌁ &nbsp; weekend-project</div>
<div class="heading">最近的任务</div><div class="thread current">让工作空间更像自己</div><div class="thread">为首页添加一点绿意</div><div class="thread">整理组件与设计变量</div><div class="thread">一个新的灵感</div>
<div class="profile"><div class="avatar">L</div>Local workspace</div></aside>
<main data-lct-part="main"><div class="topbar"><span>让工作空间更像自己</span><div><button data-lct-part="toolbar-button" aria-label="更多操作">···</button></div></div>
<div class="conversation"><div class="date">今天 · 一个好的开始</div>
<div class="user" data-lct-part="user-message">帮我给这个项目，添一点自己的风格。</div>
<div class="assistant" data-lct-part="assistant-message"><div class="eyebrow"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M10 1v18M2 5l16 10M2 15 18 5"/></svg> CODEX</div>
<p>柔和的颜色，恰好的留白。让注意力回到真正重要的事情上。</p>
<pre data-lct-part="code-block"><span class="lang">TYPESCRIPT</span><code><span class="syntax">const</span> workspace = {
  mood: <span class="syntax">'focused'</span>,
  makeItYours: <span class="syntax">true</span>,
};</code></pre><div class="caption"><span>✓ 已完成</span><span>2 个文件更新</span></div></div></div>
<div class="composer-wrap"><div class="composer" data-lct-part="composer"><div class="placeholder">接下来，想做点什么？</div><div class="tools"><span>＋ &nbsp; GPT-5 &nbsp;⌄ &nbsp; · &nbsp; 默认</span><div class="send">↑</div></div></div><div class="footnote">这是主题预览，不会发送消息或修改文件</div></div></main>
<div class="work-preview"><section data-lct-part="summary-panel"><h3>输出内容</h3><p>创建文件或站点</p><hr><h3>来源</h3><p>参考图片.png</p><p>查看全部</p></section><section data-lct-part="workspace-panel"><h3>文件预览 · app.ts</h3><pre><span class="syntax">const</span> workspace = 'local';</pre><div class="panel-tree">项目目录<p>src / app.ts</p><p>README.md</p></div></section></div>
</body></html>`;
