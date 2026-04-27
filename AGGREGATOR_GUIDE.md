# 聚合器系统指南

## 概述

新的聚合器系统已从基于内容类型（`movie`/`series`）改为基于命名聚合器的方式，支持按地域、内容类型、来源进行灵活的分组。

## 当前定义的聚合器

### 1. **海外动漫** (`overseas-anime`)
- **支持类型**: 系列剧
- **供应商**: Animekhor, Superstream
- **地域**: overseas
- **优先级**: 100
- **用途**: 专门聚合海外地区可访问的动漫源

### 2. **大陆动漫** (`mainland-anime`)
- **支持类型**: 系列剧
- **供应商**: DonghuaFun, Donghuastream, Donghuaworld
- **地域**: mainland
- **优先级**: 100
- **用途**: 专门聚合大陆地区的动漫源

### 3. **混合动漫** (`mixed-anime`)
- **支持类型**: 系列剧
- **供应商**: 所有动漫源（DonghuaFun, Donghuastream, Donghuaworld, Animekhor, Superstream, Netmirror）
- **地域**: auto
- **优先级**: 50
- **用途**: 混合所有来源，适合全球用户使用

### 4. **主流电影** (`mainstream-movies`)
- **支持类型**: 电影
- **供应商**: VidLink
- **地域**: auto
- **优先级**: 100
- **用途**: 主流电影内容聚合

## 使用方法

### 在代码中获取聚合器

```typescript
import { 
  getAggregatorByName,
  getAggregatorByType,
  getAggregatorByProviderId,
  getDefaultAggregator,
  getAllAggregators
} from './core/aggregator';

// 根据名称获取具体的聚合器
const overseasAnim = getAggregatorByName('overseas-anime');

// 根据类型获取默认聚合器
const seriesAgg = getAggregatorByType('series');

// 根据供应商 ID 获取其所属的聚合器
const agg = getAggregatorByProviderId('donghuafun');

// 根据类型和地域获取聚合器
const mainlandSeries = getDefaultAggregator('series', 'mainland');

// 获取所有已注册的聚合器
const allAggs = getAllAggregators();
```

## 多地域部署方案

对于在不同地区部署的场景，建议使用环境变量和 Docker Compose 进行配置：

### 环境变量配置

```bash
# .env.overseas
ACTIVE_AGGREGATORS=overseas-anime,mainstream-movies
PORT=3000

# .env.mainland
ACTIVE_AGGREGATORS=mainland-anime,mainstream-movies
PORT=3001
```

### Docker Compose 部署

```yaml
version: '3.8'

services:
  # 海外部署实例
  donghua-overseas:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - ACTIVE_AGGREGATORS=overseas-anime,mainstream-movies
      - NODE_ENV=production
    # 可选：配置代理以解决地域访问限制
      # - PROXY_URL=socks5://proxy-us:1080

  # 大陆部署实例
  donghua-mainland:
    build: .
    ports:
      - "3001:3000"
    environment:
      - PORT=3000
      - ACTIVE_AGGREGATORS=mainland-anime,mainstream-movies
      - NODE_ENV=production
    # 可选：配置代理以解决地域访问限制
      # - PROXY_URL=socks5://proxy-cn:1080
```

## 扩展聚合器

要添加新的聚合器，修改 `src/core/providerRegistry.ts` 中的 `aggregatorConfigs` 数组：

```typescript
const aggregatorConfigs: AggregatorConfig[] = [
  // 现有的聚合器...
  {
    name: 'my-custom-agg',
    displayName: '我的自定义聚合器',
    supportedTypes: ['series'],
    providerIds: ['provider1', 'provider2'],
    region: 'overseas',
    priority: 90,
  },
];
```

## 地域限制和代理支持

### NetMirror 印度 IP 问题

NetMirror 需要印度 IP 才能正常访问。为了支持这一点，后续可以扩展以下功能：

```typescript
// 计划中的功能：按供应商配置代理
interface ProviderConfig {
  id: string;
  proxyUrl?: string;  // 该供应商专用的代理
  geolocation?: string; // 地理位置标签，如 'IN', 'CN', 'US'
}
```

## 缓存键变更

新系统中缓存键已改为：`{aggregator-name}:streams:{id}`

这确保了不同聚合器的缓存相互隔离，避免冲突。

## 向后兼容性

旧的 API（如 `movieAggregator`, `seriesAggregator`, `getAggregatorByType()`）仍然可用，以确保现有代码不中断。这些 API 会自动路由到适当的默认聚合器。

## 迁移路径

- **现在**: 使用命名聚合器实现基础功能
- **下一步**: 支持环境变量配置激活的聚合器
- **后续**: 添加代理/IP 池管理，支持供应商级别的地理位置配置
- **远期**: 考虑动态聚合器配置（从远程配置服务加载）
