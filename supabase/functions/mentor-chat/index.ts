const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { messages, context } = await req.json()
    const apiKey = Deno.env.get('OPENROUTER_API_KEY')
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not set')

    const system = `You are the personal health and performance mentor for Lucas, a user of his private dashboard app.

CURRENT DASHBOARD DATA:
${context}

Your role: give concise, data-driven advice. Always reference his actual numbers. Max 3–4 sentences unless he asks for detail. No filler — act like a smart coach who has read his charts, not a generic health bot.`

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'X-Title': 'Lucas Dashboard Mentor',
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        messages: [
          { role: 'system', content: system },
          ...((messages || []).slice(-20)),
        ],
        max_tokens: 400,
      })
    })

    if (!res.ok) throw new Error('Model error ' + res.status)
    const data = await res.json()
    const reply = data.choices?.[0]?.message?.content?.trim() || ''
    if (!reply) throw new Error('Empty response from model')

    return new Response(JSON.stringify({ reply }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
