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

