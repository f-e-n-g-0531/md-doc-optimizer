<div align="center">

# md-doc-optimizer

**Audit & optimize Markdown documentation — remove redundancy, remove staleness, fix the facts.**

一个用于**审计并优化项目 Markdown 文档**的 Agent Skill：**去冗余 · 删过期失效 · 纠事实不符**。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Format: SKILL.md](https://img.shields.io/badge/format-SKILL.md-orange)](#)

</div>

## 这是什么

md-doc-optimizer 是一个「文档瘦身 + 事实核对」的可复用 Agent 技能。它不写新内容，只做三件事：

1. **去冗余** —— 删除重复段落/标题/链接、口水词、跨文件重复拷贝。
2. **删过期失效** —— 删除或更新已过期的表述、失效链接、不存在的路径/脚本/命令、已完成的 TODO。
3. **纠事实不符** —— 修正与代码/配置/git 历史/实际运行结果矛盾的参数、版本、示例输出、术语、链接文本。

核心原则：**证据优先**。任何删改都必须指向可复现证据（代码、git 历史、实际运行结果、链接状态、权威来源），绝不凭记忆或语感改写；无法确证的改动显式标 NEEDS_HUMAN，不脑补。

## 快速开始

在 DSH 中直接说：

~~~
用 md-doc-optimizer 清理/优化 <路径或仓库> 的文档
~~~

或描述需求，例如：

~~~
把 README 与当前代码对齐；检查 docs 里失效的链接和命令
~~~

## 安装

### DSH

把本目录放到用户技能目录下（与 code-refactor-prompts、serenity-skill 同级）：

~~~
~/.dsh/skills/md-doc-optimizer/
~~~

Windows 下为：

~~~
C:\Users\<用户名>\.dsh\skills\md-doc-optimizer\
~~~

放入后重启 DSH 或重载会话即可被自动发现并按描述触发。

### 其他 Agent（Claude Code / 通用 SKILL.md 生态）

本技能遵循通用 SKILL.md（frontmatter + 正文）格式，可直接安装到任意支持该格式的 Agent 技能目录，例如：

~~~
~/.claude/skills/md-doc-optimizer/
~~~

### 手动（git）

~~~bash
git clone git@github.com:f-e-n-g-0531/md-doc-optimizer.git
# 或
git clone https://github.com/f-e-n-g-0531/md-doc-optimizer.git
~~~

## 目录结构

~~~
md-doc-optimizer/
├── SKILL.md                      # 主体：三大目标 + 证据优先 5 阶段工作流
├── README.md
├── LICENSE / CHANGELOG.md
├── references/
│   ├── sources.md                # 同领域项目/工具调研（含出处）
│   ├── audit-checklist.md        # 逐目标检查清单
│   ├── tool-configs.md           # markdownlint / Vale / lychee / cspell / CI 配置
│   ├── drift-playbook.md         # 文档↔代码漂移核对
│   └── prompting-templates.md    # 可复用提示词模板
└── examples/
    └── before-after.md           # 去/删/改三段式示例
~~~

## 工具生态

本技能整合了以下成熟工具的能力（详见 references/sources.md）：

| 目标 | 工具 |
| --- | --- |
| 结构去重 | markdownlint、remark-lint |
| 文风/冗余 | Vale + write-good / proselint / alex |
| 链接失效 | lychee、markdown-link-check |
| 拼写 | cspell、typos |
| 文档↔代码一致 | docproof、mdoctest、Redocly respect |

工具只做「预扫候选清单」，最终结论仍以证据与运行结果为准。

## 来源与致谢

方法论与工具清单参考了 [CloudBase-AI-Toolkit 的 doc-freshness-review](https://github.com/TencentCloudBase/CloudBase-AI-Toolkit)、[testthedocs/awesome-docs](https://github.com/testthedocs/awesome-docs) 以及 Google / Microsoft / Diátaxis 文档风格指南等，完整出处见 references/sources.md。

## License

[MIT](./LICENSE) © 2026 f-e-n-g-0531
