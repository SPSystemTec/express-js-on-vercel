import JSZip from "jszip";

/* ----------- Body korrekt einlesen (Vercel Pages API!) ----------- */
async function readBody(req) {
  return new Promise((resolve, reject) => {
    try {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          resolve({});
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/* 1) Nur SCL-Inhalt (Umlaute entfernen) */
function sanitizeSCL(text) {
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

/* 2) Blöcke extrahieren */
function extractBlocks(fullText) {
  const blocks = [];
  const lines = fullText.split(/\r?\n/);

  let current = null;

  const startRegex =
    /^(ORGANIZATION_BLOCK|FUNCTION_BLOCK|FUNCTION|DATA_BLOCK)\s+([A-Za-z0-9_]+)/;

  const endRegex =
    /^END_(ORGANIZATION_BLOCK|FUNCTION_BLOCK|FUNCTION|DATA_BLOCK)/;

  for (const line of lines) {
    const start = line.match(startRegex);
    if (start) {
      if (current) blocks.push(current);
      current = {
        type: start[1],
        name: start[2],
        content: line + "\r\n",
      };
      continue;
    }

    if (current) {
      current.content += line + "\r\n";
      if (endRegex.test(line)) {
        blocks.push(current);
        current = null;
      }
    }
  }
  return blocks;
}

/* 3) XML je Block bauen */
function buildXml(block) {
  const name = block.name;
  const type = block.type;
  const clean = sanitizeSCL(block.content).replace(/]]>/g, "]]]]><![CDATA[>");

  const xmlTypeMap = {
    ORGANIZATION_BLOCK: "OB",
    FUNCTION_BLOCK: "FB",
    FUNCTION: "FC",
    DATA_BLOCK: "DB",
  };

  const xmlType = xmlTypeMap[type] || "FB";

  return `<?xml version="1.0" encoding="utf-8"?>
<Document xmlns="http://www.siemens.com/automation/Openness/Document/v4">
  <Engineering version="V19" />
  <SW.Blocks.${xmlType} ID="0">
    <AttributeList>
      <Name>${name}</Name>
      <ProgrammingLanguage>SCL</ProgrammingLanguage>
      <MemoryLayout>Optimized</MemoryLayout>
    </AttributeList>
    <ObjectList>
      <SW.Blocks.CompileUnit ID="1">
        <AttributeList>
          <ProgrammingLanguage>SCL</ProgrammingLanguage>
        </AttributeList>
        <Source><![CDATA[
${clean}
        ]]></Source>
      </SW.Blocks.CompileUnit>
    </ObjectList>
  </SW.Blocks.${xmlType}>
</Document>`;
}

/* 4) Symboltabelle extrahieren */
function extractSymbolTable(text) {
  const lines = text.split(/\r?\n/);
  const head = lines.findIndex((l) =>
    l.toLowerCase().startsWith("name;datentyp;richtung;kommentar")
  );

  if (head === -1) return null;

  const arr = [];
  for (let i = head; i < lines.length; i++) {
    const l = lines[i];
    if (!l.includes(";")) break;
    arr.push(sanitizeSCL(l));
  }

  return arr.join("\r\n");
}

/* -------------- Haupt-API Handler -------------------------------- */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Only POST allowed" });

  try {
    // Body korrekt einlesen!
    const body = await readBody(req);
    const scl = body.scl;

    if (!scl || typeof scl !== "string") {
      return res.status(400).json({ error: "Missing scl" });
    }

    const blocks = extractBlocks(scl);
    if (!blocks.length) {
      return res.status(400).json({ error: "No TIA blocks detected" });
    }

    const zip = new JSZip();

    blocks.forEach((block) => {
      zip.file(`${block.name}.scl`, sanitizeSCL(block.content));
      zip.file(`${block.name}.xml`, buildXml(block));
    });

    const symbols = extractSymbolTable(scl);
    if (symbols) zip.file("Symboltabelle.csv", symbols);

    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="TIA_Export_V19.zip"'
    );

    return res.status(200).send(buffer);
  } catch (err) {
    console.error("EXPORT ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
