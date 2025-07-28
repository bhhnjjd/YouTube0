const cron = require('node-cron');
const TrendAnalyzer = require('./services/trendAnalyzer');
const OpenAIService = require('./services/openai');
const VideoEditor = require('./services/videoEditor');
const YouTubeService = require('./services/youtube');
const { logger, ErrorHandler } = require('./utils/logger');
const config = require('./config');

class YouTubeAutomation {
  constructor() {
    this.trendAnalyzer = new TrendAnalyzer();
    this.openaiService = new OpenAIService();
    this.videoEditor = new VideoEditor();
    this.youtubeService = new YouTubeService();
    
    this.isRunning = false;
    this.videoCount = 0;
    this.maxVideosPerDay = config.automation.maxVideosPerDay;
  }

  async initialize() {
    try {
      logger.info('初始化YouTube自动化系统...');
      
      await this.trendAnalyzer.init();
      await this.youtubeService.initialize();
      
      if (!this.youtubeService.isAuthenticated) {
        logger.warn('YouTube未认证，请先完成认证流程');
        logger.info('认证URL:', this.youtubeService.getAuthUrl());
        return false;
      }
      
      logger.info('系统初始化完成');
      return true;
    } catch (error) {
      ErrorHandler.handle(error, 'YouTube自动化系统初始化失败');
      return false;
    }
  }

  async authenticateYouTube(authCode) {
    try {
      await this.youtubeService.authenticate(authCode);
      logger.info('YouTube认证完成');
      return true;
    } catch (error) {
      ErrorHandler.handle(error, 'YouTube认证失败');
      return false;
    }
  }

  async createAndPublishVideo() {
    if (this.videoCount >= this.maxVideosPerDay) {
      logger.info('今日视频发布数量已达上限');
      return null;
    }

    return ErrorHandler.safeExecute(async () => {
      logger.info('开始创建新视频...');

      const contentIdeas = await this.trendAnalyzer.generateContentIdeas(1);
      
      if (!contentIdeas.ideas || contentIdeas.ideas.length === 0) {
        throw new Error('无法生成内容创意');
      }

      const idea = contentIdeas.ideas[0];
      logger.info('选择的内容创意:', { title: idea.title });

      let scriptData;
      if (idea.raw) {
        try {
          scriptData = JSON.parse(idea.script);
        } catch {
          scriptData = {
            title: '热门话题视频',
            script: idea.script,
            description: '基于当前热门趋势的视频内容',
            tags: ['热门', '趋势', '话题']
          };
        }
      } else {
        scriptData = idea;
      }

      const videoPath = await this.videoEditor.createVideoFromScript(scriptData, {
        duration: 60,
        resolution: '1080x1920'
      });

      if (!videoPath) {
        throw new Error('视频创建失败');
      }

      const optimizedVideoPath = await this.videoEditor.optimizeForPlatform(videoPath, 'shorts');
      const thumbnailPath = await this.videoEditor.createThumbnail(optimizedVideoPath || videoPath);

      const optimizedMetadata = await this.openaiService.optimizeVideoMetadata(
        scriptData.title,
        scriptData.description,
        scriptData.tags || []
      );

      let metadata;
      try {
        metadata = typeof optimizedMetadata === 'string' 
          ? JSON.parse(optimizedMetadata) 
          : optimizedMetadata;
      } catch {
        metadata = {
          optimized_title: scriptData.title,
          optimized_description: scriptData.description,
          optimized_tags: scriptData.tags || []
        };
      }

      const uploadResult = await this.youtubeService.uploadVideo(
        optimizedVideoPath || videoPath,
        {
          title: metadata.optimized_title || scriptData.title,
          description: metadata.optimized_description || scriptData.description,
          tags: metadata.optimized_tags || scriptData.tags || [],
          privacyStatus: config.automation.autoPublish ? 'public' : 'private',
          thumbnailPath
        }
      );

      this.videoCount++;
      
      logger.info('视频创建并上传成功', {
        videoId: uploadResult.videoId,
        url: uploadResult.url,
        title: uploadResult.title,
        count: this.videoCount
      });

      return uploadResult;
    }, 'createAndPublishVideo');
  }

  async runSingleCycle() {
    logger.info('执行单次自动化循环...');
    
    try {
      const result = await this.createAndPublishVideo();
      
      if (result) {
        logger.info('单次循环执行成功', { videoUrl: result.url });
      } else {
        logger.info('单次循环未创建新视频');
      }
      
      return result;
    } catch (error) {
      ErrorHandler.handle(error, '单次循环执行失败');
      return null;
    }
  }

  startAutomation() {
    if (this.isRunning) {
      logger.warn('自动化已在运行中');
      return;
    }

    this.isRunning = true;
    logger.info('启动自动化定时任务...');

    cron.schedule('0 */2 * * *', async () => {
      logger.info('定时任务触发');
      await this.createAndPublishVideo();
    });

    cron.schedule('0 0 * * *', () => {
      this.videoCount = 0;
      logger.info('每日视频计数器重置');
    });

    logger.info('自动化定时任务已启动（每2小时检查一次）');
  }

  stopAutomation() {
    this.isRunning = false;
    logger.info('自动化任务已停止');
  }

  async getSystemStatus() {
    return {
      isRunning: this.isRunning,
      videoCount: this.videoCount,
      maxVideosPerDay: this.maxVideosPerDay,
      isYouTubeAuthenticated: this.youtubeService.isAuthenticated,
      config: {
        autoPublish: config.automation.autoPublish,
        checkInterval: config.automation.checkInterval
      }
    };
  }

  async analyzeTrends() {
    logger.info('分析当前趋势...');
    return await this.trendAnalyzer.getTopicTrends();
  }

  async generateContentIdeas(count = 5) {
    logger.info(`生成${count}个内容创意...`);
    return await this.trendAnalyzer.generateContentIdeas(count);
  }

  async cleanup() {
    if (this.trendAnalyzer) {
      await this.trendAnalyzer.close();
    }
    logger.info('系统清理完成');
  }
}

module.exports = YouTubeAutomation;