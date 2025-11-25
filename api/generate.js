import { Configuration, OpenAIApi } from "openai";

/* -------- Body korrekt einlesen (Vercel Pages API!) -------- */
async function readBody(req) {
  return new Promise((resolve, reject) => {
    try {
      let body = "";
      req.on("data", (chunk) => body += chunk.toString());
      req.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({});
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  try {
    const body = await readBody(req);
    const prompt = body.prompt;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const openai = new OpenAIApi(new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
    }));

    const completion = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an SCL code generator." },
        { role: "user", content: prompt }
      ]
    });

    const text = completion.data.choices[0].message.content;

    return res.status(200).json({ result: text });
  } catch (err) {
    console.error("GENERATION ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
