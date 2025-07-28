#!/usr/bin/env node

require('dotenv').config();
const YouTubeAutomation = require('./modules/automation');
const WebApplication = require('./web/app');
const { logger } = require('./utils/logger');

async function main() {
  const args = process.argv.slice(2);
  
  // 检查是否要启动Web应用
  if (args.includes('--web') || process.env.NODE_ENV === 'production') {
    const webApp = new WebApplication();
    await webApp.start();
    return;
  }

  // 原有的CLI模式
  const automation = new YouTubeAutomation();
  
  process.on('SIGINT', async () => {
    logger.info('接收到退出信号，正在清理...');
    automation.stopAutomation();
    await automation.cleanup();
    process.exit(0);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('未处理的Promise拒绝:', { reason, promise });
  });

  process.on('uncaughtException', (error) => {
    logger.error('未捕获的异常:', { error: error.message, stack: error.stack });
    process.exit(1);
  });

  try {
    logger.info('启动YouTube全自动化系统...');
    
    const initialized = await automation.initialize();
    
    if (!initialized) {
      logger.error('系统初始化失败，请检查配置');
      const authUrl = automation.youtubeService.getAuthUrl();
      logger.info('请访问以下链接完成YouTube认证:');
      logger.info(authUrl);
      logger.info('认证完成后重新运行程序');
      return;
    }
    
    if (args.includes('--auth')) {
      const authCode = args[args.indexOf('--auth') + 1];
      if (authCode) {
        const success = await automation.authenticateYouTube(authCode);
        if (success) {
          logger.info('认证成功，可以重新运行程序开始自动化');
        }
        return;
      } else {
        logger.error('请提供认证码: --auth YOUR_AUTH_CODE');
        return;
      }
    }

    if (args.includes('--single')) {
      logger.info('运行单次视频创建...');
      const result = await automation.runSingleCycle();
      if (result) {
        logger.info('视频创建完成:', result.url);
      }
      return;
    }

    if (args.includes('--trends')) {
      logger.info('分析当前趋势...');
      const trends = await automation.analyzeTrends();
      console.log(JSON.stringify(trends, null, 2));
      return;
    }

    if (args.includes('--ideas')) {
      const count = parseInt(args[args.indexOf('--ideas') + 1]) || 5;
      logger.info(`生成${count}个内容创意...`);
      const ideas = await automation.generateContentIdeas(count);
      console.log(JSON.stringify(ideas, null, 2));
      return;
    }

    if (args.includes('--status')) {
      const status = await automation.getSystemStatus();
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    if (args.includes('--help')) {
      console.log(`
YouTube全自动化视频制作系统

使用方法:
  node src/index.js [选项]

选项:
  --web              启动Web应用模式
  --auth CODE        使用授权码完成YouTube认证
  --single           运行单次视频创建和发布
  --trends           分析当前YouTube趋势
  --ideas [数量]      生成内容创意（默认5个）
  --status           显示系统状态
  --help            显示此帮助信息

Web模式 (推荐):
  node src/index.js --web
  访问 http://localhost:3000 使用Web界面

Docker部署:
  docker-compose up -d

自动化模式:
  不带任何参数运行将启动持续的自动化模式，
  系统将定期分析趋势、创建视频并发布到YouTube。

环境变量配置:
  复制 .env.example 到 .env 并填入你的配置信息。
      `);
      return;
    }

    logger.info('启动自动化模式...');
    automation.startAutomation();
    
    logger.info('系统正在运行，按 Ctrl+C 退出');
    logger.info('提示：建议使用 --web 参数启动Web界面获得更好的体验');
    
  } catch (error) {
    logger.error('系统启动失败:', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { YouTubeAutomation, WebApplication };