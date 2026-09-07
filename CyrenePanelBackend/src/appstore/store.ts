export interface GameApp {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: "minecraft-paper" | "minecraft-vanilla" | "generic";
  defaultCommand: string;
  defaultEnv: Record<string, string>;
  downloadUrl?: string; // 如果固定可以提供
}

export const gameApps: GameApp[] = [
  {
    id: "mc-paper-1.20.4",
    name: "Minecraft Paper (1.20.4)",
    description: "高性能的我的世界 Java 版服务端，支持插件，推荐使用。",
    icon: "logos:minecraft",
    type: "minecraft-paper",
    // 启动命令，默认分配 2G 内存
    defaultCommand: "java -Xms1G -Xmx2G -jar server.jar nogui",
    defaultEnv: {},
    // 使用 PaperMC V3 API 动态获取最新构建
  },
  {
    id: "mc-paper-1.16.5",
    name: "Minecraft Paper (1.16.5)",
    description: "经典版本 1.16.5 的 Paper 服务端。",
    icon: "logos:minecraft",
    type: "minecraft-paper",
    defaultCommand: "java -Xms1G -Xmx2G -jar server.jar nogui",
    defaultEnv: {},
    // 使用 PaperMC V3 API 动态获取最新构建
  },
  {
    id: "mc-vanilla-1.20.4",
    name: "Minecraft Vanilla (1.20.4)",
    description: "我的世界官方原版服务端，不包含任何插件支持。",
    icon: "logos:minecraft",
    type: "minecraft-vanilla",
    defaultCommand: "java -Xms1G -Xmx2G -jar server.jar nogui",
    defaultEnv: {},
    // 官方服务端，但这里可以用 BMCLAPI 等镜像源，为简化使用一个固定可用的源
    downloadUrl: "https://bmclapi2.bangbang93.com/version/1.20.4/server",
  }
];
