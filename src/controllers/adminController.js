// src/controllers/adminController.js
import fs from 'fs';
import { ensureCsv, streamAdminPhones } from '../services/parse.js';
import { bulkUpsertPhones } from '../services/store.js';
import { withConn } from '../config/db.js';
import { stringify } from 'csv-stringify/sync';
import { writeOutputFile } from '../services/store.js';


// ── Admin dashboard: simple total count
export const dashboard = async (req, res) => {
  const stats = await withConn(async (conn) => {
    const [[{ cnt }]] = await conn.query('SELECT COUNT(*) AS cnt FROM phone_numbers');
    return { total: cnt };
  });
  res.render('admin/dashboard', { stats });
};

export const showUpload = (req, res) => res.render('admin/upload');

// ── Upload master list (CSV/XLS/XLSX)
export const handleUpload = async (req, res, next) => {
  try {
    const filePath = req.file.path;
    const csvPath = ensureCsv(filePath);
    const phones = [];

    for await (const phone of streamAdminPhones(csvPath)) {
      phones.push(phone);
      if (phones.length >= 50000) {
        await bulkUpsertPhones(phones.splice(0), req.user.id);
      }
    }

    if (phones.length) await bulkUpsertPhones(phones, req.user.id);
    if (csvPath !== filePath) fs.unlinkSync(csvPath);

    // Now, upload to S3 and update the DB with the S3 URL
    const wantedFormat = (req.body.output_format || 'csv').toLowerCase();
    const { stored, fullPath } = await writeOutputFile({
      userId: req.user.id,
      rows: phones,
      format: wantedFormat,
      originalFilename: req.file.originalname,
      email: req.user.email // Pass the user's email for folder structure
    });

    // Save the file information to the database
    await withConn(async (conn) => {
      await conn.query(
        `INSERT INTO client_files (user_id, original_filename, stored_filename, output_format, output_path, record_count, unmatched_count)
         VALUES (:uid, :orig, :stored, :fmt, :path, :rc, :uc)`,
        {
          uid: req.user.id,
          orig: req.file.originalname,
          stored,
          fmt: wantedFormat,
          path: fullPath, // Save the S3 URL
          rc: phones.length,
          uc: 0 // Update with actual unmatched count if needed
        }
      );
    });

    // If the request is AJAX (XHR), return the S3 link in the response
    if (req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.json({ redirect: '/admin/numbers' });
    }

    // Otherwise, redirect to the admin numbers page
    res.redirect('/admin/numbers');
  } catch (e) {
    console.error('Upload error:', e);
    if (req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.status(500).json({ error: 'Failed to upload file. Please check logs.' });
    }
    next(e);
  }}

// ── List numbers (with search + pagination)
export const listNumbers = async (req, res) => {
  const { page = 1, search = '' } = req.query;
  const limit = 20;
  const offset = (page - 1) * limit;

  const data = await withConn(async (conn) => {
    let whereClause = '';
    let params = { limit, offset };

    if (String(search).trim()) {
      whereClause = 'WHERE phone LIKE :search OR added_by LIKE :search';
      params.search = `%${search}%`;
    }

    const [rows] = await conn.query(
      `SELECT * FROM phone_numbers ${whereClause} ORDER BY id DESC LIMIT :limit OFFSET :offset`,
      params
    );

    const [[{ cnt }]] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM phone_numbers ${whereClause}`,
      String(search).trim() ? { search: `%${search}%` } : {}
    );

    return { rows, cnt };
  });

  res.render('admin/numbers', {
    rows: data.rows,
    page: Number(page),
    pages: Math.ceil(data.cnt / limit),
    search
  });
};

export const deleteNumber = async (req, res) => {
  await withConn(async (conn) => {
    await conn.query('DELETE FROM phone_numbers WHERE id = :id', { id: req.params.id });
  });
  res.redirect('/admin/numbers');
};

// ───────────────────────────────────────────────────────────────────
// NEW: Admin can see all users
// export const listUsers = async (req, res) => {
//   const users = await withConn(async (conn) => {
//     const [rows] = await conn.query(
//       `SELECT id, email, role, created_at FROM users ORDER BY created_at DESC`
//     );
//     return rows;
//   });
//   res.render('admin/users', { users });
// };


// include timeless_access in listUsers
export const listUsers = async (req, res) => {
  const users = await withConn(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, email, role, timeless_access, created_at
         FROM users
        ORDER BY created_at DESC`
    );
    return rows;
  });
  res.render('admin/users', { users });
};

// NEW: toggle (0/1) for a user
export const toggleUserTimelessAccess = async (req, res) => {
  const { userId } = req.params;
  await withConn(async (conn) => {
    await conn.query(
      `UPDATE users
          SET timeless_access = 1 - timeless_access
        WHERE id = :userId`,
      { userId }
    );
  });
  res.redirect('/admin/users');
};

// NEW: Admin can see a user's files (all time) and download any
export const userFiles = async (req, res) => {
  const uid = req.params.userId;
  const data = await withConn(async (conn) => {
    const [[u]] = await conn.query(`SELECT id, email, role FROM users WHERE id = :uid`, { uid });
    const [files] = await conn.query(
      `SELECT * FROM client_files WHERE user_id = :uid ORDER BY created_at DESC`,
      { uid }
    );
    console.log('userFiles:', u, files.length);
    return { user: u, files };
  });
  if (!data.user) return res.status(404).send('User not found');
  res.render('admin/user_files', { user: data.user, files: data.files });
};

export const adminDownloadClientFile = async (req, res) => {
  const id = req.params.id;
  const file = await withConn(async (conn) => {
    const [rows] = await conn.query(`SELECT * FROM client_files WHERE id = :id`, { id });
    return rows[0];
  });
  if (!file) return res.status(404).send('Not found');
  return res.download(file.output_path, file.stored_filename);
};

// NEW: Export phone_numbers as CSV or XLSX
export const exportPhoneNumbers = async (req, res) => {
  const format = (req.query.format || 'csv').toLowerCase();

  const rows = await withConn(async (conn) => {
    const [data] = await conn.query(
      `SELECT id, phone, added_by, created_at FROM phone_numbers ORDER BY id ASC`
    );
    return data;
  });

  if (format === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('phone_numbers');
    ws.addRow(['id', 'phone', 'added_by', 'created_at']);
    rows.forEach(r => ws.addRow([r.id, r.phone, r.added_by ?? '', r.created_at]));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="phone_numbers.xlsx"');
    await wb.xlsx.write(res);
    return res.end();
  }

  const csv = stringify(rows, { header: true, columns: ['id', 'phone', 'added_by', 'created_at'] });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="phone_numbers.csv"');
  return res.send(csv);
};
