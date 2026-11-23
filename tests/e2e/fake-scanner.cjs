/**
 * Local stand-in for the Cloudmersive advanced virus scan (tests only; the real service is used in production).
 *   node tests/e2e/fake-scanner.cjs            (listens on 127.0.0.1:4599)
 * The app uses it with CLOUDMERSIVE_API_BASE=http://127.0.0.1:4599 and CLOUDMERSIVE_API_KEY=test-cloudmersive-key.
 * Answers, by file content:
 *   EICAR test string      → CleanResult false, FoundViruses [EICAR-Test-File]
 *   "/Encrypt" (PDF)       → CleanResult false, ContainsPasswordProtectedFile
 *   "SCANNER-DOWN-TEST"    → HTTP 503 (scanner unavailable)
 *   anything else          → CleanResult true
 * A wrong / missing Apikey header → HTTP 401. Every request is counted (GET /stats).
 */
const http = require("http");

const PORT = Number(process.env.FAKE_SCANNER_PORT ?? 4599);
const KEY = "test-cloudmersive-key";
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const stats = { scans: 0, clean: 0, blocked: 0, down: 0, unauthorized: 0, lastHeaders: {} };

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/stats") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(stats));
  }
  if (req.method !== "POST" || req.url !== "/virus/scan/file/advanced") {
    res.writeHead(404);
    return res.end();
  }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    stats.scans++;
    stats.lastHeaders = Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.startsWith("allow") || k === "restrictfiletypes"));
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.apikey !== KEY) {
      stats.unauthorized++;
      return send(401, { message: "Unauthorized" });
    }
    const body = Buffer.concat(chunks).toString("latin1");
    if (!/name="inputFile"/.test(body)) return send(400, { message: "inputFile missing" });
    if (body.includes("SCANNER-DOWN-TEST")) {
      stats.down++;
      return send(503, { message: "Service unavailable" });
    }
    if (body.includes(EICAR)) {
      stats.blocked++;
      return send(200, { CleanResult: false, FoundViruses: [{ FileName: "upload", VirusName: "EICAR-Test-File" }], ContainsExecutable: false, ContainsInvalidFile: false, ContainsScript: false, ContainsPasswordProtectedFile: false, ContainsRestrictedFileFormat: false, ContainsMacros: false, VerifiedFileFormat: null });
    }
    if (body.includes("/Encrypt")) {
      stats.blocked++;
      return send(200, { CleanResult: false, FoundViruses: null, ContainsPasswordProtectedFile: true, ContainsExecutable: false, ContainsInvalidFile: false, ContainsScript: false, ContainsRestrictedFileFormat: false, ContainsMacros: false, VerifiedFileFormat: ".pdf" });
    }
    stats.clean++;
    return send(200, { CleanResult: true, FoundViruses: null, ContainsExecutable: false, ContainsInvalidFile: false, ContainsScript: false, ContainsPasswordProtectedFile: false, ContainsRestrictedFileFormat: false, ContainsMacros: false, VerifiedFileFormat: null });
  });
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.log(`fake scanner already running on ${PORT}`);
    process.exit(0);
  }
  throw e;
});
server.listen(PORT, "127.0.0.1", () => console.log(`fake Cloudmersive scanner on http://127.0.0.1:${PORT}`));
