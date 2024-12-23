import { TranscriptionService } from '../services/openai.js';

export class TranscriptionController {
  static async transcribe(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ 
          error: 'No audio file provided',
          message: 'Please select an audio file to transcribe'
        });
      }

      const transcription = await TranscriptionService.transcribe(req.file.buffer);
      res.json({ transcription });
    } catch (error) {
      console.error('Transcription error:', error);
      
      if (error.response?.data?.error?.message?.includes('rate limit')) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Please wait a few minutes before trying again, or upgrade to a pro account'
        });
      }
      
      res.status(500).json({
        error: 'Transcription failed',
        message: 'An error occurred while transcribing the audio. Please try again.'
      });
    }
  }
}