import JSZip from "jszip";
import iconv from "iconv-lite";

/**
 * SCL-Code ab dem ersten OB/FB/FC/DB heraus schneiden
 */
function extractSclCode(fullText) {
  const lines = fullText.split(/\r?\n/);

  const codeStartIndex = lines.findIndex((line) =>
    /(ORGANIZATION_BLOCK|FUNCTION_BLOCK|FUNCTION|DATA_BLOCK)/i.test(line)
  );

  if (codeStartIndex === -1) return fullText;
  return lines.slice(codeStartIndex).join("\r\n");
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
 * XML für TIA V19 erzeugen
 */
function createFbXml(blockName, sclCode) {
  const safeName = (blockName || "FB_Generiert").replace(/[^A-Za-z0-9_]/g, "_");

  const cdataSafe = sclCode.replace(/]]>/g, "]]]]><![CDATA[>");

  return `<?xml version="1.0" encoding="utf-8"?>
<Document xmlns="http://www.siemens.com/automation/Openness/Document/v4">
  <Engineering version="V19" />
  <DocumentInfo>
    <Created>2025-01-01T00:00:00Z</Created>
    <Modified>2025-01-01T00:00:00Z</Modified>
  </DocumentInfo>
  <SW.Blocks.FB ID="0">
    <AttributeList>
      <Name>${safeName}</Name>
      <Title>${safeName}</Title>
      <Type>FB</Type>
      <ProgrammingLanguage>SCL</ProgrammingLanguage>
      <MemoryLayout>Optimized</MemoryLayout>
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

/**
 * API Handler (Vercel)
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { scl } = req.body || {};
    if (!scl || typeof scl !== "string") {
      return res.status(400).json({ error: "Field 'scl' (string) is required" });
    }

    // SCL extrahieren
    const sclCode = extractSclCode(scl);
    const symbolCsv = extractSymbolTable(scl);

    // NAME des Bausteins erkennen
    let fbName = "FB_Generiert";
    const fbMatch = scl.match(/FUNCTION_BLOCK\s+([A-Za-z0-9_]+)/i);
    if (fbMatch?.[1]) fbName = fbMatch[1];

    const fbXml = createFbXml(fbName, sclCode);

    // NEU: UTF-8 → ANSI convertieren (Pflicht für TIA!)
    const sclAnsi = iconv.encode(sclCode, "win1252");
    const symbolAnsi = symbolCsv ? iconv.encode(symbolCsv, "win1252") : null;

    // ZIP bauen
    const zip = new JSZip();
    zip.file("SCL_Programm.scl", sclAnsi);
    if (symbolAnsi) zip.file("Symboltabelle.csv", symbolAnsi);
    zip.file(`FB_${fbName}.xml`, fbXml);

    const zipContent = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="TIA_Export_Profi_V19.zip"'
    );

    return res.status(200).send(zipContent);
  } catch (err) {
    console.error("EXPORT-TIA-XML ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
}
