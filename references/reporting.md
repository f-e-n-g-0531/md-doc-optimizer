# 报告与交付规范（reporting.md）

审计结果要能被复核、被机器消费、能直接转成 issue/PR。本文件定义报告字段、JSON 契约、NEEDS_HUMAN 写法与交付模板，与 SKILL.md 的「输出格式」配套使用。

## 1. 报告最小字段

每条问题必须包含：

| 字段 | 必填 | 说明 |
|---|---|---|
| `file` | 是 | 文件路径（相对仓库根） |
| `line` | 是 | 行号；整节删除用起始行 |
| `category` | 是 | A 去冗余 / B 删过期失效 / C 纠事实不符 |
| `severity` | 是 | Critical / High / Medium / Low |
| `action` | 是 | delete / replace / annotate / keep |
| `evidence` | 是 | 可复现证据：代码位置、命令与输出、git 提交、链接状态、权威 URL |
| `excerpt` | 否 | 原文摘要（不超过 120 字） |
| `replacement` | 否 | 替换后文本，`action` 为 replace 时必填 |

`action` 取 keep 用于「疑似但判定不改」的条目，避免同一问题被反复提出。

## 2. JSON 契约

~~~json
{
  "summary": {
    "files_audited": 0,
    "examined": 0,
    "fixed": 0,
    "needs_human": 0,
    "no_action": 0
  },
  "findings": [
    {
      "file": "README.md",
      "line": 42,
      "category": "B",
      "severity": "High",
      "action": "delete",
      "excerpt": "将于 2023 年上线插件系统",
      "evidence": "全仓库无插件系统实现；git log --all -S '插件系统' 无对应提交",
      "replacement": null
    }
  ]
}
~~~

约束：

- 无问题时 `findings` 为空数组，`summary.fixed` 与 `summary.needs_human` 均为 0，并用一句话说明 NO_ISSUES。
- 同一行有多个问题合并为一条 finding，证据列全。
- `evidence` 禁止「我觉得 / 可能 / 大概」式表述，必须是路径、命令、提交号或 URL。
- 行号以审计时的文件内容为准；文件已被改动时重新定位后再输出。

## 3. NEEDS_HUMAN 写法

统一四段式，便于人工快速判断：

~~~text
NEEDS_HUMAN: <问题一句话>
证据: <可复现证据>
需要确认: <具体的待确认问题>
建议: <默认处理动作>
~~~

示例：

~~~text
NEEDS_HUMAN: README 声称支持 --legacy 参数
证据: 当前代码无该 flag；git log -S '--legacy' 显示 2024-06 删除
需要确认: 是彻底移除还是改名
建议: 若确认移除，删除该段并更新迁移说明
~~~

## 4. 严重度与默认动作

| 严重度 | 定义 | 报告模式 | 直接修改模式 |
|---|---|---|---|
| Critical | 误导用户做危险或错误操作，或安全、金钱、法律事实错误 | 置顶 | 立即修 |
| High | 事实矛盾、失效主链接、不可运行的核心命令 | 列出 | 修 |
| Medium | 冗余表达、失效次要链接、陈旧示例 | 列出 | 修或标注 |
| Low | 口水词、风格性重复、格式不一致 | 列出 | 仅「彻底」模式处理 |

## 5. 交付模板

### PR 描述

~~~markdown
## 文档审计结果

审查范围：<路径 / 文件数>

### 已修（M 处）

- <文件:行> <类别 / 严重度>：<原句> → <新句>（证据：<...>）

### 待确认（K 处）

- <文件:行>：<问题>（证据：<...>）

### 未改动

<一句话说明其他疑似点为何不改>
~~~

### commit message

~~~text
docs: fix stale/mismatched content in <范围>

- <文件:行>: <动作> <简述>
~~~

## 6. 报告示例

| 文件:行 | 类别 | 严重度 | 原文摘要 | 动作 | 证据 |
|---|---|---|---|---|---|
| README.md:42 | B | High | 将于 2023 年上线插件系统 | 删除整节 | 全仓库无实现；git log -S 无提交 |
| docs/api.md:88 | C | High | `--output-dir` 默认 `./out` | 改为 `--out-dir` / `./build` | src/cli.ts:31 默认值 `./build` |
| README.md:12 | A | Low | 非常简单，只需几步 | 删除 | 口水词，无信息量 |

结论：共审查 3 处，改 3 处，留待人工 0 处。
