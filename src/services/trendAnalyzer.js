const puppeteer = require('puppeteer');
const axios = require('axios');
const { logger, ErrorHandler } = require('../utils/logger');
const OpenAIService = require('./openai');

class TrendAnalyzer {
  constructor() {
    this.openaiService = new OpenAIService();
    this.browser = null;
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async getTrendingVideos(region = 'CN', maxResults = 50) {
    return ErrorHandler.safeExecute(async () => {
      if (!this.browser) await this.init();
      
      const page = await this.browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
      await page.goto('https://www.youtube.com/feed/trending', {
        waitUntil: 'networkidle2'
      });

      const videos = await page.evaluate(() => {
        const videoElements = document.querySelectorAll('ytd-video-renderer');
        const results = [];

        for (const element of videoElements) {
          try {
            const titleElement = element.querySelector('#video-title');
            const channelElement = element.querySelector('#channel-name a');
            const viewsElement = element.querySelector('#metadata-line span:first-child');
            const thumbnailElement = element.querySelector('img');
            const durationElement = element.querySelector('.ytd-thumbnail-overlay-time-status-renderer');

            if (titleElement && channelElement) {
              results.push({
                title: titleElement.textContent.trim(),
                channel: channelElement.textContent.trim(),
                views: viewsElement ? viewsElement.textContent.trim() : '0',
                thumbnail: thumbnailElement ? thumbnailElement.src : '',
                duration: durationElement ? durationElement.textContent.trim() : '',
                url: titleElement.href || ''
              });
            }
          } catch (error) {
            console.log('Error parsing video element:', error);
          }
        }

        return results.slice(0, 50);
      });

      await page.close();
      logger.info(`获取到${videos.length}个热门视频`);
      return videos;
    }, 'getTrendingVideos', []);
  }

  async analyzeShorts(maxResults = 30) {
    return ErrorHandler.safeExecute(async () => {
      if (!this.browser) await this.init();
      
      const page = await this.browser.newPage();
      await page.goto('https://www.youtube.com/shorts', {
        waitUntil: 'networkidle2'
      });

      const shorts = await page.evaluate(() => {
        const shortElements = document.querySelectorAll('ytd-reel-item-renderer');
        const results = [];

        for (const element of shortElements) {
          try {
            const titleElement = element.querySelector('#video-title');
            const viewsElement = element.querySelector('.view-count');
            const thumbnailElement = element.querySelector('img');

            if (titleElement) {
              results.push({
                title: titleElement.textContent.trim(),
                views: viewsElement ? viewsElement.textContent.trim() : '0',
                thumbnail: thumbnailElement ? thumbnailElement.src : '',
                type: 'shorts'
              });
            }
          } catch (error) {
            console.log('Error parsing shorts element:', error);
          }
        }

        return results.slice(0, 30);
      });

      await page.close();
      logger.info(`获取到${shorts.length}个热门短视频`);
      return shorts;
    }, 'analyzeShorts', []);
  }

  async getTopicTrends() {
    return ErrorHandler.safeExecute(async () => {
      const trendingVideos = await this.getTrendingVideos();
      const shorts = await this.analyzeShorts();
      
      const allContent = [...trendingVideos, ...shorts];
      
      const analysis = await this.openaiService.analyzeVideoTrends(allContent);
      
      try {
        const parsedAnalysis = JSON.parse(analysis);
        logger.info('趋势分析完成', { topics: parsedAnalysis.topics });
        return parsedAnalysis;
      } catch (error) {
        logger.warn('无法解析AI分析结果，返回原始文本');
        return { analysis, rawData: allContent };
      }
    }, 'getTopicTrends', {});
  }

  async searchKeywordTrends(keywords) {
    return ErrorHandler.safeExecute(async () => {
      if (!this.browser) await this.init();
      
      const results = {};
      
      for (const keyword of keywords) {
        const page = await this.browser.newPage();
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}&sp=CAM%253D`;
        
        await page.goto(searchUrl, { waitUntil: 'networkidle2' });
        
        const videos = await page.evaluate(() => {
          const videoElements = document.querySelectorAll('ytd-video-renderer');
          return Array.from(videoElements).slice(0, 10).map(element => {
            const titleElement = element.querySelector('#video-title');
            const viewsElement = element.querySelector('#metadata-line span:first-child');
            
            return {
              title: titleElement ? titleElement.textContent.trim() : '',
              views: viewsElement ? viewsElement.textContent.trim() : '0'
            };
          });
        });
        
        results[keyword] = videos;
        await page.close();
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      logger.info(`关键词趋势分析完成`, { keywords: Object.keys(results) });
      return results;
    }, 'searchKeywordTrends', {});
  }

  async generateContentIdeas(count = 5) {
    return ErrorHandler.safeExecute(async () => {
      const trends = await this.getTopicTrends();
      
      const ideas = [];
      for (let i = 0; i < count; i++) {
        const script = await this.openaiService.generateVideoScript(
          `基于当前热门趋势的创意视频 #${i + 1}`,
          60
        );
        
        try {
          const parsedScript = JSON.parse(script);
          ideas.push(parsedScript);
        } catch (error) {
          ideas.push({ script, raw: true });
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      logger.info(`生成了${ideas.length}个内容创意`);
      return { trends, ideas };
    }, 'generateContentIdeas', []);
  }
}

module.exports = TrendAnalyzer;