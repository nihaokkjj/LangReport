# T3 核心分支覆盖基线

> 状态：已启用不回退门槛
>
> 测量条件：Node.js 22.22.2、Node 原生 `--experimental-test-coverage`、每个 package 的 `src/**`。不计算测试文件、依赖 package 或全仓聚合百分比。

| Package | T3 实测分支覆盖 | 强制下限 | 执行位置 |
| --- | ---: | ---: | --- |
| `@langreport/data-engine` | 64.94% | 64% | `packages/data-engine/package.json` |
| `@langreport/generation` | 75.68% | 75% | `packages/generation/package.json` |
| `@langreport/domain` | 81.40% | 81% | `packages/domain/package.json` |
| `@langreport/chart` | 75.00% | 75% | `packages/chart/package.json` |
| `@langreport/model-gateway` | 73.28% | 73% | `packages/model-gateway/package.json` |

每个下限等于 T3 实测分支覆盖率向下取整，并通过 Node 原生 `--test-coverage-branches` 强制执行。门槛仅覆盖上述五个核心 package；不设置全仓、行覆盖或函数覆盖门槛，后续只能提高，不能回退。
