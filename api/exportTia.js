import JSZip from "jszip";

/* ============================================================
   1) UMLAUT-FILTER (TIA-SICHER)
   ============================================================ */
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

/* ============================================================
   2) BAUSTEIN-PARSER
   Erkennt OB / FB / DB und trennt sie korrekt
   ============================================================ */
function splitSclIntoBlocks(fullText) {
  const lines = fullText.split(/\r?\n/);

  const blocks = [];
  let current = null;

  for (let rawLine of lines) {
    const line = rawLine.trimEnd();

    // Bausteinstart erkennen
    const startMatch = line.match(/^(ORGANIZATION_BLOCK|FUNCTION_BLOCK|DATA_BLOCK)\s+([A-Za-z0-9_]+)/);

    if (startMatch) {
      if (current) {
        blocks.push(current);
      }

      current = {
        type: startMatch[1],
        name: startMatch[2],
        lines: [line]
      };
      continue;
    }

    // INNERHALB eines Bausteins
    if (current) {
      current.lines.push(line);

      // Ende erkennen
      if (/^END_/.test(line)) {
        blocks.push(current);
        current = null;
      }
    }
  }

  return blocks;
}

/* ============================================================
   3) FB-XML Generator (TIA V19)
   ============================================================ */
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

/* ============================================================
   4) API Handler
   ============================================================ */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Only POST allowed" });

  try {
    const { scl } = req.body || {};
    if (!scl) return res.status(400).json({ error: "Field 'scl' is required" });

    /* ==========================================
       1) Umlaute entfernen
       ========================================== */
    const cleaned = sanitizeUmlauts(scl);

    /* ==========================================
       2) Bausteine extrahieren
       ========================================== */
    const blocks = splitSclIntoBlocks(cleaned);

    if (!blocks.length) {
      return res.status(400).json({ error: "No TIA blocks found in SCL text." });
    }

    /* ==========================================
       3) ZIP erzeugen
       ========================================== */
    const zip = new JSZip();

    for (const block of blocks) {
      const fileName = `${block.name}.scl`;
      const sclBlockText = block.lines.join("\r\n");

      zip.file(fileName, sclBlockText);

      // Nur FBs bekommen XML
      if (block.type === "FUNCTION_BLOCK") {
        const xml = createFbXml(block.name, sclBlockText);
        zip.file(`${block.name}.xml`, xml);
      }
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="TIA_Export_Blocks_V19.zip"'
    );

    return res.status(200).send(zipBuffer);

  } catch (err) {
    console.error("EXPORT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
}
