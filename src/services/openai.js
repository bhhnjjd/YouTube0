const axios = require('axios');
const config = require('../config');
const cacheService = require('./cache');
const { logger, ErrorHandler } = require('../utils/logger');

class OpenAIService {
  constructor() {
    this.apiKey = config.openai.apiKey;
    this.endpoint = config.openai.endpoint;
    this.model = config.openai.model;
    this.costTracker = {
      totalTokens: 0,
      totalCost: 0,
      requests: 0
    };
    
    this.client = axios.create({
      baseURL: this.endpoint,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    // 成本计算（基于GPT-4价格，可根据实际模型调整）
    this.pricing = {
      'gpt-4': { input: 0.03, output: 0.06 }, // 每1K tokens的价格（美元）
      'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
      'default': { input: 0.01, output: 0.02 }
    };
  }

  async generateText(prompt, options = {}) {
    return ErrorHandler.safeExecute(async () => {
      // 检查缓存
      const cacheKey = cacheService.getCacheKey('ai_response', 
        this.hashString(prompt + JSON.stringify(options)));
      
      if (options.useCache !== false) {
        const cached = await cacheService.get(cacheKey);
        if (cached) {
          logger.info('使用缓存的AI响应', { cacheKey });
          return cached;
        }
      }

      // 优化token使用
      const optimizedOptions = this.optimizeTokenUsage(options);
      
      const response = await this.client.post('/chat/completions', {
        model: optimizedOptions.model || this.model,
        messages: [
          { role: 'user', content: this.optimizePrompt(prompt) }
        ],
        max_tokens: optimizedOptions.maxTokens || config.openai.maxTokens || 2000,
        temperature: optimizedOptions.temperature || config.openai.temperature || 0.7,
        top_p: 0.9, // 减少随机性以提高质量
        frequency_penalty: 0.1,
        presence_penalty: 0.1
      });

      const result = response.data.choices[0].message.content;
      const usage = response.data.usage;

      // 更新成本跟踪
      this.updateCostTracking(usage, optimizedOptions.model || this.model);

      logger.info('OpenAI API调用成功', { 
        model: optimizedOptions.model || this.model,
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        estimatedCost: this.calculateCost(usage, optimizedOptions.model || this.model)
      });

      // 缓存结果
      if (options.useCache !== false) {
        await cacheService.set(cacheKey, result, config.cache.aiCacheTtl);
      }

      return result;
    }, 'OpenAI generateText');
  }

  optimizePrompt(prompt) {
    // 移除多余的空白字符
    let optimized = prompt.replace(/\s+/g, ' ').trim();
    
    // 简化常用指令
    optimized = optimized.replace(/请你/g, '');
    optimized = optimized.replace(/帮我/g, '');
    optimized = optimized.replace(/你能/g, '');
    
    // 添加简洁性指令
    if (!optimized.includes('简洁') && !optimized.includes('concise')) {
      optimized += '\n\n请提供简洁准确的回复。';
    }
    
    return optimized;
  }

  optimizeTokenUsage(options) {
    const optimized = { ...options };
    
    // 根据内容类型调整最大token数
    if (options.contentType === 'title') {
      optimized.maxTokens = Math.min(optimized.maxTokens || 100, 100);
    } else if (options.contentType === 'description') {
      optimized.maxTokens = Math.min(optimized.maxTokens || 500, 500);
    } else if (options.contentType === 'script') {
      optimized.maxTokens = Math.min(optimized.maxTokens || 1500, 1500);
    }
    
    // 使用更便宜的模型处理简单任务
    if (options.complexity === 'simple' && !options.model) {
      optimized.model = 'gpt-3.5-turbo';
    }
    
    return optimized;
  }

  async analyzeVideoTrends(trendingData, useCache = true) {
    const cacheKey = cacheService.getCacheKey('trend_analysis', 
      this.hashString(JSON.stringify(trendingData)));
    
    if (useCache) {
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        logger.info('使用缓存的趋势分析');
        return cached;
      }
    }

    // 数据预处理，减少token使用
    const processedData = this.preprocessTrendData(trendingData);
    
    const prompt = `
    分析以下YouTube热门视频数据（已预处理），识别关键趋势：

    ${JSON.stringify(processedData, null, 2)}

    返回JSON格式：
    {
      "hotTopics": ["主题1", "主题2"],
      "contentTypes": ["类型1", "类型2"],
      "recommendations": ["建议1", "建议2"],
      "bestTimes": ["时间段1", "时间段2"]
    }
    `;

    const result = await this.generateText(prompt, { 
      contentType: 'analysis',
      complexity: 'medium',
      useCache: false
    });

    if (useCache) {
      await cacheService.set(cacheKey, result, config.cache.trendCacheTtl);
    }

    return result;
  }

  preprocessTrendData(data) {
    if (!Array.isArray(data)) return data;
    
    // 只保留关键信息，减少token使用
    return data.slice(0, 20).map(item => ({
      title: item.title?.substring(0, 100),
      views: item.views,
      type: item.type || 'video'
    }));
  }

  async generateVideoScript(topic, duration = 60, options = {}) {
    const cacheKey = cacheService.getCacheKey('video_script', 
      this.hashString(`${topic}_${duration}`));
    
    if (options.useCache !== false) {
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        logger.info('使用缓存的视频脚本');
        return cached;
      }
    }

    const prompt = `
    为"${topic}"创建${duration}秒视频脚本。

    要求：开头吸引人，有价值内容，结尾行动号召。

    JSON格式：
    {
      "title": "标题(不超过60字)",
      "description": "描述(不超过200字)",
      "script": "脚本内容",
      "tags": ["标签1", "标签2", "标签3"],
      "thumbnail_suggestions": "缩略图建议"
    }
    `;

    const result = await this.generateText(prompt, {
      contentType: 'script',
      complexity: 'medium',
      useCache: false,
      maxTokens: 1200
    });

    if (options.useCache !== false) {
      await cacheService.set(cacheKey, result, config.cache.aiCacheTtl);
    }

    return result;
  }

  async generateThumbnailPrompt(videoTitle, videoContent) {
    const prompt = `
    为"${videoTitle}"生成AI绘图提示词。

    内容：${videoContent.substring(0, 200)}...

    要求：视觉冲击力强，吸引点击，相关性强。

    返回英文提示词(不超过100词)。
    `;

    return this.generateText(prompt, {
      contentType: 'description',
      complexity: 'simple',
      model: 'gpt-3.5-turbo',
      maxTokens: 200
    });
  }

  async optimizeVideoMetadata(title, description, tags) {
    const cacheKey = cacheService.getCacheKey('metadata_optimization', 
      this.hashString(`${title}_${description}`));
    
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      logger.info('使用缓存的元数据优化');
      return cached;
    }

    const prompt = `
    优化YouTube视频元数据：

    标题：${title}
    描述：${description.substring(0, 300)}
    标签：${tags.join(', ')}

    JSON格式：
    {
      "optimized_title": "优化标题(不超过100字)",
      "optimized_description": "优化描述(不超过1000字)",
      "optimized_tags": ["标签1", "标签2", "标签3"],
      "seo_score": 85
    }
    `;

    const result = await this.generateText(prompt, {
      contentType: 'description',
      complexity: 'medium',
      maxTokens: 800
    });

    await cacheService.set(cacheKey, result, config.cache.aiCacheTtl);
    return result;
  }

  // 批量处理以减少API调用
  async batchProcess(tasks) {
    const results = [];
    const batchSize = 3; // 控制并发数
    
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(task => this.processTask(task))
      );
      results.push(...batchResults);
      
      // 添加延迟以避免触发频率限制
      if (i + batchSize < tasks.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }

  async processTask(task) {
    const { type, data } = task;
    
    switch (type) {
      case 'generateScript':
        return this.generateVideoScript(data.topic, data.duration);
      case 'optimizeMetadata':
        return this.optimizeVideoMetadata(data.title, data.description, data.tags);
      case 'analyzeTrends':
        return this.analyzeVideoTrends(data.trendingData);
      default:
        throw new Error(`未知任务类型: ${type}`);
    }
  }

  updateCostTracking(usage, model) {
    const pricing = this.pricing[model] || this.pricing.default;
    const inputCost = (usage.prompt_tokens / 1000) * pricing.input;
    const outputCost = (usage.completion_tokens / 1000) * pricing.output;
    const totalCost = inputCost + outputCost;
    
    this.costTracker.totalTokens += usage.total_tokens;
    this.costTracker.totalCost += totalCost;
    this.costTracker.requests += 1;
  }

  calculateCost(usage, model) {
    const pricing = this.pricing[model] || this.pricing.default;
    const inputCost = (usage.prompt_tokens / 1000) * pricing.input;
    const outputCost = (usage.completion_tokens / 1000) * pricing.output;
    return inputCost + outputCost;
  }

  getCostSummary() {
    return {
      totalRequests: this.costTracker.requests,
      totalTokens: this.costTracker.totalTokens,
      estimatedCost: this.costTracker.totalCost.toFixed(4),
      averageCostPerRequest: (this.costTracker.totalCost / Math.max(this.costTracker.requests, 1)).toFixed(4)
    };
  }

  hashString(str) {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
  }

  // 智能重试机制
  async smartRetry(fn, maxRetries = 3) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        // 根据错误类型决定是否重试
        if (error.response?.status === 429) { // 频率限制
          const delay = Math.min(1000 * Math.pow(2, i), 10000);
          logger.warn(`API频率限制，等待${delay}ms后重试`, { attempt: i + 1 });
          await new Promise(resolve => setTimeout(resolve, delay));
        } else if (error.response?.status >= 500) { // 服务器错误
          const delay = 1000 * (i + 1);
          logger.warn(`服务器错误，等待${delay}ms后重试`, { attempt: i + 1 });
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // 客户端错误，不重试
          break;
        }
      }
    }
    
    throw lastError;
  }
}

module.exports = OpenAIService;