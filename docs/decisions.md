# 设计取舍

按日期记。改东西之前先看这里，尤其是「没回答的解析器不算不一致」和「分享是快照」两条。

## 2026-11-11 · v1

### 范围

一个页面回答四件事：记录是什么、传播到哪了、邮件记录说了什么、注册信息是什么。输入接受域名和 URL
（`normalizeDomain` 会取 hostname、转 punycode、去掉结尾的点），IP、单标签名和纯数字 TLD 直接拒绝并说明原因。
不做 DNSSEC、DKIM 选择器、证书检查、代理对接和账号；这些都是别的工具或下一版的事。

### 为什么是这 12 家解析器

条件是：DoH 支持 wire-format `GET ?dns=`，回答带 `access-control-allow-origin`，浏览器能读，而且在多个大洲
可用。逐家验证后留下 Cloudflare、Google、Quad9、Control D、DNS.SB、CleanBrowsing、Rethink DNS、DNS4EU、
CZ.NIC ODVR、DNSForge、Tiarap、IIJ。DNS 测速工具里的 33 家里，很多只有 JSON API、没有 CORS，或者只有 `POST`，
浏览器读不到回答，所以不在这里凑数。12 家也足够看出传播，又不至于让一次查询等太久。

### 自己写 wire 解析，不用库

`src/dns.mjs` 约 250 行：构造查询（EDNS OPT、AD 位）、解析 header/question/answer、域名压缩指针、A/AAAA/
CNAME/MX/NS/SOA/TXT/CAA/SRV，未知类型保留 `TYPE<n>` 和十六进制预览。这样没有依赖、能控制错误（指针环、
越界、截断都报出来）、bundle 也小。测试用手工构造的响应包覆盖每种记录和错误分支。

### 查询怎么发

12 家解析器并行；每家内部按勾选的类型顺序问，超时 4.5 秒。某家第一次出现超时、连不上或 HTTP 错误，就标记
这家「不可达」，剩下的类型记为 `skipped`，不再白等——但 `skipped` 和「超时」是两种状态，界面上分开写。
进度按「解析器 × 类型」计数。勾选 TXT 时每家多问一次 `_dmarc.<域名>`，这次也算进度，也进分享快照。

读不到的回答（HTTP 错误、解析失败、SERVFAIL、REFUSED、其他 rcode）都保留成一条错误，不丢弃：传播面板里
必须逐家说明为什么没有值，不能留空。

### 一致率与 TTL

一致率 = 给出**可读回答**的解析器里，最常见那组回答所占的比例。失败的、没问的不进分母，否则「9 家连不上」
会被误读成「9 家不一致」——这是这个页面最容易骗人的地方。只有一家回答时一致率是 `null`，显示「—」，不显示
100%。NXDOMAIN 和空回答是真实回答，算进分母。

TTL 只是各家缓存剩余时间，不同不是不一致；合并行显示 `最小–最大` 秒。CNAME 链算回答的一部分，比较时按
「类型 + 值」排序，顺序和 TTL 不影响。

**覆盖度也算结论的一部分。** 只有少数解析器回答时，即使它们全一致，也不代表传播健康——大陆出口下经常只有
3–4 家能连上。所以绿点只在「回答的家数 ≥ 12 的一半（6 家）」且一致时用；不足一半时文案改成「只有 3 家回答，
都一致」，点用中性色。这一条来自站里的 `docs/lessons.md`：「看起来对、其实没测到」不能说成健康。

### 邮件

- SPF：找 `v=spf1`，检查是否多条、结尾是 `+all/-all/~all/?all`、是否 `all` 在最后、`include/a/mx/ptr/exists/
  redirect` 需要几次额外查询（上限 10）。不展开 include，所以查询次数是下限，帮助里写明了。
- DMARC：从 `_dmarc.<域名>` 的 TXT 读 `p`、`sp`、`rua`、`pct`；没有、`p=none`、没有 rua 都算提醒。
- MX：`0 .` 是 RFC 7505 的 null MX，意思是这个域名不收信，单独说明，不显示成一台叫「.」的服务器。
- NS：RDAP 的注册局列表和解析器返回的列表做大小写、结尾点归一化后对比，两边差什么都列出来。RDAP 拿不到时
  写「没有可对比的注册信息」，不猜。

### RDAP

`https://rdap.org/domain/<name>`，它 302 到对应注册局，两段都带 CORS。只显示注册局真的发布了的字段；缺失
显示「—」/未知，不显示「没有」。注册商链接只在 RDAP 给了 `links` 时出现。注册局数据可能比解析器旧，所以
NS 对比的结论是「两边不一样」，不是「解析器错了」。

### 分享

`/<lang>/r/1~<code>`：路径，不是 query 或 hash，这样 Worker 能按语言给标题和 noindex，聊天工具也能拿到完整
URL。code 是 `codec.js`（外壳原样复制）压缩的 JSON，版本号开头；新格式换版本号，旧链接继续能开。快照里有
域名、勾选的类型、时间、每家每类型的回答（记录 + TTL）和页面上显示的注册字段，没有 IP、没有 UA。

链接打开不重新查询——两个人比的是同一份数据；页面顶部用公共 `received()` 横幅说明这是分享结果，并给「测测
我的」。分享卡片用公共 `share()` 画：域名、一致率、最多四条值；值先缩小再换行，不丢字。Worker 只改写标题、
description 和 robots，动态 OG 图不做（没有存储，也不值得为一张预览图引入 KV）。

### 页面

顺序是「结论 → 三个数字 → 最多四条发现 → 证据」：先给一句话和一致率，再展开合并表、传播逐家表、邮件和
注册信息。移动优先：输入框 16 px（iOS 不缩放），375 px 无横向滚动，第一屏能看到输入和结论；表格自己横向
滚动，不撑破页面。颜色只用平台的 `--bg --fg --muted --line --ink`，浅色/深色/跟随系统三态跟随外壳。帮助
弹窗在右上角，10 种语言的问答由 `docs` 数组生成，同时进 FAQ JSON-LD。

10 种语言的键和占位符由 `scripts/build.mjs` 逐一比对；页面上没有第二种语言的漏网文字（动态文字也走 `t()`）。
`app_name` 按语言翻译，产品名和对外登记由站长确认。

### 构建与部署

`public/` 是生成物并提交：页面、带内容哈希的 JS/CSS、每种语言的字符串文件、sitemap、robots、llms.txt、
`_headers`（CSP 只有一段内联预涂脚本的 sha256）。Worker 用静态资源绑定，只有 `/r/...` 进 Worker；还没接
Workers Builds 时手动 `npx wrangler deploy`。

`connect-src` 写的是 `'self' https:`，不是逐家清单。原因：12 家 DoH 地址是固定的，可以列出来，但 RDAP 走
rdap.org 后会 **302 到各注册局自己的 RDAP 服务器**（Verisign、PIR、Nominet、DENIC…），CSP 会检查重定向后的
地址；注册局有上百家且各不相同，列不全就会有一批域名读不到注册信息。两个替代方案都不适合 v1：列「12 家 +
rdap.org + 常见注册局」仍有缺口；把 RDAP 改成 Worker 代理则要引入服务端请求（我们的服务器会看到访客查的域名），
与「查询不经过我们服务器」的隐私说明冲突，且要站长同意。所以 v1 保持 `https:`，并在 README 和本文件写明原因。

### 没做和待定

- 没有代理/转发：v1 的所有查询都在浏览器里完成，Worker 不代取任何 URL。要加必须站长同意。
- 没有直连权威 NS：浏览器发不出 53 端口的 DNS，也不该假装能。
- 产品名（各语言 `app_name`）、站点登记（`sites.js`、README 表格、导航）、Workers Builds 连接，都要 Public/
  站长处理；本仓库不改外壳。

## 2026-11-11 · v2 DNSSEC 探针（东京 VPS）

准备把 DNSSEC 做进页面，先回答一个问题：这 12 家里，哪几家真的会验证、会在回答里设 AD。只设查询的 AD 位
不够，OPT 里还要带 DO；探针（`scripts/dnssec-probe.mjs`，跑 `node scripts/dnssec-probe.mjs`）问
`cloudflare.com`（已签名）、`google.com`（未签名）、`dnssec-failed.org`（故意坏链）三个名字。Public 在东京
VPS 上的结果：

| 解析器 | 已签名 | 未签名 | 坏链 | 判定 |
|---|---|---|---|---|
| Cloudflare | AD | no-AD | SERVFAIL | 会验证 |
| Google | AD | no-AD | SERVFAIL | 会验证 |
| Control D | AD | no-AD | SERVFAIL | 会验证 |
| Rethink DNS | AD | no-AD | SERVFAIL | 会验证 |
| DNSForge | AD | no-AD | SERVFAIL | 会验证 |
| Tiarap | AD | no-AD | SERVFAIL | 会验证 |
| IIJ | AD | no-AD | SERVFAIL | 会验证 |
| DNS.SB | AD | no-AD | HTTP 503 | 会验证；坏链返回 503 而不是 SERVFAIL |
| CleanBrowsing | no-AD | no-AD | NOERROR | **不验证，永久排除** |
| Quad9 | HTTP 505 | HTTP 505 | HTTP 505 | 请求形状被拒，待试 POST 或换路径 |
| DNS4EU | 连不上 | 连不上 | 连不上 | 待换网络复测 |
| CZ.NIC ODVR | 连不上 | 连不上 | 连不上 | 待换网络复测 |

结论和拟用规则（实现要等站长批准）：

- **合格验证器 7 家**（Cloudflare、Google、Control D、Rethink、DNSForge、Tiarap、IIJ），加上 DNS.SB 有条件
  可用。判「通过 / 断链」要求至少 2 家合格验证器，避免单家误判。
- **CleanBrowsing 永久排除**：本机实测它对 `dnssec-failed.org` 返回 NOERROR + A，AD=0 只是因为它不验证，
  不能当作「断链」。
- **DNS.SB 只用于「通过」**：AD=1 可以算验证通过；坏链的 HTTP 503 可能是它拒绝坏签名，也可能是服务故障，
  不拿来判「断链」。
- **Quad9** 是知名验证器，505 是我们这种 `GET` + `accept: application/dns-message` + DO 的请求形状被拒；
  实现前花十分钟试 `POST` 或别的路径，能通就加进名单。
- 只有父区 DS 明确不存在时才写「未启用」；DS 查询失败、或合格验证器不足 2 家时写「无法判断」。
- 实现细节：`src/dns.mjs` 的 OPT 加 DO（现在只设查询的 AD 位），加 `DS`(43) 和 `DNSKEY`(48) 类型，只读有没有，
  不解析签名。

还没做：代码；Quad9 的 POST 试法；DNS4EU 和 CZ.NIC 的换网络复测。解析器列表变了要重跑探针。

## 2026-11-11 · v2 实现：改名、体检等级、DNSSEC、首屏和分享卡

站长批准方案后一次做完（上线前状态）。范围是改名和文案、首屏三张卡、体检等级、DNSSEC；泛解析 / CNAME /
NS 归属留给上线后。

**名字**：页面里叫「域名透视 / Domain X-Ray」，短名「域名 / Domain」，域名仍是 dig.1ms.dog，工具 id 仍是
`dig`——URL 是短手柄，品牌在页面里，和 who.1ms.dog 叫 Who Are You 一个道理。10 种语言按 `translation.md`
的新词表写：DNS resolver 是「解析器 / リゾルバー / 리졸버 / resolvedor / résolveur / Resolver / DNS-резолвер」，
解析器和服务器不是一回事，不做全站替换。「传播」这个词不再用于这一页，改成「解析器回答」。

**查询形状**：普通查询仍然只设头里的 AD 位，不加 EDNS DO。只有 DS 这一条查询带 DO——Quad9 对 `GET` + DO 回
HTTP 505，而普通查询它答得很好；DS 又是唯一必须带 DO 才有意义的查询，所以只在这一处冒这个风险。DS 只问两家
已经回答过其他记录类型的解析器（优先 Cloudflare、Google，都不是就问其他合格验证器），这样大陆访客也拿得到
DS 的回答；两家都问不到就按「无法判断」处理。AD 一律读回答头里的 AD 位，不信任何一家没在探针里验证过的解析器。

**Quad9 排除**：按站长的话试过 POST 和别的路径，从开发机都连不上（这台机器整体连不上 DoH），没有证据表明它
能用，就不进 `VALIDATORS`。它仍然作为 12 家之一回答记录，只是不参与 DNSSEC 判定。DNS4EU、CZ.NIC 同理。

**DNSSEC 判定**（`src/dnssec.mjs`）：

- `pass`：父区有 DS，至少 2 家合格验证器回答，且所有回答的合格验证器都设了 AD。DNS.SB 的 AD 可以凑数。
- `broken`：父区有 DS，**没有一家**验证器给出 AD，且有 2 家以上合格验证器 SERVFAIL。
- `off`：父区明确说没有 DS（NOERROR 且没有 DS 记录）。
- 其余（DS 没问到、验证器不够、只有部分 AD）一律 `unknown`，页面写「无法判断」。

比探针阶段的草案收紧了一处：草案写的是「AD 的合格验证器少于 2 家且有 2 家 SERVFAIL 就断链」，实现改成
「一家都没有 AD」。理由是 AD 只证明「有效」，不证明「唯一」：只要有一家验过，就说明这条链在某个地方是通的，
那是分歧而不是断链，而断链是唯一会扣分、会吓到站长的状态，宁可写「无法判断」。DNS.SB 的 503 不算 SERVFAIL，
所以它不会挡掉真正的断链判定。

**体检等级**（`src/grade.mjs`）：

- 解析：12 家全回答且回答全相同才 A；少一家或有一家不同就是 B；回答不足 6 家（`ok * 2 < 12`）或没有记录时
  不出等级。
- 邮件：只在有能收信的 MX、且 SPF 和 DMARC 都问到时才评。SPF 和 DMARC 各最多贡献一条备注（p=none 又没有 rua
  算一条）。两个问题 → D，一个问题或两条备注 → C，一条备注 → B，否则 A。
- 总等级：解析和邮件里较低的那个；DNSSEC `broken` 再降一级（A→B，D 还是 D）。DNSSEC 未启用、CAA 和 IPv6
  都不影响等级——大多数域名没开 DNSSEC，扣分等于什么都没说。CAA 和 IPv6 只做徽章。
- 首屏三张卡就是这三个数：解析一致（`多数/回答数`）、邮件等级、DNSSEC 状态；结论点色跟总等级走，D 是红的，
  断链另起一条坏消息。

**分享卡**：不再画记录值，改成左侧一个等级方块、右边三个格子（解析一致、邮件、DNSSEC）、下面一行覆盖情况
（几家回答 / 几家没回答）和一行发现的问题数，问题逐条换行、最多两行，靠 `kit.fit` / `kit.wrap` 保证不裁剪
（`window.__msShareClips` 必须为空）。卡高从 760 改成 720。快照格式加了 `dn: [state, answered]`；老链接没有
这一项时 DNSSEC 显示「—」，不猜。没回答的解析器仍然不进一致率的分母。

**没做**：泛解析检测、CNAME 链展示、NS 归属对比（上线后）；DKIM 选择器仍是明确不做。


## 2026-11-11 · 注册信息两级措辞、补充表，和查询时的布局骨架

站长用 sina.cn 发现的问题：.cn 根本没有 RDAP，页面却写「这个域名没有注册信息」——把「没问到」说成了「没有」。
这一批顺带做了查询过程中的布局骨架。

**RDAP 只覆盖 IANA 引导表**（约 1,200 个后缀，rdap.org 按它路由）。.cn、.jp、.ru、.hk、.de、.vn 不在表里。
rdap.org 对这类后缀回的不是注册局的 404，而是它自己的
`{"errorCode":404,"title":"No RDAP service is available for this resource"}`，所以浏览器能分清两种 404。
`src/rdap.mjs` 的判定顺序：

1. 后缀命中补充表（`RDAP_SUPPLEMENTS`，目前只有 .io → Identity Digital）→ 直接问注册局；它的 404 就是域名不存在。
2. rdap.org 回 404 且 body 里有 `no rdap service` → `unsupported`，带上后缀。
3. rdap.org 回 404、body 读不到、但后缀在已知无 RDAP 的名单（`NO_RDAP_TLDS`）里 → 同样 `unsupported`。
4. 其余 404 → `notFound`：注册局确实说没有这个域名。

两级措辞：`notFound` 写「查不到注册数据 / 注册局回答了，但没有这个域名的注册数据，通常说明域名还没有注册」；
`unsupported` 写「.cn 没有公开可用的 RDAP / RDAP 只覆盖 IANA 引导表里的后缀…」，后面跟一句去注册局 WHOIS
页面查的链接（CNNIC、JPRS、TCI、HKDNR、VNNIC）。两段话不重复：标题是结论，正文是原因。

**为什么只补了 .io**：.io 不在引导表里，但 Identity Digital 的 RDAP 带 `access-control-allow-origin: *`，
浏览器能直接问（实测 200）。其它缺的后缀要么没有 RDAP（.cn、.jp 的 `rdap.nic.ad.jp` 回 501），要么有 RDAP 但
不带 CORS（.de 的 DENIC），浏览器都用不了；43 端口的 WHOIS 同样发不出去。补充表按「能 CORS、能答、有数据」三
条往里加，加一个之前先用 curl 看一眼响应头和 404 形状。43 端口兜底不做，等站长定。

**分享快照**：`xz` 增加 `"no"` 表示「这个后缀没有公开 RDAP」。老链接没有 `xz` 时仍按 `notFound` 显示，不会凭空
出现「查不到后缀」。帮助里加了一条「为什么有些后缀查不到注册信息？」，并在「我的查询发到哪里去了？」里补上
「不在引导表里的后缀（如 .io）直接发给注册局自己的 RDAP」，页脚的数据来源也从「rdap.org 的 RDAP」改成「注册信息
来自 RDAP」——隐私说法要照实。分享弹窗的隐私行是外壳组件自带的，没动。

**布局骨架**（`skeleton()`）：查询一开始就把结论、记录、解析器回答、邮件、注册五块按最终顺序画出来，每块带自己
的状态（正在查 / 回答 / 没有 / 无法判断），数据到了就地填，不重排。测法：把 `window.fetch` 换成按调用顺序
错开 0.4–6 秒的包装，每 100 ms 记一次各块的位置和高度。改之前，占位表格 6 行、真实只有 2 行，底部的两列会往上
跳约 140 px；改之后只剩结论里的发现列表变长、记录表少一行的差别，底部两列移动 33 px（不到一行）。

- 结论：发现列表最少留两行（`.findings { min-height: 48px }`；后来发现会长到三行，2026-11-12 改成 75 px，见下）。
- 记录：桌面上表格至少留 180 px，但只在有行时留（`:has(#recBody tr)`），NXDOMAIN 的空表就按自然高度。
- 邮件和注册：各有最小高度（300 / 176 px），占位行数按常见的形状来（注册信息 6 行：注册商、注册、到期、更新、
  状态、NS）。
- 移动端不加记录表的最小高度，一屏本来就紧。

顺带修了一个文案参数的顺序错误：`v_few_most` 的 `{c}` 是回答数、`{b}` 是解析器总数，调用时传反了，于是出现过
「只有 12/1 家解析器回答」。十种语言的句子都是 `{c} … {b}`，改的是调用处，`v_few_all` 的 `{a}/{b}` 本来就对。

## 2026-11-11 · 首页 H1、分享卡下半截、几处译文，和 CLS

站长看过截图后的意见。

**H1 不再复述旧名字**：十条语言都换掉「DNS 记录查询、解析器回答与域名体检」这类开头，改成说这页现在做什么：
中文「一个域名的 DNS、邮件和 DNSSEC，一起看」，英文 "A domain's DNS, mail and DNSSEC, side by side"，俄语
「DNS, почта и DNSSEC одного домена — сразу вместе」，法语「Le DNS, le mail et le DNSSEC d'un domaine, d'un
seul coup d'œil」。名字在页面左上角和 `app_name` 里，H1 说功能。

**分享卡的下半截**：原来 1200×720 的卡只画到 380 px，下面半张空白。现在三格换成四行检查项——解析一致、邮件、
DNSSEC、注册信息——每行一个状态点和页面上同源的结论，下面仍是覆盖情况那一行。注册信息这一行是新加的：卡上
第一次能一眼看到「注册信息查到了/查不到」，前三行也不再用大数字和三格重复一遍。值长了先缩小（`kit.fit`），
不裁剪，`window.__msShareClips` 必须为空。

**译文**：法语 `k_mail` 改「Note e-mail」，德语改「E-Mail-Note」；法语名字改「Radiographie du domaine」
（法语里 X 光片就叫 radiographie）；俄语 `k_agree` 改「Совпадение」。

**CLS**：外壳的 `npm run cls` 跑本地页面，改之前 0.128（主要是结论块在结果落地时长了 31 px：分享按钮、徽章
行、三张卡的小字都没占位）。现在：`.v-head` 给按钮留 34 px、`.facts` 80 px、`.fact i` 19 px、`.v-sub` 20 px，
徽章那一行从查询开始就在布局里（空着也占 19 px），记录表在桌面上保底 180 px。实测 0.030，剩下的是字体加载和
记录表长高带来的 0.007。四条检查项在卡上也是「先画块再填」，道理一样。

## 2026-11-12 · 等级：连不上的解析器不扣分

站长看到 cloudflare.com 拿 B（12 家里 11 家作答、11 家一致）后定的方向：**连不上不扣分**。旧规则是
`ok < total → B`，等于把「我们这边没问到」记成域名的问题，和 tool-contract「不知道不能画成没问题」相反；
客服 FAQ 里写的又是「有一半连不上才是 B」，代码和文档本来就不一致。

- 失败分两类。`servfail`、`refused` 和别的 rcode 是解析器就这个域名作答，**算作答**，进一致率的分母，会拉低
  等级。`timeout`、`network`、`http`、`bad`、`skipped` 是我们没问到，**不进分母、不扣分**，既不是没问题也不是
  有问题，就是不知道。
- 一致率 = 最常见那份回答的家数 ÷ 作答的家数；作答不到一半（< 6/12）仍然不出等级、不给绿点。
- 结论下面那一行改成「{b} 家里有 {n} 家这次没连上（多半是你这边的线路），不计入等级」，级别从 warn 改成
  note，不进「N 项待处理」；只剩 note 时仍然显示「没有发现问题」。
- 新文案 `v_servfail`：一家记录都没答上来（全是 SERVFAIL / REFUSED）时，不再说「没有解析器回答」——它们答了，
  只是没给记录。
- 分享快照给 `rcode` 了一个码（10）。旧页面读到不认识的码会当成「不知道」，不会当成域名的错。
- 结果：cloudflare.com 从 B 变 A（11 家作答、11 家一致）。测试里补了「11/12 全一致 = A」「SERVFAIL 算作答、
  timeout 不算」。

FAQ 第 92 条（体检等级）十条语言按新规则重写；第 95 条（连不上不算不一致）现在才名副其实。

## 2026-11-12 · 浏览器读不了的注册信息，由 Worker 代查（/whois）

.cn、.jp、.ru、.hk 没有 RDAP；.de 有 RDAP（`rdap.denic.de`）但不发 CORS 头。这三种情况下浏览器自己读不到注册信息，
页面原来只能写「查不到这个后缀」。站长定的方向是不加新成本，就在现有 Worker 上加一条 `GET /whois?d=<域名>`
（AGENTS.md 要求给 Worker 加转发先问站长，这次是站长要的）。

**顺序**：先进 IANA 引导表的 RDAP（.de 改问注册局自己的 RDAP），再走 43 端口的 WHOIS。两样都没有才是
「查不到这个后缀」。.vn 的 WHOIS 从哪都问不到，留在 `QUIET_TLDS`，页面继续给注册局链接。

**测速**（从 Cloudflare 的网络测，Public 会话做的）：`whois.cnnic.cn` 56 ms，`whois.jprs.jp` 加 `/e` 要英文输出
244 ms，`whois.tcinet.ru` 502 ms，`whois.hkirc.hk` 475 ms。Cloudflare 只封 25 端口，43 端口通。超时定 8 秒，
输出最多读 40 KB。

**只留该留的字段**：解析出来的只有注册商、注册/到期/更新时间、状态和注册局 NS，和 RDAP 下来的字段同名。
`.cn` 的 WHOIS 里有注册人姓名、邮箱、电话，`parseWhois` 根本不读这些键，Worker 也不会把它们写进响应——
访客问的是域名，不是域名的主人。有测试专门拿带注册人信息的样本反查，响应里不能出现这些值。

**缓存和边界**：`caches.default`，成功 12 小时、失败 10 分钟（失败可能是我们这边一时的线路，不该冻一天）；给页面
的 `Cache-Control` 是 1 小时。只接受 GET，域名先过和页面一样的正则（ASCII、至少两段，页面传过来的是 punycode），
不合格直接 400，不建 socket 也不发 fetch。CORS 只对 `https://dig.1ms.dog` 发 `Access-Control-Allow-Origin`，带
`Vary: Origin`，别站借不到。

**踩过的坑**：
- `cloudflare:sockets` 的 `connect()` 只能在请求处理里调，模块顶层的绑定会报错；所以拿它放在单独的
  `src/whois-net.js`，`/whois` 里再动态 import，Node 的测试才能照常 import worker.js。
- 动态 import 是异步的，`connect(...)` 拿到的是 Promise，忘了 await 会把一个 Promise 当 socket 用。
- CNNIC 发完数据不关连接，等 EOF 会一直等到 8 秒超时；改成每次 read 等 1.5 秒没下文就当结束。
- JPRS 对保留域名（example.jp）会回一句域名本身、没有任何字段。这种回「查不到注册数据」，不是「出错」。
- 本地 `wrangler dev` 的缓存存在 `.wrangler/state/v3/cache`，失败也会被缓存 10 分钟；改代码后测到「仍超时」其实
  是缓存，要先停掉 dev、删掉这个目录再起。

**页面怎么标**：响应带 `src: "rdap" | "whois"`，页面在注册信息下面写「这一项由 1ms.dog 的服务器代查」，分享快照
的 `xs` 记住来源。页脚的数据来源、README 和十种语言的隐私问答都从「全部在浏览器里完成」改成照实说：DNS 查询
仍然只在浏览器里，注册信息在浏览器读不了时由服务器代查，注册人信息不读、不返回。

## 2026-11-12 · 注册人照注册局公开的显示；一次查询只发一次 /whois

站长看过 /whois 的第一版后改了一条：**注册人信息不屏蔽**。原话是「本身 whois 就是注册局提供的公开可查询信息，
隐藏没意义」。上一版只读注册商、日期、状态和 NS，注册人姓名、邮箱、电话在读的时候就被丢掉了，这一版作废。

**现在页面上的注册信息块**：注册商、注册/到期/更新时间、状态、注册局 NS、注册人（机构或姓名）、邮箱、电话、
注册局的 DNSSEC，注册局给了就显示，没给（.de 按 GDPR 隐去、隐私保护服务替换掉的）就整行不出现——不编造，也不写
「为保护隐私」。值原样显示，不截断、不改写；中文注册人名按 UTF-8 显示（`parseWhois` 读的就是原文，测试里有
「一些公司」这个样本）。解析之后还有一份**原始记录**：WHOIS 的原文、RDAP 的 JSON，放在注册信息块下面一个默认
收起的 `<details>` 里（最多 16000 字符），解析漏了字段也能看到。RDAP 的 `normalize` 现在从 registrant 实体的
vCard 取 `fn`/`org`/`email`/`tel`，`secureDNS.delegationSigned` 取签名状态。

**来源标注**：每一块都写源，不再只在服务器代查时写。`rd_from_rdap`（RDAP，浏览器直接读的）、`rd_src_rdap`
（RDAP，服务器代查）、`rd_src_whois`（注册局 43 端口 WHOIS，服务器代查），三种各一句，十种语言。

**一次查询只发一次 `/whois`**（Public 提的硬要求，牵涉成本）。页面的 RDAP 还是先由浏览器自己问 rdap.org；
读不到才调用一次 `fetchServerRegistration`。「先 RDAP 后 WHOIS」整条链在 Worker 的一次请求里走完，不会变成
两次 Worker 请求。钉住它的测试：`lookupRegistration` 一次调用里 `fetchImpl` 恰好一次、socket 恰好一次；
`src/app.js` 里 `fetchServerRegistration(` 只能出现一个调用点（整页唯一的兜底）。

**缓存**：键就是请求自己的 URL（含 `d`），所以不同域名各占一条，也不会跟别的路径串味。成功（含服务器 RDAP）
存 12 小时，失败和「注册局说查不到」存 10 分钟——失败多半是线路一时的，冻一天没道理。

**成本口径**（写进 README 的那句话背后的账）：
- DNS 部分：12 家解析器 × 各种记录类型，全部从访客浏览器直接发 DoH，**0 次 Worker 请求**。
- 注册信息：浏览器自己读得到的后缀（.com、.net、.org、.io 等绝大多数）也是 **0 次**；只有读不到的
  （.cn、.jp、.ru、.hk 没有 RDAP，.de 的 RDAP 不给浏览器读）才 **+1 次**，每个域名一次。
- 缓存命中仍然算一次 Worker 请求（Worker 还是被调用了），但不再打注册局，也不占 socket。

**分享（站长的决定，已定，不是待定）**：页面上的注册信息照注册局公开的给全，**分享出去的东西不带注册人和
联系方式**。分享卡只画等级、域名、解析一致、邮件等级、DNSSEC、注册商；分享链接的快照 `x` 里只有注册商、日期、
状态、NS。卡片和链接是同一样东西，两者一致，所以链接打开时那几行就是不出现——要看注册人就在页面上现查一次。
`src/app.js` 里快照那段只取这五个字段，测试钉住它不能多出 registrant / email / phone / raw。

## 2026-11-12 · 注册信息按「可注册域名」查，不按主机名

站长报的问题：输入 www.cloudflare.com 查不到注册信息，输入 cloudflare.com 才行。原因很简单——注册局只登记注册名，
`www.cloudflare.com` 这种主机名在注册局那里根本没有记录：rdap.org 回 404、CNNIC 回 `Invalid parameter:www.sina.cn`、
HKDNR 回 `Incorrect input`，页面于是说「查不到」。DNS 那部分仍然查访客输入的完整名字（www 的 CNAME 就该看），
只有注册信息这一块改成往上一层层找。

**做法**：`parentDomains(name)` 给出最多三级候选，最具体的在前（`a.b.example.co.uk` → `a.b.example.co.uk`、
`b.example.co.uk`、`example.co.uk`）。浏览器侧 `fetchRdap` 和 Worker 侧 `lookupRegistration` 都按这个顺序试：
RDAP 先，注册局的 404 或「没有这个域名的记录」就换上一级；43 端口 WHOIS 同理，`No matching record`、
`Invalid parameter`、`Incorrect input`、只回一个域名没有字段，都算「这个名字它没有」，继续往上一级。
三级封顶：再深的链子注册局也不会持有，没必要一路问到 `co.uk`。

**代价**：还是**一次** `/whois` 请求（Public 的硬要求没变），只是 Worker 内部可能多一次 RDAP 或 socket；
socket 的 8 秒预算改成从整个请求开始算，不会变成两次 8 秒。浏览器侧的 RDAP 多一跳是免费的。

**页面怎么说**：应答带 `lookedUp`（实际查到记录的那个名字）；和访客输入的不一样时，注册信息块下面加一行
`rd_parent`：「注册信息属于 {domain}——它下面的主机名没有自己的注册记录。」十种语言。分享快照不带这个字段。

实测：www.cloudflare.com → 浏览器直接读到 cloudflare.com 的 RDAP，注册信息完整，0 次 `/whois`；
www.sina.cn → 1 次 `/whois`，CNNIC 先答 Invalid parameter，再取 sina.cn 的记录；www.hkirc.hk、www.jprs.jp 同理。

## 2026-11-12 · 发现列表留三行；没有 MX 回答时不说「收不到邮件」

**CLS 的第二处**（Public 量的：6332 ms 时 `findings` 从 0 长到 74 px，CLS 0.047）。骨架给三张卡、记录表和邮件
都留了位置，唯独发现列表没占位。改法：查询一开始就往 `#findings` 里放三行占位（`skeleton()` 建 3 个 `li.ph`），
数据到了逐条填；`.findings` 的 `min-height` 从 48 px 提到 75 px（三行），占位行用 muted 色。实测本地
sina.cn（12 家 1 家没连上、3 条发现）：1080×900 下 CLS **0**，`#findings` 高 75 px；375 px 不横向滚动，
原始记录展开也不滚。

**邮件那句**：原来没有 MX 时一律说「没有 MX 记录：这个域名收不到邮件」。但「12 家都没回答 MX」和「域名确实没有
MX」不是一回事：前者是我们没问到，后者才是观测到的结论。按工具契约（不知道不能画成没问题），
`state.merged.MX.answered === 0` 时改用 `mx_noanswer`：「没有一家解析器回答 MX 记录，无法判断这个域名怎么收信」
（en: "No resolver returned MX records, so we can't tell how this domain receives mail"），十种语言。有解析器
作答、答案为空仍然是 `mx_none`，Null MX 仍然是 `mx_null`。分享链接打开时走同一条渲染路径，同样这句话。

## 2026-11-12 · 窄屏页头只留 logo；「其他工具」那行开查就画

线上验收（Public 在 375 px 和真查 cloudflare.com 时量的）报回来的两处。

**页头被裁**：375 px 下 `.brand` 里的名字被切掉——中文「域名透视」、俄语「Рентген домена」。四个控件加 90 px
logo 之后只剩约 50 px，俄语名字要 155 px，缩字号救不回来。按约定的第二种做法：≤540 px 时 `.brand-name`
`display:none`，只留 1ms logo（壳的导航条上方已经写着 1ms.dog），链接补 `aria-label`（`{{a:app_name}}`），
读屏念的仍是「域名透视」而不是「1ms」。同时 `.brand { flex: none; overflow: visible }`，否则 90 px 的 logo 会被
压进 89.5 px 的盒子，那 0.5 px 本身就会被判成溢出。540 px 以上名字照常显示（768 px 下俄语 155 px 放得下）。

**verdict 长高 31 px**：真查时 5.1 s 时 `#verdict` 290→321，把 `#records` 往下推。长高的是 `#links`——「哪家
DNS 最快 / 从这个地区 Ping」那一行，原来只在 `finish()` 里画：12 px 外边距 + 19 px 行高 = 31 px。它只依赖壳注入
的 `<meta name="dns">` 等工具地址和域名，开查时两者都知道，所以改成 `skeleton()` 里就 `renderLinks()`。本地补上
壳会注入的 meta 后实测：桌面 verdict 322→321（1 px 舍入），CLS 0；375 px 下 links 46 px 从第一帧就在（两行，
说明提前画也顺手解决了窄屏换行）。

两条都钉了测试：页头的 `aria-label` + 540 px 的 `display:none`，以及 `skeleton()` 里必须出现 `renderLinks()`。

## 2026-11-12 · 邮件、NS、DNSSEC 查根域，不查访客输入的主机名

站长报的问题：输入 `www.baidu.com`，邮件那一块显示「没有 MX 记录」。原因和注册信息那条一样——主机名没有自己的
邮件配置：MX、SPF、`_dmarc` 都在 `baidu.com`，问 `www.baidu.com` 只会拿到别的 zone 的 SOA 或者空答案。
把「没问到」画成「这个域名不收信」，正是这个页面最不能犯的错。

**哪个名字**：A/AAAA/CNAME/SRV 仍然查访客输入的名字（www 的 CNAME 链就该看）；MX、NS、TXT（SPF）、CAA、
SOA、`_dmarc.<根域>`、DS 查根域。仓库里没有 PSL，也不打算放一份——根域从 DNS 自己读出来：**一次 SOA 查询**，
问在输入的名字上，答案区或授权区里的 SOA owner 就是 zone apex。12 家解析器同时发，谁先答用谁，其余立刻掐掉，
只多一轮、不按记录类型各问一遍。

**最多往上一层**（`src/zone.mjs` 的 `findApex`）：输入的名字拿到可用的 SOA（是它自己或它的上级）就用；
拿到 NXDOMAIN，或者 CNAME 到别的 zone（`www.baidu.com` → `a.shifen.com`，SOA 是 shifen.com 的，不是它的上级）
才往上问一级。再往上就危险了：`www.x.co.uk` 不存在时会一路问到 `co.uk`，而问 co.uk 的邮件对谁都没用。
两级封顶，`www.example.co.uk` → `example.co.uk`，绝不会被砍成 `co.uk`（测试钉住）。

**主机自己是 zone 的情况**：`www.cloudflare.com` 有自己的 SOA 和 NS，是真正委派出去的 zone，DNS 层面它就是
apex——但邮件还是 `cloudflare.com` 的。这个只有注册局知道：注册信息的 `lookedUp` 就是可注册域名。
`resolveApex` 同时等 SOA 和浏览器 RDAP，最多 1.2 秒，RDAP 先回且是可注册域名就用它。浏览器读不到注册局时
（`.cn` 之类要走 Worker 代查），答案会晚得多：这时 zone 记录先按 SOA 的 apex 查，`loadRdap` 拿到 `lookedUp`
后如果发现是更短的上级，就**只把 zone 类型重问一遍**（`reaskZone`，A/AAAA 不动），重算等级和分享码再重画。
RDAP 在查询还没结束时就回来的话，名字先记在 `lateApex`，等 `finish()` 之后统一处理，避免和正在进行的
zone 查询抢 `state.results`。代价只在「主机是独立 zone」这种少数情况：多一轮 zone 查询，其他情况一次都不多。

**页面怎么说**：邮件块和属性块的标题旁加一行 `q_apex`——「查的是 baidu.com」（en: "looked up on cloudflare.com"），
只在根域和输入不同时出现；记录表里 zone 类型的行在类型名下面标根域。分享快照加 `ap` 字段（根域不等于输入时），
旧链接照旧没有这行。十种语言的 `q_apex` 要给站长过目。

**顺带修的一处**：375 px 下 `cloudflare.com` 会横向滚动 1 px——DMARC 的 `mailto:<一长串哈希>@dmarc…` 是不可断的
长 token，把 `.grid2` 的两列撑到 360 px（轨道只有 343 px）。`.grid2 > * { min-width: 0 }`，`.blk p` 加
`overflow-wrap: anywhere`。这是原来就有的，不是这次引入的，但「页面不能横向滚动」是底线。

测试：`test/zone.test.mjs` 14 项——apex 保持、主机只问一次、CNAME 跨 zone 上一层、两级后缀不砍、未注册名字
问到 `x.co.uk` 就停、NXDOMAIN、无回答、非上级 SOA 忽略、`nameFor` 分流、`preferRegistrable`，以及页面接线
（zone 类型问 `apex`、`_dmarc.<apex>`、DS 问 `state.apex`、`lateApex` 的重问路径）。`npm test` 104 项全过。
