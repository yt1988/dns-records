# 域名透视（Domain X-Ray）

[English](README.md) · **简体中文**

[域名透视](https://dig.1ms.dog) 在浏览器里查任何域名的 DNS 记录，并给出一个体检等级：

- **记录**：A、AAAA、CNAME、MX、NS、TXT、CAA、SRV、SOA，默认查常用的 6 种。各家解析器一致的值合并成一行，
  同时给出各解析器剩下的 TTL 和返回它的解析器数量。
- **解析器回答**：同一个问题同时发给 12 家公共解析器（走 DNS over HTTPS），逐家显示它自己的回答：谁已经有
  新值、谁还是旧值、谁连不上或没有回答。
- **体检等级**：首屏三张卡——解析一致、邮件等级、DNSSEC。等级取解析和邮件两项里较低的那个；DNSSEC 断链
  再降一级，没启用不扣分。CAA 和 IPv6 只做徽章。
- **邮件**：MX 记录；SPF（是否有多条、结尾是什么、要花几次 DNS 查询）；从 `_dmarc.<域名>` 读 DMARC（策略、
  rua、pct）；再把注册局的 NS 和解析器返回的 NS 放在一起对比。
- **DNSSEC**：向父区查 DS 记录，再读已知会验证的解析器的 AD 位，分成「已启用，验证通过」「已启用，但验证
  失败」「未启用」「无法判断」四种；不到 2 家合格验证器回答时只写无法判断。
- **注册信息**：注册商、注册和到期时间、状态、注册局的 NS，来自 RDAP。
- **分享**：结果可以生成链接和图片，10 种语言。链接是当时的快照，两个人看到的是同一份数据；里面只有域名和
  记录，没有访客的 IP。

线上：https://dig.1ms.dog

## 怎么查的

每条 DNS 查询都是页面直接发给解析器的 DNS over HTTPS `GET`（RFC 8484），中间没有我们的服务器，DNS 查询也不发往
1ms.dog。二进制 DNS 回答由 [`src/dns.mjs`](src/dns.mjs) 在浏览器里解析（约 250 行，不依赖 DNS 库）；合并结果在
[`src/merge.mjs`](src/merge.mjs)，邮件检查在 [`src/mail.mjs`](src/mail.mjs)，DNSSEC 判定在
[`src/dnssec.mjs`](src/dnssec.mjs)，等级在 [`src/grade.mjs`](src/grade.mjs)。

12 家解析器是 Cloudflare、Google、Quad9、Control D、DNS.SB、CleanBrowsing、Rethink DNS、DNS4EU、CZ.NIC ODVR、
DNSForge、Tiarap、IIJ。选它们的条件：能用 wire-format DoH 回答，带浏览器可读的 CORS 头，并且在多个大洲可用。

四条规矩保证结果不骗人：

- **连不上的解析器不算「不一致」，也不扣分**。一致率的分母是给出回答的解析器；连不上（超时、被挡、读不回）
  既不进分母，也不降等级——不知道就是不知道。SERVFAIL、REFUSED 和其他 rcode 是解析器就这个域名作答，算作答。
- **回答的家数少，不等于健康**。解析这一项在作答的解析器全部一致时是 A；至少 6 家作答才有等级，更少时只写
  「只有 N 家回答」，不给绿点，也不给字母。
- **TTL 不同不算不一致**。TTL 从区域里的值往下倒数，各家剩余时间本来就不同，所以只显示范围，不参与比较。
- **不直连域名的权威服务器**。浏览器不能用 53 端口发 DNS，页面只能看到公共解析器缓存的内容；区域里的当前
  真值这里看不到。

DMARC 在 `_dmarc.<域名>`，所以勾选 TXT 时每家解析器会多问一次这个名字。DNSSEC 的 DS 只问两家已经回答过其他
记录类型的解析器（优先 Cloudflare、Google），正常查询不带 EDNS DO 位，AD 读的是回答头里的 AD 位。注册信息先在
浏览器里读：走 https://rdap.org/，由它跳到对应的注册局，或者直接问不在 IANA 引导表里、但有带 CORS 的公开 RDAP
的后缀（目前是 .io）。浏览器读不了注册局的时候——后缀没有 RDAP（.cn、.jp、.ru、.hk），或者 RDAP 不带 CORS
头（.de）——页面会问 Worker 的 `GET /whois?d=<域名>`：它先试不带 CORS 的 RDAP，再试注册局 43 端口的 WHOIS（目前
是 CNNIC、JPRS、TCI 和 HKDNR）。这种回答在页面上标成「由 1ms.dog 的服务器代查」，内容只有注册商、日期、状态和
NS：注册人姓名、邮箱、电话一律不读出、不返回。两样都没有的后缀（目前是 .vn）写「查不到这个后缀的注册信息」，
并给出注册局 WHOIS 页面的链接，不说成「这个域名没有注册信息」。

这一版没有：DKIM 选择器、证书检查（都是别的工具），也没有代理软件对接和账号体系。

## 文件

```
src/dns.mjs         DNS wire 格式：构造 DoH GET 查询、解析回答（不用库）
src/domain.mjs      访客输入 → 域名（URL、IDN、结尾的点；IP 拒绝）
src/resolvers.mjs   12 家解析器和记录类型
src/merge.mjs       按值合并、一致率、旧值解析器、TTL 范围
src/mail.mjs        SPF、DMARC、注册局 NS 与解析器 NS 的对比
src/dnssec.mjs      DS 的回答、AD 位、合格验证器名单 → 四种 DNSSEC 状态
src/grade.mjs       解析等级、邮件等级、总等级（DNSSEC 断链降一级）
src/rdap.mjs        从 rdap.org 取注册信息并规范化；补充表（.io）；浏览器读不了注册局时页面发的请求
src/whois.mjs       Worker 的注册信息查询：不带 CORS 的 RDAP、.cn/.jp/.ru/.hk 的 43 端口 WHOIS，以及只留
                    注册商、日期、状态、NS 的文本解析
src/whois-net.js    Cloudflare 的 sockets API，只在处理 /whois 请求时引入
src/code.mjs        分享结果与链接（/r/<code>）的互转
src/app.js          页面：查询、结论、三张卡、表格、解析器回答、邮件、注册信息、分享
src/worker.js       Worker：静态资源、分享链接的预览标题（noindex），以及 GET /whois
src/page.html       页面模板，每种语言一份
src/style.css       主题（--bg --fg --muted --line --ink），桌面和 375 px
src/i18n/*.mjs      10 种语言；键和占位符会跟英文逐一比对
scripts/build.mjs   生成 public/（页面、带哈希的资源、CSP、sitemap、robots、llms.txt）
scripts/assets.mjs  用 resvg 生成 public/og/<lang>.png（1200 × 630）
scripts/dnssec-probe.mjs  在能发 DoH 的机器上核对各家解析器的 DNSSEC 行为
public/             生成的文件，随源码提交；assets/share/ 从 1ms.dog 外壳原样复制
test/               node --test：wire 解析、合并、SPF/DMARC、DNSSEC、等级、RDAP、分享码、页面、Worker
```

## 本地运行

```bash
npm install
npm run build     # 生成 public/
npm test          # build --check + 单元和页面测试
npm run dev       # wrangler dev，http://localhost:8794
```

部署：`npm run deploy`。在 1ms.dog 上域名由外壳路由；自己部署时在 Cloudflare 面板把域名绑到这个 Worker，
构建时用 `SITE_URL=https://你的域名 npm run build`。两种情况下 DNS 查询都不经过 Worker：Worker 只改写分享链接的
HTML，以及代查浏览器读不了的注册信息。

## 加一家解析器

1. 确认它的 DoH 能回答 wire-format GET、带 CORS，并且不止一个网络可用：
   `curl 'https://…/dns-query?dns=AAABAAABAAAAAAAAB2V4YW1wbGUDY29tAAABAAE' -H 'accept: application/dns-message' -i`
   （200、`content-type: application/dns-message`、`access-control-allow-origin: *`）。
2. 加进 `src/resolvers.mjs`。
3. `npm run build && npm test`，再 `npm run dev`，把它的回答和其他家对一遍。
4. 想让它参与 DNSSEC 判定，先用 `scripts/dnssec-probe.mjs` 确认它会验证（签名域名设 AD、坏链域名 SERVFAIL），
   再加进 `src/dnssec.mjs` 的 `VALIDATORS`。

## 隐私

页面把每条 DNS 查询从访客的浏览器直接发给「解析器回答」里列出的解析器，1ms.dog 的服务器看不到 DNS 查询和回答。
注册信息也是浏览器自己去问（rdap.org，或注册局自己的 RDAP）。浏览器读不了注册局时，页面问 Worker 的 `/whois`：
先试 RDAP，再试注册局 43 端口的 WHOIS，只返回上面列出的那几项，注册人信息不读出、不返回，页面上也标明了这是
服务器代查。这些查询缓存 12 小时（失败 10 分钟），不记日志。分享链接里有域名自己的公开记录和页面上显示的注册
信息，没有访客的 IP；分享弹窗和问答里都写明了这一点。没有 Cookie、没有账号，也没有外壳页面计数之外的统计。

## 许可

MIT。1ms.dog 的 logo 和名称归 1ms.dog。
