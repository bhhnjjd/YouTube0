const { logger } = require('../utils/logger');
const config = require('../config');

class MetricsService {
  constructor() {
    this.metrics = {
      system: {
        startTime: Date.now(),
        requests: 0,
        errors: 0,
        videosCreated: 0,
        videosUploaded: 0,
        trendsAnalyzed: 0,
        aiRequests: 0,
        totalCost: 0
      },
      hourly: new Map(),
      daily: new Map(),
      realtime: {
        activeConnections: 0,
        queueStatus: {},
        memoryUsage: 0,
        cpuUsage: 0
      }
    };

    this.collectors = [];
    this.enabled = config.monitoring.enableMetrics;
    
    if (this.enabled) {
      this.startCollection();
    }
  }

  startCollection() {
    // 收集系统指标
    setInterval(() => {
      this.collectSystemMetrics();
    }, 30000); // 每30秒收集一次

    // 收集进程指标
    setInterval(() => {
      this.collectProcessMetrics();
    }, 10000); // 每10秒收集一次

    // 清理历史数据
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 3600000); // 每小时清理一次
  }

  collectSystemMetrics() {
    const now = Date.now();
    const hour = new Date(now).getHours();
    const day = new Date(now).toDateString();

    // 更新实时指标
    this.metrics.realtime.memoryUsage = process.memoryUsage();
    this.metrics.realtime.cpuUsage = process.cpuUsage();

    // 记录小时统计
    if (!this.metrics.hourly.has(hour)) {
      this.metrics.hourly.set(hour, {
        requests: 0,
        errors: 0,
        videosCreated: 0,
        aiRequests: 0,
        averageResponseTime: 0
      });
    }

    // 记录每日统计
    if (!this.metrics.daily.has(day)) {
      this.metrics.daily.set(day, {
        requests: 0,
        errors: 0,
        videosCreated: 0,
        aiRequests: 0,
        totalCost: 0,
        uptime: 0
      });
    }

    // 更新每日运行时间
    const dailyMetrics = this.metrics.daily.get(day);
    dailyMetrics.uptime = now - this.metrics.system.startTime;
  }

  collectProcessMetrics() {
    // 可以在这里添加更详细的进程监控
    // 例如：文件描述符数量、网络连接等
  }

  cleanupOldMetrics() {
    const now = new Date();
    
    // 清理超过24小时的小时数据
    const cutoffHour = new Date(now.getTime() - 24 * 60 * 60 * 1000).getHours();
    for (const [hour] of this.metrics.hourly) {
      if (hour < cutoffHour) {
        this.metrics.hourly.delete(hour);
      }
    }

    // 清理超过30天的每日数据
    const cutoffDay = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toDateString();
    for (const [day] of this.metrics.daily) {
      if (day < cutoffDay) {
        this.metrics.daily.delete(day);
      }
    }
  }

  // 记录请求
  recordRequest(endpoint, responseTime, statusCode) {
    if (!this.enabled) return;

    this.metrics.system.requests++;
    
    if (statusCode >= 400) {
      this.metrics.system.errors++;
    }

    const hour = new Date().getHours();
    const day = new Date().toDateString();

    // 更新小时统计
    const hourlyStats = this.metrics.hourly.get(hour);
    if (hourlyStats) {
      hourlyStats.requests++;
      if (statusCode >= 400) {
        hourlyStats.errors++;
      }
      
      // 计算平均响应时间
      const totalTime = hourlyStats.averageResponseTime * (hourlyStats.requests - 1) + responseTime;
      hourlyStats.averageResponseTime = totalTime / hourlyStats.requests;
    }

    // 更新每日统计
    const dailyStats = this.metrics.daily.get(day);
    if (dailyStats) {
      dailyStats.requests++;
      if (statusCode >= 400) {
        dailyStats.errors++;
      }
    }
  }

  // 记录视频创建
  recordVideoCreated(duration, cost = 0) {
    if (!this.enabled) return;

    this.metrics.system.videosCreated++;
    this.metrics.system.totalCost += cost;

    const day = new Date().toDateString();
    const dailyStats = this.metrics.daily.get(day);
    if (dailyStats) {
      dailyStats.videosCreated++;
      dailyStats.totalCost += cost;
    }

    logger.info('视频创建指标记录', {
      totalVideos: this.metrics.system.videosCreated,
      duration,
      cost
    });
  }

  // 记录视频上传
  recordVideoUploaded(videoId, size) {
    if (!this.enabled) return;

    this.metrics.system.videosUploaded++;

    logger.info('视频上传指标记录', {
      videoId,
      size,
      totalUploaded: this.metrics.system.videosUploaded
    });
  }

  // 记录趋势分析
  recordTrendAnalysis(videosAnalyzed, topics) {
    if (!this.enabled) return;

    this.metrics.system.trendsAnalyzed++;

    logger.info('趋势分析指标记录', {
      videosAnalyzed,
      topics: topics?.length || 0,
      totalAnalyses: this.metrics.system.trendsAnalyzed
    });
  }

  // 记录AI请求
  recordAIRequest(type, tokens, cost) {
    if (!this.enabled) return;

    this.metrics.system.aiRequests++;
    this.metrics.system.totalCost += cost;

    const hour = new Date().getHours();
    const day = new Date().toDateString();

    // 更新小时统计
    const hourlyStats = this.metrics.hourly.get(hour);
    if (hourlyStats) {
      hourlyStats.aiRequests++;
    }

    // 更新每日统计
    const dailyStats = this.metrics.daily.get(day);
    if (dailyStats) {
      dailyStats.aiRequests++;
      dailyStats.totalCost += cost;
    }

    logger.debug('AI请求指标记录', {
      type,
      tokens,
      cost,
      totalRequests: this.metrics.system.aiRequests
    });
  }

  // 更新队列状态
  updateQueueStatus(queueStats) {
    if (!this.enabled) return;

    this.metrics.realtime.queueStatus = queueStats;
  }

  // 更新活跃连接数
  updateActiveConnections(count) {
    if (!this.enabled) return;

    this.metrics.realtime.activeConnections = count;
  }

  // 获取系统概览
  getSystemOverview() {
    const uptime = Date.now() - this.metrics.system.startTime;
    
    return {
      uptime: this.formatUptime(uptime),
      totalRequests: this.metrics.system.requests,
      totalErrors: this.metrics.system.errors,
      errorRate: this.metrics.system.requests > 0 
        ? (this.metrics.system.errors / this.metrics.system.requests * 100).toFixed(2) + '%'
        : '0%',
      videosCreated: this.metrics.system.videosCreated,
      videosUploaded: this.metrics.system.videosUploaded,
      trendsAnalyzed: this.metrics.system.trendsAnalyzed,
      aiRequests: this.metrics.system.aiRequests,
      totalCost: '$' + this.metrics.system.totalCost.toFixed(4),
      activeConnections: this.metrics.realtime.activeConnections,
      memoryUsage: this.formatMemoryUsage(this.metrics.realtime.memoryUsage),
      queueStatus: this.metrics.realtime.queueStatus
    };
  }

  // 获取每日统计
  getDailyStats(days = 7) {
    const stats = [];
    const now = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayKey = date.toDateString();
      const dayStats = this.metrics.daily.get(dayKey);
      
      stats.push({
        date: dayKey,
        requests: dayStats?.requests || 0,
        errors: dayStats?.errors || 0,
        videosCreated: dayStats?.videosCreated || 0,
        aiRequests: dayStats?.aiRequests || 0,
        totalCost: dayStats?.totalCost || 0,
        uptime: dayStats?.uptime || 0
      });
    }
    
    return stats;
  }

  // 获取小时统计
  getHourlyStats() {
    const stats = [];
    
    for (let hour = 0; hour < 24; hour++) {
      const hourStats = this.metrics.hourly.get(hour);
      stats.push({
        hour,
        requests: hourStats?.requests || 0,
        errors: hourStats?.errors || 0,
        videosCreated: hourStats?.videosCreated || 0,
        aiRequests: hourStats?.aiRequests || 0,
        averageResponseTime: hourStats?.averageResponseTime || 0
      });
    }
    
    return stats;
  }

  // 获取性能指标
  getPerformanceMetrics() {
    const memUsage = this.metrics.realtime.memoryUsage;
    
    return {
      memory: {
        rss: this.formatBytes(memUsage.rss),
        heapTotal: this.formatBytes(memUsage.heapTotal),
        heapUsed: this.formatBytes(memUsage.heapUsed),
        external: this.formatBytes(memUsage.external),
        usage: ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(2) + '%'
      },
      cpu: this.metrics.realtime.cpuUsage,
      uptime: this.formatUptime(Date.now() - this.metrics.system.startTime),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    };
  }

  // 导出指标数据
  exportMetrics(format = 'json') {
    const data = {
      timestamp: new Date().toISOString(),
      system: this.metrics.system,
      realtime: this.metrics.realtime,
      daily: Object.fromEntries(this.metrics.daily),
      hourly: Object.fromEntries(this.metrics.hourly)
    };

    switch (format) {
      case 'prometheus':
        return this.toPrometheusFormat(data);
      case 'json':
      default:
        return JSON.stringify(data, null, 2);
    }
  }

  toPrometheusFormat(data) {
    let output = '';
    
    // 系统指标
    output += `# TYPE youtube_automation_requests_total counter\n`;
    output += `youtube_automation_requests_total ${data.system.requests}\n`;
    
    output += `# TYPE youtube_automation_errors_total counter\n`;
    output += `youtube_automation_errors_total ${data.system.errors}\n`;
    
    output += `# TYPE youtube_automation_videos_created_total counter\n`;
    output += `youtube_automation_videos_created_total ${data.system.videosCreated}\n`;
    
    output += `# TYPE youtube_automation_videos_uploaded_total counter\n`;
    output += `youtube_automation_videos_uploaded_total ${data.system.videosUploaded}\n`;
    
    output += `# TYPE youtube_automation_ai_requests_total counter\n`;
    output += `youtube_automation_ai_requests_total ${data.system.aiRequests}\n`;
    
    output += `# TYPE youtube_automation_total_cost gauge\n`;
    output += `youtube_automation_total_cost ${data.system.totalCost}\n`;
    
    // 内存指标
    if (data.realtime.memoryUsage) {
      output += `# TYPE youtube_automation_memory_usage_bytes gauge\n`;
      output += `youtube_automation_memory_usage_bytes{type="rss"} ${data.realtime.memoryUsage.rss}\n`;
      output += `youtube_automation_memory_usage_bytes{type="heap_total"} ${data.realtime.memoryUsage.heapTotal}\n`;
      output += `youtube_automation_memory_usage_bytes{type="heap_used"} ${data.realtime.memoryUsage.heapUsed}\n`;
    }
    
    return output;
  }

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}天 ${hours % 24}小时 ${minutes % 60}分钟`;
    } else if (hours > 0) {
      return `${hours}小时 ${minutes % 60}分钟`;
    } else {
      return `${minutes}分钟 ${seconds % 60}秒`;
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatMemoryUsage(memUsage) {
    if (!memUsage) return {};
    
    return {
      rss: this.formatBytes(memUsage.rss),
      heapTotal: this.formatBytes(memUsage.heapTotal),
      heapUsed: this.formatBytes(memUsage.heapUsed),
      heapUsage: ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(1) + '%'
    };
  }

  // 重置指标
  reset() {
    this.metrics.system = {
      startTime: Date.now(),
      requests: 0,
      errors: 0,
      videosCreated: 0,
      videosUploaded: 0,
      trendsAnalyzed: 0,
      aiRequests: 0,
      totalCost: 0
    };
    
    this.metrics.hourly.clear();
    this.metrics.daily.clear();
    
    logger.info('指标已重置');
  }
}

module.exports = new MetricsService();