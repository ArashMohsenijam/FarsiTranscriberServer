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
  // Add response to active connections
  activeConnections.add(res);
  let currentProcess = null;

  const sendStatus = (status, progress = 0) => {
    try {
      res.write(`data: ${JSON.stringify({ status, progress })}\n\n`);
    } catch (error) {
      console.error('Error sending status:', error);
    }
  };

  const cleanup = () => {
    try {
      // Kill any running ffmpeg process
      if (currentProcess) {
        try {
          currentProcess.kill();
          activeProcesses.delete(currentProcess);
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

      // Remove response from active connections
      activeConnections.delete(res);
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  };

  // Handle client disconnection
  req.on('close', () => {
    console.log('Client disconnected, cleaning up...');
    cleanup();
  });

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
            activeProcesses.delete(process);
            reject(err);
          })
          .on('end', () => {
            console.log('FFmpeg process completed');
            activeProcesses.delete(process);
            resolve(outputPath);
          });

        // Store the process so we can kill it if needed
        currentProcess = process;
        activeProcesses.add(process);
        
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
            role: "system",
            content: `You are a highly skilled Farsi (Persian) language expert specializing in transcription improvement. Your tasks include:

1. Fix common Whisper transcription errors in Farsi:
   - Correct word boundaries and spacing
   - Fix homophone confusions
   - Correct dialectal variations to standard Farsi
   - Handle informal/spoken Farsi appropriately

2. Improve text readability:
   - Use proper punctuation (،٫؛؟)
   - Format numbers and dates correctly
   - Maintain proper paragraph structure
   - Use standard Persian numerals when appropriate

3. Grammar and style:
   - Fix verb conjugations and tense consistency
   - Correct ezāfe constructions
   - Ensure subject-verb agreement
   - Maintain formal/informal tone consistency

4. Preserve authenticity:
   - Keep colloquial expressions when intentional
   - Maintain speaker's dialect markers if significant
   - Preserve technical terms and proper nouns
   - Keep original meaning intact

Return only the improved Farsi text without any explanations or notes.`
          },
          {
            role: "user",
            content: `لطفا این متن فارسی را با حفظ معنی و سبک اصلی بهبود دهید. فقط متن بهبود یافته را برگردانید:

${text}`
          }
        ],
        temperature: 0.3,
        max_tokens: 128000,  
        max_completion_tokens: 128000  
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
