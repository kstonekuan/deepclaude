"use client"

import * as React from "react"
import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import Image from "next/image"
import { useVirtualizer } from "@tanstack/react-virtual"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { ChevronRight, ChevronDown, Loader2, Settings2, PlusCircle, Trash2, Github } from "lucide-react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import { CopyButton } from "@/components/ui/copy-button"
import { MarkdownEditor } from "@/components/ui/markdown-editor"
import { usePostHog } from "../providers/posthog"

interface Message {
  role: "user" | "assistant"
  content: string
  thinking?: string
}

interface StoredChat {
  id: string
  title: string
  timestamp: string
  messages: Message[]
}

interface ChatProps {
  selectedModel: string
  onModelChange: (model: string) => void
  apiTokens: {
    anthropicApiToken: string
  }
}

export function Chat({ selectedModel, onModelChange, apiTokens }: ChatProps) {
  const posthog = usePostHog()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [openThinking, setOpenThinking] = useState<number | null>(null)
  const [currentModel, setCurrentModel] = useState(selectedModel || "claude-3-7-sonnet-20250219")
  const parentRef = useRef<HTMLDivElement>(null)
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)
  const [chats, setChats] = useState<StoredChat[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [chatToDelete, setChatToDelete] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null)
  const [elapsedTime, setElapsedTime] = useState<number>(0)
  const [isThinkingComplete, setIsThinkingComplete] = useState<boolean>(false)

  // Format elapsed time into human readable string
  const formatElapsedTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60

    if (minutes === 0) {
      return `${remainingSeconds} seconds`
    }
    return `${minutes} minute${minutes > 1 ? 's' : ''} ${remainingSeconds} seconds`
  }

  // Track elapsed time during thinking
  useEffect(() => {
    if (isLoading && !isThinkingComplete) {
      if (!thinkingStartTime) {
        setThinkingStartTime(Date.now())
      }

      const interval = setInterval(() => {
        if (thinkingStartTime) {
          setElapsedTime(Math.floor((Date.now() - thinkingStartTime) / 1000))
        }
      }, 1000)

      return () => clearInterval(interval)
    }
  }, [isLoading, thinkingStartTime, isThinkingComplete])

  // Save chats to localStorage whenever they change
  useEffect(() => {
    if (chats.length > 0) {
      localStorage.setItem('deepclaude-chats', JSON.stringify(chats))
    }
  }, [chats])

  // Generate chat title from first message
  const generateChatTitle = (firstMessage: string): string => {
    return firstMessage.slice(0, 20)
  }

  // Delete a chat
  const deleteChat = (chatId: string) => {
    posthog.capture('chat_deleted', {
      chat_id: chatId,
      timestamp: new Date().toISOString()
    })
    setChats(prev => prev.filter(chat => chat.id !== chatId))
    if (currentChatId === chatId) {
      setCurrentChatId(null)
      setMessages([])
    }
    setChatToDelete(null)
  }

  // Clear all chats
  const clearAllChats = () => {
    posthog.capture('chats_cleared', {
      chats_count: chats.length,
      timestamp: new Date().toISOString()
    })
    setChats([])
    setCurrentChatId(null)
    setMessages([])
    localStorage.removeItem('deepclaude-chats')
    setShowClearConfirm(false)
  }

  // Generate UUID v4
  const generateUUID = () => {
    // Fallback UUID generator for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }

  // Create a new chat
  const createNewChat = useCallback(() => {
    const chatId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : generateUUID()
    const newChat: StoredChat = {
      id: chatId,
      title: 'New Chat',
      timestamp: new Date().toISOString(),
      messages: []
    }
    setChats(prev => [...prev, newChat])
    setCurrentChatId(chatId)
    setMessages([])

    posthog.capture('chat_created', {
      chat_id: chatId,
      timestamp: new Date().toISOString()
    })
  }, [posthog])

  // Load chats from localStorage on mount and create new chat
  useEffect(() => {
    const storedChats = localStorage.getItem('deepclaude-chats')
    if (storedChats) {
      const parsedChats = JSON.parse(storedChats)
      setChats(parsedChats)
    }
    // Always create a new chat on mount
    createNewChat()
  }, [createNewChat])

  // Update current chat
  const updateCurrentChat = useCallback(() => {
    if (currentChatId && messages.length > 0) {
      setChats(prev => {
        const updatedChats = prev.map(chat => {
          if (chat.id === currentChatId) {
            return {
              ...chat,
              messages,
              title: chat.messages.length === 0 && messages[0] ?
                generateChatTitle(messages[0].content) :
                chat.title
            }
          }
          return chat
        })
        return updatedChats
      })
    }
  }, [currentChatId, messages])

  // Update chat whenever messages change
  useEffect(() => {
    updateCurrentChat()
  }, [messages, updateCurrentChat])

  // Ref for current message
  const currentMessageRef = useRef<Message | null>(null)
  const scrollRef = useRef<number | null>(null)

  // Track model changes
  useEffect(() => {
    if (currentModel !== selectedModel) {
      posthog.capture('model_changed', {
        from_model: currentModel,
        to_model: selectedModel,
        chat_id: currentChatId,
        timestamp: new Date().toISOString()
      })
      setCurrentModel(selectedModel)
    }
  }, [selectedModel, currentModel, currentChatId, posthog])

  // Memoized renderers for code blocks
  const renderers = useMemo(() => {
    const CodeRenderer = React.memo(({ node, inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || "")
      const language = match ? match[1] : "text"
      const content = String(children).replace(/\n$/, "")

      // Check if it's a code block (has language or multiple lines)
      const isCodeBlock = match || content.includes("\n")

      if (!inline && isCodeBlock) {
        return (
          <div className="relative">
            {!isLoading && <CopyButton value={content} />}
            <SyntaxHighlighter
              language={language}
              style={{
                ...oneDark,
                'pre[class*="language-"]': {
                  ...oneDark['pre[class*="language-"]'],
                  background: 'none',
                },
                'code[class*="language-"]': {
                  ...oneDark['code[class*="language-"]'],
                  background: 'none',
                }
              }}
              PreTag="div"
              customStyle={{
                margin: 0,
                borderRadius: "0.375rem"
              }}
              {...props}
            >
              {content}
            </SyntaxHighlighter>
          </div>
        )
      }

      // For inline code or single backticks
      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    })
    CodeRenderer.displayName = 'CodeRenderer'

    return {
      code: CodeRenderer
    }
  }, [isLoading])

  // Optimized virtual list with dynamic sizing and performance tweaks
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => document.getElementById('chat-container'),
    estimateSize: useCallback(() => 100, []), // Lower initial estimate for faster first render
    overscan: 2, // Reduced overscan for better performance
    paddingStart: 20, // Add padding for smoother scrolling
    paddingEnd: 20,
    scrollPaddingStart: 20, // Additional scroll padding for smoother experience
    scrollPaddingEnd: 20
  })

  // RAF-based scroll handler
  const handleScroll = useCallback(() => {
    const container = document.getElementById('chat-container')
    if (!container || isScrolling) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const isAtBottom = scrollHeight - (scrollTop + clientHeight) < 50
    setIsAutoScrollEnabled(isAtBottom)
  }, [isScrolling])

  // Immediate scroll to bottom
  const scrollToBottom = useCallback(() => {
    const container = document.getElementById('chat-container')
    if (!container) return

    if (scrollRef.current) {
      cancelAnimationFrame(scrollRef.current)
    }

    scrollRef.current = requestAnimationFrame(() => {
      if (!container) return
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "auto"
      })
      scrollRef.current = null
    })
  }, [])

  // Immediate auto-scroll on message updates
  useEffect(() => {
    if (isAutoScrollEnabled && messages.length > 0) {
      scrollToBottom()
    }
  }, [messages, isAutoScrollEnabled, scrollToBottom])

  // Scroll event listener with cleanup
  useEffect(() => {
    const container = document.getElementById('chat-container')
    if (!container) return

    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      container.removeEventListener("scroll", handleScroll)
    }
  }, [handleScroll])

  // Memoized message renderer
  const MessageContent = useMemo(() => {
    const MemoizedMessageContent = React.memo(({ message, index }: { message: Message; index: number }) => {
      if (message.role === "user") {
        return (
          <div className="prose prose-zinc dark:prose-invert max-w-none bg-primary/10 rounded-lg px-4 py-3 message-transition" data-loaded="true">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, rehypeSanitize]}
              components={renderers}
              className="message-content"
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )
      }

      return (
        <>
          {message.thinking && (
            <Collapsible
              open={openThinking === index}
              onOpenChange={(open) => setOpenThinking(open ? index : null)}
            >
              <div className="border border-indigo-400/20 dark:border-indigo-500/20 bg-indigo-50/30 dark:bg-indigo-950/10 rounded-lg message-transition mb-3 shadow-sm" data-loaded="true">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full flex items-center justify-between p-2 text-sm text-indigo-700 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:bg-indigo-100/50 dark:hover:bg-indigo-900/20"
                  >
                    <div className="flex items-center gap-2">
                      {(isLoading || !isThinkingComplete) && (
                        <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />
                      )}
                      <span className="font-medium">Thinking</span>
                      {isLoading && !isThinkingComplete && (
                        <span className="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded-full animate-pulse">Live</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-indigo-600/80 dark:text-indigo-400/80">
                        {isThinkingComplete
                          ? `Thought for ${formatElapsedTime(elapsedTime)}`
                          : `Thinking... ${formatElapsedTime(elapsedTime)}`}
                      </span>
                      {openThinking === index ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </div>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="p-4 text-sm bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-900 dark:text-indigo-200 whitespace-pre-wrap border-t border-indigo-200 dark:border-indigo-800/50 message-content overflow-auto max-h-[600px] relative prose prose-indigo dark:prose-invert max-w-none">
                    {!isLoading && message.thinking && <CopyButton value={message.thinking} src="thinking" />}
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw, rehypeSanitize]}
                      components={renderers}
                    >
                      {message.thinking || ""}
                    </ReactMarkdown>
                    {isLoading && !isThinkingComplete && (
                      <div className="h-5 w-5 mt-2">
                        <span className="inline-block h-1 w-1 rounded-full bg-indigo-400 mr-1 animate-bounce" style={{ animationDelay: "0ms" }}></span>
                        <span className="inline-block h-1 w-1 rounded-full bg-indigo-400 mr-1 animate-bounce" style={{ animationDelay: "100ms" }}></span>
                        <span className="inline-block h-1 w-1 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "200ms" }}></span>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}
          <div className="prose prose-zinc dark:prose-invert max-w-none bg-muted/30 rounded-lg px-4 py-3 relative message-transition" data-loaded="true">
            {!isLoading && <CopyButton value={message.content} src="message" />}
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, rehypeSanitize]}
              components={renderers}
              className="message-content"
            >
              {message.content}
            </ReactMarkdown>
          </div>
        </>
      )
    })
    MemoizedMessageContent.displayName = 'MemoizedMessageContent'
    return MemoizedMessageContent
  }, [openThinking, renderers, isLoading, elapsedTime, isThinkingComplete])

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return
    if (!apiTokens.anthropicApiToken) return

    // Track message sent
    posthog.capture('message_sent', {
      chat_id: currentChatId,
      model: currentModel,
      message_length: input.length,
      has_code: input.includes('```'),
      timestamp: new Date().toISOString()
    })

    // Create new chat if none exists
    if (!currentChatId) {
      const newChat: StoredChat = {
        id: typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : generateUUID(),
        title: generateChatTitle(input),
        timestamp: new Date().toISOString(),
        messages: []
      }
      setChats(prev => [...prev, newChat])
      setCurrentChatId(newChat.id)
    }

    const userMessage: Message = {
      role: "user",
      content: input
    }

    setMessages(prev => [...prev, userMessage])
    setInput("")
    setIsLoading(true)
    setThinkingStartTime(null)
    setElapsedTime(0)
    setIsThinkingComplete(false)

    const controller = new AbortController()

    try {
      const requestBody = {
        stream: true,
        system: "You are a helpful AI assistant who excels at reasoning and responds in Markdown format. For code snippets, you wrap them in Markdown codeblocks with it's language specified.",
        verbose: false,
        messages: [...messages, { content: input, role: "user" }].map(msg => ({
          content: msg.content,
          role: msg.role
        })),
        anthropic_config: {
          headers: { 
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "output-128k-2025-02-19"
          },
          body: {
            temperature: 1,
            model: currentModel,
            max_tokens: 128000,
            thinking: {
              type: "enabled",
              budget_tokens: 64000 // Increased token budget for more detailed thinking
            }
          }
        }
      }

      const response = await fetch("http://localhost:1337", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-Anthropic-API-Token": apiTokens.anthropicApiToken
        },
        body: JSON.stringify(requestBody)
      })

      const reader = response.body?.getReader()
      if (!reader) throw new Error("No reader available")

      // Initialize current message
      currentMessageRef.current = {
        role: "assistant",
        content: "",
        thinking: "" // Initialize thinking to empty string to ensure it's always available
      }
      
      // Add empty assistant message to start the streaming UI immediately
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "",
        thinking: ""
      }])

      const processLine = (line: string) => {
        if (!line.trim() || !line.startsWith("data: ")) return

        try {
          const data = JSON.parse(line.slice(6))

          if (data.type === "content") {
            for (const content of data.content) {
              if (!currentMessageRef.current) return

              // Handle thinking content
              if (content.content_type === "thinking" && content.thinking) {
                currentMessageRef.current.thinking = (currentMessageRef.current.thinking || "") + content.thinking
                // Auto-open thinking block when we receive thinking content
                setOpenThinking(messages.length)
              }
              // Handle regular text content
              else if (content.text) {
                currentMessageRef.current.content += content.text
              }

              // Always update messages state to ensure real-time updates
              setMessages(prev => {
                const newCurrentMessage = { ...currentMessageRef.current! }
                
                if (prev.length > 0 && prev[prev.length - 1]?.role === "assistant") {
                  const newMessages = [...prev]
                  newMessages[newMessages.length - 1] = newCurrentMessage
                  return newMessages
                }
                return [...prev, newCurrentMessage]
              })
            }
          } else if (data.type === "message_stop") {
            // Thinking is complete when the message stops
            setIsThinkingComplete(true)
          }
        } catch (error) {
          console.error("Error processing line:", error)
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = new TextDecoder().decode(value)
        const lines = chunk.split("\n")

        for (const line of lines) {
          processLine(line)
        }
      }
    } catch (error) {
      console.error("Error:", error)
      // Track error
      posthog.capture('chat_error', {
        chat_id: currentChatId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      })
    } finally {
      setIsLoading(false)
      // Clean up
      if (scrollRef.current) {
        cancelAnimationFrame(scrollRef.current)
      }
    }

    return () => {
      controller.abort()
      if (scrollRef.current) {
        cancelAnimationFrame(scrollRef.current)
      }
    }
  }

  const hasApiTokens = apiTokens.anthropicApiToken

  return (
    <div className="flex min-h-screen">
      {/* Delete Chat Confirmation Dialog */}
      <Dialog open={!!chatToDelete} onOpenChange={() => setChatToDelete(null)}>
        <DialogContent>
          <DialogTitle>Delete Chat</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this chat? This action cannot be undone.
          </DialogDescription>
          <DialogFooter className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setChatToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => chatToDelete && deleteChat(chatToDelete)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear All Chats Confirmation Dialog */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent>
          <DialogTitle>Clear All Chats</DialogTitle>
          <DialogDescription>
            Are you sure you want to clear all chats? This action cannot be undone.
          </DialogDescription>
          <DialogFooter className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowClearConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={clearAllChats}
            >
              Clear All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full w-64 border-r border-border/40 bg-background transition-all duration-300 ease-in-out z-50 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-64'
          }`}
      >
        <div className="flex flex-col h-full justify-between">
          {/* Top Section */}
          <div className="flex-shrink-0">
            <div className="p-4 border-b border-border/40">
              <div className="flex gap-2">
                <Button
                  onClick={createNewChat}
                  className="flex-1"
                >
                  <PlusCircle className="h-4 w-4 mr-2" />
                  New Chat
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowClearConfirm(true)}
                  className="shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {/* Chat History - Scrollable Section */}
            <div className="flex-1 overflow-y-auto p-2 h-[calc(100vh-220px)] sidebar-scroll">
              {chats.map(chat => (
                <div
                  key={chat.id}
                className={`group flex items-center gap-2 p-3 rounded-lg mb-2 hover:bg-muted/50 transition-colors ${
                  currentChatId === chat.id ? 'bg-muted' : ''
                    }`}
                >
                  <button
                    onClick={() => {
                      setCurrentChatId(chat.id)
                      setMessages(chat.messages)
                      // Track chat selection
                      posthog.capture('chat_selected', {
                        chat_id: chat.id,
                        timestamp: new Date().toISOString()
                      })
                    }}
                    className="flex-1 text-left"
                  >
                    <div className="font-mono text-sm truncate">{chat.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(chat.timestamp).toLocaleString()}
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation()
                      setChatToDelete(chat.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Section */}
          {/* Bottom Section */}
          <div className="flex-shrink-0 p-4 pb-8 border-t border-border/40 space-y-4">
            <a
              href="https://github.com/getAsterisk/deepclaude/issues/new"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                posthog.capture('github_issue_click', {
                  timestamp: new Date().toISOString()
                })
              }}
            >
              <Button
                variant="outline"
                className="w-full"
              >
                <Github className="h-4 w-4 mr-2" />
                File a bug on GitHub
              </Button>
            </a>

            <div className="flex items-center justify-center text-sm text-muted-foreground whitespace-nowrap">
              <span className="flex-shrink-0 mr-1">An</span>
              <a
                href="https://asterisk.so/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:opacity-80 transition-opacity flex items-center mx-1"
              >
                <Image
                  src="/asterisk.png"
                  alt="Asterisk Logo"
                  width={90}
                  height={30}
                  className="inline-block"
                  quality={100}
                />
              </a>
              <span className="flex-shrink-0">side project ❤️</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Toggle Sidebar Button */}
      <button
        onClick={() => {
          const newState = !isSidebarOpen
          setIsSidebarOpen(newState)
          // Track sidebar toggle
          posthog.capture('sidebar_toggled', {
            new_state: newState ? 'open' : 'closed',
            timestamp: new Date().toISOString()
          })
        }}
        className={`fixed top-4 z-50 p-2 bg-muted/30 hover:bg-muted/50 rounded-lg transition-all duration-300 ease-in-out ${
          isSidebarOpen ? 'left-[268px]' : 'left-4'
          }`}
      >
        <ChevronRight
          className={`h-4 w-4 transition-transform duration-300 ${
            isSidebarOpen ? 'rotate-180' : ''
            }`}
        />
      </button>

      {/* Main Chat Area */}
      <main
        className={`flex-1 transition-[margin] duration-300 ease-in-out ${
          isSidebarOpen ? 'ml-64' : 'ml-0'
          }`}
      >
        <div className="container max-w-4xl mx-auto px-4 flex flex-col h-screen">
          <header className="sticky top-0 py-4 px-2 bg-background/80 backdrop-blur z-40 border-b border-border/40">
            <div className="flex items-center justify-center gap-2">
              <Select
                value={currentModel}
                onValueChange={(value) => {
                  setCurrentModel(value)
                  onModelChange(value)
                }}
              >
                <SelectTrigger className="w-[260px] bg-muted/30">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {[
                    "claude-3-7-sonnet-20250219",
                    "claude-3-5-sonnet-20241022",
                    "claude-3-5-sonnet-latest",
                    "claude-3-5-haiku-20241022",
                    "claude-3-5-haiku-latest",
                    "claude-3-opus-20240229",
                    "claude-3-opus-latest"
                  ].map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                onClick={createNewChat}
                className="bg-muted/30"
              >
                <PlusCircle className="h-4 w-4" />
              </Button>
            </div>
          </header>
          <div
            ref={parentRef}
            className="flex-1 w-full overflow-y-auto px-2"
            id="chat-container"
          >
            <div
              className="relative mx-auto min-h-full py-4"
              style={{
                height: messages.length > 0 ? `${rowVirtualizer.getTotalSize()}px` : '100%',
                minHeight: '100%'
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const message = messages[virtualRow.index]
                const index = virtualRow.index
                return (
                  <div
                    key={virtualRow.index}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    className="absolute left-0 w-full virtual-item-transition"
                    style={{
                      transform: `translate3d(0, ${virtualRow.start}px, 0)`
                    }}
                  >
                    <div
                      className={`py-4 message-transition ${message.role === "assistant" ? "border-b border-border/40" : ""}`}
                      data-loaded="true"
                    >
                      <div className="max-w-4xl mx-auto space-y-3 px-4">
                        <div className="font-medium text-sm text-muted-foreground message-content">
                          {message.role === "user" ? "You" : "Assistant"}
                        </div>
                        <MessageContent message={message} index={index} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="sticky bottom-0 bg-background/80 backdrop-blur border-t border-border/40 w-full">
            <div className="py-4 px-2">
              <MarkdownEditor
                value={input}
                onChange={setInput}
                onSubmit={handleSubmit}
                placeholder={hasApiTokens ? "Type a message..." : "Please configure API tokens in settings first"}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
