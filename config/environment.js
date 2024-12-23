import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: 'whisper-1',
    language: 'fa',
  },
  upload: {
    maxSize: 25 * 1024 * 1024, // 25MB
    allowedMimeTypes: [
      'audio/mpeg',
      'audio/wav',
      'audio/x-m4a',
      'audio/ogg',
      'application/ogg'
    ],
  },
};