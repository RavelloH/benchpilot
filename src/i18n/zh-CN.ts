import type { MessageCatalog } from "./types.js";

export const zhCN: MessageCatalog = {
  "cli.interaction.agent": "此命令需要人类交互会话，Agent 不应直接调用。",
  "cli.interaction.terminal": "此命令需要可交互的终端。",
  "cli.interaction.machine":
    "此命令需要交互式输入，不能与机器输出模式一起使用。",
  "cli.interaction.cancelled": "交互已取消。",
  "init.language": "选择显示语言",
  "init.projectId": "项目 ID",
  "init.projectName": "项目名称",
  "init.locale": "显示语言",
  "init.done": "BenchPilot 项目已初始化。",
  "menu.choose": "选择下一步操作",
  "menu.value": "请输入{name}",
  "menu.invalid": "请选择列出的选项之一。",
  "error.unknown": "命令失败：{message}",
};
