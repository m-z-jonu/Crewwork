import { ChatOpenAI } from '@langchain/openai'

/**
 * Create a DeepSeek chat model (OpenAI-compatible API).
 */
export function createChatModel(options?: {
  model?: string
  temperature?: number
  maxTokens?: number
}): ChatOpenAI {
  const model = options?.model ?? process.env.DEEPSEEK_MODEL_CHAT ?? 'deepseek-chat'

  return new ChatOpenAI({
    modelName: model,
    temperature: options?.temperature ?? 0.7,
    maxTokens: options?.maxTokens ?? 2048,
    configuration: {
      baseURL: 'https://api.deepseek.com',
    },
    apiKey: process.env.DEEPSEEK_API_KEY,
  })
}

/**
 * Create a reasoning model for complex tasks.
 */
export function createReasoningModel(): ChatOpenAI {
  return createChatModel({
    model: process.env.DEEPSEEK_MODEL_REASON ?? 'deepseek-reasoner',
    temperature: 0.3,
    maxTokens: 4096,
  })
}
