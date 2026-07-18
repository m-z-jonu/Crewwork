import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createChatModel } from './llm'
import type { CompressedKnowledge } from '@/types/database'

type CompressionResult = Omit<CompressedKnowledge, 'id' | 'userId' | 'savedPostId' | 'compressedAt'>

export async function compressPost(
  content: string,
  channelName: string,
  senderName: string
): Promise<CompressionResult> {
  const model = createChatModel({ temperature: 0.3 })

  const systemPrompt = `You are a knowledge compression engine. Analyze the following post and extract structured knowledge.

Return ONLY a valid JSON object with this exact shape (no markdown, no explanation):
{
  "concepts": ["key concept 1", "key concept 2"],
  "relationships": [{"from": "concept A", "to": "concept B", "type": "related_to|depends_on|contradicts|extends"}],
  "actionItems": ["actionable takeaway 1"],
  "summary": "one-paragraph distilled summary",
  "tags": ["tag1", "tag2"]
}

Rules:
- concepts: 3-8 key ideas, terms, or topics from the post
- relationships: how concepts relate to each other (1-5 relationships)
- actionItems: practical takeaways the user can act on (0-5 items)
- summary: concise 1-2 sentence summary capturing the essence
- tags: 2-5 lowercase topic tags for categorization`

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(`Channel: ${channelName}\nAuthor: ${senderName}\n\nContent:\n${content}`),
  ])

  const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return {
      concepts: [],
      relationships: [],
      actionItems: [],
      summary: content.slice(0, 200),
      tags: [],
    }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
      relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary : content.slice(0, 200),
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    }
  } catch {
    return {
      concepts: [],
      relationships: [],
      actionItems: [],
      summary: content.slice(0, 200),
      tags: [],
    }
  }
}
