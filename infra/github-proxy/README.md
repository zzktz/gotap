# GitHub 发布文件代理

该代理复用 GoYou 生产服务器上的 SSH 隧道（`127.0.0.1:19080`），提供两类 HTTP CONNECT 入口：

- `127.0.0.1:18081`：宿主机上的 GoYou 管理 API 使用
- `172.21.0.1:18082`：GoTap Docker bridge 网络中的管理 API 使用

GoTap 管理 API 通过 `GITHUB_PROXY_URL=http://172.21.0.1:18082` 访问 GitHub。`172.21.0.1` 是生产环境 `gotap-api_default` 网络的网关地址；如果重新创建 Docker 网络，需要同步修改监听地址和环境变量。
