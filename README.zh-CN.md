# DNS 记录查询

[English](README.md) · **简体中文**

[DNS 记录查询](https://dig.1ms.dog) 在浏览器里查任何域名的 DNS 记录：

- **记录**：A、AAAA、CNAME、MX、NS、TXT、CAA、SRV、SOA，默认查常用的 6 种。各家解析器一致的值合并成一行，
  同时给出各解析器剩下的 TTL 和返回它的解析器数量。
- **传播**：同一个问题同时发给 12 家公共解析器（走 DNS over HTTPS），逐家显示它自己的回答：谁已经有新值、
  谁还是旧值、谁连不上或没有回答。
- **邮件**：MX 记录；SPF（是否有多条、结尾是什么、要花几次 DNS 查询）；从 `_dmarc.<域名>` 读 DMARC（策略、
  rua、pct）；再把注册局的 NS 和解析器返回的 NS 放在一起对比。
- **注册信息**：注册商、注册和到期时间、状态、注册局的 NS，来自 RDAP。
- **分享**：结果可以生成链接和图片，10 种语言。链接是当时的快照，两个人看到的是同一份数据；里面只有域名和
  记录，没有访客的 IP。

线上：https://dig.1ms.dog

## 怎么查的

每条查询都是页面直接发给解析器的 DNS over HTTPS `GET`（RFC 8484），中间没有我们的服务器，也没有请求发往
1ms.dog。二进制 DNS 回答由 [`src/dns.mjs`](src/dns.mjs) 在浏览器里解析（约 250 行，不依赖 DNS 库）；合并结果在
[`src/merge.mjs`](src/merge.mjs)，邮件检查在 [`src/mail.mjs`](src/mail.mjs)。

12 家解析器是 Cloudflare、Google、Quad9、Control D、DNS.SB、CleanBrowsing、Rethink DNS、DNS4EU、CZ.NIC ODVR、
DNSForge、Tiarap、IIJ。选它们的条件：能用 wire-format DoH 回答，带浏览器可读的 CORS 头，并且在多个大洲可用。

三条规矩保证结果不骗人：

- **没回答的解析器不算「不一致」**。一致率的分母是给出回答的解析器；连不上的单列，绝不显示成空记录。
- **回答的家数少，不等于健康**。只有至少一半（6/12）解析器回答时，结论才用绿点；更少时直接写「只有 N 家
  回答」，点用中性色。
- **TTL 不同不算不一致**。TTL 从区域里的值往下倒数，各家剩余时间本来就不同，所以只显示范围，不参与比较。
- **不直连域名的权威服务器**。浏览器不能用 53 端口发 DNS，页面只能看到公共解析器缓存的内容——这正是「传播」
  的含义；区域里的当前真值这里看不到。

DMARC 在 `_dmarc.<域名>`，所以勾选 TXT 时每家解析器会多问一次这个名字。RDAP 走 https://rdap.org/，由它跳到
对应的注册局。

这一版没有：DNSSEC 验证、DKIM 选择器、证书检查（都是别的工具），也没有代理软件对接和账号体系。

## 文件

```
src/dns.mjs         DNS wire 格式：构造 DoH GET 查询、解析回答（不用库）
src/domain.mjs      访客输入 → 域名（URL、IDN、结尾的点；IP 拒绝）
src/resolvers.mjs   12 家解析器和记录类型
src/merge.mjs       按值合并、一致率、旧值解析器、TTL 范围
src/mail.mjs        SPF、DMARC、注册局 NS 与解析器 NS 的对比
src/rdap.mjs        从 rdap.org 取注册信息并规范化
src/code.mjs        分享结果与链接（/r/<code>）的互转
src/app.js          页面：查询、结论、表格、传播、邮件、注册信息、分享
src/worker.js       Worker：静态资源，以及分享链接的预览标题（noindex）
src/page.html       页面模板，每种语言一份
src/style.css       主题（--bg --fg --muted --line --ink），桌面和 375 px
src/i18n/*.mjs      10 种语言；键和占位符会跟英文逐一比对
scripts/build.mjs   生成 public/（页面、带哈希的资源、CSP、sitemap、robots、llms.txt）
scripts/assets.mjs  用 resvg 生成 public/og/<lang>.png（1200 × 630）
public/             生成的文件，随源码提交；assets/share/ 从 1ms.dog 外壳原样复制
test/               node --test：wire 解析、合并、SPF/DMARC、RDAP、分享码、页面、Worker
```

## 本地运行

```bash
npm install
npm run build     # 生成 public/
npm test          # build --check + 单元和页面测试
npm run dev       # wrangler dev，http://localhost:8794
```

部署：`npm run deploy`。在 1ms.dog 上域名由外壳路由；自己部署时在 Cloudflare 面板把域名绑到这个 Worker，
构建时用 `SITE_URL=https://你的域名 npm run build`。两种情况下 DNS 查询都不经过 Worker，Worker 只改写分享链接的 HTML。

## 加一家解析器

1. 确认它的 DoH 能回答 wire-format GET、带 CORS，并且不止一个网络可用：
   `curl 'https://…/dns-query?dns=AAABAAABAAAAAAAAB2V4YW1wbGUDY29tAAABAAE' -H 'accept: application/dns-message' -i`
   （200、`content-type: application/dns-message`、`access-control-allow-origin: *`）。
2. 加进 `src/resolvers.mjs`。
3. `npm run build && npm test`，再 `npm run dev`，把它的回答和其他家对一遍。

## 隐私

页面把每条 DNS 查询从访客的浏览器直接发给「传播」里列出的解析器；RDAP 查询发给 rdap.org。1ms.dog 的服务器
看不到查询和回答，也不记日志。分享链接里只有域名、记录和页面上显示的注册信息，没有访客的 IP；分享弹窗在
每种语言里都写明了这一点。没有 Cookie、没有账号，也没有外壳页面计数之外的统计。

## 许可

MIT。1ms.dog 的 logo 和名称归 1ms.dog。
