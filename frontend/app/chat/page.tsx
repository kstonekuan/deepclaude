"use client"

import { useState } from "react"
import { Chat } from "../../components/chat"
import { Settings } from "../../components/settings"

export default function ChatPage() {
  const [selectedModel, setSelectedModel] = useState("claude-3-7-sonnet-20250219")
  const [apiTokens, setApiTokens] = useState({
    anthropicApiToken: ""
  })

  return (
    <main className="relative min-h-screen">
      <Settings 
        onSettingsChange={setApiTokens}
      />
      <Chat 
        selectedModel={selectedModel} 
        onModelChange={setSelectedModel}
        apiTokens={apiTokens}
      />
    </main>
  )
}
