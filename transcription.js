import OpenAI from 'openai';
import { Readable } from 'stream';
import FormData from 'form-data';
import axios from 'axios';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function transcribeAudio(audioBuffer) {
  try {
    const formData = new FormData();
    
    // Create a readable stream from the buffer
    const stream = new Readable();
    stream.push(audioBuffer);
    stream.push(null);

    formData.append('file', stream, {
      filename: 'audio.mp3',
      contentType: 'audio/mpeg',
    });
    formData.append('model', 'whisper-1');
    formData.append('language', 'fa');
    formData.append('response_format', 'text');

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    });

    return response.data;
  } catch (error) {
    console.error('Error in transcribeAudio:', error);
    throw error;
  }
}