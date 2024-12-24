# Farsi Transcriber Server

Backend server for the Farsi Transcriber application, handling audio file transcription and text improvement using OpenAI's Whisper and o1-mini models.

## Features

### Core Functionality
- **Audio Processing**: FFmpeg-based audio optimization
- **Transcription**: OpenAI Whisper API integration
- **Text Improvement**: o1-mini model integration
- **File Management**: Secure file handling and cleanup
- **Progress Tracking**: Server-Sent Events (SSE) for real-time updates

### API Features
- **Transcription Endpoint**: Process audio files with configurable options
- **Workflow Options**: Toggle audio optimization and text improvement
- **Error Handling**: Comprehensive error management
- **Resource Management**: Automatic cleanup of temporary files
- **Process Control**: Support for cancellation and graceful shutdown

### Security
- **CORS Protection**: Configurable origin restrictions
- **Input Validation**: File type and size validation
- **Resource Limits**: Controlled file processing
- **Error Boundaries**: Protected error handling
- **Clean Architecture**: Separation of concerns

## Technical Stack

### Core Technologies
- **Runtime**: Node.js
- **Framework**: Express.js
- **File Processing**: FFmpeg
- **AI Models**:
  - OpenAI Whisper for transcription
  - o1-mini for text improvement
- **File Upload**: Multer middleware

### Dependencies
- **express**: Web framework
- **multer**: File upload handling
- **cors**: Cross-Origin Resource Sharing
- **node-fetch**: HTTP client
- **form-data**: Form data handling
- **fluent-ffmpeg**: FFmpeg wrapper

## Installation

1. Prerequisites:
   - Node.js 16.x or higher
   - FFmpeg installed on the system
   - OpenAI API key with appropriate access

2. Clone the repository:
   \`\`\`bash
   git clone https://github.com/ArashMohsenijam/FarsiTranscriberServer.git
   cd FarsiTranscriberServer
   \`\`\`

3. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

4. Create .env file:
   \`\`\`env
   OPENAI_API_KEY=your_api_key_here
   PORT=10000
   \`\`\`

5. Start the server:
   \`\`\`bash
   node server.js
   \`\`\`

## API Documentation

### POST /api/transcribe

Transcribes an audio file and optionally improves the transcription.

#### Request
- **Method**: POST
- **Content-Type**: multipart/form-data
- **Body**:
  - `file`: Audio file (required)
  - `optimizeAudio`: Boolean (optional, default: false)
  - `improveTranscription`: Boolean (optional, default: true)

#### Response
Server-Sent Events with the following data:
\`\`\`typescript
interface TranscriptionEvent {
  status: string;
  progress: number;
  result?: {
    original: string;
    improved: string | null;
  };
}
\`\`\`

#### Example Usage
\`\`\`javascript
const formData = new FormData();
formData.append('file', audioFile);
formData.append('optimizeAudio', 'false');
formData.append('improveTranscription', 'true');

const response = await fetch('http://localhost:10000/api/transcribe', {
  method: 'POST',
  body: formData
});

const reader = response.body.getReader();
// Handle SSE data...
\`\`\`

## Configuration

### Environment Variables
- `OPENAI_API_KEY`: OpenAI API key
- `PORT`: Server port (default: 10000)

### CORS Configuration
Allowed origins:
- http://localhost:5173 (development)
- https://arashmohsenijam.github.io (production)

## Directory Structure

\`\`\`
FarsiTranscriberServer/
├── server.js          # Main server file
├── uploads/           # Temporary upload directory
├── optimized/         # Optimized audio files
├── package.json       # Dependencies and scripts
├── .env              # Environment variables
└── README.md         # Documentation
\`\`\`

## Error Handling

The server implements comprehensive error handling:

1. **File Upload Errors**:
   - File size limits
   - File type validation
   - Upload interruption

2. **Processing Errors**:
   - FFmpeg optimization failures
   - OpenAI API errors
   - Network issues

3. **Resource Management**:
   - Automatic file cleanup
   - Process termination handling
   - Memory management

## Deployment

### Render Deployment
1. Connect GitHub repository
2. Configure environment variables
3. Set build command
4. Configure start command

### Environment Setup
Required environment variables in Render:
- `OPENAI_API_KEY`
- `PORT`

## Development

### Running Locally
1. Start in development mode:
   \`\`\`bash
   node server.js
   \`\`\`

2. Watch for changes:
   \`\`\`bash
   nodemon server.js
   \`\`\`

### Testing
1. Test API endpoints:
   \`\`\`bash
   curl -X POST -F "file=@test.mp3" http://localhost:10000/api/transcribe
   \`\`\`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details

## Support

For support, email [your-email@example.com] or create an issue in the repository.

## Acknowledgments

- OpenAI for Whisper and o1-mini models
- FFmpeg for audio processing
- All contributors and users of the application
