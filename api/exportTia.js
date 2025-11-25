const JSZip = require("jszip");
const iconv = require("iconv-lite");

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

  return symbolLines.length ? symbolLines.join("\r\n") : null;
}

/**
 * TIA-kompatibles FB-XML (V19)
 */
function createFbXml(blockName, sclCode) {
  const safeName = (blockName || "FB_Generiert").replace(/[^A-Za-z0-9_]/g, "_");

  const cdataSafe = sclCode.replace(/]]>/g, "]]]]><![CDATA[>");

  return `
<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="http://www.siemens.com/automation/Openness/Document/v4">
  <Engineering version="V19" />
  <SW.Blocks.FB ID="0">
    <AttributeList>
      <Name>${safeName}</Name>
      <Title>${safeName}</Title>
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
</Document>
`;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  try {
    const { scl } = req.body || {};

    if (!scl || typeof scl !== "string") {
      return res.status(400).json({ error: "Field 'scl' is required" });
    }

    const sclCode = extractSclCode(scl);
    const symbolCsv = extractSymbolTable(scl);

    let fbName = "FB_Generiert";
    const fbMatch = scl.match(/FUNCTION_BLOCK\s+([A-Za-z0-9_]+)/i);
    if (fbMatch && fbMatch[1]) fbName = fbMatch[1];

    const fbXml = createFbXml(fbName, sclCode);

    const zip = new JSZip();

    zip.file("SCL_Programm.scl", iconv.encode(sclCode, "win1252"));
    if (symbolCsv) zip.file("Symboltabelle.csv", iconv.encode(symbolCsv, "win1252"));
    zip.file(`FB_${fbName}.xml`, iconv.encode(fbXml, "win1252"));

    const zipContent = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="TIA_Export_Profi_V19.zip"');

    return res.status(200).send(zipContent);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
