const ffmpeg = require('fluent-ffmpeg');
const path = require('path');

function optimizeAudio(inputPath) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(
      path.dirname(inputPath),
      `${path.basename(inputPath, path.extname(inputPath))}_optimized.mp3`
    );

    ffmpeg(inputPath)
      .toFormat('mp3')
      .audioBitrate('128k')
      .audioChannels(1)
      .audioFrequency(16000)
      .on('end', () => {
        console.log('Audio optimization complete');
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Error optimizing audio:', err);
        reject(err);
      })
      .save(outputPath);
  });
}

module.exports = { optimizeAudio };
