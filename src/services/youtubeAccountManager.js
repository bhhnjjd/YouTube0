const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../utils/logger');
const config = require('../config');

class YouTubeAccountManager {
  constructor() {
    this.accountsDir = config.youtube.accountsDir;
    this.activeAccount = config.youtube.activeAccount;
  }

  async ensureDir() {
    await fs.mkdir(this.accountsDir, { recursive: true });
  }

  getTokenPath(name) {
    return path.join(this.accountsDir, `youtube_token_${name}.json`);
  }

  async listAccounts() {
    await this.ensureDir();
    const files = await fs.readdir(this.accountsDir);
    return files
      .filter((f) => f.startsWith('youtube_token_') && f.endsWith('.json'))
      .map((f) => f.slice('youtube_token_'.length, -'.json'.length));
  }

  async setActiveAccount(name) {
    this.activeAccount = name;
    config.youtube.activeAccount = name;
    logger.info('Active YouTube account set', { name });
  }

  getActiveAccount() {
    return this.activeAccount;
  }

  async loadTokens(name = this.activeAccount) {
    try {
      const file = this.getTokenPath(name);
      const data = await fs.readFile(file, 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async saveTokens(name, tokens) {
    await this.ensureDir();
    const file = this.getTokenPath(name);
    await fs.writeFile(file, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    logger.info('Saved YouTube tokens', { name });
    await this.setActiveAccount(name);
  }
}

module.exports = new YouTubeAccountManager();
