/**
 * __mock__ —— 离线演示数据入口
 * ---------------------------------------------------------------------------
 * 仅在真实接口不可用时启用（见 src/pages/entry/client.ts 的降级策略）。
 * 生产构建同样保留：真实接口返回 404/5xx 时会自动切到演示数据，页面不白屏。
 */

export * from './data'
export { mockApi } from './store'
export type { MockApi } from './store'
