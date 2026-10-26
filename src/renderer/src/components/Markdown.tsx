import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo } from 'react'

marked.setOptions({ gfm: true, breaks: true })

export function Markdown({ content }: { content: string }) {
  const html = useMemo(() => {
    const parsed = marked.parse(content, { async: false }) as string
    return DOMPurify.sanitize(parsed)
  }, [content])
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
}
