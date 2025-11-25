// WICHTIG: Node.js Runtime verwenden (kein Edge!)
export const config = {
  runtime: "nodejs",
};

import JSZip from "jszip";

/**
 * Entfernt Kopfbereich & extrahiert reinen SCL-Code
 */
function extractSclCode(fullText) {
  const lines = fullText.split(/\r?\n/);

  const startIndex = lines.findIndex((line) =>
    /(ORGANIZATION_BLOCK|FUNCTION_BLOCK|FUNCTION|DATA_BLOCK)/i.test(line)
  );

  return startIndex === -1
    ? fullText
    : lines.slice(startIndex).join("\r\n");
}

/**
 * Variablenliste extrahieren
 */
function extractSymbolTable(fullText) {
  const lines = fullText.split(/\r?\n/);
  const headerIndex = lines.findIndex((l) =>
    l.trim().toLowerCase().startsWith("name;datentyp;richtung;kommentar")
  );

  if (headerIndex === -1) return null;

  const list = [];

  for (let i = headerIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.includes(";")) break;
    list.push(line);
  }

  return list.length ? list.join("\r\n") : null;
}

/**
 * XML für TIA V19 erstellen
 */
function createFbXml(blockName, sclCode) {
  const safe = blockName.replace(/[^A-Za-z0-9_]/g, "_");
  const safeCdata = sclCode.replace(/]]>/g, "]]]]><![CDATA[>");

  return `<?xml version="1.0" encoding="utf-8"?>
<Document xmlns="http://www.siemens.com/automation/Openness/Document/v4">
  <Engineering version="V19" />
  <SW.Blocks.FB ID="0">
    <AttributeList>
      <Name>${safe}</Name>
      <ProgrammingLanguage>SCL</ProgrammingLanguage>
    </AttributeList>
    <ObjectList>
      <SW.Blocks.CompileUnit ID="1">
        <AttributeList>
          <ProgrammingLanguage>SCL</ProgrammingLanguage>
        </AttributeList>
        <Source><![CDATA[
${safeCdata}
        ]]></Source>
      </SW.Blocks.CompileUnit>
    </ObjectList>
  </SW.Blocks.FB>
</Document>`;
}

/**
 * API Handler
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Only POST allowed" });

  try {
    const { scl } = req.body;
    if (!scl) return res.status(400).json({ error: "Missing 'scl'" });

    const sclCode = extractSclCode(scl);
    const symbolCsv = extractSymbolTable(scl);

    // Blockname erkennen
    let fb = "FB_Generiert";
    const m = scl.match(/FUNCTION_BLOCK\s+([A-Za-z0-9_]+)/i);
    if (m?.[1]) fb = m[1];

    // XML erzeugen
    const xml = createFbXml(fb, sclCode);

    // ZIP bauen
    const zip = new JSZip();
    zip.file("SCL_Programm.scl", sclCode);
    if (symbolCsv) zip.file("Symboltabelle.csv", symbolCsv);
    zip.file(`FB_${fb}.xml`, xml);

    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=TIA_Export_V19.zip"
    );

    res.status(200).send(buffer);
  } catch (err) {
    console.error("TIA EXPORT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
}
