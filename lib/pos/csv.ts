import { posCsvRowSchema, type PosCsvRow } from "@/lib/validation/phase10";

export const LOYVERSE_CSV_HEADERS = [
  "external_reference",
  "external_line_id",
  "occurred_at",
  "type",
  "entity_type",
  "external_id",
  "quantity",
] as const;

export const MAX_POS_CSV_BYTES = 1_048_576;
export const MAX_POS_CSV_ROWS = 500;

export class PosCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PosCsvError";
  }
}

/** RFC-style CSV records with escaped quotes, CRLF/LF, commas, and newlines inside quotes. */
export function parseCsvRecords(input: string): string[][] {
  const source = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.length > 0)
        throw new PosCsvError("A quote must begin at the start of a CSV field.");
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      record.push(field);
      field = "";
      if (record.some((value) => value.length > 0)) records.push(record);
      record = [];
    } else {
      field += char;
    }
  }

  if (quoted) throw new PosCsvError("CSV contains an unterminated quoted field.");
  record.push(field);
  if (record.some((value) => value.length > 0)) records.push(record);
  return records;
}

export function parseLoyverseCsv(input: string): PosCsvRow[] {
  if (new TextEncoder().encode(input).byteLength > MAX_POS_CSV_BYTES) {
    throw new PosCsvError("CSV must be 1 MiB or smaller.");
  }
  const records = parseCsvRecords(input);
  if (records.length < 2) throw new PosCsvError("CSV requires a header and at least one data row.");

  const headers = records[0]!.map((value) => value.trim().toLowerCase());
  if (
    headers.length !== LOYVERSE_CSV_HEADERS.length ||
    headers.some((header, index) => header !== LOYVERSE_CSV_HEADERS[index])
  ) {
    throw new PosCsvError(`CSV headers must be exactly: ${LOYVERSE_CSV_HEADERS.join(",")}`);
  }

  const data = records.slice(1);
  if (data.length > MAX_POS_CSV_ROWS) {
    throw new PosCsvError(`CSV cannot exceed ${MAX_POS_CSV_ROWS} data rows.`);
  }

  const seen = new Set<string>();
  return data.map((record, index) => {
    const rowNumber = index + 2;
    if (record.length !== LOYVERSE_CSV_HEADERS.length) {
      throw new PosCsvError(`Row ${rowNumber} must contain exactly seven columns.`);
    }
    const [
      externalReference,
      externalLineId,
      occurredAt,
      movementType,
      entityType,
      externalId,
      qty,
    ] = record.map((value) => value.trim());
    const parsed = posCsvRowSchema.safeParse({
      rowNumber,
      externalReference,
      externalLineId,
      occurredAt,
      movementType: movementType?.toLowerCase(),
      entityType: entityType?.toLowerCase(),
      externalId,
      quantity: qty,
    });
    if (!parsed.success) {
      throw new PosCsvError(
        `Row ${rowNumber}: ${parsed.error.issues[0]?.message ?? "Invalid row."}`,
      );
    }
    const key = `${parsed.data.externalLineId}\u0000${parsed.data.movementType}`;
    if (seen.has(key)) {
      throw new PosCsvError(`Row ${rowNumber}: external line and type must be unique in the file.`);
    }
    seen.add(key);
    return parsed.data;
  });
}
