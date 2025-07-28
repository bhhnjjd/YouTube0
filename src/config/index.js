const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

class Config {
  constructor() {
    // 基础配置
    this.env = process.env.NODE_ENV || 'production';
    this.port = parseInt(process.env.PORT) || 3000;

    // OpenAI配置
    this.openai = {
      apiKey: process.env.OPENAI_API_KEY,
      endpoint: process.env.OPENAI_API_ENDPOINT || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL || 'gpt-4',
      maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 2000,
      temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7
    };

    // YouTube配置
    this.youtube = {
      clientId: process.env.YOUTUBE_CLIENT_ID,
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
      redirectUri: process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3000/auth/callback'
    };

    // 数据库配置
    this.database = {
      url: process.env.DATABASE_URL,
      postgres: {
        password: process.env.POSTGRES_PASSWORD
      }
    };

    // Redis配置
    this.redis = {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      password: process.env.REDIS_PASSWORD,
      host: this.parseRedisUrl(process.env.REDIS_URL).host,
      port: this.parseRedisUrl(process.env.REDIS_URL).port
    };

    // 文件路径配置
    this.paths = {
      videoInput: process.env.VIDEO_INPUT_DIR || './videos/input',
      videoOutput: process.env.VIDEO_OUTPUT_DIR || './videos/output',
      temp: process.env.TEMP_DIR || './temp',
      data: process.env.DATA_DIR || './data'
    };

    // 日志配置
    this.logging = {
      level: process.env.LOG_LEVEL || 'info',
      file: process.env.LOG_FILE || './logs/app.log'
    };

    // 自动化配置
    this.automation = {
      autoPublish: process.env.AUTO_PUBLISH === 'true',
      checkInterval: parseInt(process.env.CHECK_INTERVAL) || 7200000,
      maxVideosPerDay: parseInt(process.env.MAX_VIDEOS_PER_DAY) || 5
    };

    // 缓存配置
    this.cache = {
      ttl: parseInt(process.env.CACHE_TTL) || 3600,
      trendCacheTtl: parseInt(process.env.TREND_CACHE_TTL) || 1800,
      aiCacheTtl: parseInt(process.env.AI_CACHE_TTL) || 86400
    };

    // 性能配置
    this.performance = {
      maxMemoryUsage: parseInt(process.env.MAX_MEMORY_USAGE) || 1024,
      videoQuality: process.env.VIDEO_QUALITY || 'medium',
      enableGpuAcceleration: process.env.ENABLE_GPU_ACCELERATION === 'true',
      maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS) || 3
    };

    // Web应用配置
    this.web = {
      port: this.port,
      sessionSecret: process.env.SESSION_SECRET,
      jwtSecret: process.env.JWT_SECRET,
      corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      helmetEnabled: process.env.HELMET_ENABLED !== 'false',
      rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 900000,
      rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 100
    };

    // 监控配置
    this.monitoring = {
      enableMetrics: process.env.ENABLE_METRICS === 'true',
      webhookUrl: process.env.WEBHOOK_URL,
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL
    };

    // 代理配置
    this.proxy = {
      http: process.env.HTTP_PROXY,
      https: process.env.HTTPS_PROXY
    };

    // 功能开关
    this.features = {
      enableTrendAnalysis: process.env.ENABLE_TREND_ANALYSIS !== 'false',
      enableVideoGeneration: process.env.ENABLE_VIDEO_GENERATION !== 'false',
      enableAutoUpload: process.env.ENABLE_AUTO_UPLOAD !== 'false',
      enableScheduler: process.env.ENABLE_SCHEDULER !== 'false'
    };

    this.validate();
  }

  parseRedisUrl(url) {
    if (!url) return { host: 'localhost', port: 6379 };
    
    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname,
        port: parseInt(parsed.port) || 6379
      };
    } catch {
      return { host: 'localhost', port: 6379 };
    }
  }

  validate() {
    const required = [
      'OPENAI_API_KEY',
      'YOUTUBE_CLIENT_ID',
      'YOUTUBE_CLIENT_SECRET'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0 && this.env === 'production') {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // 验证Web应用必需的密钥
    if (!this.web.sessionSecret && this.env === 'production') {
      console.warn('WARNING: SESSION_SECRET not set, using default (insecure)');
      this.web.sessionSecret = 'default-session-secret-change-in-production';
    }

    if (!this.web.jwtSecret && this.env === 'production') {
      console.warn('WARNING: JWT_SECRET not set, using default (insecure)');
      this.web.jwtSecret = 'default-jwt-secret-change-in-production';
    }
  }

  get(key) {
    return this[key];
  }

  // 获取所有配置的摘要（隐藏敏感信息）
  getSummary() {
    return {
      env: this.env,
      port: this.port,
      openai: {
        endpoint: this.openai.endpoint,
        model: this.openai.model,
        maxTokens: this.openai.maxTokens,
        temperature: this.openai.temperature
      },
      paths: this.paths,
      automation: this.automation,
      cache: this.cache,
      performance: this.performance,
      features: this.features,
      monitoring: {
        enableMetrics: this.monitoring.enableMetrics
      }
    };
  }

  // 检查功能是否启用
  isFeatureEnabled(feature) {
    return this.features[feature] === true;
  }

  // 获取完整的Redis配置
  getRedisConfig() {
    return {
      host: this.redis.host,
      port: this.redis.port,
      password: this.redis.password,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    };
  }
}

module.exports = new Config();