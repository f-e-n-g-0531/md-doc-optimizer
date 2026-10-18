# 同领域项目与工具调研（sources.md）

调研时间：2026-10-18。目标：梳理可复用于「去冗余 / 删过期失效 / 纠事实不符」的开源项目，为 SKILL.md 的流程与 references/tool-configs.md 的配置提供依据。映射列含义：A=去冗余，B=删过期/失效，C=纠事实不符。

## 1. 直接类比的 AI Skill（最重要参考）

- **TencentCloudBase / CloudBase-AI-Toolkit — skills/doc-freshness-review**
  - 仓库：https://github.com/TencentCloudBase/CloudBase-AI-Toolkit
  - 定位：审阅仓库文档是否与当前代码、生成物、发布入口一致；按「stale statement / 缺失或过时引用 / 过时命令 / 文档间漂移 / 文档与实现漂移」分类，机械可修的直接出 PR，产品语义不明的出报告。本 Skill 的触发判定、分级、最小自检三步即借鉴其结构。
  - 映射：B、C

## 2. 文档与代码一致性 / 事实核对（目标 C 的核心）

- **docproof** — https://github.com/melbinjp/docproof
  - 校验文档声称的内容是否仍对仓库成立：文件路径、CLI flag、版本号、文档化 import，全部对照代码与 git 历史解析。带 GitHub Action，构建失败即文档撒谎。
  - 映射：C
- **mdoctest** — https://github.com/ingrid-owusu/mdoctest
  - 运行 Markdown 里的代码块与控制台会话，核对输出是否仍然一致，提供 --fix 自动更新；语言无关、零依赖。
  - 映射：C、B
- **markdown-doctest** — https://github.com/Widdershin/markdown-doctest
  - 只执行 Markdown 里的 JS 代码块、验证不抛异常，**不比对输出**；输出一致性核对请用 mdoctest。
  - 映射：C
- **Redocly respect** — https://redocly.com/docs/respect
  - 面向 OpenAPI 的「行为与安全回归测试」，确保文档与 API 描述、真实响应一致；对 API 文档的事实一致性尤其有用。
  - 映射：C
- **Doc Detective** — https://github.com/doc-detective/doc-detective
  - 把文档步骤写成脚本执行，发现「照着做却做不通」的过时步骤。
  - 映射：B、C
- **elastic / docs-actions（gh-aw-docs-staleness-sweep）** — https://github.com/elastic/docs-actions
  - 大厂文档「陈旧度扫描」工作流，识别长期未更新、可能过时的文档页。
  - 映射：B
- **mdite** — https://github.com/radleta/mdite
  - 把文档当作连通图：校验链接、检测孤儿文档、映射依赖，便于判断哪些内容可安全删除。
  - 映射：A、B
- **docsync / doclint / rumdl / seiso**
  - docsync：https://pkg.go.dev/github.com/ubgo/docsync
  - doclint：https://pkg.go.dev/github.com/openserbia/doclint
  - rumdl：https://pypi.org/project/rumdl/
  - seiso：https://crates.io/crates/seiso
  - docsync 侧重把文档绑定到它描述的代码/配置/事实；doclint、rumdl、seiso 分别提供 Markdown 结构、lint/format、约定检查的不同切片。
  - 映射：A、B、C（视工具而定）

## 3. 结构 / 去重 lint（目标 A 的机械部分）

- **markdownlint** — https://github.com/DavidAnson/markdownlint
  - 规则编号覆盖 MD001–MD060（有缺号，如 MD057 未定义；npm 最新 v0.42.0，本仓库经 markdownlint-cli2 实测 v0.41.1）。与去冗余直接相关：**MD024 重复标题**、**MD025 多个一级标题**、MD013 行长度、MD036 不要用强调代替标题、MD012 连续多个空行。
  - 配套 CLI：**markdownlint-cli2** — https://github.com/DavidAnson/markdownlint-cli2
- **remark-lint** — https://github.com/remarkjs/remark-lint
  - unified 插件生态：no-duplicate-headings、no-duplicate-definitions、no-unused-definitions、no-dead-urls、no-empty-url 等，可组合成自定义规则集。

## 4. 文风 / 冗余 / 得体（目标 A 的语义部分）

- **Vale** — https://vale.sh ；仓库 https://github.com/errata-ai/vale
  - 可配置的 prose linter，内置风格包：Microsoft、Google、Readability，以及下述 write-good、proselint、alex 的封装。
- **write-good** — https://github.com/btford/write-good
  - 抓英文口水词/冗余：weasel words（many、various、very）、被动语态、多余副词、以 so / there is 开头等。
- **proselint** — https://github.com/amperser/proselint
  - 抓陈词滥调、行话、冗余、very 滥用、weasel words，以及会「过时」的相对日期表述（valuable for B）。
- **alex** — https://github.com/get-alex/alex
  - 抓无意识偏见/不得体/不包容的措辞。
- **Harper** — https://writewithharper.com （本地/开源语法与可读性检查）
- **LanguageTool** — https://languagetool.org （语法/风格，开源引擎）
- **textlint** — https://github.com/textlint/textlint （可插拔文本 lint，日/英/中文规则生态）

## 5. 链接失效检测（目标 B 的机械部分）

- **lychee** — https://github.com/lycheeverse/lychee
  - 快速异步链接检查（Rust），支持 MD/HTML/rst 与本地文件；配套 CI：**lychee-action** — https://github.com/lycheeverse/lychee-action
- **markdown-link-check** — https://github.com/tcort/markdown-link-check
  - 逐条校验 Markdown 超链接死活。
- **htmltest** — https://github.com/wjdp/htmltest
- **linkcheck** — https://github.com/sen-ltd/linkcheck （带锚点解析）
- **linkspector** — https://github.com/UmbrellaDocs/linkspector

## 6. 拼写 / 错词（目标 C 的机械部分）

- **cspell** — https://github.com/streetsidesoftware/cspell
- **typos** — https://github.com/crate-ci/typos
- **codespell** — https://github.com/codespell-project/codespell
- **PySpelling** — https://facelessuser.github.io/pyspelling/

## 7. 格式化（可选，保持结构一致）

- **prettier** — https://prettier.io （Markdown 支持）
- **mdformat** — https://github.com/executablebooks/mdformat

## 8. 风格指南（用作「事实/质量」人工判断的标尺）

- Google developer documentation style guide — https://developers.google.com/style
- Microsoft Writing Style Guide — https://learn.microsoft.com/style-guide
- Diátaxis（教程/操作指南/参考/解释四类结构）— https://diataxis.fr
- Write the Docs — https://www.writethedocs.org

## 9. 精选列表（更多工具入口）

- **awesome-docs** — https://github.com/testthedocs/awesome-docs （文档工具大全）
- **awesome-markdown-devtools** — https://github.com/dp1620/awesome-markdown-devtools
- **awesome-markdown** — https://github.com/mansucache/awesome-markdown

## 10. 中文专项 lint（目标 A/C 的机械部分）

- **zhlint** — https://github.com/zhlint-project/zhlint
  - 中文标点、全半角与中英文空格；`--fix` 会改动技术内容，只建议 check-only（实测见 references/cjk-doc-rules.md 第 7 节）。
- **lint-md** — https://github.com/lint-md/lint-md （核心库）；CLI — https://github.com/lint-md/cli
  - 中文 Markdown 综合 lint，规则可按仓库风格收敛。
- **pangu** — https://github.com/vinta/pangu.js
  - 在 CJK 与拉丁字母/数字之间补空格；只输出修正稿，不直接写回。
- 映射：A、C（排版与术语一致性）

## 使用建议

工具只做「预扫 + 候选清单」，不能代替判断。最终结论必须回到 SKILL.md 的证据优先原则：读代码/git、跑命令、探测链接，再决定删改或标 NEEDS_HUMAN。
