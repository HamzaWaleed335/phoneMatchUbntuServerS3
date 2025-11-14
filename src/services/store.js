// src/services/store.js
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { stringify } from 'csv-stringify/sync';
import { withConn } from '../config/db.js';
import AWS from 'aws-sdk';



// Initialize the AWS S3 SDK
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

/** Utility function to sanitize email for folder use */
function sanitizeEmail(email) {
  return email.toLowerCase().replace(/[^\w\-]+/g, '_');
}
/** Ensure upload dirs exist */
export function ensureDirs(base = 'uploads') {
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  if (!fs.existsSync(path.join(base, 'admin'))) fs.mkdirSync(path.join(base, 'admin'), { recursive: true });
  if (!fs.existsSync(path.join(base, 'client'))) fs.mkdirSync(path.join(base, 'client'), { recursive: true });
}

/** Upsert phone numbers in chunks using a unique index on phone */
export async function bulkUpsertPhones(phones, userId, chunkSize = 10000) {
  let total = 0;
  await withConn(async (conn) => {
    for (let i = 0; i < phones.length; i += chunkSize) {
      const chunk = phones.slice(i, i + chunkSize);
      if (chunk.length === 0) continue;
      const values = chunk.map(p => [p, userId]);
      const [result] = await conn.query(
        `INSERT INTO phone_numbers (phone, added_by) VALUES ?
         ON DUPLICATE KEY UPDATE phone = VALUES(phone)`,
        [values]
      );
      total += result.affectedRows;
    }
  });
  return total;
}

/** Given a batch of phones, return those NOT present in phone_numbers */
export async function findUnmatchedPhones(batchPhones) {
  if (batchPhones.length === 0) return [];
  return withConn(async (conn) => {
    // Use a unique temp table name to avoid "already exists" across re-used pooled connections
    const tmpName = `tmp_phones_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

    try {
      await conn.query(`CREATE TEMPORARY TABLE \`${tmpName}\` (phone VARCHAR(32) PRIMARY KEY)`);
      const values = batchPhones.map(p => [p]);
      await conn.query(`INSERT INTO \`${tmpName}\` (phone) VALUES ?`, [values]);

      const [rows] = await conn.query(
        `SELECT t.phone
           FROM \`${tmpName}\` t
           LEFT JOIN phone_numbers p ON p.phone = t.phone
          WHERE p.phone IS NULL`
      );

      return rows.map(r => r.phone);
    } finally {
      // Ensure cleanup even if the query above throws
      await conn.query(`DROP TEMPORARY TABLE IF EXISTS \`${tmpName}\``);
    }
  });
}

/**
 * Write clean (unmatched) numbers to a per-user file (csv or xlsx) and return its paths.
 * The browser download name mirrors the original upload name with "-clean" and chosen extension.
 */
// export async function writeOutputFile({
//   userId,
//   numbers,
//   rows,
//   format,
//   originalFilename,     // used to craft the browser download name
//   baseDir = 'uploads'
// }) {
//   // rows can be:
//   //  - array of strings (phones) OR
//   //  - array of { state, phone }
//   // numbers is kept for backward compatibility (phones-only)
//   const payload = Array.isArray(rows) ? rows : (Array.isArray(numbers) ? numbers : []);
//   const hasObjects = payload.length && typeof payload[0] === 'object' && payload[0] !== null;

//   const dir = path.join(baseDir, 'client', String(userId));
//   fs.mkdirSync(dir, { recursive: true });

//   const ts = new Date().toISOString().replace(/[:.]/g, '-');

//   // Build a clean, user-visible filename that mirrors the upload name
//   const origBase = (originalFilename || 'file').replace(/\.[^.]+$/,''); // strip ext
//   const userVisibleName = `${origBase}-clean.${format}`;                // what users see
//   // Keep an internal unique path (timestamped) to avoid collisions on disk
//   const internalStored = `${origBase}-clean-${ts}.${format}`;
//   const fullPath = path.join(dir, internalStored);

//   if (format === 'csv') {
//     if (hasObjects) {
//       // Write state + phone columns
//       const csv = stringify(
//         payload.map(r => ({ state: r.state ?? '', phone: r.phone })),
//         { header: true, columns: ['state', 'phone'] }
//       );
//       fs.writeFileSync(fullPath, csv);
//     } else {
//       // numbers-only
//       const csv = stringify(payload.map(n => ({ phone: n })), { header: true });
//       fs.writeFileSync(fullPath, csv);
//     }
//   } else {
//     const wb = new ExcelJS.Workbook();
//     const ws = wb.addWorksheet('Clean'); // worksheet name
//     if (hasObjects) {
//       ws.addRow(['state', 'phone']);
//       payload.forEach(r => ws.addRow([r.state ?? '', r.phone]));
//     } else {
//       ws.addRow(['phone']);
//       payload.forEach(n => ws.addRow([n]));
//     }
//     await wb.xlsx.writeFile(fullPath);
//   }

//   // Return user-visible name (for the browser) and internal path
//   return { stored: userVisibleName, fullPath };
// }
export async function writeOutputFile({
  userId,
  numbers,
  rows,
  format,
  originalFilename,     // used to craft the browser download name
  baseDir = 'uploads',
  email,                // The user's email for the folder structure
}) {
  // rows can be:
  //  - array of strings (phones) OR
  //  - array of { state, phone }
  const payload = Array.isArray(rows) ? rows : (Array.isArray(numbers) ? numbers : []);
  const hasObjects = payload.length && typeof payload[0] === 'object' && payload[0] !== null;

  // Set up the directory structure
  const sanitizedEmail = sanitizeEmail(email);  // Sanitize email for S3 folder name
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileNameWithoutExt = originalFilename.replace(/\.[^.]+$/, ''); // Remove file extension
  const userFolder = `PhoneDirectoryProjectFiles/${sanitizedEmail}`;  // Main folder: Project > User's Email

  const fileName = `${fileNameWithoutExt}-clean-${timestamp}.${format}`; // File name with timestamp
  const fileKey = `${userFolder}/${fileName}`;  // S3 Key with folder structure

  // Write file locally first, and then upload to S3
  const tempFilePath = path.join(baseDir, fileName);

  if (format === 'csv') {
    if (hasObjects) {
      const csv = stringify(
        payload.map(r => ({ state: r.state ?? '', phone: r.phone })),
        { header: true, columns: ['state', 'phone'] }
      );
      fs.writeFileSync(tempFilePath, csv);
    } else {
      const csv = stringify(payload.map(n => ({ phone: n })), { header: true });
      fs.writeFileSync(tempFilePath, csv);
    }
  } else {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Clean'); // worksheet name
    if (hasObjects) {
      ws.addRow(['state', 'phone']);
      payload.forEach(r => ws.addRow([r.state ?? '', r.phone]));
    } else {
      ws.addRow(['phone']);
      payload.forEach(n => ws.addRow([n]));
    }
    await wb.xlsx.writeFile(tempFilePath);
  }

  // Upload file to S3
  const fileContent = fs.readFileSync(tempFilePath);

  const s3Params = {
    Bucket: BUCKET_NAME,
    Key: fileKey,  // Use the structured S3 key with folders
    Body: fileContent,
    ContentType: format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // Removed the ACL setting here, as the bucket policy should handle access
  };

  try {
    const uploadResult = await s3.upload(s3Params).promise();

    // Remove the local file after uploading
    fs.unlinkSync(tempFilePath);

    // Return the S3 URL (publicly accessible)
    const fileUrl = uploadResult.Location;  // The URL for the file

    return { stored: fileName, fullPath: fileUrl };
  } catch (err) {
    console.error('S3 upload failed:', err);
    throw new Error('Failed to upload file to S3');
  }
}