export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Kein Prompt gesendet" });
    }

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Du bist ein SPS/SCL Generator." },
          { role: "user", content: prompt }
        ]
      })
    });

    const data = await openaiRes.json();

    return res.status(200).json({
      result: data.choices?.[0]?.message?.content || "Keine Antwort erhalten"
    });

  } catch (err) {
    console.error("API Fehler:", err);
    return res.status(500).json({ error: err.message });
  }
}
