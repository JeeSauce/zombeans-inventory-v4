import type { ReportEnvelope } from "@/lib/validation/phase9";

function ascii(value: unknown): string {
  return String(value ?? "")
    .replaceAll("₱", "PHP ")
    .replaceAll("→", "->")
    .replaceAll("—", "-")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?");
}

function pdfEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function wrap(value: string, width = 108): string[] {
  if (value.length <= width) return [value];
  const lines: string[] = [];
  let remaining = value;
  while (remaining.length > width) {
    const split = Math.max(remaining.lastIndexOf(" ", width), Math.floor(width * 0.6));
    lines.push(remaining.slice(0, split));
    remaining = remaining.slice(split).trimStart();
  }
  if (remaining) lines.push(remaining);
  return lines;
}

export function reportToPdf(report: ReportEnvelope): Uint8Array {
  const sourceLines = [
    ascii(report.title),
    `Generated: ${ascii(report.generatedAt)}`,
    `Range: ${report.filters.startDate} to ${report.filters.endDate}`,
    report.note ? ascii(report.note) : "",
    "",
    ascii(report.columns.map((column) => column.label).join(" | ")),
    ...report.rows.flatMap((row) =>
      wrap(ascii(report.columns.map((column) => row[column.key] ?? "").join(" | "))),
    ),
  ].filter((line, index, all) => line || all[index - 1] !== "");
  const pages: string[][] = [];
  for (let index = 0; index < sourceLines.length; index += 48) {
    pages.push(sourceLines.slice(index, index + 48));
  }
  if (!pages.length) pages.push([ascii(report.title)]);

  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((lines, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    const commands = ["BT", "/F1 9 Tf", "36 756 Td"];
    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) commands.push("0 -14 Td");
      commands.push(`(${pdfEscape(line)}) Tj`);
    });
    commands.push("ET");
    const stream = commands.join("\n");
    objects[pageId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId - 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = output.length;
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(output);
}
