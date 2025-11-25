const JSZip = require("jszip");

/**
 * Kleine Hilfsfunktion:
 * - Schneidet reinen SCL-Code ab dem ersten OB/FB/FC/DB heraus
 */
function extractSclCode(fullText) {
  const lines = fullText.split(/\r?\n/);

  const codeStartIndex = lines.findIndex((line) =>
    /(ORGANIZATION_BLOCK|FUNCTION_BLOCK|FUNCTION|DATA_BLOCK)/i.test(line)
  );

  if (codeStartIndex === -1) {
    // Fallback: alles zurückgeben
    return fullText;
  }

  return lines.slice(codeStartIndex).join("\r\n");
}

/**
 * Variablenliste aus dem generierten Text herausziehen
 * (gleiches Prinzip wie im Frontend bei "Variablen kopieren")
 */
function extractSymbolTable(fullText) {
  const lines = fullText.split(/\r?\n/);
  const headerIndex = lines.findIndex((l) =>
    l.trim().toLowerCase().startsWith("name;datentyp;richtung;kommentar")
  );

  if (headerIndex === -1) {
    return null;
  }

  const symbolLines = [];
  for (let i = headerIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (!line.includes(";")) break;
    symbolLines.push(line);
  }

  if (!symbolLines.length) return null;
  return symbolLines.join("\r\n");
}

/**
 * Sehr einfaches FB-XML-Template (Profi-Export als Startpunkt)
 *
 * WICHTIG:
 * - Dieses XML ist ein PRAKTISCHES TEMPLATE.
 * - Für 100%ig schema-konformen Openness-Import solltest du einmal
 *   einen echten SCL-FB aus deinem TIA exportieren und die Struktur
 *   mit diesem Template vergleichen / anpassen.
 */
function createFbXml(blockName, sclCode) {
  const safeName = (blockName || "FB_Generiert").replace(/[^A-Za-z0-9_]/g, "_");

  // CDATA darf nicht "]]>" enthalten → splitten
  const cdataSafe = sclCode.replace(/]]>/g, "]]]]><![CDATA[>");

  return `<?xml version="1.0" encoding="utf-8"?>
<Document xmlns="http://www.siemens.com/automation/Openness/Document/v4">
  <Engineering version="V16" />
  <SW.Blocks.FB ID="0">
    <AttributeList>
      <Name>${safeName}</Name>
      <ProgrammingLanguage>SCL</ProgrammingLanguage>
    </AttributeList>
    <ObjectList>
      <SW.Blocks.CompileUnit ID="1">
        <AttributeList>
          <ProgrammingLanguage>SCL</ProgrammingLanguage>
        </AttributeList>
        <Source><![CDATA[
${cdataSafe}
        ]]></Source>
      </SW.Blocks.CompileUnit>
    </ObjectList>
  </SW.Blocks.FB>
</Document>`;
}

module.exports = async (req, res) => {
  // CORS wie in generate.js
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

    // ------------------------------------------------------------------
    // 1) Teile aus dem generierten Text extrahieren
    // ------------------------------------------------------------------
    const sclCode = extractSclCode(scl);
    const symbolCsv = extractSymbolTable(scl);

    // Blockname grob aus dem Text erraten (wenn möglich)
    // z.B. "FUNCTION_BLOCK FB_Foerderband" oder "FUNCTION_BLOCK FB10_Foerderband"
    let fbName = "FB_Generiert";
    const fbMatch = scl.match(/FUNCTION_BLOCK\s+([A-Za-z0-9_]+)/i);
    if (fbMatch && fbMatch[1]) {
      fbName = fbMatch[1];
    }

    // FB-XML erzeugen
    const fbXml = createFbXml(fbName, sclCode);

    // ------------------------------------------------------------------
    // 2) ZIP bauen
    // ------------------------------------------------------------------
    const zip = new JSZip();

    // a) kompletter SCL-Teil
    zip.file("SCL_Programm.scl", sclCode);

    // b) Symboltabelle, falls vorhanden
    if (symbolCsv) {
      zip.file("Symboltabelle.csv", symbolCsv);
    }

    // c) FB-XML (Profi-Export)
    zip.file(`FB_${fbName}.xml`, fbXml);

    const zipContent = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="TIA_Export_Profi.zip"');
    return res.status(200).send(zipContent);
  } catch (err) {
    console.error("EXPORT-TIA-XML ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
};
