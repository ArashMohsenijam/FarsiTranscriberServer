export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  if (err.name === 'MulterError') {
    return res.status(400).json({
      error: 'File upload error',
      message: err.message,
    });
  }

  if (err.isAxiosError) {
    return res.status(err.response?.status || 500).json({
      error: 'Transcription service error',
      message: err.response?.data?.error?.message || 'Failed to transcribe audio',
    });
  }

  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
};