const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const path = require('path');
const fs = require('fs').promises;
const { logger, ErrorHandler } = require('../utils/logger');
const config = require('../config');

ffmpeg.setFfmpegPath(ffmpegStatic);

class VideoEditor {
  constructor() {
    this.tempDir = config.paths.temp;
    this.outputDir = config.paths.videoOutput;
  }

  async ensureDirectories() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
      await fs.mkdir(this.outputDir, { recursive: true });
      await fs.mkdir(path.join(this.tempDir, 'audio'), { recursive: true });
      await fs.mkdir(path.join(this.tempDir, 'video'), { recursive: true });
    } catch (error) {
      logger.error('创建目录失败', { error: error.message });
    }
  }

  async createVideoFromScript(scriptData, options = {}) {
    return ErrorHandler.safeExecute(async () => {
      await this.ensureDirectories();
      
      const {
        title,
        script,
        duration = 60,
        resolution = '1080x1920',
        fps = 30
      } = { ...scriptData, ...options };

      logger.info('开始创建视频', { title, duration });

      const outputPath = path.join(this.outputDir, `${this.sanitizeFilename(title)}.mp4`);
      
      const scenes = this.parseScript(script);
      const videoSegments = [];

      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const segmentPath = await this.createSceneVideo(scene, i, duration / scenes.length);
        videoSegments.push(segmentPath);
      }

      const finalVideo = await this.concatenateVideos(videoSegments, outputPath);
      
      await this.cleanup(videoSegments);
      
      logger.info('视频创建完成', { output: finalVideo });
      return finalVideo;
    }, 'createVideoFromScript');
  }

  parseScript(script) {
    const sentences = script.split('. ').filter(s => s.trim().length > 0);
    return sentences.map((sentence, index) => ({
      id: index,
      text: sentence.trim(),
      duration: 3 + Math.random() * 2
    }));
  }

  async createSceneVideo(scene, index, maxDuration) {
    return ErrorHandler.safeExecute(async () => {
      const scenePath = path.join(this.tempDir, 'video', `scene_${index}.mp4`);
      
      return new Promise((resolve, reject) => {
        ffmpeg()
          .input('color=c=black:s=1080x1920:d=' + Math.min(scene.duration, maxDuration))
          .inputFormat('lavfi')
          .videoFilter([
            `drawtext=fontfile=/System/Library/Fonts/Arial.ttf:text='${scene.text.replace(/'/g, "\\'")}':fontcolor=white:fontsize=60:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,0,${Math.min(scene.duration, maxDuration)})'`
          ])
          .outputOptions([
            '-pix_fmt yuv420p',
            '-r 30'
          ])
          .output(scenePath)
          .on('end', () => {
            logger.debug(`场景 ${index} 创建完成`);
            resolve(scenePath);
          })
          .on('error', reject)
          .run();
      });
    }, `createSceneVideo-${index}`, null);
  }

  async concatenateVideos(videoPaths, outputPath) {
    return ErrorHandler.safeExecute(async () => {
      const listFile = path.join(this.tempDir, 'concat_list.txt');
      const listContent = videoPaths
        .filter(p => p) 
        .map(p => `file '${p}'`)
        .join('\n');
      
      await fs.writeFile(listFile, listContent);

      return new Promise((resolve, reject) => {
        ffmpeg()
          .input(listFile)
          .inputOptions(['-f concat', '-safe 0'])
          .outputOptions([
            '-c copy',
            '-movflags faststart'
          ])
          .output(outputPath)
          .on('end', () => {
            logger.info('视频合并完成', { output: outputPath });
            resolve(outputPath);
          })
          .on('error', reject)
          .run();
      });
    }, 'concatenateVideos');
  }

  async addBackgroundMusic(videoPath, musicPath, options = {}) {
    return ErrorHandler.safeExecute(async () => {
      const outputPath = videoPath.replace('.mp4', '_with_music.mp4');
      const { volume = 0.3, fadeIn = 2, fadeOut = 2 } = options;

      return new Promise((resolve, reject) => {
        ffmpeg()
          .input(videoPath)
          .input(musicPath)
          .complexFilter([
            `[1:a]volume=${volume},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=-${fadeOut}:d=${fadeOut}[music]`,
            `[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[audio]`
          ])
          .outputOptions([
            '-map 0:v',
            '-map [audio]',
            '-c:v copy',
            '-c:a aac'
          ])
          .output(outputPath)
          .on('end', () => {
            logger.info('背景音乐添加完成', { output: outputPath });
            resolve(outputPath);
          })
          .on('error', reject)
          .run();
      });
    }, 'addBackgroundMusic');
  }

  async addSubtitles(videoPath, subtitles, options = {}) {
    return ErrorHandler.safeExecute(async () => {
      const outputPath = videoPath.replace('.mp4', '_with_subs.mp4');
      const { fontSize = 40, fontColor = 'white' } = options;

      const subtitleFilter = subtitles.map((sub, index) => {
        return `drawtext=fontfile=/System/Library/Fonts/Arial.ttf:text='${sub.text.replace(/'/g, "\\'")}':fontcolor=${fontColor}:fontsize=${fontSize}:x=(w-text_w)/2:y=h-text_h-50:enable='between(t,${sub.start},${sub.end})'`;
      }).join(',');

      return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .videoFilter(subtitleFilter)
          .output(outputPath)
          .on('end', () => {
            logger.info('字幕添加完成', { output: outputPath });
            resolve(outputPath);
          })
          .on('error', reject)
          .run();
      });
    }, 'addSubtitles');
  }

  async createThumbnail(videoPath, timestamp = '00:00:01') {
    return ErrorHandler.safeExecute(async () => {
      const thumbnailPath = videoPath.replace('.mp4', '_thumbnail.jpg');

      return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .seekInput(timestamp)
          .outputOptions([
            '-vframes 1',
            '-q:v 2'
          ])
          .output(thumbnailPath)
          .on('end', () => {
            logger.info('缩略图创建完成', { output: thumbnailPath });
            resolve(thumbnailPath);
          })
          .on('error', reject)
          .run();
      });
    }, 'createThumbnail');
  }

  async optimizeForPlatform(videoPath, platform = 'youtube') {
    const platforms = {
      youtube: {
        resolution: '1920x1080',
        bitrate: '8000k',
        format: 'mp4'
      },
      shorts: {
        resolution: '1080x1920',
        bitrate: '6000k',
        format: 'mp4'
      },
      tiktok: {
        resolution: '1080x1920',
        bitrate: '4000k',
        format: 'mp4'
      }
    };

    return ErrorHandler.safeExecute(async () => {
      const settings = platforms[platform] || platforms.youtube;
      const outputPath = videoPath.replace('.mp4', `_${platform}.mp4`);

      return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .size(settings.resolution)
          .videoBitrate(settings.bitrate)
          .outputOptions([
            '-c:v libx264',
            '-preset medium',
            '-crf 23',
            '-movflags faststart'
          ])
          .output(outputPath)
          .on('end', () => {
            logger.info(`${platform}优化完成`, { output: outputPath });
            resolve(outputPath);
          })
          .on('error', reject)
          .run();
      });
    }, `optimizeForPlatform-${platform}`);
  }

  sanitizeFilename(filename) {
    return filename.replace(/[^a-z0-9\u4e00-\u9fff]/gi, '_').substring(0, 100);
  }

  async cleanup(filePaths) {
    for (const filePath of filePaths) {
      try {
        if (filePath) {
          await fs.unlink(filePath);
          logger.debug('临时文件已删除', { file: filePath });
        }
      } catch (error) {
        logger.warn('删除临时文件失败', { file: filePath, error: error.message });
      }
    }
  }

  async getVideoInfo(videoPath) {
    return ErrorHandler.safeExecute(async () => {
      return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
          if (err) reject(err);
          else resolve(metadata);
        });
      });
    }, 'getVideoInfo');
  }
}

module.exports = VideoEditor;