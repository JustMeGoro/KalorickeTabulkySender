// Shared Gemini helper: sends a prompt, returns parsed JSON that follows the given schema.
// Needs GEMINI_API_KEY in .env. GEMINI_MODEL in .env overrides the first model tried.
try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional if the variables are already set in the environment
}
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) throw new Error("GEMINI_API_KEY is missing - put it in .env");

// Free-tier models are often overloaded (503/429), so fall back through several.
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"].filter(Boolean);
const endpoint = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// images: optional [{ mimeType, data }] with base64 data, sent together with the prompt
export async function generateJson(prompt, schema, images = []) {
  const body = {
    contents: [{ parts: [...images.map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.data } })), { text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2 },
  };
  for (let attempt = 0; attempt < MODELS.length * 3; attempt++) {
    const model = MODELS[attempt % MODELS.length];
    let res;
    try {
      // a request that hangs (seen in the cloud: no response headers for 5 minutes) is cut off and retried
      res = await fetch(endpoint(model), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      console.warn(`  ${model}: ${e.name === "TimeoutError" ? "no answer in 60 s" : e.message}, trying next model`);
      await sleep(2000);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      // 429 is either a short rate limit or the free quota being used up; the dashboard alerts on the latter
      const quota = res.status === 429 && /quota|RESOURCE_EXHAUSTED|exceeded/i.test(await res.text().catch(() => ""));
      console.warn(`  ${model}: HTTP ${res.status}${quota ? " QUOTA exceeded" : ""}, trying next model`);
      await sleep(2000);
      continue;
    }
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty Gemini response");
    return JSON.parse(text);
  }
  throw new Error("Gemini kept failing");
}
