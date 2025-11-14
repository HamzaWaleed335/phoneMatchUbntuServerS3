// src/routes/admin.js
import { Router } from 'express';
import multer from 'multer';
import { ensureAuth, ensureRole } from '../middleware/auth.js';
import {
  dashboard, showUpload, handleUpload, listNumbers, deleteNumber,
  listUsers, userFiles, adminDownloadClientFile, exportPhoneNumbers
} from '../controllers/adminController.js';
import { toggleUserTimelessAccess } from '../controllers/adminController.js';
const router = Router();
const upload = multer({ dest: 'uploads/admin', limits: { fileSize: 1024 * 1024 * 200 } });

router.use(ensureAuth, ensureRole('admin'));

router.get('/', dashboard);
router.get('/upload', showUpload);
router.post('/upload', upload.single('file'), handleUpload);

router.get('/numbers', listNumbers);
router.post('/numbers/:id/delete', deleteNumber);

// NEW: admin → users & files
router.get('/users', listUsers);
router.get('/users/:userId/files', userFiles);
router.get('/users/files/:id/download', adminDownloadClientFile);

// NEW: export phone_numbers
router.get('/numbers/export', exportPhoneNumbers); // ?format=csv|xlsx
router.post('/users/:userId/toggle-access', toggleUserTimelessAccess);
router.post('/users/:userId/timeless', toggleUserTimelessAccess);

export default router;
