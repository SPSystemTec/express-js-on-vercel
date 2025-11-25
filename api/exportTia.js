import JSZip from "jszip";
import iconv from "iconv-lite";

/**
 * SCL-Code ab erstem Baustein schneiden
 */
function extractSclCode(fullText) {
  const lines = fullText.split(/\r?\n/);
  const idx = lines.findIndex((l) =>
    /(ORGANIZATION_BLOCK|FUNCTION_BLOCK|FUNCTION|DATA_BLOCK)/i.test(l)
  );
  return idx === -1 ? fullText : lines.slice(idx).join("\r\n");
}

/**
 * Variablenliste extrahieren
 */
function extractSymbolTable(fullText) {
  const lines = fullText.split(/\r?\n/);
  const header = lines.findIndex((l) =>
    l.trim().toLowerCase().startsWith("name;datentyp;richtung;kommentar")
  );
  if (header === -1) return null;

  const out = [];
  for (let i = header; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !line.includes(";")) break;
    out.push(line);
  }
  return out.length ? out.join("\r\n") : null;
}

/**
 * XML für TIA
 */
function createFbXml(blockName, sclCode) {
  const safe = blockName.replace(/[^A-Za-z0-9_]/g, "_");
  const cdata = sclCode.replace(/]]>/g, "]]]]><![CDATA[>");

  return `<?xml version="1.0" encoding="utf-8"?>
<Document xmlns="http://www.siemens.com/automation/Openness/Document/v4">
  <Engineering version="V19" />
  <SW.Blocks.FB ID="0">
    <AttributeList>
      <Name>${safe}</Name>
      <ProgrammingLanguage>SCL</ProgrammingLanguage>
      <MemoryLayout>Optimized</MemoryLayout>
    </AttributeList>
    <ObjectList>
      <SW.Blocks.CompileUnit ID="1">
        <AttributeList>
          <ProgrammingLanguage>SCL</ProgrammingLanguage>
        </AttributeList>
        <Source><![CDATA[
${cdata}
        ]]></Source>
      </SW.Blocks.CompileUnit>
    </ObjectList>
  </SW.Blocks.FB>
</Document>`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Only POST allowed" });

  try {
    const { scl } = req.body;

    if (!scl) return res.status(400).json({ error: "Missing 'scl'" });

    const sclCode = extractSclCode(scl);
    const symbol = extractSymbolTable(scl);

    let fbName = "FB_Generiert";
    const match = scl.match(/FUNCTION_BLOCK\s+([A-Za-z0-9_]+)/i);
    if (match?.[1]) fbName = match[1];

    const xml = createFbXml(fbName, sclCode);

    const zip = new JSZip();

    // ❗ SCL → ANSI (für TIA zwingend!)
    const sclAnsi = iconv.encode(sclCode, "latin1");
    zip.file("SCL_Programm.scl", sclAnsi, { binary: true });

    if (symbol) {
      const symbolAnsi = iconv.encode(symbol, "latin1");
      zip.file("Symboltabelle.csv", symbolAnsi, { binary: true });
    }

    // XML bleibt UTF-8
    zip.file(`FB_${fbName}.xml`, xml);

    const content = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="TIA_Export_Profi_V19.zip"'
    );

    res.status(200).send(content);
  } catch (e) {
    console.error("EXPORT ERROR", e);
    res.status(500).json({ error: "Internal server error", details: e.message });
  }
}
