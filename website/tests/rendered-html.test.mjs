import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Model Foreman product page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Model Foreman/);
  assert.match(html, /把多个模型/);
  assert.match(html, /拧成一条交付线/);
  assert.match(html, /ONE CONTROLLED THREAD/);
  assert.match(html, /强模型先把方向想清楚/);
  assert.match(html, /执行模型只在隔离区动手/);
  assert.match(html, /证据决定任务是否完成/);
  assert.match(html, /最后一步仍由人类掌控/);
  assert.match(html, /长期目标/);
  assert.match(html, /原生技能/);
  assert.match(html, /GITHUB REPOSITORY/);
  assert.match(html, /DELIVERY CONTROL/);
  assert.match(html, /从 GitHub 克隆/);
  assert.match(html, /OPEN PULL REQUEST/);
  assert.match(html, /RECENT ACTIONS/);
  assert.match(html, /高风险操作保留人工门禁/);
  assert.match(html, /一次只执行当前步骤/);
  assert.match(html, /RUN OBSERVABILITY/);
  assert.match(html, /STEP RESOURCE LEDGER/);
  assert.match(html, /输入 \/ 输出 Token/);
  assert.match(html, /本地工程记忆/);
  assert.match(html, /v0\.5\.5 · macOS \+ Windows/);
  assert.match(html, /OpenAI Responses/);
  assert.match(html, /Anthropic Messages/);
  assert.match(html, /github\.com\/zhoujiacheng1031\/Model-Foreman/);
  assert.match(html, /class="brand-mark"/);
  assert.doesNotMatch(html, />F<\/span>/);
  assert.doesNotMatch(html, />MF<\/span>/);
});

test("server-renders the product guide", async () => {
  const response = await render("/guide");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /MODEL FOREMAN GUIDE/);
  assert.match(html, /配置角色、模型与 Skills/);
  assert.match(html, /自定义 API 模型无法使用/);
  assert.match(html, /监控交付状态/);
  assert.match(html, /界面勾选指定必用/);
  assert.match(html, /GitHub CLI/);
  assert.match(html, /交付向导/);
  assert.match(html, /每次只执行你明确确认的当前步骤/);
  assert.match(html, /brew install gh/);
  assert.match(html, /gh auth login/);
  assert.match(html, /CLI 没有报告的数据会显示 0/);
  assert.match(html, /创建长期目标/);
  assert.match(html, /最大返工轮次位于/);
  assert.match(html, /进入长期记忆候选/);
  assert.match(html, /需要时交给 Desktop/);
  assert.match(html, /常见问题/);
});

test("uses the shared Foreman icon across site surfaces", async () => {
  const [page, layout, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  await access(new URL("../public/foreman-yarn-cluster-icon.png", import.meta.url));
  assert.match(page, /className="brand-mark"/);
  assert.match(layout, /icon:\s*"\/foreman-yarn-cluster-icon\.png"/);
  assert.match(layout, /apple:\s*"\/foreman-yarn-cluster-icon\.png"/);
  assert.match(css, /background-image:url\('\/foreman-yarn-cluster-icon\.png'\)/);
});

test("keeps core product sections on one shared desktop track", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /className="repository-section section feature-track"/);
  assert.match(page, /className="repository-copy feature-track-copy"/);
  assert.match(page, /className="observability-section section feature-track"/);
  assert.match(page, /className="observability-copy feature-track-copy"/);
  assert.match(css, /\.repository-section,\.observability-section\s*\{[^}]*max-width:1240px;/s);
  assert.match(css, /\.section \.section-title,\.story-section \.section-title\s*\{[^}]*font-size:clamp\(38px,4\.2vw,62px\);/s);
});

test("uses one bilingual hierarchy and even spacing across marketing sections", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.equal(page.match(/className="section-kicker"/g)?.length, 8);
  assert.equal(page.match(/className="section-title"/g)?.length, 8);
  assert.match(page, /<b>交付控制<\/b><em>DELIVERY CONTROL<\/em>/);
  assert.match(page, /<b>运行可观测<\/b><em>RUN OBSERVABILITY<\/em>/);
  assert.match(page, /<b>原生技能<\/b><em>NATIVE SKILLS<\/em>/);
  assert.doesNotMatch(page, /<h2>[^<]*<br\s*\/>/);
  assert.match(css, /\.section\s*\{\s*padding-block:clamp\(100px,9vw,144px\);/);
  assert.match(css, /\.section \.section-kicker,\.story-section \.section-kicker\s*\{[^}]*display:flex;[^}]*color:#625fe2;/s);
});

test("ships an accessible one-screen product story", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../app/FeatureStory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(component, /onMouseEnter=\{\(\) => setActive\(index\)\}/);
  assert.match(component, /onFocus=\{\(\) => setActive\(index\)\}/);
  assert.match(component, /aria-pressed=\{active === index\}/);
  assert.match(component, /IMPLEMENTATION CONTRACT/);
  assert.match(component, /30 \/ 30 gates passed/);
  assert.match(component, /查看并确认交付/);
  assert.doesNotMatch(component, /IntersectionObserver/);
  assert.match(css, /main \{ overflow: clip; \}/);
  assert.match(css, /\.title-lock \{ display:inline-block; white-space:nowrap; \}/);
  assert.match(css, /\.story-copy-list \{ height:632px;display:flex;flex-direction:column;/);
  assert.match(css, /\.story-sticky\s*\{[^}]*position:relative;top:auto;/s);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\).*\.story-scene/s);
});
