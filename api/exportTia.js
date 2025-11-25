import JSZip from "jszip";

function extractSclCode(fullText) {
  const lines = fullText.split(/\r?\n/);
  const index = lines.findIndex((l) =>
    /(ORGANIZATION_BLOCK|FUNCTION_BLOCK|FUNCTION|DATA_BLOCK)/i.test(l)
  );
  return index === -1 ? fullText : lines.slice(index).join("\r\n");
}

function extractSymbolTable(fullText) {
  const lines = fullText.split(/\r?\n/);
  const header = lines.findIndex((l) =>
    l.trim().toLowerCase().startsWith("name;datentyp;richtung;kommentar")
  );
  if (header === -1) return null;
  const out = [];
  for (let i = header; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes(";")) break;
    out.push(line.trim());
  }
  return out.length ? out.join("\r\n") : null;
}

function createFbXml(blockName, sclCode) {
  const safe = (blockName || "FB_Generiert").replace(/[^A-Za-z0-9_]/g, "_");
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Only POST allowed" });

  try {
    const { scl } = req.body;
    if (!scl) return res.status(400).json({ error: "'scl' missing" });

    const sclCode = extractSclCode(scl);
    const symbolCsv = extractSymbolTable(scl);
    let fbName = "FB_Generiert";

    const match = scl.match(/FUNCTION_BLOCK\s+([A-Za-z0-9_]+)/i);
    if (match) fbName = match[1];

    const zip = new JSZip();
    zip.file("SCL_Programm.scl", sclCode);
    if (symbolCsv) zip.file("Symboltabelle.csv", symbolCsv);
    zip.file(`FB_${fbName}.xml`, createFbXml(fbName, sclCode));

    const zipData = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=TIA_Export_V19.zip"
    );
    res.send(zipData);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
