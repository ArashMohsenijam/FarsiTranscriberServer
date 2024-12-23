import OpenAI from 'openai';
import { Readable } from 'stream';
import FormData from 'form-data';
import axios from 'axios';
import { config } from '../config/environment.js';
import fs from 'fs/promises';
import { optimizeAudioForWhisper, cleanupAudioFile } from '../utils/audioProcessor.js';
import path from 'path';
import os from 'os';

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

export class TranscriptionService {
  static async transcribe(audioBuffer) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'whisper-'));
    const inputPath = path.join(tempDir, 'input.mp3');
    
    try {
      // Write buffer to temporary file
      await fs.writeFile(inputPath, audioBuffer);
      
      // Optimize audio for Whisper
      const optimizedPath = await optimizeAudioForWhisper(inputPath);
      
      const formData = new FormData();
      const optimizedBuffer = await fs.readFile(optimizedPath);
      
      const stream = new Readable();
      stream.push(optimizedBuffer);
      stream.push(null);

      // Detect content type based on file extension
      const contentType = path.extname(optimizedPath).toLowerCase() === '.ogg' 
        ? 'audio/ogg'
        : 'audio/mpeg';

      formData.append('file', stream, {
        filename: path.basename(optimizedPath),
        contentType: contentType,
      });
      formData.append('model', config.openai.model);
      formData.append('language', config.openai.language);
      formData.append('response_format', 'text');

      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            'Authorization': `Bearer ${config.openai.apiKey}`,
          },
        }
      );

      // Cleanup temporary files
      await cleanupAudioFile(optimizedPath);
      await fs.rmdir(tempDir, { recursive: true });

      return response.data;
    } catch (error) {
      // Cleanup on error
      try {
        await fs.rmdir(tempDir, { recursive: true });
      } catch (cleanupError) {
        console.warn('Failed to cleanup temporary directory:', cleanupError);
      }
      
      console.error('OpenAI API Error:', error.response?.data || error.message);
      throw error;
    }
  }
}