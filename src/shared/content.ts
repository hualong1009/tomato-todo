/**
 * 待办正文的长度限制。
 *
 * 正文是 Markdown，图片以 base64 data URL 内嵌（`![alt](data:image/webp;base64,…)`），
 * 一段 100KB 的图片编码后就有 13 万字符——如果直接按整串长度判断，插一张图就会
 * 触发「内容不能超过 50000 个字符」，导致待办根本存不下来。
 *
 * 所以长度限制只统计**真正的文字**：内嵌图片 / 附件按占位符计入，
 * 图片本身体积另有单张上限（编辑器插入时压到 1280px WebP）。
 */

/** 正文文字长度上限（不计内嵌图片 / 附件的 base64 体积）。 */
export const CONTENT_TEXT_LIMIT = 50000

/** 正文总字符上限（含内嵌图片）：约 8MB，防止单条待办把存储和同步拖垮。 */
export const CONTENT_MAX_CHARS = 8 * 1024 * 1024

/** Markdown 图片里的 base64 data URL：![alt](data:image/webp;base64,AAAA…) */
const MARKDOWN_IMAGE_DATA_URL = /!\[([^\]]*)\]\(\s*data:[^)\s]*\)/gi

/** HTML 形式的 base64 图片：<img src="data:image/png;base64,AAAA…"> */
const HTML_IMAGE_DATA_URL = /<img\b[^>]*\bsrc=["']?data:[^>"']*["']?[^>]*>/gi

/** 夹在文字里的裸 data URL（既不在图片语法里，也不是 HTML 属性）。 */
const BARE_DATA_URL = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64,[a-z0-9+/=_\-]*/gi

/** 把正文里的内嵌图片换成占位文字，用于字数统计 / 文本摘要等纯文本场景。 */
export function describeInlineImages(content: string, placeholder = '［图片］'): string {
  return content
    .replace(MARKDOWN_IMAGE_DATA_URL, placeholder)
    .replace(HTML_IMAGE_DATA_URL, placeholder)
    .replace(BARE_DATA_URL, placeholder)
}

/** 统计正文的文字长度（内嵌图片 / 附件按一个占位符计）。 */
export function contentTextLength(content: string): number {
  return describeInlineImages(content).length
}

/** 正文是否超过文字上限（不含图片体积）。 */
export function contentTooLong(content: string): boolean {
  return contentTextLength(content) > CONTENT_TEXT_LIMIT
}
