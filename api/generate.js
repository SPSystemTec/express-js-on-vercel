const OpenAI = require("openai");

module.exports = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: "Kein Prompt gesendet" });
        }

        const client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        const completion = await client.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
                { role: "system", content: "Du bist ein SPS/SCL Generator."},
                { role: "user", content: prompt}
            ]
        });

        res.status(200).json({
            result: completion.choices[0].message.content
        });

    } catch (err) {
        console.error("API Fehler:", err);
        res.status(500).json({ error: err.message });
    }
};
