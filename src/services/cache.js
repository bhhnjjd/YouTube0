const Redis = require('ioredis');
const { logger } = require('../utils/logger');
const config = require('../config');

class CacheService {
  constructor() {
    this.redis = new Redis(config.redis.url, {
      password: config.redis.password,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    });

    this.redis.on('connect', () => {
      logger.info('Redis连接成功');
    });

    this.redis.on('error', (error) => {
      logger.error('Redis连接错误', { error: error.message });
    });
  }

  async get(key) {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('缓存获取失败', { key, error: error.message });
      return null;
    }
  }

  async set(key, value, ttl = config.cache.ttl) {
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await this.redis.setex(key, ttl, serialized);
      } else {
        await this.redis.set(key, serialized);
      }
      return true;
    } catch (error) {
      logger.error('缓存设置失败', { key, error: error.message });
      return false;
    }
  }

  async del(key) {
    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      logger.error('缓存删除失败', { key, error: error.message });
      return false;
    }
  }

  async exists(key) {
    try {
      return await this.redis.exists(key);
    } catch (error) {
      logger.error('缓存检查失败', { key, error: error.message });
      return false;
    }
  }

  async keys(pattern) {
    try {
      return await this.redis.keys(pattern);
    } catch (error) {
      logger.error('缓存键查找失败', { pattern, error: error.message });
      return [];
    }
  }

  async incr(key, ttl = null) {
    try {
      const result = await this.redis.incr(key);
      if (ttl && result === 1) {
        await this.redis.expire(key, ttl);
      }
      return result;
    } catch (error) {
      logger.error('缓存递增失败', { key, error: error.message });
      return 0;
    }
  }

  async mget(keys) {
    try {
      const values = await this.redis.mget(keys);
      return values.map(value => value ? JSON.parse(value) : null);
    } catch (error) {
      logger.error('批量缓存获取失败', { keys, error: error.message });
      return new Array(keys.length).fill(null);
    }
  }

  async mset(keyValues, ttl = config.cache.ttl) {
    try {
      const pipeline = this.redis.pipeline();
      
      for (const [key, value] of Object.entries(keyValues)) {
        const serialized = JSON.stringify(value);
        if (ttl) {
          pipeline.setex(key, ttl, serialized);
        } else {
          pipeline.set(key, serialized);
        }
      }
      
      await pipeline.exec();
      return true;
    } catch (error) {
      logger.error('批量缓存设置失败', { error: error.message });
      return false;
    }
  }

  async getOrSet(key, fetchFunction, ttl = config.cache.ttl) {
    try {
      let value = await this.get(key);
      
      if (value === null) {
        value = await fetchFunction();
        await this.set(key, value, ttl);
      }
      
      return value;
    } catch (error) {
      logger.error('缓存获取或设置失败', { key, error: error.message });
      return await fetchFunction();
    }
  }

  getCacheKey(prefix, ...parts) {
    return `${prefix}:${parts.join(':')}`;
  }

  async clearPattern(pattern) {
    try {
      const keys = await this.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      return keys.length;
    } catch (error) {
      logger.error('批量缓存清除失败', { pattern, error: error.message });
      return 0;
    }
  }

  async disconnect() {
    try {
      await this.redis.quit();
      logger.info('Redis连接已断开');
    } catch (error) {
      logger.error('Redis断开连接失败', { error: error.message });
    }
  }
}

module.exports = new CacheService();