import JSZip from "jszip";

/* ============================================================
   1) UMLAUT-SANITIZER (TIA V19 kann keine Umlaute in Quelltext)
   ============================================================ */
function sanitize(text) {
  if (!text) return "";
  return text
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .replace(/[^\x00-\x7F]/g, ""); // ALLE nicht-ASCII raus
}

/* ============================================================
   2) BAUSTEINE AUTOMATISCH ERKENNEN & EXTRAHIEREN
   ============================================================ */
function extractBlocks(fullText) {
  const blocks = [];
  const lines = fullText.split(/\r?\n/);
  let current = null;

  const startRegex =
    /^(ORGANIZATION_BLOCK|FUNCTION_BLOCK|FUNCTION|DATA_BLOCK)\s+([A-Za-z0-9_]+)/;

  const endRegex = /^END_(ORGANIZATION_BLOCK|FUNCTION_BLOCK|FUNCTION|DATA_BLOCK)/;

  for (const line of lines) {
    const clean = sanitize(line);

    const startMatch = clean.match(startRegex);
    if (startMatch) {
      if (current) blocks.push(current);
      current = {
        type: startMatch[1],
        name: startMatch[2],
        content: clean + "\r\n",
      };
      continue;
    }

    if (current) {
      current.content += clean + "\r\n";

      if (endRegex.test(clean)) {
        blocks.push(current);
        current = null;
      }
    }
  }

  return blocks;
}

/* ============================================================
   3) XML generieren (TIA V19)
   ============================================================ */
function createXml(blockName, sclCode) {
  const safeName = sanitize(blockName);
  const safeCode = sclCode.replace(/]]>/g, "]]]]><![CDATA[>");

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
      <ProgrammingLanguage>SCL</ProgrammingLanguage>
      <MemoryLayout>Optimized</MemoryLayout>
    </AttributeList>

    <ObjectList>
      <SW.Blocks.CompileUnit ID="1">
        <AttributeList>
          <ProgrammingLanguage>SCL</ProgrammingLanguage>
        </AttributeList>
        <Source><![CDATA[
${safeCode}
        ]]></Source>
      </SW.Blocks.CompileUnit>
    </ObjectList>
  </SW.Blocks.FB>
</Document>`;
}

/* ============================================================
   4) SYMBOLTABELLE EXTRAHIEREN
   ============================================================ */
function extractSymbolTable(fullText) {
  const lines = fullText.split(/\r?\n/);
  const headerIndex = lines.findIndex((l) =>
    l.trim().toLowerCase().startsWith("name;datentyp;richtung;kommentar")
  );
  if (headerIndex === -1) return null;

  const out = [];
  for (let i = headerIndex; i < lines.length; i++) {
    const t = sanitize(lines[i]);
    if (!t.includes(";")) break;
    out.push(t);
  }
  return out.join("\r\n");
}

/* ============================================================
   5) API HANDLER (Vercel)
   ============================================================ */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST")
    return res.status(405).json({ error: "Only POST allowed" });

  try {
    const { scl } = req.body || {};
    if (!scl) return res.status(400).json({ error: "Missing 'scl'" });

    const cleanText = sanitize(scl);

    // 🔥 1) Bausteine automatisch extrahieren
    const blocks = extractBlocks(cleanText);

    if (!blocks.length) {
      return res.status(400).json({
        error: "No OB / FB / FC / DB blocks detected in SCL",
      });
    }

    // 🔥 2) ZIP erzeugen
    const zip = new JSZip();

    // → einzelne SCL-Dateien
    for (const blk of blocks) {
      const filename = `${blk.name}.scl`;
      zip.file(filename, blk.content);

      // → XML-Dateien
      const xmlName = `${blk.name}.xml`;
      zip.file(xmlName, createXml(blk.name, blk.content));
    }

    // → Symboltabelle
    const symbols = extractSymbolTable(scl);
    if (symbols) zip.file("Symboltabelle.csv", symbols);

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="TIA_Export_V19_Profi.zip"'
    );

    return res.status(200).send(zipBuffer);
  } catch (err) {
    console.error("EXPORT ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
