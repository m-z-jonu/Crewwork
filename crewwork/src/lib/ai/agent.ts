import { StateGraph, Annotation, START, END } from '@langchain/langgraph'
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import { createChatModel } from './llm'
import {
  saveAIMessage,
  getAIConversationHistory,
  buildMemoryContext,
} from './memory'
import { AI_TOOLS, createSaveUserMemoryTool } from './tools'

// --- Agent State ---

const AgentState = Annotation.Root({
  messages: Annotation<(HumanMessage | AIMessage | ToolMessage)[]>({
    reducer: (curr, prev) => [...curr, ...prev],
    default: () => [],
  }),
  userId: Annotation<string>({
    reducer: (_curr, prev) => prev,
    default: () => '',
  }),
  channelId: Annotation<string>({
    reducer: (_curr, prev) => prev,
    default: () => '',
  }),
  memoryContext: Annotation<string>({
    reducer: (_curr, prev) => prev,
    default: () => '',
  }),
})

type AgentStateType = typeof AgentState.State

// --- System Prompt ---

function getSystemPrompt(): string {
  return `You are CrewWork AI, a helpful assistant integrated into the CrewWork team messaging platform.

You can:
- Answer questions and have conversations
- Search messages in channels
- List workspace channels
- Look up user profiles
- View and manage todos
- Remember user preferences and facts

Be concise, helpful, and friendly. Use markdown formatting when appropriate.
When you learn something important about the user, use the save_user_memory tool to remember it.
Keep responses conversational and not overly formal.`
}

// --- Graph Nodes ---

async function loadMemory(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const memoryContext = await buildMemoryContext(state.userId)
  const history = await getAIConversationHistory(state.userId, 30)

  const langchainMessages = history.map(m =>
    m.role === 'user'
      ? new HumanMessage(m.content)
      : new AIMessage(m.content)
  )

  return {
    memoryContext,
    messages: langchainMessages,
  }
}

async function callModel(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const model = createChatModel({ temperature: 0.7 })
  const saveMemoryTool = createSaveUserMemoryTool(state.userId)
  const modelWithTools = model.bindTools([...AI_TOOLS, saveMemoryTool])

  const systemMessage = new SystemMessage(
    getSystemPrompt() +
    (state.memoryContext ? `\n\n${state.memoryContext}` : '')
  )

  const allMessages = [
    systemMessage,
    ...state.messages,
  ]

  const response = await modelWithTools.invoke(allMessages)

  return {
    messages: [response],
  }
}

async function useTools(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage

  if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
    return {}
  }

  const toolMap = Object.fromEntries([...AI_TOOLS, createSaveUserMemoryTool(state.userId)].map(t => [t.name, t]))
  const toolResults: (string | AIMessage)[] = []

  for (const toolCall of lastMessage.tool_calls) {
    const tool = toolMap[toolCall.name!]
    if (!tool) {
      toolResults.push(`Unknown tool: ${toolCall.name}`)
      continue
    }
    const result = await (tool as any).invoke(toolCall.args)
    toolResults.push(result as string)
  }

  // Convert tool results to ToolMessage format
  const toolMessages = toolResults.map((result, i) =>
    new ToolMessage({
      content: String(result),
      tool_call_id: lastMessage.tool_calls![i].id!,
      name: lastMessage.tool_calls![i].name!,
    })
  )

  return {
    messages: toolMessages as any,
  }
}

async function saveMessages(state: AgentStateType): Promise<Partial<AgentStateType>> {
  // Find the last human message
  const humanMessages = state.messages.filter(m => m._getType?.() === 'human')
  const lastHuman = humanMessages[humanMessages.length - 1]

  // Find the last AI message (final response, not tool-calling intermediate)
  const aiMessages = state.messages.filter(m => m._getType?.() === 'ai') as AIMessage[]
  const lastAI = aiMessages[aiMessages.length - 1]

  if (lastHuman) {
    await saveAIMessage({
      userId: state.userId,
      role: 'user',
      content: typeof lastHuman.content === 'string' ? lastHuman.content : JSON.stringify(lastHuman.content),
      timestamp: new Date().toISOString(),
    })
  }

  if (lastAI && (!lastAI.tool_calls || lastAI.tool_calls.length === 0)) {
    await saveAIMessage({
      userId: state.userId,
      role: 'assistant',
      content: typeof lastAI.content === 'string' ? lastAI.content : JSON.stringify(lastAI.content),
      timestamp: new Date().toISOString(),
    })
  }

  return {}
}

// --- Routing ---

function shouldUseTools(state: AgentStateType): 'tools' | 'save' {
  const lastMessage = state.messages[state.messages.length - 1]
  if (lastMessage._getType?.() === 'ai') {
    const aiMsg = lastMessage as AIMessage
    if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
      return 'tools'
    }
  }
  return 'save'
}

// --- Build Graph ---

function buildAgentGraph() {
  const graph = new StateGraph(AgentState)
    .addNode('load_memory', loadMemory)
    .addNode('call_model', callModel)
    .addNode('use_tools', useTools)
    .addNode('save_messages', saveMessages)

    .addEdge(START, 'load_memory')
    .addEdge('load_memory', 'call_model')
    .addConditionalEdges('call_model', shouldUseTools, {
      tools: 'use_tools',
      save: 'save_messages',
    })
    .addEdge('use_tools', 'call_model')
    .addEdge('save_messages', END)

  return graph.compile()
}

// --- Main Export ---

const compiledGraph = buildAgentGraph()

export interface AgentChatRequest {
  userId: string
  channelId: string
  message: string
  workspaceId?: string
}

export interface AgentChatResponse {
  reply: string
  toolCalls?: string[]
}

export async function chatWithAgent(request: AgentChatRequest): Promise<AgentChatResponse> {
  const { userId, channelId, message } = request

  const result = await compiledGraph.invoke({
    messages: [new HumanMessage(message)],
    userId,
    channelId,
    memoryContext: '',
  })

  // Extract final AI response
  const aiMessages = result.messages.filter(
    (m: any) => m._getType?.() === 'ai'
  ) as AIMessage[]
  const finalResponse = aiMessages[aiMessages.length - 1]

  // Track which tools were used
  const toolCallNames = result.messages
    .filter((m: any) => m._getType?.() === 'ai')
    .flatMap((m: any) => (m.tool_calls ?? []).map((tc: any) => tc.name))

  return {
    reply: typeof finalResponse.content === 'string'
      ? finalResponse.content
      : JSON.stringify(finalResponse.content),
    toolCalls: toolCallNames.length > 0 ? toolCallNames : undefined,
  }
}
