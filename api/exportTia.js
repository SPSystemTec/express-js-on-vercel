import JSZip from "jszip";

/* -------- BODY PARSER FÜR VERCEL PAGES API -------- */
async function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

/* ============================================================
   1) UMLAUT FILTER
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
   ============================================================ */
function splitSclIntoBlocks(fullText) {
  const lines = fullText.split(/\r?\n/);

  const blocks = [];
  let current = null;

  for (let rawLine of lines) {
    const line = rawLine.trimEnd();

    const startMatch = line.match(
      /^(ORGANIZATION_BLOCK|FUNCTION_BLOCK|FUNCTION|DATA_BLOCK)\s+([A-Za-z0-9_]+)/
    );

    if (startMatch) {
      if (current) blocks.push(current);

      current = {
        type: startMatch[1],
        name: startMatch[2],
        lines: [line]
      };
      continue;
    }

    if (current) {
      current.lines.push(line);

      if (/^END_/.test(line)) {
        blocks.push(current);
        current = null;
      }
    }
  }

  return blocks;
}

/* ============================================================
   3) XML GENERATOR FÜR TIA BLOCKTYPEN
   ============================================================ */
function createXml(block, sclCode) {
  const xmlTypeMap = {
    ORGANIZATION_BLOCK: "OB",
    FUNCTION_BLOCK: "FB",
    FUNCTION: "FC",
    DATA_BLOCK: "DB"
  };

  const type = xmlTypeMap[block.type] || "FB";
  const safeName = block.name.replace(/[^A-Za-z0-9_]/g, "_");
  const cdata = sclCode.replace(/]]>/g, "]]]]><![CDATA[>");

  return `<?xml version="1.0" encoding="utf-8"?>
<Document xmlns="http://www.siemens.com/automation/Openness/Document/v4">
  <Engineering version="V19" />
  <SW.Blocks.${type} ID="0">
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
${cdata}
        ]]></Source>
      </SW.Blocks.CompileUnit>
    </ObjectList>
  </SW.Blocks.${type}>
</Document>`;
}

/* ============================================================
   4) API HANDLER
   ============================================================ */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Only POST allowed" });

  try {
    /* ---------- Body korrekt lesen ---------- */
    const body = await readBody(req);
    const scl = body.scl;

    if (!scl) return res.status(400).json({ error: "Field 'scl' is required" });

    /* ---------- Umlaute entfernen ---------- */
    const cleaned = sanitizeUmlauts(scl);

    /* ---------- Blöcke extrahieren ---------- */
    const blocks = splitSclIntoBlocks(cleaned);
    if (!blocks.length) {
      return res.status(400).json({ error: "No TIA blocks found." });
    }

    /* ---------- ZIP erzeugen ---------- */
    const zip = new JSZip();

    for (const block of blocks) {
      const content = block.lines.join("\r\n");

      zip.file(`${block.name}.scl`, content);

      const xml = createXml(block, content);
      zip.file(`${block.name}.xml`, xml);
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="TIA_Export_V19.zip"'
    );

    return res.status(200).send(zipBuffer);

  } catch (err) {
    console.error("EXPORT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
}
