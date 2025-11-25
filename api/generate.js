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
funct
