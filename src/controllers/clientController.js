import fs from 'fs';
import { ensureCsv, streamClientRows } from '../services/parse.js';
import { findUnmatchedPhones, writeOutputFile } from '../services/store.js';
import { withConn } from '../config/db.js';
import { stringify } from 'csv-stringify/sync'; // Ensure this is imported


export const dashboard = async (req, res) => {
  const { page = 1 } = req.query;
  const limit = 10;
  const offset = (page - 1) * limit;

  const data = await withConn(async (conn) => {
      const currentTime = new Date();  // Get the current time (NOW())
    console.log("Current Time (NOW()):", currentTime);  // Log the current time
    // Fetching the rows (client files)
    const [rows] = await conn.query(
      `SELECT cf.* 
         FROM client_files cf
         JOIN users u ON u.id = cf.user_id
        WHERE cf.user_id = :uid
          AND (cf.created_at >= (NOW() - INTERVAL 24 HOUR) OR u.timeless_access = 1)
        ORDER BY cf.created_at DESC
        LIMIT :limit OFFSET :offset`,
      { uid: req.user.id, limit, offset }
    );

    // Logging the rows (files)
    console.log("Fetched Files:", rows);

    // Fetching the count for pagination
    const [[{ cnt }]] = await conn.query(
      `SELECT COUNT(*) AS cnt
         FROM client_files cf
         JOIN users u ON u.id = cf.user_id
        WHERE cf.user_id = :uid
          AND (cf.created_at >= (NOW() - INTERVAL 24 HOUR) OR u.timeless_access = 1)`,
      { uid: req.user.id }
    );

    // Logging the total count of files for pagination
    console.log("Total Files Count:", cnt);

    return { rows, cnt };
  });

  // Logging the final data object
  console.log("Dashboard Data:", data);

  res.render('client/dashboard', {
    files: data.rows,
    page: Number(page),
    pages: Math.ceil(data.cnt / limit)
  });
};


export const showUpload = (req, res) => res.render('client/upload');


export const handleUpload = async (req, res, next) => {
  try {
    const wantedFormat = (req.body.output_format || 'csv').toLowerCase();
    const filePath = req.file.path;
    const csvPath = ensureCsv(filePath);

    let total = 0;
    const buffer = new Map();
    const unmatched = new Map();
    let hadAnyState = false;

    // Flush function to process large chunks of data
    async function flush() {
      if (buffer.size === 0) return;

      const batchMap = new Map(buffer);
      buffer.clear();

      const phones = [...batchMap.keys()];
      const notFound = await findUnmatchedPhones(phones);

      for (const p of notFound) {
        const st = batchMap.get(p) ?? null;
        if (st && String(st).trim().length) hadAnyState = true;
        if (!unmatched.has(p)) unmatched.set(p, st);
        else if (!unmatched.get(p) && st) unmatched.set(p, st);
      }
    }

    // Process the file rows and build the unmatched set
    for await (const { phone, state } of streamClientRows(csvPath)) {
      total++;
      if (!buffer.has(phone)) buffer.set(phone, state ?? null);
      if (buffer.size >= 20000) await flush();
    }
    await flush();

    // Prepare the rows for S3 upload
    const rows = hadAnyState
      ? [...unmatched].map(([phone, state]) => ({ state, phone }))
      : [...unmatched.keys()];

    // Upload the processed data to S3 and get the URL
    const { stored, fullPath } = await writeOutputFile({
      userId: req.user.id,
      rows,
      format: wantedFormat,
      originalFilename: req.file.originalname,
      email: req.user.email // Pass the user's email for folder structure
    });

    // Insert metadata into the database
    await withConn(async (conn) => {
      await conn.query(
        `INSERT INTO client_files (user_id, original_filename, stored_filename, output_format, output_path, record_count, unmatched_count)
         VALUES (:uid, :orig, :stored, :fmt, :path, :rc, :uc)`,
        {
          uid: req.user.id,
          orig: req.file.originalname,
          stored,
          fmt: wantedFormat,
          path: fullPath,  // Save the S3 URL
          rc: total,
          uc: rows.length
        }
      );
    });

    // Clean up local CSV file after processing
    if (csvPath !== filePath) fs.unlinkSync(csvPath);

    // Send response based on the request type
    if (req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.json({ ok: true, redirect: '/client' });
    }
    return res.redirect('/client');
  } catch (e) {
    console.error('Error during file upload:', e);
    next(e);
  }
};





export const listFiles = async (req, res) => {
  const files = await withConn(async (conn) => {
    const [rows] = await conn.query(
      `SELECT cf.*
         FROM client_files cf
         JOIN users u ON u.id = cf.user_id
        WHERE cf.user_id = :uid
          AND (cf.created_at >= (NOW() - INTERVAL 24 HOUR) OR u.timeless_access = 1)
        ORDER BY cf.created_at DESC`,
      { uid: req.user.id }
    );
    return rows;
  });
  res.render('client/files', { files });
};

// export const listFiles = async (req, res) => {
//   const files = await withConn(async (conn) => {
//     const [rows] = await conn.query(
//       `SELECT *
//          FROM client_files
//         WHERE user_id = :uid
//           AND created_at >= (NOW() - INTERVAL 24 HOUR)
//         ORDER BY created_at DESC`,
//       { uid: req.user.id }
//     );
//     return rows;
//   });
//   res.render('client/files', { files });
// };

export const download = async (req, res) => {
  const file = await withConn(async (conn) => {
    const [rows] = await conn.query(
      `SELECT cf.* FROM client_files cf WHERE cf.id = :id AND cf.user_id = :uid`,
      { id: req.params.id, uid: req.user.id }
    );
    return rows[0];
  });

  if (!file) return res.status(404).send('File not found');

  // Generate S3 signed URL for downloading the file
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: file.output_path, // S3 path of the file
    Expires: 60 * 60 // 1 hour expiration time for the download link
  };

  try {
    const signedUrl = s3.getSignedUrl('getObject', params);
    return res.redirect(signedUrl); // Redirect user to S3 download link
  } catch (err) {
    console.error('Error generating S3 signed URL:', err);
    return res.status(500).send('Error downloading the file.');
  }
};
