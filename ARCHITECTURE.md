# 经途系统架构

本文档描述经途中级经济师刷题工具的开发、题库维护、持续集成、线上部署和用户数据存储方式。

## 总体架构

```text
本地开发机
├─ imports/raw/                 原始题目
├─ database/question-bank.sqlite
│                               题库维护主库
└─ dist/data/questions.json     网页发布题库
          │ git push
          ▼
GitHub
├─ main 分支
└─ Actions：校验 JS、题库、同步 API、部署脚本
          │ CI 成功
          ▼
云服务器
├─ Nginx：HTTPS 和静态页面
├─ Python API：账号及进度同步
├─ /var/lib/jingtu/jingtu.db：用户账号、做题记录
└─ 每两分钟检查 GitHub 并自动部署
```

系统采用“本地开发、GitHub 管理代码、云服务器运行”的模式。题库维护数据和用户运行数据相互独立，发布新版不会覆盖用户记录。

## 组件职责

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| 原始题目投放区 | `imports/raw/` | 接收 CSV、JSON、JSONL 等待导入资料 |
| 题库维护主库 | `database/question-bank.sqlite` | 保存题目、导入批次、去重指纹和异常记录 |
| 网页发布题库 | `dist/data/questions.json` | 提供给浏览器读取的只读题库 |
| 前端 PWA | `dist/` | 刷题、错题、模考、学习报告和离线回退 |
| 同步 API | `server/jingtu_api.py` | 注册、登录、会话和学习进度同步 |
| GitHub Actions | `.github/workflows/ci.yml` | 在发布前执行语法、题库、缓存策略、API 和部署脚本测试 |
| 自动部署器 | `deploy/server-auto-deploy.sh` | 仅部署 CI 成功的 `main` 提交，并执行备份和健康检查 |
| Nginx | 云服务器 | HTTPS、静态文件、缓存控制和 `/api/` 反向代理 |
| 用户数据库 | `/var/lib/jingtu/jingtu.db` | 保存线上账号、会话和学习进度 |

## 两类数据库

### 题库维护数据库

- 文件：`database/question-bank.sqlite`
- 所在位置：本地开发机
- 用途：题目整理、批量导入、内容去重、审核和导出
- Git 策略：不提交到 GitHub
- 发布方式：导出为 `dist/data/questions.json` 后提交

### 用户运行数据库

- 文件：`/var/lib/jingtu/jingtu.db`
- 所在位置：云服务器
- 用途：用户账号、登录会话、做题记录和同步版本号
- Git 策略：不进入源码仓库
- 发布策略：代码部署不覆盖该文件
- 备份位置：`/var/lib/jingtu/backups/`

这两个数据库用途不同，不能相互替代。题库更新只改变发布 JSON；应用更新只改变代码；两者都不会主动改写线上用户数据库。

## 题库数据流

```text
CSV / JSON / JSONL
        │ 放入 imports/raw/
        ▼
npm run bank:sync
        ├─ 初始化题库主库
        ├─ 按文件 SHA-256 跳过已处理资料
        ├─ 按题目内容指纹去重
        ├─ 生成 reports/imports/ 导入报告
        ├─ 导出 dist/data/questions.json
        └─ 校验题型、选项、答案和审核状态
        │
        ▼
git commit + git push
        │
        ▼
GitHub CI → 云服务器自动部署 → 用户刷新读取新题库
```

题目 `id` 必须跨版本保持稳定。用户错题和学习记录通过题目 `id` 关联；修改题干时不应随意更换已有题目的 `id`，也不能把旧 `id` 分配给另一道题。

## 用户数据同步流

```text
浏览器本地状态
      │ 登录后合并
      ▼
HTTPS /api/progress
      ▼
Nginx 反向代理
      ▼
Python 同步 API
      ▼
/var/lib/jingtu/jingtu.db
```

- 未登录时，学习记录保存在浏览器 `localStorage`。
- 登录时，本地记录与云端记录进行合并。
- 登录后，每次状态变化会延迟约 900 毫秒自动同步。
- 写入使用 `baseRevision` 进行并发冲突检测；发生冲突时先合并再重试。
- `/api/` 请求使用 `Cache-Control: no-store`，且完全绕过 Service Worker。
- 会话 Cookie 设置为 `HttpOnly`、`Secure` 和 `SameSite=Lax`。

## 浏览器缓存策略

| 内容 | 策略 |
| --- | --- |
| `/api/` | 不由 Service Worker 接管，永不进入 Cache Storage |
| `data/questions.json` | 网络优先，离线时使用最近成功缓存 |
| HTML、JavaScript、CSS | 在线时向服务器重新验证，离线时回退缓存 |
| Service Worker | Nginx 返回 `no-cache, no-store, must-revalidate` |

发布新版 Service Worker 时会立即激活、清理旧 `jingtu-*` 缓存并接管页面。Worker 切换后页面自动重新加载，确保用户刷新即可获得新题库和新程序。

## GitHub 持续集成

代码仓库：<https://github.com/jerrist/jingtu>

向 `main` 推送后，GitHub Actions 依次执行：

1. JavaScript 语法检查；
2. 题库结构与内容校验；
3. Service Worker 缓存策略测试；
4. Python 同步 API 冒烟测试；
5. Bash 部署脚本语法检查。

任何步骤失败时，服务器不会部署该提交。

## 自动部署流程

```text
服务器定时器（每两分钟）
        │
        ├─ 获取 GitHub main 最新提交
        ├─ 确认该提交的 CI 已成功
        ├─ 下载并校验源码
        ├─ 创建用户数据库一致性备份
        ├─ 创建独立前端版本目录
        ├─ 更新 Python API
        ├─ 原子切换 current 符号链接
        ├─ 重启同步服务
        └─ 执行健康检查
```

主要服务器路径：

| 路径 | 用途 |
| --- | --- |
| `/var/www/jingtu/releases/` | 按 Git 提交保存前端版本 |
| `/var/www/jingtu/current` | Nginx 当前使用的前端版本链接 |
| `/opt/jingtu/server/` | Python 同步 API |
| `/var/lib/jingtu/jingtu.db` | 用户运行数据库 |
| `/var/lib/jingtu/backups/` | 部署前数据库备份 |
| `/var/lib/jingtu/deployed-commit` | 当前已部署 Git 提交 |
| `/usr/local/sbin/jingtu-auto-deploy` | 服务器自动部署程序 |

## 故障与回滚

- CI 失败：不触发部署，线上继续运行原版本。
- GitHub 下载失败：部署任务退出，当前版本不切换；定时器稍后重试。
- 新 API 健康检查失败：恢复原前端链接和后端文件，然后重启原服务。
- 前端发布采用独立目录和原子符号链接切换，不覆盖旧版本。
- 每次实际部署前备份 `jingtu.db`，代码回滚不会删除用户数据。

## 数据边界

以下文件不会提交到 GitHub：

- `database/*.sqlite`
- `imports/raw/` 中的原始资料
- `reports/imports/` 中的导入报告
- `exports/` 中的临时导出结果
- `deploy/*.tar.gz` 发布压缩包
- 日志、环境变量和 Python 缓存

线上用户数据库、密码哈希、登录会话和学习记录始终只保存在云服务器。
