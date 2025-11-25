const JSZip = require("jszip");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { scl } = req.body;

    if (!scl || typeof scl !== "string") {
      return res.status(400).json({ error: "Field 'scl' (string) is required" });
    }

    const lines = scl.split(/\r?\n/);

    // === 1) SCL-Quellcode extrahieren ===
    const codeStartIndex = lines.findIndex((line) =>
      /(ORGANIZATION_BLOCK|FUNCTION_BLOCK|FUNCTION|DATA_BLOCK)/i.test(line)
    );

    let codePart = scl;
    if (codeStartIndex !== -1) {
      codePart = lines.slice(codeStartIndex).join("\r\n");
    }

    // === 2) Variablenliste extrahieren (CSV) ===
    const headerIndex = lines.findIndex((l) =>
      l.trim().toLowerCase().startsWith("name;datentyp;richtung;kommentar")
    );

    let symbolLines = [];
    if (headerIndex !== -1) {
      for (let i = headerIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (!line.includes(";")) break;
        symbolLines.push(line);
      }
    }

    // === 3) ZIP bauen ===
    const zip = new JSZip();

    zip.file("SCL_Programm.scl", codePart);

    if (symbolLines.length > 0) {
      const csvText = symbolLines.join("\r\n");
      zip.file("Symboltabelle.csv", csvText);
    }

    const zipContent = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="TIA_Export.zip"');

    return res.status(200).send(zipContent);
  } catch (err) {
    console.error("EXPORT ERROR:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
};
