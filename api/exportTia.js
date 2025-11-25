import JSZip from "jszip";

/* ---------- Body-Parser für Vercel Pages API ---------- */
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
   1) UMLAUT-FILTER
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

function makeSafeName(name) {
  return sanitizeUmlauts(name || "")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^_+/, "") || "Block";
}

/* ============================================================
   2) BAUSTEIN-PARSER
============================================================ */
function splitBlocks(fullText) {
  const lines = fullText.split(/\r?\n/);
  const blocks = [];
  let current = null;

  const startPatterns = [
    { type: "OB", regex: /^ *ORGANIZATION_BLOCK\s+([A-Za-z0-9_]+)/i },
    { type: "FB", regex: /^ *FUNCTION_BLOCK\s+([A-Za-z0-9_]+)/i },
    { type: "FC", regex: /^ *FUNCTION\s+([A-Za-z0-9_]+)/i },
    { type: "DB", regex: /^ *DATA_BLOCK\s+([A-Za-z0-9_]+)/i },
  ];

  const endPatterns = {
    OB: /^ *END_ORGANIZATION_BLOCK\b/i,
    FB: /^ *END_FUNCTION_BLOCK\b/i,
    FC: /^ *END_FUNCTION\b/i,
    DB: /^ *END_DATA_BLOCK\b/i,
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!current) {
      for (const sp of startPatterns) {
        const m = line.match(sp.regex);
        if (m) {
          current = {
            type: sp.type,
            name: makeSafeName(m[1]),
            lines: [line],
          };
          break;
        }
      }
      continue;
    }

    current.lines.push(line);

    const endRe = endPatterns[current.type];
    if (endRe && endRe.test(line)) {
      blocks.push(current);
      current = null;
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

/* ============================================================
   3) SYMBOLTABELLE
============================================================ */
function extractSymbolTable(fullText) {
  const lines = fullText.split(/\r?\n/);
  const start = lines.findIndex((l) =>
    l.trim().toLowerCase().startsWith("name;datentyp;richtung;kommentar")
  );

  if (start === -1) return null;

  const list = [];

  for (let i = start; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || !l.includes(";")) break;
    list.push(l);
  }

  return list.length ? list.join("\r\n") : null;
}

/* ============================================================
   4) XML FB GENERATOR
============================================================ */
function createFbXml(blockName, sclCode) {
  const safe = makeSafeName(blockName);
  const safeCode = sclCode.replace(/]]>/g, "]]]]><![CDATA[>");

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
        <Source><![CDATA[
${safeCode}
        ]]></Source>
      </SW.Blocks.CompileUnit>
    </ObjectList>
  </SW.Blocks.FB>
</Document>`;
}

/* ============================================================
   5) API HANDLER
============================================================ */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Only POST allowed" });

  try {
    /* 🔥 WICHTIG: Body korrekt lesen */
    const body = await readBody(req);
    const scl = body.scl;

    if (!scl || typeof scl !== "string")
      return res.status(400).json({ error: "Field 'scl' (string) is required" });

    const clean = sanitizeUmlauts(scl);
    const blocks = splitBlocks(clean);
    const symbolCsv = extractSymbolTable(clean);

    if (!blocks.length)
      return res.status(400).json({
        error: "Keine TIA-Bausteine erkannt. OB / FB / FC / DB fehlen.",
      });

    const zip = new JSZip();
    const sclFolder = zip.folder("SCL");
    const xmlFolder = zip.folder("XML");

    for (const block of blocks) {
      const code = block.lines.join("\r\n");
      sclFolder.file(`${block.name}.scl`, code);

      if (block.type === "FB") {
        const xml = createFbXml(block.name, code);
        xmlFolder.file(`${block.name}.xml`, xml);
      }
    }

    if (symbolCsv) {
      zip.file("Symboltabelle.csv", sanitizeUmlauts(symbolCsv));
    }

    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="TIA_Export_Profi_V19.zip"'
    );

    return res.status(200).send(buffer);
  } catch (err) {
    console.error("EXPORT ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
