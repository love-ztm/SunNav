# SunNav

粉色玻璃拟态风格的个人导航仪表盘。基于开源项目 [ModernNav](https://github.com/lyan0220/ModernNav)（原作者 [Lyan](https://github.com/lyan0220)）二次开发，前端 React + Tailwind CSS，后端 Cloudflare Pages Functions + D1，全部跑在 Cloudflare 免费套餐上。

线上示例：**https://nav.ww.fyi**

[English](README_en.md) | 中文

## 功能

**前台**

- 分类 + 子分组 + 链接三级结构，玻璃拟态卡片
- 聚合搜索（站内 / Google / Bing 等可配置，快捷键 `/` 唤起命令面板）
- 亮色 / 暗色 / 跟随系统三态主题，暗色模式支持独立壁纸
- 每日壁纸、主题色自动取色、背景模糊、卡片毛玻璃参数可调
- 卡片宽度 / 高度 / 图标大小 / **每行卡片数** 全部后台可调
- 访问码登录可见的私密分类，访客不可见
- 中英双语，未设置时默认中文
- PWA：可添加到主屏幕

**后台（`/admin`，默认访问码 `admin`）**

- 内容管理：分类 / 链接的增删改、拖拽排序、⭐ 一键指定打开站点时默认显示的分类
- 外观设置：壁纸、主题色、玻璃质感、布局全参数
- **WebDAV 云备份**：支持同时配置两个 WebDAV 网盘（坚果云 / InfiniCLOUD / AList 等）
  - 定时自动备份：设定每日备份时间与保留份数，超出自动清理
  - 备份列表随时可查，任意一份一键恢复
- 数据导入导出（JSON）、浏览器书签导入
- 访问码修改（PBKDF2 哈希存储，修改后所有已登录设备失效）

## 部署（Cloudflare Pages）

1. Fork 或推送本仓库 → Cloudflare Dashboard → **Workers & Pages** → 连接该仓库创建 Pages 项目（框架选 Vite，构建命令 `npm run build`）
2. 创建 **D1 数据库**（示例名 `sunnav-db`），在数据库 **Console** 中执行 [`schema-console.sql`](./schema-console.sql)（D1 控制台解析不了带 `--` 注释的 SQL，所以用这份无注释版；带注释的 [`schema.sql`](./schema.sql) 供 wrangler CLI 使用）
3. Pages 项目 → **Settings → Bindings** 添加 D1 绑定：变量名 **`DB`** → 选择该数据库 → **重新部署**
4. 访问站点，齿轮图标进入后台。默认账号 / 密码：**admin / admin**（登录页只需输入访问码 `admin`），登录后第一时间在 全局设置 → 底部 修改密码

> 修改访问码会轮换 JWT 签名密钥，所有已登录设备需重新登录。

## WebDAV 定时备份说明

Cloudflare Pages Functions 没有常驻定时器，定时备份采用**懒触发**：页面打开时（及每 10 分钟）静默检查一次，已过设定时间且当天未备份则自动执行。因此实际备份时刻为「设定时间之后第一次打开站点」；页面保持打开则会准点备份。

- 推荐使用**应用密码**（如坚果云：账户信息 → 安全选项 → 生成应用密码）
- WebDAV 地址必须公网可达（局域网 NAS 地址 Cloudflare 无法访问）
- 备份文件为 JSON（分类 + 壁纸 + 偏好），与「下载备份文件」导出格式一致

## 本地开发

```bash
npm install
npx wrangler d1 execute sunnav-db --local --file=./schema.sql
npm run dev            # 前端开发
npm run build          # 生产构建
npx wrangler pages dev ./dist   # 本地全栈模拟（含 Functions + D1）
```

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 · Tailwind CSS · TanStack Query · Vite |
| 后端 | Cloudflare Pages Functions |
| 数据库 | Cloudflare D1 (SQLite) |
| 认证 | 访问码 + JWT (HMAC-SHA256) · HttpOnly Cookie · IP 限流 |
| 备份 | WebDAV（多目标 · 定时 · 保留策略） |

## 致谢与许可

基于 [ModernNav](https://github.com/lyan0220/ModernNav)（原作者 [Lyan](https://github.com/lyan0220)）二次开发，感谢原作者。

[MIT](./LICENSE)
