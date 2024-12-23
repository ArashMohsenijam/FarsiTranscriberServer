import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Re-encodes an audio file to optimize it for Whisper API
 * Uses Opus codec with low bitrate while maintaining voice quality
 * @param {string} inputPath - Path to the input audio file
 * @returns {Promise<string>} Path to the optimized audio file
 */
export async function optimizeAudioForWhisper(inputPath) {
    const outputPath = path.join(
        path.dirname(inputPath),
        `optimized-${path.basename(inputPath, path.extname(inputPath))}.ogg`
    );

    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .toFormat('ogg')
            .audioChannels(1) // Mono
            .audioCodec('libopus')
            .audioBitrate('12k')
            .addOutputOption('-application', 'voip')
            .addOutputOption('-map_metadata', '-1') // Remove metadata
            .on('end', () => {
                // Delete the original file after successful conversion
                fs.unlink(inputPath)
                    .then(() => resolve(outputPath))
                    .catch(error => {
                        console.warn('Failed to delete original file:', error);
                        resolve(outputPath);
                    });
            })
            .on('error', (err) => {
                reject(new Error(`Failed to process audio: ${err.message}`));
            })
            .save(outputPath);
    });
}

/**
 * Cleans up temporary audio files
 * @param {string} filePath - Path to the file to delete
 */
export async function cleanupAudioFile(filePath) {
    try {
        await fs.unlink(filePath);
    } catch (error) {
        console.warn('Failed to cleanup audio file:', error);
    }
}
