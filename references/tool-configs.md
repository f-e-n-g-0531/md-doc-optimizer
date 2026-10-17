# 现成工具配置（tool-configs.md）

以下配置可直接粘贴。工具一律作「预扫候选清单」，最终结论仍以读到的证据与运行结果为准。

## markdownlint —— 结构 / 去重

文件 .markdownlint.yml：

~~~yaml
default: true
# 行长度交给格式化工具，避免与内容去重混在一起
MD013: false
# 重复标题：仅兄弟层级也算重复（去冗余核心）
MD024:
  siblings_only: true
# 多一级标题在长文档常见，关闭；README 类若坚持单 H1 请改回 true
MD025:
  front_matter_title: ""
# 允许内联 HTML，减少误报
MD033: false
# 是否禁止用强调当标题，按团队风格定
MD036: false
MD041: false     # 首行标题非强制
MD048:          # 代码围栏风格统一
  style: "backtick"
~~~

运行：npx markdownlint-cli2 "**/*.md"

## Vale —— 文风 / 冗余 / 得体

文件 .vale.ini：

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

安装风格包（任选其一在 styles/ 下放置）：write-good、proselint、alex、Microsoft、Google。

运行：vale .

## lychee —— 链接失效

文件 lychee.toml：

~~~toml
files = ["**/*.md", "**/*.html"]
exclude_all_private = true
exclude = ["localhost", "127.0.0.1", "example.com"]
accept = ["200", "301", "302", "403", "429"]
max_retries = 2
timeout = 10
~~~

运行：lychee --no-progress .

## markdown-link-check —— 单文件链接

运行：npx markdown-link-check README.md
（批量：对每个 *.md 循环执行，或配 config.json 加 ignorePatterns）

## cspell —— 拼写 / 错词

文件 .cspell.json：

~~~json
{
  "version": "0.2",
  "language": "en",
  "words": ["markdownlint", "lychee", "vale", "dedupe", "docproof"],
  "ignorePaths": ["node_modules", "*.lock", "dist", "LICENSE"],
  "allowCompoundWords": true
}
~~~

运行：npx cspell "**/*.md"

## doctest —— 复跑示例代码（事实核对）

- mdoctest（语言无关）：mdoctest README.md （加 --fix 自动更新失效输出）
- markdown-doctest（JS 生态）：npx markdown-doctest README.md

## GitHub Actions —— 组合检查

文件 .github/workflows/docs-qa.yml：

~~~yaml
name: docs-qa
on:
  pull_request:
    paths: ["**.md"]
  push:
    paths: ["**.md"]
jobs:
  qa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: markdownlint
        run: npx markdownlint-cli2 "**/*.md"
      - name: spell
        run: npx cspell "**/*.md"
      - name: vale
        uses: errata-ai/vale-action@reviewdog
        with:
          files: .
      - name: links
        uses: lycheeverse/lychee-action@v2
        with:
          args: --no-progress ./
~~~

提示：docproof 也有现成 GitHub Action，见 https://github.com/melbinjp/docproof 。可把它加进同一工作流，用于「文档声称是否仍对仓库成立」的硬校验（文件路径 / CLI flag / 版本号 / 文档化 import）。
