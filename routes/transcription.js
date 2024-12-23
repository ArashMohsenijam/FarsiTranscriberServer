import express from 'express';
import { TranscriptionController } from '../controllers/transcription.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();

router.post(
  '/transcribe',
  upload.single('file'),
  TranscriptionController.transcribe
);

export default router;