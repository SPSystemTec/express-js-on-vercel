import JSZip from "jszip";

// ==============================
// UMLAUT-FILTER (TIA-sicher)
// ==============================
function sanitizeUmlauts(text) {
  if (!text) return "";

  return text
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss");
}

// ==============================
// SCL-Code ab OB/FB/FC/DB schneiden
// ==============================
function extractSclCode(fullText) {
 const codeLines = fullText
    .split(/\r?\n/)
    .filter((line) =>
      /^ *(ORGANIZATION_BLOCK|END_ORGANIZATION_BLOCK|FUNCTION_BLOCK|END_FUNCTION_BLOCK|DATA_BLOCK|END_DATA_BLOCK|VAR_|BEGIN|END_|[A-Za-z0-9_].*:)/.test(line)
    );

  return codeLines.join("\r\n");
}

// ==============================
// Variablenliste extrahieren
// ==============================
function extractSymbolTable(fullText) {
  const lines = fullText.split(/\r?\n/);
  const headerIndex = lines.findIndex((l) =>
    l.trim().toLowerCase().startsWith("name;datentyp;richtung;kommentar")
  );
  if (headerIndex === -1) return null;

  const result = [];
  for (let i = headerIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !line.includes(";")) break;
    result.push(line);
  }
  return result.length ? result.join("\r\n") : null;
}

// ==============================
// XML für TIA erstellen (V19-kompatibel)
// ==============================
function createFbXml(blockName, sclCode) {
  const safeName = blockName.replace(/[^A-Za-z0-9_]/g, "_");
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

// ==============================
// API Handler
// ==============================
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Only POST allowed" });

  try {
    const { scl } = req.body || {};
    if (!scl) return res.status(400).json({ error: "Field 'scl' required" });

    // ==========================
    // 1) UMLAUT-FILTER
    // ==========================
    const cleanScl = sanitizeUmlauts(scl);

    // ==========================
    // 2) Teile extrahieren
    // ==========================
    const sclCode = sanitizeUmlauts(extractSclCode(cleanScl));
    const symbolCsv = sanitizeUmlauts(extractSymbolTable(cleanScl) || "");

    let fbName = "FB_Generiert";
    const fbMatch = cleanScl.match(/FUNCTION_BLOCK\s+([A-Za-z0-9_]+)/i);
    if (fbMatch?.[1]) fbName = fbMatch[1];

    const fbXml = createFbXml(fbName, sclCode);

    // ==========================
    // 3) ZIP erstellen
    // ==========================
    const zip = new JSZip();
    zip.file("SCL_Programm.scl", sclCode);
    if (symbolCsv) zip.file("Symboltabelle.csv", symbolCsv);
    zip.file(`FB_${fbName}.xml`, fbXml);

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="TIA_Export_Profi_V19.zip"'
    );

    return res.status(200).send(zipBuffer);

  } catch (err) {
    console.error("EXPORT ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
