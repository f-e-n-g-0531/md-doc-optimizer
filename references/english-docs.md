# 英文文档专项规则（english-docs.md）

英文文档有自己的高频冗余、过期与事实错误形态。本文档是中英分册的英文册：中文文档套用 references/cjk-doc-rules.md，英文文档（含中英混排文档里的英文段落）套用本文档。英文 linter 只提供候选，**每条命中都要落到「文件:行号 + 目标 A/B/C + 可复现证据」**，否则不改。

## 1. 适用范围与边界

- 适用：正文为英文的 README、docs、guides、FAQ、错误信息与帮助文本。
- 不适用（与 CJK 册同一套判断边界，见 SKILL.md）：CHANGELOG、迁移指南、旧版本文档、LICENSE 与合规文本——只报不改。
- **风格建议 ≠ 内容修改**：Vale / write-good / proselint / alex 命中的是 style 候选，不是错误；只有能归入 A/B/C 且删改后语义不变才动手，纯语气偏好（主动/被动、长短句）默认 keep。
- **最小 diff**：只删冗余、删失效、改错，不扩写、不润色、不重排；每处给出「原句 → 新句 → 证据」。
- **不自动修**：生成物、历史记录、法律文本、演示性错误、与官方规范冲突的文档（标 DUBIOUS）、无法复核的断言（标 NEEDS_HUMAN）、明确标注 planned/roadmap 的内容。

| 情形 | 处置 | 报告落点 |
|---|---|---|
| 可机械证明：死链、拼写、代码能证明的 flag/默认值 | 直接改 | Fixed |
| 文档与代码冲突，但文档可能对齐官方规范/产品决策 | 保留原文，标 DUBIOUS 说明分歧 | Needs review |
| 无法复现或无法确证现状 | 不改，按 references/reporting.md 四段式标 NEEDS_HUMAN | Needs review |
| 正常内容被 linter 命中 | 不改，标 keep 防止反复提出 | No action |

## 2. 目标 A —— 英文冗余信号

（对应目标 A 去冗余）

| 信号 | 典型英文 | 判定与证据 |
|---|---|---|
| weasel words | very / really / quite / various / many / some / several / clearly / obviously | 删后语义不变即冗余；many、various 在定量语境可能是事实（supports various platforms），必须看上下文。证据：`grep -nEi "\b(very\|really\|quite\|obviously\|clearly)\b" README.md` + 逐句判定 |
| canned phrases | it is important to note that / please note that / simply / easily / in order to → to / at this point in time → now / due to the fact that → because | 删后读一遍确认语义不变；`grep -nEi "it is important to note\|please note\|simply\|easily"` |
| marketing adjectives | powerful / flexible / seamless / robust / cutting-edge / state-of-the-art / best-in-class / lightning-fast | 无 benchmark、版本或可验证事实支撑时删；确需描述能力就改成可验证陈述（支持的平台、性能数字、链接） |
| duplicated sections / links | 同一段落在 README 与 docs/ 各写一遍；同一 URL 全篇反复出现；FAQ 与 troubleshooting 互拷 | `grep -n "^## "` 查重复章节；`grep -oE "https?://[^ )]+" file.md \| sort \| uniq -c \| sort -rn` 查重复链接；跨文件 `git grep -n "<原句片段>"` |
| double hedging | may possibly / could potentially / might perhaps / it is possible that … may | 保留一个限定词；删后仍成立才删，不成立则改成确定表述并给证据 |
| redundant back-reference | as mentioned above / as described below / as we saw earlier | 同页内删或改成可点击的锚点链接；跨文件保留链接 |
| tautology | each and every / first and foremost / end result / past history / advance planning | 直接删其中一个词，语义不变 |

**区分有意的重复**（不算 A）：多平台安装命令（brew / apt / winget）、不同场景示例（dev / prod）、CLI help 与文档同步内容、必须重复的安全警告——删掉会影响可执行性或可发现性，保留并标注「有意重复」。git blame 可区分历史拷贝与有意设计：`git blame -L 10,20 README.md`。

## 3. 目标 B —— 过期信号

（对应目标 B 删过期/失效）

| 信号 | 典型英文 | 核查方式（证据） |
|---|---|---|
| 相对时间 | currently / recently / soon / coming soon / in the near future / next quarter / by the end of 2025 / this year | 按审计当日逐句核对；`grep -nEi "\b(currently\|recently\|soon\|upcoming\|in the near future\|next quarter)\b"`；过期即删或改成有日期的确证事实 |
| latest 版本 | the latest version is 2.x / as of v1.2 | 对照清单与 tags：`grep -n '"version"' package.json`、`git tag --sort=-v:refname \| head -n 5`；写具体版本或指向 releases 页 |
| 废弃/移除声明 | X is deprecated / will be removed in v3 | 对照代码与 CHANGELOG：`rg -n "deprecated\|removed" CHANGELOG.md`；代码仍在用且无移除记录 → B/C 问题 |
| 占位残留 | TODO / TBD / coming soon / to be added / stay tuned | 对照 issue/PR 状态与已发布功能；已完成的删占位句 |
| README 里的发布日志 | 逐版本更新日志堆在 README，与 CHANGELOG 重复 | 保留一句指向 CHANGELOG / releases；历史本身不删 |
| 失效链接 | 404 / 410 / 跳转到无关页 / 旧域名 | lychee 或 markdown-link-check 全量探测（命令见第 6 节） |
| 命令输出不匹配 | 文档示例输出与实跑结果不同 | 实际运行并 diff 输出；mdoctest / markdown-doctest 复跑 |

~~~markdown
Widget CLI is currently in beta. The latest version is 1.2, and v2 is coming soon.
~~~

判定：B——审计日对照 CHANGELOG 与 `git tag --sort=-v:refname`，v2.0.0 已发布；currently in beta 无当前依据，整句删除，状态改为指向 releases 页。明确标注 planned / roadmap / experimental 的内容按「计划」处理，不算 B；只有其声称的状态与证据冲突才算。

## 4. 目标 C —— 事实不符

（对应目标 C 纠事实不符，核对顺序见 references/drift-playbook.md）

| 核对项 | 证据来源 | 可复现方法 |
|---|---|---|
| flag / 默认值 | CLI 解析代码 | `rg -n -- '--[a-z-]+' src/`；文档里的 flag 名与默认值逐字比对（连字符、单复数、引号） |
| 环境变量 | 配置读取代码 | `rg -n "process\.env\.[A-Z0-9_]+" src/`（或对应语言写法） |
| 路径 / import | 文件系统与依赖清单 | 路径用 `ls` 核对；import 在包入口与依赖清单核对：`rg -n "from ['\"]pkg" src/` |
| API 端点 | 路由定义 / OpenAPI | `rg -n "/(v[0-9]+/)?[a-z-]+" src/routes/`；可用 Redocly respect 做行为回归 |
| 示例输出 | 实际运行 | 执行命令保存 stdout/stderr，与文档逐行 diff；跑不通记 run-failed 作为证据 |
| 数字/日期/时区/货币 | CHANGELOG、git log、权威页面 | `git log --format=%ad` 核对发布日期；跨时区写明时区（如 09:00 UTC） |
| 产品名大小写 | 官方品牌写法 | `git grep -nE "Github\|Javascript\|MacOS\|NodeJS\|NPM" -- "*.md"` |
| 链接文本 vs 目标 | 目标页标题与内容 | curl 或 web_fetch 打开确认；lychee 只证明可达，不证明语义匹配 |
| 限额/价格/配额 | 官方 pricing / limits 页 | 记录授权 URL 与访问日期；二手博客不算证据 |

**DUBIOUS vs NEEDS_HUMAN**：

- DUBIOUS：文档与代码冲突，但文档可能对齐官方规范或产品决策（文档先行、代码未跟上）——保留原文，报告里写清冲突双方与各自证据。
- NEEDS_HUMAN：无法用代码/运行/权威来源复核的断言（功能是否已废弃、数字是否该更新）——按 references/reporting.md 第 3 节四段式写，禁止静默改成猜的值。

## 5. 术语与文风一致性

（对应目标 A 重复、目标 C 拼写与产品名）

- 拼写方言：全篇统一 en-US（color / behavior / organize）或 en-GB（colour / behaviour / organise）；用 cspell 词典按团队选择收敛（配置见 references/tool-configs.md 的 .cspell.json）。证据：`grep -nE "\b(color\|colour\|behavior\|behaviour)\b"` 列全后统一。
- 标点与句式：serial comma、contractions（it's / don't）、人称由团队风格指南定（Google / Microsoft 均要求 serial comma）；一旦选定全篇一致，只改不一致处，不按个人偏好重写。
- 产品与品牌名：GitHub / JavaScript / macOS / Kubernetes / Node.js / npm / TypeScript / Markdown——大小写与官方一致；不用 K8s 等缩写替正式名，除非首次定义。
- inclusive language：alex 的候选（whitelist / blacklist、master / slave、sanity check 等）属 Low；替换时保持技术含义不变，仅在用户要求「彻底」时批量处理，不当作事实修正。
- passive voice：references/tool-configs.md 里 `write-good.Passive = NO` 是有意关闭的——被动语态本身不是错误，只在主语缺失导致对象/责任不清或句子明显冗长时改，禁止批量改写。
- 锚点与链接文本一致性：标题改名会让 `](#old-heading)` 失效；先用 `git grep -n "](#"` 列出全部锚点，再与 `grep -n "^#"` 的标题逐一对；同一目标全篇用同一链接文本。

## 6. 工具与配置（只写可验证的命令）

（全部 check-only，只作候选清单；命令与配置来源 references/tool-configs.md）

| 目标 | 工具 | 运行 | 边界 |
|---|---|---|---|
| A 结构与重复标题 | markdownlint | `npx --yes markdownlint-cli2 "**/*.md"` | MD024 重复标题、MD025 多 H1；只报结构，不判语义重复 |
| A/B/C 文风 | Vale | `vale .`（先按 .vale.ini 备好 styles/ 与 Vocab） | 需风格包，否则报错；配置见 tool-configs.md |
| A/B 冗余词 | write-good / proselint（Vale 风格包） | 随 `vale .` 生效；不单独装 CLI | `write-good.Passive = NO`、`proselint.Very = YES` 已在 .vale.ini 设定 |
| A 得体用语 | alex（Vale 风格包） | 随 `vale .` 生效 | 只作候选，替换属 Low |
| B 死链 | lychee | `lychee --config ./lychee.toml --no-progress "**/*.md"` | 只证明可达，不证明文本与目标匹配 |
| B 死链（单文件） | markdown-link-check | `npx markdown-link-check README.md` | 批量需自行循环 |
| C 拼写 | cspell | `npx cspell "**/*.md"` | 误报用团队词表收敛，不做自动改 |
| C 拼写补充 | typos / codespell | 按官方文档启用（本仓库未内置配置） | 参数以官方文档为准，不凭记忆写 flag |
| A/自定规则 | textlint | `npx textlint "**/*.md"` | 英文规则需自备，无规则集等于空跑 |
| C 示例复跑 | mdoctest / markdown-doctest | `mdoctest README.md`（核对输出）；`npx markdown-doctest README.md`（仅验证不抛异常） | mdoctest 比对输出；markdown-doctest 只验证可执行，不证明输出正确 |

- 所有 linter 输出都是候选清单，不是结论；不得把 `--fix` 类自动修复直接套到技术文档（CJK 工具实测见 references/cjk-doc-rules.md 第 7 节，英文同理）。
- CI 用 `.github/workflows/docs-qa.yml`：markdownlint、链接检查、文档自洽检查（scripts/check-docs.mjs）与报告 Schema 校验都是门禁；Vale 需先备风格包、默认注释，按需启用。
- 新增工具前先核对官方文档参数；拿不准就写「按官方文档启用」，不编造命令。

## 7. 英文文档审计清单

- [ ] 已列出事实来源：代码、配置、清单版本、CHANGELOG、发布记录、权威页面。
- [ ] 每条命中都有「文件:行号 + 目标 A/B/C + 可复现证据」。
- [ ] A：weasel words、canned phrases、marketing adjectives 已 grep 并逐句判定，未机械删除。
- [ ] A：重复段落/链接已跨文件定位，保留唯一权威出处；有意的重复已排除。
- [ ] B：相对时间全部按审计当日核对；版本号对照 manifest 与 `git tag`。
- [ ] B：死链全量探测（lychee 或 markdown-link-check）。
- [ ] B：文档命令实际跑过，输出与示例一致；跑不通已记 run-failed。
- [ ] C：flag / 默认值 / env / 路径 / import / endpoint 有代码行号证据。
- [ ] C：产品名大小写、日期/时区/数字、链接文本与目标已核对。
- [ ] C：DUBIOUS 与 NEEDS_HUMAN 已按 reporting.md 四段式标注。
- [ ] 术语：US/UK 拼写、serial comma、contractions、人称全篇一致。
- [ ] 未改生成物、CHANGELOG、法律文本、演示性错误、planned 内容。
- [ ] 复跑 markdownlint + lychee 无新增问题；二次审计应得到 NO_ISSUES。
- [ ] `git diff --stat` 只含证据点，无顺手重排。

## 8. 前后对照示例

演示英文文档三类优化的通用形态，非真实仓库内容。Before：

~~~~markdown
# WidgetKit

WidgetKit is a very powerful, flexible and seamless library that makes it simple to build widgets.
It is important to note that configuration is easy — simply run:

~~~bash
widget init --output-dir ./out
~~~

We are planning to ship v2.0 soon, and it will be available in the near future.
See the [docs](https://example.com/pricing) for details.
~~~~

After：

~~~~markdown
# WidgetKit

WidgetKit builds widgets from a declarative config file. Configure it with:

~~~bash
widget init --out-dir ./build
~~~

See the [documentation](https://docs.example.com) for details.
~~~~

| 类别 | 严重度 | 原内容 | 动作 | 证据 |
|---|---|---|---|---|
| A 去冗余 | Low | very powerful、flexible and seamless；it is important to note that … simply | 删除营销形容词与套话 | write-good / proselint 候选；无 benchmark/版本证据，删后语义不变 |
| B 删过期 | High | planning to ship v2.0 soon … in the near future | 删除整句 | `git tag --sort=-v:refname` 显示 v2.0.0 已发布，CHANGELOG 有对应条目 |
| C 纠事实 | High | `widget init --output-dir ./out` | 改 `--out-dir ./build` | `rg -n -- '--output-dir'` 无匹配；CLI 源码默认 `./build` |
| C 纠事实 | Medium | 链接文本 docs 指向 example.com/pricing | 改真实文档地址与文案 | 打开目标页为定价页，文本与目标不符；旧域名链接失效 |

## 9. 出处

链接与工具调研见 references/sources.md（2026-10-18 核对）。本文只引用其中已验证 URL：

- Vale — https://vale.sh ；规则仓库 https://github.com/errata-ai/vale
- write-good — https://github.com/btford/write-good ；proselint — https://github.com/amperser/proselint ；alex — https://github.com/get-alex/alex
- cspell — https://github.com/streetsidesoftware/cspell ；typos — https://github.com/crate-ci/typos ；codespell — https://github.com/codespell-project/codespell
- textlint — https://github.com/textlint/textlint
- markdownlint — https://github.com/DavidAnson/markdownlint ；markdownlint-cli2 — https://github.com/DavidAnson/markdownlint-cli2
- lychee — https://github.com/lycheeverse/lychee
- mdoctest — https://github.com/ingrid-owusu/mdoctest ；markdown-doctest — https://github.com/Widdershin/markdown-doctest
- docproof — https://github.com/melbinjp/docproof
- Google developer documentation style guide — https://developers.google.com/style
- Microsoft Writing Style Guide — https://learn.microsoft.com/style-guide
- Diátaxis — https://diataxis.fr

相关文件：SKILL.md（判断边界与三目标）、references/cjk-doc-rules.md（中文专项）、references/tool-configs.md（配置）、references/reporting.md（报告与 NEEDS_HUMAN 四段式）、references/drift-playbook.md（漂移核对顺序）。
