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

test("server-renders the evidence-led product homepage", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Model Foreman/);
  assert.match(html, /从目标到交付/);
  assert.match(html, /每一步都有证据/);
  assert.match(html, /产品导览/);
  assert.match(html, /工作台/);
  assert.match(html, /任务输入/);
  assert.match(html, /角色与流程/);
  assert.match(html, /模型设置/);
  assert.match(html, /安全交付/);
  assert.match(html, /真实应用界面/);
  assert.match(html, /规划/);
  assert.match(html, /隔离执行/);
  assert.match(html, /本地验证/);
  assert.match(html, /人工批准/);
  assert.match(html, /长期目标/);
  assert.match(html, /工程记忆/);
  assert.match(html, /OpenAI Responses/);
  assert.match(html, /Anthropic Messages/);
  assert.match(html, /v0\.5\.5/);
  assert.match(html, /github\.com\/zhoujiacheng1031\/Model-Foreman/);
});

test("ships public product screenshots without raw personal paths", async () => {
  const [page, component] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ProductTour.tsx", import.meta.url), "utf8"),
  ]);

  for (const asset of ["product-workbench.png", "product-settings.png", "product-roles.png", "product-task-input.png"]) {
    await access(new URL(`../public/${asset}`, import.meta.url));
  }

  assert.match(component, /product-workbench\.png/);
  assert.match(component, /product-settings\.png/);
  assert.match(page, /product-roles\.png/);
  assert.match(page, /product-task-input\.png/);
  assert.doesNotMatch(`${page}\n${component}`, /Users\/zhoujiacheng/);
});

test("product tour is keyboard and pointer interactive", async () => {
  const component = await readFile(new URL("../app/ProductTour.tsx", import.meta.url), "utf8");
  assert.match(component, /role="tablist"/);
  assert.match(component, /role="tab"/);
  assert.match(component, /aria-selected=\{active === index\}/);
  assert.match(component, /onClick=\{\(\) => setActive\(index\)\}/);
  assert.match(component, /onMouseEnter=\{\(\) => setActive\(index\)\}/);
  assert.match(component, /onFocus=\{\(\) => setActive\(index\)\}/);
});

test("server-renders the product guide", async () => {
  const response = await render("/guide");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /MODEL FOREMAN GUIDE/);
  assert.match(html, /配置角色、模型与 Skills/);
  assert.match(html, /自定义 API 模型无法使用/);
  assert.match(html, /监控交付状态/);
  assert.match(html, /GitHub CLI/);
  assert.match(html, /交付向导/);
  assert.match(html, /创建长期目标/);
  assert.match(html, /需要时交给 Desktop/);
  assert.match(html, /常见问题/);
});

test("uses the current Foreman line-cat icon across site surfaces", async () => {
  const [page, layout, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  await access(new URL("../public/foreman-line-cat-icon.png", import.meta.url));
  assert.match(page, /className="brand-mark"/);
  assert.match(layout, /icon:\s*"\/foreman-line-cat-icon\.png"/);
  assert.match(layout, /apple:\s*"\/foreman-line-cat-icon\.png"/);
  assert.match(css, /background-image:url\('\/foreman-line-cat-icon\.png'\)/);
});
