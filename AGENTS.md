# AGENTS.md

给在这个仓库里干活的人和 AI 代理（Claude Code、Codex、Cursor 等都适用）。

## 这是什么

dig.1ms.dog（DNS 记录查询）：在浏览器里查任何域名的 DNS 记录、传播情况、邮件记录和注册信息。12 家公共
解析器同时问（DNS over HTTPS，从访客的浏览器直接发），结果按值合并，再逐家显示各自的回答；SPF、DMARC 和
注册局 NS 用大白话解释；RDAP 给出注册商、日期和状态。结果可以分享成链接和图片，10 种语言。

先读 [README.zh-CN.md](README.zh-CN.md)（功能、文件、本地运行、加解析器），再读
[docs/decisions.md](docs/decisions.md)（为什么这样做、试过什么）。1ms.dog 全站的运营说明和密钥在私有仓库，
不在这里。

## 本地跑起来

```bash
npm install
npm run build      # 由 src/ 生成 public/；public/ 是要提交的
npm test           # build --check，再跑 test/*.test.mjs
npm run dev        # wrangler dev，http://localhost:8794
```

## 测试：按改动范围选

| 改了什么 | 跑什么 |
|---|---|
| 任何 `src/`、`scripts/`、文案 | `npm test`（先确认 public/ 已重新生成并提交，再跑 42 个测试：wire 解析、合并、SPF/DMARC、RDAP、分享码、页面、Worker）。提交前必须通过 |
| 页面外观 | 再在浏览器里看桌面和手机宽度 375 px，中文和俄语（字最长）；页面不能横向滚动；第一屏要能看到输入框和结论 |
| 解析器列表 `src/resolvers.mjs` | 按 README 的步骤逐家确认 DoH + CORS，最好从另一个网络也看一次；再 `npm run build && npm test` |
| 分享组件 `public/assets/share/` | **不要改**。它是外壳 `assets/share/` 的原样复制；要改先去外壳仓库改那一份，再同步过来 |
| 上线后 | 打开线上页面，桌面和手机各看一遍 |

## 部署和发版

- **网站**：推送 `main` 就是上线。Cloudflare Workers Builds 跑 `npm ci && npm test`，再 `npx wrangler deploy`。
  `public/` 是生成的文件，要和源码一起提交。Worker 不绑域名（`wrangler.toml`），在 1ms.dog 上由外壳把域名
  路由过来；自己部署时在 Cloudflare 面板绑自己的域名，构建时用 `SITE_URL=https://<your-domain> npm run build`。
- **Worker 只做两件事**：发静态文件，以及把 `/r/<code>` 的标题和预览改成分享结果（noindex）。DNS 查询永远
  不经过 Worker，也不经过 1ms.dog 的任何服务器。

## 规矩

- 文案 10 种语言都要有，键和占位符一致（`npm test` 会查）。数量放在名词后面写（「解析器 3 家」），避开各语言
  的复数变化。
- 隐私照实写：查询从访客浏览器直达解析器；分享链接里没有 IP；RDAP 走 rdap.org。改隐私说法要同时改帮助里的
  「我的查询去哪了？」、分享弹窗（组件自带）和 README。
- **没回答的解析器不算不一致**：一致率的分母是给出回答的解析器；连不上、超时、没问的单列，不能显示成空记录。
  TTL 不同不是不一致。回答不足一半（<6/12）时结论不能是绿点或健康语气，只能写「只有 N 家回答」。这是这个
  页面的底线，改合并或结论逻辑前先想清楚。
- 不做：直连权威 NS（浏览器 53 端口发不出去）、猜 DKIM 选择器、证书检查、代理软件对接、账号体系。v1 也不
  自己加代理；要给 Worker 加转发必须先问站长。
- 不往仓库里放密钥，不写进文档和提交说明。
- **改样式和界面前，先把方案给站长看**；推 `main` 等于上线，要站长当次同意。
- 外壳仓库不要改：登记 `sites.js`、README 表格、导航、Worker 路由由 Public 会话做。
- 技术取舍和测过的结论写进 `docs/decisions.md`。提交说明用英文，文档用中文。
