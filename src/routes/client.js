import { Router } from 'express';
import multer from 'multer';
import { ensureAuth, ensureRole } from '../middleware/auth.js';
import { dashboard, showUpload, handleUpload, listFiles, download } from '../controllers/clientController.js';


const router = Router();
const upload = multer({ dest: 'uploads/client', limits: { fileSize: 1024 * 1024 * 200 } });


router.use(ensureAuth, ensureRole('client'));


router.get('/', dashboard);
router.get('/upload', showUpload);
router.post('/upload', upload.single('file'), handleUpload);
router.get('/files', listFiles);
router.get('/download/:id', download);


export default router;