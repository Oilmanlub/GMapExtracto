// Excel 2003 XML workbook: one worksheet (tab) per search Location, plus a combined "All" tab.
// Classic script: exposed on globalThis.XLSX (+ module.exports for the node self-test).
(function (root) {
  // XML 1.0 forbids the control chars below; if one survives into a cell the
  // whole workbook stops opening in Excel. Strip them, then escape the markup.
  const ILLEGAL = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
  const xesc = (s) =>
    String(s == null ? "" : s).replace(ILLEGAL, "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Excel sheet name: <=31 chars, no \ / ? * [ ] :, and unique within the workbook.
  function sheetName(loc, used) {
    const base = String(loc || "(no location)").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "(no location)";
    let n = base;
    let i = 2;
    while (used.has(n.toLowerCase())) n = (base.slice(0, 28) + " " + i++).slice(0, 31);
    used.add(n.toLowerCase());
    return n;
  }

  function sheetXml(name, rows, cols) {
    const head = cols.map((c) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${xesc(c)}</Data></Cell>`).join("");
    const body = rows
      .map((r) => "<Row>" + cols.map((c) => `<Cell><Data ss:Type="String">${xesc(r[c])}</Data></Cell>`).join("") + "</Row>")
      .join("");
    return `<Worksheet ss:Name="${xesc(name)}"><Table><Row>${head}</Row>${body}</Table></Worksheet>`;
  }

  // Tabs come from the Location the user typed into the Locations box (r.location),
  // NOT from the address column.
  function buildExcelXml(rows, cols) {
    const groups = new Map();
    for (const r of rows) {
      const loc = String(r.location || "").trim() || "(no location)";
      if (!groups.has(loc)) groups.set(loc, []);
      groups.get(loc).push(r);
    }
    const used = new Set(["all"]);
    let sheets = sheetXml("All", rows, cols);
    for (const [loc, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      sheets += sheetXml(sheetName(loc, used), list, cols);
    }
    return (
      '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      '<Styles><Style ss:ID="hdr"><Font ss:Bold="1"/></Style></Styles>' +
      sheets +
      "</Workbook>"
    );
  }

  root.XLSX = { xesc, sheetName, sheetXml, buildExcelXml };
  if (typeof module !== "undefined" && module.exports) module.exports = root.XLSX;
})(typeof globalThis !== "undefined" ? globalThis : this);
