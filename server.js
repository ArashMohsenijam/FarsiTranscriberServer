const express = require('express');
const cors = require('cors');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { optimizeAudio } = require('./utils/audioOptimizer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const OpenAI = require('openai');
ffmpeg.setFfmpegPath(ffmpegPath);

require('dotenv').config();

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Ensure upload and optimized directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const optimizedDir = path.join(__dirname, 'optimized');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(optimizedDir)) fs.mkdirSync(optimizedDir);

const upload = multer({ dest: uploadsDir });

// Configure CORS
const allowedOrigins = [
  'https://arashmohsenijam.github.io',
  'http://localhost:5173',
  'https://farsitranscriber.onrender.com'
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      callback(null, origin);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set in environment variables');
  process.exit(1);
}

// Add root endpoint for health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'FarsiTranscriber API is running' });
});

app.post('/api/transcribe', upload.single('file'), async (req, res) => {
  let currentProcess = null;

  const cleanup = () => {
    try {
      // Kill any running ffmpeg process
      if (currentProcess) {
        try {
          currentProcess.kill();
        } catch (error) {
          console.error('Error killing process:', error);
        }
      }

      // Clean up uploaded file
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      // Clean up optimized file
      const optimizedPath = path.join(optimizedDir, path.basename(req.file?.path || '') + '.mp3');
      if (fs.existsSync(optimizedPath)) {
        fs.unlinkSync(optimizedPath);
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  };

  // Handle client disconnection
  req.on('close', () => {
    console.log('Client disconnected, cleaning up...');
    cleanup();
  });

  const sendStatus = (status, progress = 0) => {
    try {
      res.write(`data: ${JSON.stringify({ status, progress })}\n\n`);
    } catch (error) {
      console.error('Error sending status:', error);
    }
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    if (!req.file) {
      throw new Error('No file uploaded');
    }

    // Parse workflow options from form data
    console.log('Form data:', req.body);
    const shouldOptimizeAudio = req.body.optimizeAudio === 'true';
    const shouldImproveTranscription = req.body.improveTranscription === 'true';

    console.log('Workflow options:', {
      optimizeAudio: shouldOptimizeAudio,
      improveTranscription: shouldImproveTranscription
    });

    console.log('File received:', req.file.originalname);
    sendStatus('Uploading', 20);

    let audioPath = req.file.path;
    let finalPath = audioPath;
    
    // Only optimize if the option is enabled
    if (shouldOptimizeAudio) {
      console.log('Optimizing audio...');
      sendStatus('Optimizing', 40);
      audioPath = await new Promise((resolve, reject) => {
        const outputPath = path.join(optimizedDir, path.basename(req.file.path) + '.mp3');
        
        const process = ffmpeg(req.file.path)
          .toFormat('mp3')
          .on('error', (err) => {
            console.error('FFmpeg error:', err);
            reject(err);
          })
          .on('end', () => {
            console.log('FFmpeg process completed');
            resolve(outputPath);
          });

        // Store the process so we can kill it if needed
        currentProcess = process;
        
        process.save(outputPath);
      });
      finalPath = audioPath;
    } else {
      // If not optimizing, ensure the file has a proper extension
      const tempPath = path.join(optimizedDir, path.basename(req.file.path) + '.mp3');
      await fs.promises.copyFile(audioPath, tempPath);
      finalPath = tempPath;
      console.log('Skipping audio optimization, using copied file:', finalPath);
      sendStatus('Transcribing', 40);
    }

    // Verify file exists and is readable
    if (!fs.existsSync(finalPath)) {
      throw new Error('Audio file not found');
    }

    const stats = fs.statSync(finalPath);
    console.log('Audio file stats:', {
      path: finalPath,
      size: stats.size,
      isFile: stats.isFile(),
      permissions: stats.mode
    });

    // Create form data for OpenAI API
    const formData = new FormData();
    formData.append('file', fs.createReadStream(finalPath));
    formData.append('model', 'whisper-1');
    formData.append('language', 'fa');
    formData.append('response_format', 'text');

    console.log('Sending request to OpenAI...');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    console.log('OpenAI response status:', response.status);
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error('OpenAI API error response:', errorData);
      res.write(`data: ${JSON.stringify({ 
        status: 'Error',
        progress: 0,
        error: errorData
      })}\n\n`);
      throw new Error(`OpenAI API error: ${errorData}`);
    }

    let transcription = await response.text();
    console.log('Transcription received, length:', transcription.length);
    
    // Only improve transcription if the option is enabled
    if (shouldImproveTranscription) {
      console.log('Improving transcription with GPT-4...');
      sendStatus('Improving transcription', 80);
      transcription = await improveTranscription(transcription);
      console.log('Transcription improved');
      sendStatus('Complete', 100);
    } else {
      console.log('Skipping transcription improvement');
      sendStatus('Complete', 100);
    }
    
    // Send the final transcription result
    res.write(`data: ${JSON.stringify({ 
      status: 'Complete',
      progress: 100,
      transcription: transcription 
    })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Server error:', error);
    res.write(`data: ${JSON.stringify({ 
      status: 'Error',
      progress: 0,
      error: error.message || 'An unexpected error occurred'
    })}\n\n`);
    res.end();
  } finally {
    cleanup();
  }
});

async function improveTranscription(transcription) {
  try {
    console.log('Improving transcription with GPT-4...');
    const prompt = `read and fix this transcript for word and grammatical errors, keep the language as Farsi and return it in the same Farsi language:\n\n${transcription}`;
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a helpful assistant that improves Farsi transcriptions while maintaining the original meaning and language." },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Error improving transcription:', error);
    return transcription; // Return original if improvement fails
  }
}

const port = process.env.PORT || 10000;
const server = app.listen(port, '0.0.0.0', (err) => {
  if (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
  console.log(`Server running on port ${port}`);
});

// Handle server errors
server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});

// Handle process termination
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
