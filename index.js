import express from 'express';
import cors from 'cors';
import { config } from './config/environment.js';
import { errorHandler } from './middleware/errorHandler.js';
import transcriptionRoutes from './routes/transcription.js';

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api', transcriptionRoutes);

// Error handling
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});