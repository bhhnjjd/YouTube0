const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const { logger, ErrorHandler } = require('../utils/logger');
const config = require('../config');

class YouTubeService {
  constructor() {
    this.oauth2Client = null;
    this.youtube = null;
    this.isAuthenticated = false;
    this.credentials = config.youtube;
  }

  async initialize() {
    return ErrorHandler.safeExecute(async () => {
      this.oauth2Client = new google.auth.OAuth2(
        this.credentials.clientId,
        this.credentials.clientSecret,
        this.credentials.redirectUri
      );

      const tokenPath = path.join(process.cwd(), 'youtube_token.json');
      
      try {
        const tokenData = await fs.readFile(tokenPath, 'utf8');
        const tokens = JSON.parse(tokenData);
        this.oauth2Client.setCredentials(tokens);
        this.isAuthenticated = true;
        logger.info('YouTube认证信息已加载');
      } catch (error) {
        logger.warn('未找到已保存的认证信息，需要重新授权');
      }

      this.youtube = google.youtube({
        version: 'v3',
        auth: this.oauth2Client
      });
      
      return this.isAuthenticated;
    }, 'YouTubeService initialize');
  }

  getAuthUrl() {
    const scopes = [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  async authenticate(code) {
    return ErrorHandler.safeExecute(async () => {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      
      const tokenPath = path.join(process.cwd(), 'youtube_token.json');
      await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2));
      
      this.isAuthenticated = true;
      logger.info('YouTube认证成功');
      return true;
    }, 'YouTube authenticate');
  }

  async uploadVideo(videoPath, metadata) {
    if (!this.isAuthenticated) {
      throw new Error('请先完成YouTube认证');
    }

    return ErrorHandler.safeExecute(async () => {
      const {
        title,
        description,
        tags = [],
        categoryId = '22',
        privacyStatus = 'private',
        thumbnailPath
      } = metadata;

      logger.info('开始上传视频到YouTube', { title, videoPath });

      const videoResource = {
        snippet: {
          title: title.substring(0, 100),
          description: description.substring(0, 5000),
          tags: tags.slice(0, 500),
          categoryId,
          defaultLanguage: 'zh-CN',
          defaultAudioLanguage: 'zh-CN'
        },
        status: {
          privacyStatus,
          embeddable: true,
          license: 'youtube',
          publicStatsViewable: true
        }
      };

      const media = {
        body: require('fs').createReadStream(videoPath)
      };

      const response = await this.youtube.videos.insert({
        part: 'snippet,status',
        resource: videoResource,
        media: media
      });

      const videoId = response.data.id;
      logger.info('视频上传成功', { videoId, title });

      if (thumbnailPath) {
        await this.uploadThumbnail(videoId, thumbnailPath);
      }

      return {
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title,
        status: response.data.status.privacyStatus
      };
    }, 'uploadVideo');
  }

  async uploadThumbnail(videoId, thumbnailPath) {
    return ErrorHandler.safeExecute(async () => {
      const media = {
        body: require('fs').createReadStream(thumbnailPath)
      };

      await this.youtube.thumbnails.set({
        videoId,
        media
      });

      logger.info('缩略图上传成功', { videoId });
    }, 'uploadThumbnail');
  }

  async updateVideoMetadata(videoId, metadata) {
    return ErrorHandler.safeExecute(async () => {
      const resource = {
        id: videoId,
        snippet: {
          categoryId: metadata.categoryId || '22',
          description: metadata.description.substring(0, 5000),
          title: metadata.title.substring(0, 100),
          tags: metadata.tags ? metadata.tags.slice(0, 500) : []
        }
      };

      if (metadata.privacyStatus) {
        resource.status = {
          privacyStatus: metadata.privacyStatus
        };
      }

      const response = await this.youtube.videos.update({
        part: 'snippet,status',
        resource
      });

      logger.info('视频元数据更新成功', { videoId });
      return response.data;
    }, 'updateVideoMetadata');
  }

  async getVideoInfo(videoId) {
    return ErrorHandler.safeExecute(async () => {
      const response = await this.youtube.videos.list({
        part: 'snippet,statistics,status',
        id: videoId
      });

      if (response.data.items.length === 0) {
        throw new Error(`视频不存在: ${videoId}`);
      }

      return response.data.items[0];
    }, 'getVideoInfo');
  }

  async getChannelInfo() {
    return ErrorHandler.safeExecute(async () => {
      const response = await this.youtube.channels.list({
        part: 'snippet,statistics',
        mine: true
      });

      if (response.data.items.length === 0) {
        throw new Error('无法获取频道信息');
      }

      return response.data.items[0];
    }, 'getChannelInfo');
  }

  async scheduleVideo(videoId, publishTime) {
    return ErrorHandler.safeExecute(async () => {
      const resource = {
        id: videoId,
        status: {
          privacyStatus: 'private',
          publishAt: publishTime.toISOString()
        }
      };

      const response = await this.youtube.videos.update({
        part: 'status',
        resource
      });

      logger.info('视频定时发布设置成功', { 
        videoId, 
        publishTime: publishTime.toISOString() 
      });
      
      return response.data;
    }, 'scheduleVideo');
  }

  async publishVideo(videoId) {
    return ErrorHandler.safeExecute(async () => {
      const resource = {
        id: videoId,
        status: {
          privacyStatus: 'public'
        }
      };

      const response = await this.youtube.videos.update({
        part: 'status',
        resource
      });

      logger.info('视频已发布', { videoId });
      return response.data;
    }, 'publishVideo');
  }

  async getVideoStatistics(videoId) {
    return ErrorHandler.safeExecute(async () => {
      const response = await this.youtube.videos.list({
        part: 'statistics',
        id: videoId
      });

      if (response.data.items.length === 0) {
        return null;
      }

      return response.data.items[0].statistics;
    }, 'getVideoStatistics');
  }

  async deleteVideo(videoId) {
    return ErrorHandler.safeExecute(async () => {
      await this.youtube.videos.delete({
        id: videoId
      });

      logger.info('视频已删除', { videoId });
      return true;
    }, 'deleteVideo');
  }

  async createPlaylist(title, description, privacyStatus = 'private') {
    return ErrorHandler.safeExecute(async () => {
      const resource = {
        snippet: {
          title: title.substring(0, 150),
          description: description.substring(0, 5000)
        },
        status: {
          privacyStatus
        }
      };

      const response = await this.youtube.playlists.insert({
        part: 'snippet,status',
        resource
      });

      logger.info('播放列表创建成功', { 
        playlistId: response.data.id,
        title 
      });
      
      return response.data;
    }, 'createPlaylist');
  }

  async addVideoToPlaylist(playlistId, videoId) {
    return ErrorHandler.safeExecute(async () => {
      const resource = {
        snippet: {
          playlistId,
          resourceId: {
            kind: 'youtube#video',
            videoId
          }
        }
      };

      const response = await this.youtube.playlistItems.insert({
        part: 'snippet',
        resource
      });

      logger.info('视频已添加到播放列表', { playlistId, videoId });
      return response.data;
    }, 'addVideoToPlaylist');
  }
}

module.exports = YouTubeService;