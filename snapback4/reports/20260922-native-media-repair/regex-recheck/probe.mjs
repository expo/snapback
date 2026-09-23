const pattern = /^[A-Za-z0-9+/]*={0,2}$/;
const rows = ["\n", "\r", "\r\n", "\u2028", "\u2029"].map(terminator => {
 const encoded = (terminator.length === 2 ? "AQ" : "AQI") + terminator;
 return {terminator: JSON.stringify(terminator), codePoints:[...terminator].map(c=>c.codePointAt(0)), encodedLength:encoded.length, originalUnflaggedMatch:pattern.test(encoded), explicitMultilineControl:/^[A-Za-z0-9+/]*={0,2}$/m.test(encoded)};
});
console.log(JSON.stringify({node:process.version,source:pattern.source,flags:pattern.flags,rows},null,2));
if(rows.some(r=>r.originalUnflaggedMatch))process.exitCode=1;
