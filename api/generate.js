import { OpenAI } from "openai";

/* ---------- Body-Parser für Vercel Pages API ---------- */
async function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

export default async function handler(req, res) {
  /* ---------- CORS ---------- */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Only POST allowed",
    });
  }

  try {
    /* ---------- Body einlesen ---------- */
    const body = await readBody(req);
    const prompt = body.prompt;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({
        error: "Field 'prompt' (string) is required",
      });
    }

    /* ---------- OpenAI initialisieren ---------- */
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    /* 
       WICHTIG:
       Deine App erwartet "result: <SCL CODE>"
       Darum geben wir exakt dieses Format zurück
    */

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You generate Siemens TIA Portal SCL code in strict multi-block format.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
    });

    const resultText = completion.choices[0].message.content || "";

    return res.status(200).json({
      result: resultText,
    });
  } catch (err) {
    console.error("GENERATE ERROR:", err);

    return res.status(500).json({
      error: err.message || "Internal server error",
    });
  }
}
