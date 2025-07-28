const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const YouTubeAutomation = require('../modules/automation');
const queueService = require('../services/queue');
const cacheService = require('../services/cache');
const metricsService = require('../services/metrics');
const accountManager = require('../services/youtubeAccountManager');
const { logger, ErrorHandler } = require('../utils/logger');
const config = require('../config');

class WebApplication {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: config.web.corsOrigin,
        methods: ["GET", "POST"]
      }
    });
    
    this.automation = new YouTubeAutomation();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketHandlers();
  }

  setupMiddleware() {
    if (config.web.helmetEnabled) {
      this.app.use(helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
          },
        },
      }));
    }

    this.app.use(cors({
      origin: config.web.corsOrigin,
      credentials: true
    }));

    this.app.use(compression());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    const limiter = rateLimit({
      windowMs: config.web.rateLimitWindow,
      max: config.web.rateLimitMax,
      message: { error: '请求过于频繁，请稍后再试' }
    });
    this.app.use('/api/', limiter);

    this.app.use(express.static(path.join(__dirname, '../web/public')));

    this.app.use((req, res, next) => {
      logger.info('HTTP请求', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
  }

  setupRoutes() {
    // 首页
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../web/public/index.html'));
    });

    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });

    // API路由
    this.setupAPIRoutes();

    // 错误处理
    this.app.use((err, req, res, next) => {
      ErrorHandler.handle(err, `Web应用错误: ${req.url}`);
      res.status(500).json({ 
        error: '服务器内部错误',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    });

    // 404处理
    this.app.use((req, res) => {
      res.status(404).json({ error: '页面未找到' });
    });
  }

  setupAPIRoutes() {
    const router = express.Router();

    // 系统状态
    router.get('/status', async (req, res) => {
      try {
        const [systemStatus, queueStats] = await Promise.all([
          this.automation.getSystemStatus(),
          queueService.getAllStats()
        ]);

        res.json({
          ...systemStatus,
          queues: queueStats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        ErrorHandler.handle(error, 'API: 获取系统状态');
        res.status(500).json({ error: '获取系统状态失败' });
      }
    });

    // 系统指标
    router.get('/metrics', (req, res) => {
      try {
        const format = req.query.format === 'prometheus' ? 'prometheus' : 'json';
        const data = metricsService.exportMetrics(format);
        if (format === 'prometheus') {
          res.type('text/plain').send(data);
        } else {
          res.type('application/json').send(data);
        }
      } catch (error) {
        ErrorHandler.handle(error, 'API: 获取指标');
        res.status(500).json({ error: '获取指标失败' });
      }
    });

    // 趋势分析
    router.get('/trends', async (req, res) => {
      try {
        const cacheKey = cacheService.getCacheKey('trends', 'latest');
        const trends = await cacheService.getOrSet(
          cacheKey,
          () => this.automation.analyzeTrends(),
          config.cache.trendCacheTtl
        );

        res.json(trends);
      } catch (error) {
        ErrorHandler.handle(error, 'API: 获取趋势分析');
        res.status(500).json({ error: '获取趋势分析失败' });
      }
    });

    // 生成内容创意
    router.post('/ideas', [
      body('count').optional().isInt({ min: 1, max: 20 }).toInt()
    ], async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }

        const { count = 5 } = req.body;
        const ideas = await this.automation.generateContentIdeas(count);

        res.json(ideas);
      } catch (error) {
        ErrorHandler.handle(error, 'API: 生成内容创意');
        res.status(500).json({ error: '生成内容创意失败' });
      }
    });

    // 创建视频任务
    router.post('/video/create', [
      body('scriptData').isObject(),
      body('options').optional().isObject()
    ], async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }

        const { scriptData, options = {} } = req.body;
        
        const job = await queueService.addVideoGenerationJob(scriptData, options);
        
        res.json({
          success: true,
          jobId: job.id,
          message: '视频创建任务已提交'
        });

        // 通知WebSocket客户端
        this.io.emit('jobCreated', {
          type: 'videoGeneration',
          jobId: job.id,
          data: { title: scriptData.title }
        });

      } catch (error) {
        ErrorHandler.handle(error, 'API: 创建视频任务');
        res.status(500).json({ error: '创建视频任务失败' });
      }
    });

    // 获取任务状态
    router.get('/job/:queue/:id', async (req, res) => {
      try {
        const { queue, id } = req.params;
        const status = await queueService.getJobStatus(queue, id);
        
        if (!status) {
          return res.status(404).json({ error: '任务未找到' });
        }

        res.json(status);
      } catch (error) {
        ErrorHandler.handle(error, 'API: 获取任务状态');
        res.status(500).json({ error: '获取任务状态失败' });
      }
    });

    // 队列管理
    router.post('/queue/:name/pause', async (req, res) => {
      try {
        await queueService.pauseQueue(req.params.name);
        res.json({ success: true, message: '队列已暂停' });
      } catch (error) {
        ErrorHandler.handle(error, 'API: 暂停队列');
        res.status(500).json({ error: '暂停队列失败' });
      }
    });

    router.post('/queue/:name/resume', async (req, res) => {
      try {
        await queueService.resumeQueue(req.params.name);
        res.json({ success: true, message: '队列已恢复' });
      } catch (error) {
        ErrorHandler.handle(error, 'API: 恢复队列');
        res.status(500).json({ error: '恢复队列失败' });
      }
    });

    router.delete('/queue/:name', async (req, res) => {
      try {
        await queueService.clearQueue(req.params.name);
        res.json({ success: true, message: '队列已清空' });
      } catch (error) {
        ErrorHandler.handle(error, 'API: 清空队列');
        res.status(500).json({ error: '清空队列失败' });
      }
    });

    // 自动化控制
    router.post('/automation/start', async (req, res) => {
      try {
        this.automation.startAutomation();
        res.json({ success: true, message: '自动化已启动' });
      } catch (error) {
        ErrorHandler.handle(error, 'API: 启动自动化');
        res.status(500).json({ error: '启动自动化失败' });
      }
    });

    router.post('/automation/stop', async (req, res) => {
      try {
        this.automation.stopAutomation();
        res.json({ success: true, message: '自动化已停止' });
      } catch (error) {
        ErrorHandler.handle(error, 'API: 停止自动化');
        res.status(500).json({ error: '停止自动化失败' });
      }
    });

    // 手动执行单次循环
    router.post('/automation/run-once', async (req, res) => {
      try {
        const result = await this.automation.runSingleCycle();
        res.json({ 
          success: true, 
          result,
          message: result ? '任务执行成功' : '没有创建新视频'
        });
      } catch (error) {
        ErrorHandler.handle(error, 'API: 执行单次循环');
        res.status(500).json({ error: '执行单次循环失败' });
      }
    });

    // YouTube认证
    router.get('/youtube/auth-url', (req, res) => {
      try {
        const authUrl = this.automation.youtubeService.getAuthUrl();
        res.json({ authUrl });
      } catch (error) {
        ErrorHandler.handle(error, 'API: 获取YouTube认证URL');
        res.status(500).json({ error: '获取认证URL失败' });
      }
    });

    // 获取账户列表
    router.get('/youtube/accounts', async (req, res) => {
      try {
        const accounts = await accountManager.listAccounts();
        res.json({
          accounts,
          active: accountManager.getActiveAccount()
        });
      } catch (error) {
        ErrorHandler.handle(error, 'API: 获取账户列表');
        res.status(500).json({ error: '获取账户列表失败' });
      }
    });

    // 切换活跃账户
    router.post('/youtube/accounts/switch', [
      body('name').notEmpty().trim()
    ], async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }
        await accountManager.setActiveAccount(req.body.name);
        await this.automation.youtubeService.initialize();
        res.json({ success: true, message: '已切换账户', active: req.body.name });
      } catch (error) {
        ErrorHandler.handle(error, 'API: 切换账户');
        res.status(500).json({ error: '切换账户失败' });
      }
    });

    router.post('/youtube/authenticate', [
      body('code').notEmpty().trim(),
      body('account').optional().trim()
    ], async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }

        const { code, account = 'default' } = req.body;
        const success = await this.automation.authenticateYouTube(code, account);
        
        if (success) {
          res.json({ success: true, message: 'YouTube认证成功' });
        } else {
          res.status(400).json({ error: 'YouTube认证失败' });
        }
      } catch (error) {
        ErrorHandler.handle(error, 'API: YouTube认证');
        res.status(500).json({ error: 'YouTube认证失败' });
      }
    });

    this.app.use('/api', router);
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      logger.info('WebSocket客户端连接', { socketId: socket.id });

      socket.on('disconnect', () => {
        logger.info('WebSocket客户端断开', { socketId: socket.id });
      });

      socket.on('getSystemStatus', async () => {
        try {
          const status = await this.automation.getSystemStatus();
          socket.emit('systemStatus', status);
        } catch (error) {
          socket.emit('error', { message: '获取系统状态失败' });
        }
      });

      socket.on('getQueueStats', async () => {
        try {
          const stats = await queueService.getAllStats();
          socket.emit('queueStats', stats);
        } catch (error) {
          socket.emit('error', { message: '获取队列状态失败' });
        }
      });
    });

    // 定期广播系统状态
    setInterval(async () => {
      try {
        const [systemStatus, queueStats] = await Promise.all([
          this.automation.getSystemStatus(),
          queueService.getAllStats()
        ]);

        this.io.emit('systemUpdate', {
          ...systemStatus,
          queues: queueStats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error('定期状态更新失败', { error: error.message });
      }
    }, 10000); // 每10秒更新一次
  }

  async start(port = config.web.port) {
    try {
      await this.automation.initialize();
      
      this.server.listen(port, () => {
        logger.info(`Web应用启动成功`, { port });
        logger.info(`访问地址: http://localhost:${port}`);
      });

      // 优雅关闭
      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());

    } catch (error) {
      ErrorHandler.handle(error, 'Web应用启动失败');
      process.exit(1);
    }
  }

  async shutdown() {
    logger.info('正在关闭Web应用...');
    
    try {
      this.server.close();
      await this.automation.cleanup();
      await queueService.close();
      await cacheService.disconnect();
      
      logger.info('Web应用已优雅关闭');
      process.exit(0);
    } catch (error) {
      logger.error('关闭应用时出错', { error: error.message });
      process.exit(1);
    }
  }
}

module.exports = WebApplication;