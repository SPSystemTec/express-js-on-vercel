const JSZip = require("jszip");

/**
 * SCL-Code ab dem ersten OB/FB/FC/DB heraus schneiden
 */
function extractSclCode(fullText) {
  const lines = fullText.split(/\r?\n/);

  const codeStartIndex = lines.findIndex((line) =>
    /(ORGANIZATION_BLOCK|FUNCTION_BLOCK|FUNCTION|DATA_BLOCK)/i.test(line)
  );

  if (codeStartIndex === -1) {
    // Fallback: alles
    return fullText;
  }

  return lines.slice(codeStartIndex).join("\r\n");
}

/**
 * Variablenliste aus dem generierten Text herausziehen
 * (gleiches Prinzip wie im Frontend bei "Variablenliste kopieren")
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
 * Sehr einfaches, TIA-kompatibles FB-XML Template für V19.
 *
 * Das XML enthält:
 * - Document-Root mit Openness-Namespace
 * - Engineering version="V19"
 * - SW.Blocks.FB mit SCL-CompileUnit
 *
 * Interface lassen wir bewusst weg, weil es in deinem SCL-Code über
 * VAR_INPUT/VAR_OUTPUT/... definiert ist. TIA kann das beim Import
 * wieder ableiten.
 */
function createFbXml(blockName, sclCode) {
  const safeName = (blockName || "FB_Generiert").replace(/[^A-Za-z0-9_]/g, "_");

  // CDATA darf nicht "]]>" enthalten
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
    const { scl } = req.body || {};

    if (!scl || typeof scl !== "string") {
      return res.status(400).json({ error: "Field 'scl' (string) is required" });
    }

    // ------------------------------------------------------------------
    // 1) Teile aus dem generierten Text extrahieren
    // ------------------------------------------------------------------
    const sclCode = extractSclCode(scl);
    const symbolCsv = extractSymbolTable(scl);

    // Blockname grob aus dem Text erraten (FUNCTION_BLOCK <Name>)
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

    // c) FB-XML (TIA V19 / Openness-kompatibel, Template)
    zip.file(`FB_${fbName}.xml`, fbXml);

    const zipContent = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="TIA_Export_Profi_V19.zip"');
    return res.status(200).send(zipContent);
  } catch (err) {
    console.error("EXPORT-TIA-XML ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
};
