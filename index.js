import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());

// ✨ CORS für deine Shopify-Seite erlauben
app.use(cors({
  origin: ["https://plc-code.com", "https://www.plc-code.com", "http://localhost:3000"],
  methods: ["POST"],
  allowedHeaders: ["Content-Type"],
}));

// 🔑 OpenAI-Key von Vercel ENV Variablen
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.post("/api/scl", async (req, res) => {
  try {
    const userPrompt = req.body.prompt;
    if (!userPrompt) return res.status(400).json({ error: "No prompt provided" });

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Du bist Experte für SCL-Code" },
          { role: "user", content: userPrompt }
        ]
      })
    });

    const data = await openaiRes.json();

    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server Fehler" });
  }
});

// Vercel benötigt diesen Export
export default app;
