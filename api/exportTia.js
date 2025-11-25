import JSZip from "jszip";

/* ============================================
   1) UMLAUT-FILTER (TIA-sicher)
   ============================================ */
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

/* ============================================
   2) SCL-SANITIZER
   - schneidet Kopf & Symboltabelle ab
   - ersetzt END_VAR_INPUT / END_VAR_OUTPUT ...
   ============================================ */
function sanitizeSclCode(fullText) {
  if (!fullText) return "";

  // Schritt 1: Umlaute raus
  let txt = sanitizeUmlauts(fullText);

  const lines = txt.split(/\r?\n/);

  // 1) Alles VOR dem ersten Block (OB/FB/DB) rausschneiden
  let startIndex = lines.findIndex((line) =>
    /^\s*(ORGANIZATION_BLOCK|FUNCTION_BLOCK|DATA_BLOCK)\b/.test(line)
  );
  if (startIndex === -1) {
    // keine Bausteine gefunden → ganze Datei zurück (aber das ist eh schräg)
    startIndex = 0;
  }
  let relevant = lines.slice(startIndex);

  // 2) Symboltabelle / Hinweis am Ende abschneiden
  const symIndex = relevant.findIndex((l) =>
    l.trim().toLowerCase().startsWith("name;datentyp;richtung;kommentar")
  );
  if (symIndex !== -1) {
    relevant = relevant.slice(0, symIndex);
  }

  let sclCode = relevant.join("\r\n");

  // 3) Typische KI-SCL-Syntaxfehler korrigieren
  // END_VAR_INPUT / END_VAR_OUTPUT / END_VAR_IN_OUT → END_VAR
  sclCode = sclCode.replace(/\bEND_VAR_INPUT\b/g, "END_VAR");
  sclCode = sclCode.replace(/\bEND_VAR_OUTPUT\b/g, "END_VAR");
  sclCode = sclCode.replace(/\bEND_VAR_IN_OUT\b/g, "END_VAR");
  sclCode = sclCode.replace(/\bEND_VAR_INOUT\b/g, "END_VAR");

  // Falls irgendwo "VAR_IN_OUT" statt "VAR_IN_OUT" / "VAR_INOUT" Chaos entsteht,
  // könnte man hier auch noch normalisieren, z.B.:
  // sclCode = sclCode.replace(/\bVAR_IN_OUT\b/g, "VAR_IN_OUT");

  return sclCode;
}

/* ============================================
   3) Variablenliste extrahieren (für CSV)
   ============================================ */
function extractSymbolTable(fullText) {
  if (!fullText) return null;

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
  return result.length ? sanitizeUmlauts(result.join("\r\n")) : null;
}

/* ============================================
   4) XML für TIA (FB) erstellen – V19-kompatibel
   ============================================ */
function createFbXml(blockName, sclCode) {
  const safeName = (blockName || "FB_Generiert").replace(/[^A-Za-z0-9_]/g, "_");
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

/* ============================================
   5) API Handler (/api/exportTia)
   ============================================ */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { scl } = req.body || {};
    if (!scl || typeof scl !== "string") {
      return res.status(400).json({ error: "Field 'scl' (string) is required" });
    }

    // 1) SCL sanitizen (Umlaute, Kopf, Symboltabelle, END_VAR_* usw.)
    const sclCode = sanitizeSclCode(scl);

    // 2) Symboltabelle rausziehen
    const symbolCsv = extractSymbolTable(scl);

    // 3) FB-Namen grob aus dem Text erraten
    let fbName = "FB_Generiert";
    const fbMatch = scl.match(/FUNCTION_BLOCK\s+([A-Za-z0-9_]+)/i);
    if (fbMatch?.[1]) {
      fbName = sanitizeUmlauts(fbMatch[1]);
    }

    const fbXml = createFbXml(fbName, sclCode);

    // 4) ZIP bauen
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
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
}
