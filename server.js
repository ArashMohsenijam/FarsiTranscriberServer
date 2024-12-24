const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const FormData = require('form-data');
const fetch = require('node-fetch');
const { optimizeAudio } = require('./utils/audioOptimizer');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const OpenAI = require('openai');
ffmpeg.setFfmpegPath(ffmpegPath);

require('dotenv').config();

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Keep track of active connections and processes
const activeConnections = new Set();
const activeProcesses = new Set();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
const optimizedDir = path.join(__dirname, 'optimized');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
if (!fs.existsSync(optimizedDir)) {
  fs.mkdirSync(optimizedDir);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

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

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  cleanup();
  res.status(500).json({ error: 'Server error: ' + err.message });
});

// Graceful shutdown function
async function cleanup() {
  console.log('Starting cleanup...');
  
  // Clean up active FFmpeg processes
  for (const process of activeProcesses) {
    try {
      process.kill();
      activeProcesses.delete(process);
    } catch (error) {
      console.error('Error killing process:', error);
    }
  }

  // Clean up files
  try {
    const uploadFiles = fs.readdirSync(uploadsDir);
    const optimizedFiles = fs.readdirSync(optimizedDir);

    for (const file of uploadFiles) {
      fs.unlinkSync(path.join(uploadsDir, file));
    }
    for (const file of optimizedFiles) {
      fs.unlinkSync(path.join(optimizedDir, file));
    }
  } catch (error) {
    console.error('Error cleaning up files:', error);
  }

  // Close active connections
  for (const res of activeConnections) {
    try {
      res.end();
      activeConnections.delete(res);
    } catch (error) {
      console.error('Error closing connection:', error);
    }
  }

  console.log('Cleanup completed');
}

// Handle process termination
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await cleanup();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await cleanup();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Add root endpoint for health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'FarsiTranscriber API is running' });
});

app.post('/api/transcribe', upload.single('file'), async (req, res) => {
  const shouldOptimizeAudio = req.body.optimizeAudio === 'true';
  const shouldImproveTranscription = req.body.improveTranscription === 'true';
  let originalFilePath = req.file.path;
  let optimizedFilePath = null;
  let transcriptionText = '';
  let improvedText = null;

  try {
    // Send initial status
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Audio optimization step
    if (shouldOptimizeAudio) {
      res.write(`data: ${JSON.stringify({ status: 'Optimizing audio...', progress: 0 })}\n\n`);
      optimizedFilePath = path.join(__dirname, 'optimized', `${Date.now()}-${path.basename(req.file.path)}.mp3`);
      await optimizeAudio(originalFilePath, optimizedFilePath);
      res.write(`data: ${JSON.stringify({ status: 'Audio optimization complete', progress: 20 })}\n\n`);
    }

    // Transcription step
    res.write(`data: ${JSON.stringify({ status: 'Transcribing audio...', progress: 30 })}\n\n`);
    const fileToTranscribe = optimizedFilePath || originalFilePath;
    console.log('Audio file stats:', await fs.promises.stat(fileToTranscribe));
    
    transcriptionText = await transcribeAudio(fileToTranscribe);
    console.log('Transcription received, length:', transcriptionText.length);
    res.write(`data: ${JSON.stringify({ status: 'Transcription complete', progress: 80 })}\n\n`);

    // Text improvement step
    if (shouldImproveTranscription) {
      try {
        res.write(`data: ${JSON.stringify({ status: 'Improving transcription...', progress: 90 })}\n\n`);
        console.log('Improving transcription...');
        improvedText = await improveTranscription(transcriptionText);
        console.log('Transcription improved');
      } catch (error) {
        console.error('Error improving transcription:', error);
        res.write(`data: ${JSON.stringify({ status: 'Error improving transcription, using original', progress: 90 })}\n\n`);
        improvedText = null;
      }
    }

    // Send final result
    const result = {
      original: transcriptionText,
      improved: shouldImproveTranscription ? improvedText : null
    };

    res.write(`data: ${JSON.stringify({ status: 'Complete', progress: 100, result })}\n\n`);
    res.end();

    // Cleanup files
    try {
      if (originalFilePath) {
        await fs.promises.unlink(originalFilePath);
      }
      if (optimizedFilePath) {
        await fs.promises.unlink(optimizedFilePath);
      }
    } catch (error) {
      console.error('Error cleaning up files:', error);
    }

  } catch (error) {
    console.error('Error processing request:', error);
    res.write(`data: ${JSON.stringify({ status: 'Error', error: error.message })}\n\n`);
    res.end();

    // Cleanup files on error
    try {
      if (originalFilePath) {
        await fs.promises.unlink(originalFilePath);
      }
      if (optimizedFilePath) {
        await fs.promises.unlink(optimizedFilePath);
      }
    } catch (cleanupError) {
      console.error('Error cleaning up files after error:', cleanupError);
    }
  }
});

async function transcribeAudio(filePath) {
  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('model', 'whisper-1');
    formData.append('language', 'fa');
    formData.append('response_format', 'text');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('OpenAI API error response:', errorData);
      throw new Error(`OpenAI API error: ${errorData}`);
    }

    const transcription = await response.text();
    console.log('Transcription received, length:', transcription.length);
    return transcription;
  } catch (error) {
    console.error('Error transcribing audio:', error);
    throw error;
  }
}

async function improveTranscription(text) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "o1-mini",
        messages: [
          {
            role: "user",
            content: `Please improve this Farsi transcription by:
1. Fixing transcription errors (word boundaries, homophones, dialectal variations)
2. Adding proper punctuation (،٫؛؟)
3. Correcting grammar and style
4. Preserving authentic expressions and technical terms

Here is the text:

${text}

Return only the improved text without explanations.`
          }
        ],
        max_completion_tokens: 65536
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('OpenAI API error:', error);
      throw new Error(`OpenAI API error: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('Error improving transcription:', error);
    return text;
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
server.on('error', async (error) => {
  console.error('Server error:', error);
  await cleanup();
  process.exit(1);
});
