import { net } from 'electron'

/**
 * 使用 Electron 的 Chromium 网络栈，而不是 Node/undici。
 * 这样可以自动使用系统代理与系统证书，解决企业内网自签 CA 下
 * Node fetch 报 `fetch failed / unable to verify the first certificate` 的问题。
 */
export const appFetch = net.fetch.bind(net) as typeof fetch
