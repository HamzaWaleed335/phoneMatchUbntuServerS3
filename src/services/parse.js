// src/services/parse.js
import fs from 'fs';
import path from 'path';
import { parse as csvParse } from '@fast-csv/parse';
import XLSX from 'xlsx';
import { normalizePhone, isProbablyState } from './util.js';

/**
 * Convert XLS/XLSX to a temporary CSV file and return the CSV path.
 * If the input is already .csv, just return it.
 */
export function ensureCsv(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.csv') return inputPath;

  const wb = XLSX.readFile(inputPath, { cellDates: false, WTF: false });
  const firstSheet = wb.SheetNames[0];
  const csvOut = XLSX.utils.sheet_to_csv(wb.Sheets[firstSheet], { FS: ',', RS: '\n' });
  const tmpCsv = inputPath + '.tmp.csv';
  fs.writeFileSync(tmpCsv, csvOut);
  return tmpCsv;
}

/**
 * Admin: stream a CSV (headers optional/any name), yield normalized phone numbers.
 * If only one column, use it. Otherwise, try to pick a phone-looking header.
 */
export async function *streamAdminPhones(csvPath) {
  const stream = fs.createReadStream(csvPath);
  const csvStream = csvParse({ headers: true, ignoreEmpty: true, trim: true })
    .on('error', err => { throw err; });

  stream.pipe(csvStream);

  let headerGuessed = false;
  let phoneKey = null;

  for await (const row of csvStream) {
    if (!headerGuessed) {
      const keys = Object.keys(row);
      if (keys.length === 1) {
        phoneKey = keys[0];
      } else {
        phoneKey = keys.find(k => /phone|mobile|msisdn/i.test(k)) || keys[0];
      }
      headerGuessed = true;
    }
    const phone = normalizePhone(row[phoneKey]);
    if (phone) yield phone;
  }
}

/**
 * Client: stream a CSV with two columns (state + phone in any order, headers optional).
 * Yields { state, phone } where phone is normalized. If only one column, it's treated as phone.
 */
export async function *streamClientRows(csvPath) {
  const stream = fs.createReadStream(csvPath);
  const csvStream = csvParse({ headers: true, ignoreEmpty: true, trim: true })
    .on('error', err => { throw err; });

  stream.pipe(csvStream);

  for await (const row of csvStream) {
    const keys = Object.keys(row);
    let phoneVal, stateVal;

    if (keys.length === 1) {
      // Only one column: assume it's the phone
      phoneVal = row[keys[0]];
    } else {
      // Try to detect which column is state vs phone based on values/headers
      const [a, b] = keys;
      const av = row[a];
      const bv = row[b];
      const aIsState = isProbablyState(av);
      const bIsState = isProbablyState(bv);

      if (aIsState && !bIsState) { stateVal = av; phoneVal = bv; }
      else if (bIsState && !aIsState) { stateVal = bv; phoneVal = av; }
      else {
        // Fall back to header names
        const phoneKey = keys.find(k => /phone|mobile|msisdn/i.test(k)) || a;
        phoneVal = row[phoneKey];
        const stateKey = keys.find(k => /state|region|province/i.test(k));
        stateVal = stateKey ? row[stateKey] : undefined;
      }
    }

    const phone = normalizePhone(phoneVal);
    if (phone) yield { state: stateVal, phone };
  }
}
