const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BASE_PROMPT = `You are a precision nutrition analyst. Examine this food photo carefully and:

1. Identify each item specifically — e.g. "grilled chicken breast with roasted broccoli", not just "chicken and vegetables"
2. Estimate total grams of the ENTIRE visible portion using visual reference points: a standard dinner plate is ~26 cm, a fork ~20 cm, a tablespoon ~15 ml, a mug ~300 ml
3. Calculate total nutrition for the FULL portion shown — use USDA FoodData Central values, NOT per-100g values
4. All minerals and vitamins must be in mg (convert from mcg or g where needed)

Return ONLY this JSON with no markdown, no explanation, no preamble:
{"name":"","grams":0,"cal":0,"prot":0,"carb":0,"fat":0,"fiber":0,"servingDesc":"","potassium":0,"sodium":0,"calcium":0,"iron":0,"magnesium":0,"vitamin_c":0,"zinc":0}`

function buildPrompt(notes?: string): string {
  if (!notes || !notes.trim()) return BASE_PROMPT
  return BASE_PROMPT + `\n\nCritical user context — you MUST adjust your estimates to reflect this: "${notes.trim()}"`
}

// Robust JSON extraction: find outermost { ... } by brace counting
function extractJSON(text: string): Record<string, unknown> {
  let depth = 0, start = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i
      depth++
    } else if (text[i] === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        return JSON.parse(text.slice(start, i + 1))
      }
    }
  }
  throw new Error('No JSON object found in response')
}

function isValid(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return typeof d.name === 'string' && d.name.trim().length > 0
    && Number(d.cal) > 0
    && Number(d.grams) > 0
}

async function queryModel(model: string, image: string, mimeType: string, apiKey: string, prompt: string) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${image}` } },
        { type: 'text', text: prompt },
      ]}],
      max_tokens: 350,
    })
  })
  if (!res.ok) throw new Error(`${model} HTTP ${res.status}`)
  const data = await res.json()
  const text = (data.choices?.[0]?.message?.content || '').trim()
  if (!text) throw new Error(`Empty response from ${model}`)
  const parsed = extractJSON(text)
  if (!isValid(parsed)) throw new Error(`Invalid nutrition data from ${model}`)
  return parsed
}

// Resolves with the first response that passes validation; rejects only if all fail.
function raceFirstValid(promises: Promise<Record<string, unknown>>[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let resolved = false
    let done = 0
    for (const p of promises) {
      p.then(result => {
        done++
        if (resolved) return
        resolved = true
        resolve(result)
      }).catch(() => {
        done++
        if (!resolved && done === promises.length) {
          reject(new Error('All vision models failed or returned invalid data'))
        }
      })
    }
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { image, mimeType, notes } = await req.json()
    if (!image) throw new Error('No image provided')

    const apiKey = Deno.env.get('OPENROUTER_API_KEY')
    if (!apiKey) throw new Error('OPENROUTER_API_KEY secret not set')

    const prompt = buildPrompt(notes)

    const parsed = await raceFirstValid([
      queryModel('google/gemini-2.0-flash-exp:free',     image, mimeType, apiKey, prompt),
      queryModel('meta-llama/llama-4-scout:free',        image, mimeType, apiKey, prompt),
      queryModel('google/gemma-4-26b-a4b-it:free',       image, mimeType, apiKey, prompt),
    ])

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
