# 现成工具配置（tool-configs.md）

以下配置可直接粘贴。工具一律作「预扫候选清单」，最终结论仍以读到的证据与运行结果为准。

## markdownlint —— 结构 / 去重

文件 `.markdownlint.yml`（与本仓库实际配置一致；已关闭与中文文档习惯冲突的纯风格规则）：

~~~yaml
default: true

# 行长度交给格式化工具，避免与内容去重混在一起
MD013: false

# 中文「冒号 + 列表」惯用写法，不强制标题/列表周围空行
MD022: false
MD032: false

# 重复标题：只查兄弟层级（允许不同章节下同名小节）
MD024:
  siblings_only: true

# 多一级标题在长文档中允许
MD025:
  front_matter_title: ""

# 允许内联 HTML（README 居中徽章区）
MD033: false

# 允许裸 URL（工具清单类文档）
MD034: false

# 允许用强调代替标题
MD036: false

# 允许无语言标注的围栏代码块（纯文本示例/目录树）
MD040: false

# 首行不必是顶级标题
MD041: false

# 不强制代码围栏风格
MD048: false

# 不强制表格分隔行空格一致性
MD060: false
~~~

运行：`npx markdownlint-cli2 "**/*.md"`

## Vale —— 文风 / 冗余 / 得体（主要面向英文，中文效果有限）

文件 `.vale.ini`：

~~~ini
StylesPath = styles
MinAlertLevel = suggestion
Vocab = Docs

[*.md]
BasedOnStyles = Vale, Microsoft, write-good, proselint, alex
write-good.Passive = NO
write-good.So = YES
proselint.Very = YES
~~~

前置条件：`styles/` 下需放置对应风格包（write-good、proselint、alex、Microsoft、Google）；词汇表按 Vale 3.x 放在 `<StylesPath>/config/vocabularies/Docs/accept.txt`（即 `styles/config/vocabularies/Docs/accept.txt`）。缺风格包或词汇表时 `vale` 会报错。

运行：`vale .`

## 中文文档专项（zhlint / lint-md / pangu）

中文标点、全半角、中英空格、术语一致性，用中文专用工具。完整规则见 references/cjk-doc-rules.md。

~~~bash
# 只检查，不修改
npx zhlint "**/*.md"
npx @lint-md/cli "**/*.md"

# 预览 pangu 的空格修正（输出到 stdout，不写回文件）
npx pangu -f README.md > README.pangu-preview.md
~~~

说明：zhlint 用 `--fix`、lint-md 用 `-f` 自动修复；接入 CI 前先按团队风格写 `.zhlintrc` / `.lintmdrc` 收敛规则，避免一次性大改。

### 中文 linter 配置（保留仓库风格）

`.zhlintrc` —— 保留全角括号与「」，只统一空格与标点习惯：

~~~json
{
  "preset": "default",
  "rules": {
    "halfwidthPunctuation": "",
    "unifiedPunctuation": { "default": false }
  }
}
~~~

`.lintmdrc` —— 关闭与仓库风格冲突的半角标点规则（`0` 关、`1` 警告、`2` 错误）：

~~~json
{
  "rules": {
    "no-half-width-punctuation": 0
  }
}
~~~

两者都**只跑检查、不跑自动修复**：实测 `zhlint --fix` 会把 `.github` 改成 `。github`、把代码里的 `"X"` 改成弯引号（见 references/cjk-doc-rules.md 第 7 节）。

## lychee —— 链接失效

文件 `lychee.toml`。注意 **lychee 配置里没有 `files` 键**：输入文件由命令行位置参数或 `files_from` 指定。写成 `files = [...]` 会报 `required arguments were not provided`（本仓库接入 CI 时踩过这个坑）。

~~~toml
# 接受这些状态码视为可达（403/429 常见于反爬与限流）
accept = ["200", "201", "202", "204", "301", "302", "304", "403", "429"]

# 跳过内网/本地/回环地址
exclude_all_private = true
exclude = ["localhost", "127.0.0.1", "0.0.0.0", "example.com"]

# 不检查代码块内的链接（git clone / SSH 地址等）
include_verbatim = false

# 网络健壮性
timeout = 20
max_retries = 3
max_concurrency = 16
~~~

运行（文件/glob 必须作为位置参数传入）：

~~~bash
lychee --config ./lychee.toml --no-progress "**/*.md"
~~~

## markdown-link-check —— 单文件链接

运行：`npx markdown-link-check README.md`
（批量：对每个 `*.md` 循环执行，或配 `config.json` 加 `ignorePatterns`）

## cspell —— 拼写 / 错词

文件 `.cspell.json`：

~~~json
{
  "version": "0.2",
  "language": "en",
  "words": ["markdownlint", "lychee", "vale", "dedupe", "docproof"],
  "ignorePaths": ["node_modules", "*.lock", "dist", "LICENSE"],
  "allowCompoundWords": true
}
~~~

运行：`npx cspell "**/*.md"`

## doctest —— 复跑示例代码（事实核对）

- mdoctest（语言无关）：`mdoctest README.md`（加 `--fix` 自动更新失效输出）
- markdown-doctest（JS 生态）：只执行 JS 示例验证不抛异常，不比对输出：`npx markdown-doctest README.md`

## 内置预扫脚本（scripts/pre-scan.mjs）

零依赖、只读的候选生成器，用于 P2：不访问网络、不修改目标仓库，输出确定性的 JSON 候选清单。候选必须再按 SKILL.md 的 P3 逐条核对，不能直接当结论。

~~~bash
node scripts/pre-scan.mjs <目标目录>          # 输出 JSON 候选清单
node scripts/pre-scan.mjs <目标目录> --text   # 输出人读摘要
~~~

`--text` 每行按 `file:line [类别] kind -- evidence | 原文` 输出：`evidence` 是命中的具体词或路径（例如同一行里的「目前」「最近」会分别列出），便于逐条 triage。

覆盖的候选类型（kind / 类别）：

| kind | 类别 | 说明 |
|---|---|---|
| broken-local-link | B | 相对路径链接指向不存在的文件（图片链接暂不检查） |
| case-mismatch-link | B | 路径大小写与磁盘真实文件名不一致：Windows/macOS 本地能打开，Linux/CI 上 404 |
| broken-anchor | B | `#锚点` 在当前文件或目标文件中不存在（按 GitHub 锚点规则计算） |
| default-branch-master-link | B | GitHub 链接硬编码 `/tree/master/` 或 `/blob/master/`，需核对默认分支 |
| trailing-fullwidth-after-url | C | URL 后粘连全角括号/引号，常导致 404 |
| stale-time-phrase | B | currently / recently / soon / 目前 / 最近 等时间敏感词 |
| placeholder-marker | B | TODO / TBD / 待补充 / coming soon 等占位 |
| duplicate-heading | A | 同文件内同层级同名标题 |
| duplicate-paragraph | A | 同文件内重复段落 |
| multiple-h1 | A | 一个文件多个一级标题 |
| near-duplicate-files | A | 两个文件行集合高度相似，疑似拷贝或生成副本 |

输出结构：`{tool, schema_version, target, files_scanned, candidates[], summary{total, by_kind, by_category}}`；candidates 按 file/line/kind 排序，便于 diff。

锚点与大小写是两类最容易误判的候选，预扫按 GitHub 的实际规则处理：

- **锚点**：保留下划线与连字符；重复标题按出现顺序追加 `-1`、`-2`；标题里的 HTML 标签按渲染文本处理、实体先解码；`<a name="x">`、`<span id="x">` 等显式 HTML 锚点同样算合法目标。
- **大小写**：不依赖本机文件系统是否区分大小写，而是逐段 `readdir` 比对真实文件名，因此 Windows 开发机与 Linux CI 上的结论一致。

`near-duplicate-files` 为两两文件比较（O(n²)）：数千个 Markdown 的大仓库会偏慢，可先对 docs/ 等子目录分批扫描。每个候选带 `context` 字段：`fixture`（路径含 `test/`、`tests/`、`fixtures/`、`__fixtures__/`、`__snapshots__/`，或文件名以 `example-` 开头；先按测试夹具边界排除）或 `docs`。

自测：`node scripts/pre-scan.test.mjs`（CI 会跑）。

注意：规则文档会引用候选词表本身（如本 skill 的 SKILL.md 写了「目前/最近/TODO」），因此对本仓库运行会得到一批预期内的候选噪音；这类命中应 triage 为 no action，不影响扫描器价值。

2026-10-18 在两个案例仓库快照上复跑：docproof 0 个候选；zhlint 30 个候选（含 3 个 `default-branch-master-link`、1 个 `near-duplicate-files`），恰好提示了案例里的失效链接与「README 由 docs/index.md 生成」线索——但候选只是线索，最终结论仍来自逐条证据核对。1.7.0 修正锚点与大小写规则后按同一快照复跑，结果不变（docproof 0；zhlint 30，无新增候选）。

## GitHub Actions —— 组合检查（自包含版）

文件 `.github/workflows/docs-qa.yml`。下面这份可直接复制，门禁步骤与本仓库实际文件一致（额外只有说明注释和末尾可选的 Vale 段）：markdownlint、链接检查、文档自洽检查、预扫自测与报告 Schema 校验是必过门禁；Vale 需先备好风格包、默认注释，按需启用。

下面三步「docs consistency / pre-scan self-test / validate report schema」依赖本仓库的 scripts/check-docs.mjs、scripts/pre-scan.test.mjs 与 references/report.schema.json；复制到其他仓库时按需删改，或换成自己的自洽检查。

~~~yaml
name: docs-qa

on:
  push:
    branches: [main]
    paths:
      - "**.md"
      - "**.markdown"
      - ".markdownlint.yml"
      - "lychee.toml"
      - ".github/workflows/docs-qa.yml"
      - "scripts/**"
      - "**.json"
  pull_request:
    paths:
      - "**.md"
      - "**.markdown"
      - ".markdownlint.yml"
      - "lychee.toml"
      - ".github/workflows/docs-qa.yml"
      - "scripts/**"
      - "**.json"

  workflow_call:

permissions:
  contents: read

jobs:
  docs-qa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: markdownlint
        run: npx --yes markdownlint-cli2 "**/*.md"

      # 仓库自洽检查：SKILL.md 版本 / 引用文件 / README 目录树（依赖 scripts/check-docs.mjs）
      - name: docs consistency
        run: node scripts/check-docs.mjs

      - name: pre-scan self-test
        run: node scripts/pre-scan.test.mjs

      # 报告 JSON Schema 校验（依赖 references/report.schema.json 与 examples/*.json）
      - name: validate report schema
        run: npx --yes ajv-cli@5 validate --spec=draft2020 -s references/report.schema.json -d "examples/*.json"

      - name: check-links
        uses: lycheeverse/lychee-action@v2
        with:
          args: --config ./lychee.toml --no-progress '**/*.md'
          fail: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # 可选：Vale 需先准备 .vale.ini + styles/ + Vocab
      # - name: vale
      #   uses: errata-ai/vale-action@reviewdog
      #   with:
      #     files: .
~~~

提示：docproof 也有现成 GitHub Action，见 https://github.com/melbinjp/docproof 。可把它加进同一工作流，用于「文档声称是否仍对仓库成立」的硬校验（文件路径 / CLI flag / 版本号 / 文档化 import）。
