import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const 项目目录 = resolve(new URL("..", import.meta.url).pathname);
const 软件包 = JSON.parse(await readFile(resolve(项目目录, "package.json"), "utf8"));
const 版本号 = process.env.VITE_ADMIN_VERSION || 软件包.version;
const 构建提交 = process.env.GOTAP_BUILD_COMMIT || "";

await new Promise((resolvePromise, reject) => {
  const vite命令 = process.platform === "win32" ? "vite.cmd" : "vite";
  const 子进程 = spawn(vite命令, ["build"], {
    cwd: 项目目录,
    env: { ...process.env, VITE_ADMIN_VERSION: 版本号 },
    stdio: "inherit",
  });
  子进程.on("error", reject);
  子进程.on("exit", (退出码) => {
    if (退出码 === 0) resolvePromise();
    else reject(new Error(`前端构建失败，退出码：${退出码}`));
  });
});

const 清单目录 = resolve(项目目录, "dist/assets");
await mkdir(清单目录, { recursive: true });
await writeFile(
  resolve(清单目录, "version.json"),
  `${JSON.stringify(
    {
      version: 版本号,
      commit: 构建提交,
      built_at: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
