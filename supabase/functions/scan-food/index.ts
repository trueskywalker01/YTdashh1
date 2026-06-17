const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BASE_PROMPT = 'Identify the food in this image. Estimate the grams shown and provide total nutrition for that portion. All mineral/vitamin values must be in mg. Respond with JSON only — no markdown, no explanation: {"name":"","grams":0,"cal":0,"prot":0,"carb":0,"fat":0,"fiber":0,"servingDesc":"","potassium":0,"sodium":0,"calcium":0,"iron":0,"magnesium":0,"vitamin_c":0,"zinc":0}'

function buildPrompt(notes?: string): string {
  if (!notes || !notes.trim()) return BASE_PROMPT
  return BASE_PROMPT + `\n\nImportant user context — adjust all estimates to account for this: "${notes.trim()}"`
}

async function queryModel(model: string, image: string, mimeType: string, apiKey: string, prompt: string) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${image}` } },
        { type: 'text', text: prompt }
      ]}],
      max_tokens: 200,
    })
  })
  if (!res.ok) throw new Error(`${model} ${res.status}`)
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content || ''
  const match = text.match(/\{[\s\S]*?\}/)
  if (!match) throw new Error(`No JSON from ${model}`)
  return JSON.parse(match[0])
}

// Returns the first model that succeeds; only rejects if ALL fail.
function raceFirst(promises: Promise<unknown>[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let failed = 0
    promises.forEach(p => p.then(resolve).catch(() => {
      failed++
      if (failed === promises.length) reject(new Error('All models failed'))
    }))
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

    // Race two free vision models — use whichever responds first.
    const parsed = await raceFirst([
      queryModel('nvidia/nemotron-nano-12b-v2-vl:free', image, mimeType, apiKey, prompt),
      queryModel('google/gemma-4-26b-a4b-it:free',     image, mimeType, apiKey, prompt),
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
