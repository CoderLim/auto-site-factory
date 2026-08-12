import type { EntityType, ExtractedEntity, StoredSignal } from "@factory/shared"

const VALID_TYPES = new Set<EntityType>([
  "GAME", "TOOL", "AI_MODEL", "PRODUCT", "CHARACTER", "ITEM",
  "FEATURE", "MAP", "EVENT", "MODE", "OTHER"
])

interface LlmEntityPayload {
  entities?: Array<{
    name?: unknown
    type?: unknown
    confidence?: unknown
    parent?: unknown
  }>
}

function parseJsonObject(value: string): LlmEntityPayload {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value
  return JSON.parse(fenced.trim()) as LlmEntityPayload
}

export async function extractLlmEntities(signal: StoredSignal): Promise<ExtractedEntity[]> {
  const apiUrl = process.env.LLM_API_URL
  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_MODEL
  if (!apiUrl || !apiKey || !model) return []

  const prompt = `You extract newly introduced named entities from noisy web/social signals for keyword discovery.\nScope: ${signal.scope}\nSource: ${signal.sourceType}\nTitle: ${signal.title ?? ""}\nContent: ${(signal.content ?? "").slice(0, 5000)}\n\nReturn JSON only: {"entities":[{"name":"...","type":"GAME|TOOL|AI_MODEL|PRODUCT|CHARACTER|ITEM|FEATURE|MAP|EVENT|MODE|OTHER","confidence":0.0,"parent":"optional"}]}.\nDo not return generic intent words such as guide, wiki, codes, update, release date, download, best, how to.`

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Extract named entities. Prefer recall but never invent names not present in the signal." },
        { role: "user", content: prompt }
      ]
    })
  })
  if (!response.ok) throw new Error(`LLM extractor ${response.status}`)
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = payload.choices?.[0]?.message?.content
  if (!content) return []
  const parsed = parseJsonObject(content)
  return (parsed.entities ?? []).flatMap((entity) => {
    if (typeof entity.name !== "string" || !entity.name.trim()) return []
    const type = typeof entity.type === "string" && VALID_TYPES.has(entity.type as EntityType)
      ? entity.type as EntityType
      : "OTHER"
    const confidence = typeof entity.confidence === "number"
      ? Math.min(1, Math.max(0, entity.confidence))
      : 0.75
    return [{
      name: entity.name.trim(),
      type,
      confidence,
      parent: typeof entity.parent === "string" ? entity.parent : undefined,
      evidence: signal.title ?? entity.name.trim()
    }]
  })
}
