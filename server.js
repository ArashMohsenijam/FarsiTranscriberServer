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
ffmpeg.setFfmpegPath(ffmpegPath);

require('dotenv').config();

const app = express();

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
  const cleanup = () => {
    try {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      // Clean up optimized file if it exists
      const optimizedPath = path.join(optimizedDir, path.basename(req.file?.path || '') + '.mp3');
      if (fs.existsSync(optimizedPath)) {
        fs.unlinkSync(optimizedPath);
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  };

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
  res.setHeader('Access-Control-Allow-Origin', allowedOrigins);

  try {
    if (!req.file) {
      throw new Error('No file uploaded');
    }

    console.log('File details:', {
      name: req.file.originalname,
      size: req.file.size,
      type: req.file.mimetype,
      path: req.file.path
    });

    if (!req.file.mimetype?.startsWith('audio/')) {
      throw new Error('Invalid file type. Please upload an audio file.');
    }

    console.log('File received:', req.file.originalname);
    sendStatus('Uploading', 33);

    // Optimize audio file
    console.log('Optimizing audio...');
    sendStatus('Optimizing', 50);
    const optimizedPath = await optimizeAudio(req.file.path);
    
    console.log('Optimized file path:', optimizedPath);
    sendStatus('Transcribing', 75);

    // Verify optimized file exists and is readable
    if (!fs.existsSync(optimizedPath)) {
      throw new Error('Optimized file not found');
    }

    const stats = fs.statSync(optimizedPath);
    console.log('Optimized file stats:', {
      size: stats.size,
      isFile: stats.isFile(),
      permissions: stats.mode
    });

    const formData = new FormData();
    formData.append('file', fs.createReadStream(optimizedPath));
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
      console.error('OpenAI API Error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData
      });
      throw new Error(`OpenAI API error: ${errorData}`);
    }

    const transcription = await response.text();
    console.log('Transcription received, length:', transcription.length);
    console.log('Transcription text:', transcription);
    
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
