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
- markdown-doctest（JS 生态）：`npx markdown-doctest README.md`

## GitHub Actions —— 组合检查（自包含版）

文件 `.github/workflows/docs-qa.yml`。markdownlint 与 lychee 是必过门禁；Vale 需先备好风格包，默认注释掉，按需启用。

~~~yaml
name: docs-qa

on:
  push:
    branches: [main]
    paths: ["**.md", ".markdownlint.yml", "lychee.toml", ".github/workflows/docs-qa.yml"]
  pull_request:
    paths: ["**.md", ".markdownlint.yml", "lychee.toml", ".github/workflows/docs-qa.yml"]

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

      - name: check-links
        uses: lycheeverse/lychee-action@v2
        with:
          args: --config ./lychee.toml --no-progress "**/*.md"
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
