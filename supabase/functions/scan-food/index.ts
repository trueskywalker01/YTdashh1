const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PROMPT = 'What food is this? Estimate grams shown and total nutrition for that portion. JSON only, no markdown: {"name":"","grams":0,"cal":0,"prot":0,"carb":0,"fat":0,"fiber":0,"servingDesc":""}'

async function queryModel(model: string, image: string, mimeType: string, apiKey: string) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${image}` } },
        { type: 'text', text: PROMPT }
      ]}],
      max_tokens: 80,
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
    const { image, mimeType } = await req.json()
    if (!image) throw new Error('No image provided')

    const apiKey = Deno.env.get('OPENROUTER_API_KEY')
    if (!apiKey) throw new Error('OPENROUTER_API_KEY secret not set')

    // Race two free vision models — use whichever responds first.
    const parsed = await raceFirst([
      queryModel('nvidia/nemotron-nano-12b-v2-vl:free', image, mimeType, apiKey),
      queryModel('google/gemma-4-26b-a4b-it:free',     image, mimeType, apiKey),
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
