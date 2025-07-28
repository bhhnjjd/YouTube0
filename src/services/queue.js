const Bull = require('bull');
const config = require('../config');
const { logger } = require('../utils/logger');

class QueueService {
  constructor() {
    this.queues = {};
    this.init();
  }

  init() {
    const redisConfig = {
      redis: {
        port: config.redis.port,
        host: config.redis.host,
        password: config.redis.password
      }
    };

    this.queues.videoGeneration = new Bull('video generation', redisConfig);
    this.queues.trendAnalysis = new Bull('trend analysis', redisConfig);
    this.queues.videoUpload = new Bull('video upload', redisConfig);
    this.queues.aiProcessing = new Bull('ai processing', redisConfig);

    this.setupProcessors();
    this.setupEventHandlers();
  }

  setupProcessors() {
    this.queues.videoGeneration.process(config.performance.maxConcurrentJobs, async (job) => {
      const { VideoEditor } = require('./videoEditor');
      const videoEditor = new VideoEditor();
      
      logger.info('开始处理视频生成任务', { jobId: job.id });
      job.progress(10);

      const result = await videoEditor.createVideoFromScript(job.data.scriptData, job.data.options);
      job.progress(100);

      return result;
    });

    this.queues.trendAnalysis.process(1, async (job) => {
      const TrendAnalyzer = require('./trendAnalyzer');
      const analyzer = new TrendAnalyzer();
      
      logger.info('开始处理趋势分析任务', { jobId: job.id });
      job.progress(10);

      await analyzer.init();
      const result = await analyzer.getTopicTrends();
      await analyzer.close();
      
      job.progress(100);
      return result;
    });

    this.queues.videoUpload.process(2, async (job) => {
      const YouTubeService = require('./youtube');
      const youtubeService = new YouTubeService();
      
      logger.info('开始处理视频上传任务', { jobId: job.id });
      job.progress(10);

      await youtubeService.initialize();
      const result = await youtubeService.uploadVideo(job.data.videoPath, job.data.metadata);
      
      job.progress(100);
      return result;
    });

    this.queues.aiProcessing.process(3, async (job) => {
      const OpenAIService = require('./openai');
      const openaiService = new OpenAIService();
      
      logger.info('开始处理AI任务', { jobId: job.id, type: job.data.type });
      job.progress(10);

      let result;
      switch (job.data.type) {
        case 'generateScript':
          result = await openaiService.generateVideoScript(job.data.topic, job.data.duration);
          break;
        case 'optimizeMetadata':
          result = await openaiService.optimizeVideoMetadata(
            job.data.title, 
            job.data.description, 
            job.data.tags
          );
          break;
        case 'analyzeTrends':
          result = await openaiService.analyzeVideoTrends(job.data.trendingData);
          break;
        default:
          throw new Error(`未知的AI任务类型: ${job.data.type}`);
      }
      
      job.progress(100);
      return result;
    });
  }

  setupEventHandlers() {
    Object.entries(this.queues).forEach(([name, queue]) => {
      queue.on('completed', (job, result) => {
        logger.info(`队列 ${name} 任务完成`, { 
          jobId: job.id, 
          duration: Date.now() - job.timestamp 
        });
      });

      queue.on('failed', (job, err) => {
        logger.error(`队列 ${name} 任务失败`, { 
          jobId: job.id, 
          error: err.message,
          duration: Date.now() - job.timestamp
        });
      });

      queue.on('stalled', (job) => {
        logger.warn(`队列 ${name} 任务停滞`, { jobId: job.id });
      });
    });
  }

  async addVideoGenerationJob(scriptData, options = {}, priority = 0) {
    const job = await this.queues.videoGeneration.add(
      'generateVideo',
      { scriptData, options },
      {
        priority,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: 10,
        removeOnFail: 5
      }
    );

    logger.info('视频生成任务已添加到队列', { jobId: job.id });
    return job;
  }

  async addTrendAnalysisJob(priority = 0) {
    const job = await this.queues.trendAnalysis.add(
      'analyzeTrends',
      {},
      {
        priority,
        attempts: 2,
        backoff: {
          type: 'fixed',
          delay: 5000
        },
        removeOnComplete: 5,
        removeOnFail: 3
      }
    );

    logger.info('趋势分析任务已添加到队列', { jobId: job.id });
    return job;
  }

  async addVideoUploadJob(videoPath, metadata, priority = 0) {
    const job = await this.queues.videoUpload.add(
      'uploadVideo',
      { videoPath, metadata },
      {
        priority,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 3000
        },
        removeOnComplete: 10,
        removeOnFail: 5
      }
    );

    logger.info('视频上传任务已添加到队列', { jobId: job.id });
    return job;
  }

  async addAIProcessingJob(type, data, priority = 0) {
    const job = await this.queues.aiProcessing.add(
      type,
      { type, ...data },
      {
        priority,
        attempts: 2,
        backoff: {
          type: 'fixed',
          delay: 1000
        },
        removeOnComplete: 20,
        removeOnFail: 10
      }
    );

    logger.info('AI处理任务已添加到队列', { jobId: job.id, type });
    return job;
  }

  async getJobStatus(queueName, jobId) {
    if (!this.queues[queueName]) {
      throw new Error(`队列不存在: ${queueName}`);
    }

    const job = await this.queues[queueName].getJob(jobId);
    if (!job) {
      return null;
    }

    return {
      id: job.id,
      data: job.data,
      progress: job.progress(),
      state: await job.getState(),
      createdAt: new Date(job.timestamp),
      processedAt: job.processedOn ? new Date(job.processedOn) : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
      failedReason: job.failedReason,
      returnValue: job.returnvalue
    };
  }

  async getQueueStats(queueName) {
    if (!this.queues[queueName]) {
      throw new Error(`队列不存在: ${queueName}`);
    }

    const queue = this.queues[queueName];
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed()
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length
    };
  }

  async getAllStats() {
    const stats = {};
    
    for (const [name, queue] of Object.entries(this.queues)) {
      stats[name] = await this.getQueueStats(name);
    }
    
    return stats;
  }

  async clearQueue(queueName) {
    if (!this.queues[queueName]) {
      throw new Error(`队列不存在: ${queueName}`);
    }

    await this.queues[queueName].empty();
    logger.info(`队列 ${queueName} 已清空`);
  }

  async pauseQueue(queueName) {
    if (!this.queues[queueName]) {
      throw new Error(`队列不存在: ${queueName}`);
    }

    await this.queues[queueName].pause();
    logger.info(`队列 ${queueName} 已暂停`);
  }

  async resumeQueue(queueName) {
    if (!this.queues[queueName]) {
      throw new Error(`队列不存在: ${queueName}`);
    }

    await this.queues[queueName].resume();
    logger.info(`队列 ${queueName} 已恢复`);
  }

  async close() {
    const closePromises = Object.values(this.queues).map(queue => queue.close());
    await Promise.all(closePromises);
    logger.info('所有队列已关闭');
  }
}

module.exports = new QueueService();