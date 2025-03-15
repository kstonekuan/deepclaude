  "use client"

import * as React from "react"
import { Textarea } from "./textarea"
import { Button } from "./button"
import { useEffect } from "react"

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
}

export function MarkdownEditor({
  value,
  onChange,
  onSubmit,
  placeholder
}: MarkdownEditorProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Automatically adjust height of textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = `${Math.min(textarea.scrollHeight, 300)}px`
    }
  }, [value])

  // Handle special key combinations
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget
    const { selectionStart, selectionEnd, value } = textarea

    // Handle Enter key
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault()
      onSubmit()
      return
    }

    // Handle code block autocompletion
    if (e.key === "`") {
      const beforeCursor = value.slice(0, selectionStart)
      const afterCursor = value.slice(selectionEnd)
      
      // Triple backtick
      if (beforeCursor.endsWith("``")) {
        e.preventDefault()
        const insertion = "```\n\n```"
        onChange(
          value.slice(0, selectionStart - 2) + insertion + afterCursor
        )
        // Place cursor between the code block
        setTimeout(() => {
          textarea.setSelectionRange(
            selectionStart + 2,
            selectionStart + 2
          )
        }, 0)
        return
      }
      
      // Single backtick
      if (!beforeCursor.endsWith("`")) {
        e.preventDefault()
        const insertion = "``"
        onChange(
          value.slice(0, selectionStart) + insertion + afterCursor
        )
        // Place cursor between the backticks
        setTimeout(() => {
          textarea.setSelectionRange(
            selectionStart + 1,
            selectionStart + 1
          )
        }, 0)
      }
    }
  }

  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="min-h-[40px] py-2 resize-none overflow-y-hidden"
        />
      </div>
      <Button 
        onClick={onSubmit}
        className="h-[40px] px-4 self-end"
      >
        Send
      </Button>
    </div>
  )
}
