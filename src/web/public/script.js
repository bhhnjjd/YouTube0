class YouTubeAutomationUI {
    constructor() {
        this.socket = io();
        this.init();
        this.setupEventListeners();
        this.setupSocketListeners();
    }

    init() {
        this.loadSystemStatus();
        this.startStatusUpdates();
    }

    setupEventListeners() {
        // 控制面板按钮
        document.getElementById('start-automation').addEventListener('click', () => this.startAutomation());
        document.getElementById('stop-automation').addEventListener('click', () => this.stopAutomation());
        document.getElementById('run-once').addEventListener('click', () => this.runOnce());
        document.getElementById('analyze-trends').addEventListener('click', () => this.analyzeTrends());

        // YouTube认证
        document.getElementById('get-auth-url').addEventListener('click', () => this.getAuthUrl());
        document.getElementById('submit-auth').addEventListener('click', () => this.submitAuth());

        // 内容生成
        document.getElementById('generate-ideas').addEventListener('click', () => this.generateIdeas());
        document.getElementById('video-form').addEventListener('submit', (e) => this.createVideo(e));
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            this.log('WebSocket连接成功', 'info');
            this.updateConnectionStatus(true);
        });

        this.socket.on('disconnect', () => {
            this.log('WebSocket连接断开', 'error');
            this.updateConnectionStatus(false);
        });

        this.socket.on('systemUpdate', (data) => {
            this.updateSystemStatus(data);
        });

        this.socket.on('jobCreated', (data) => {
            this.log(`任务已创建: ${data.type} (${data.jobId})`, 'success');
        });

        this.socket.on('error', (error) => {
            this.showNotification(error.message, 'error');
        });
    }

    async loadSystemStatus() {
        try {
            const response = await fetch('/api/status');
            const data = await response.json();
            this.updateSystemStatus(data);
        } catch (error) {
            this.log(`加载系统状态失败: ${error.message}`, 'error');
        }
    }

    updateSystemStatus(data) {
        // 更新状态指示器
        const indicator = document.getElementById('status-indicator');
        const statusText = document.getElementById('status-text');
        
        if (data.isRunning) {
            indicator.className = 'w-3 h-3 rounded-full bg-green-400 mr-2';
            statusText.textContent = '系统运行中';
        } else {
            indicator.className = 'w-3 h-3 rounded-full bg-yellow-400 mr-2';
            statusText.textContent = '系统已停止';
        }

        // 更新统计数据
        document.getElementById('video-count').textContent = data.videoCount || 0;
        document.getElementById('automation-status').textContent = data.isRunning ? '运行中' : '已停止';
        document.getElementById('youtube-status').textContent = data.isYouTubeAuthenticated ? '已认证' : '未认证';

        // 更新队列统计
        if (data.queues) {
            let totalJobs = 0;
            const queueStats = document.getElementById('queue-stats');
            queueStats.innerHTML = '';

            Object.entries(data.queues).forEach(([name, stats]) => {
                totalJobs += stats.waiting + stats.active;
                
                const queueDiv = document.createElement('div');
                queueDiv.className = 'flex justify-between items-center p-2 bg-gray-50 rounded';
                queueDiv.innerHTML = `
                    <span class="text-sm font-medium">${this.formatQueueName(name)}</span>
                    <div class="text-xs text-gray-600">
                        <span class="bg-blue-100 px-2 py-1 rounded">等待: ${stats.waiting}</span>
                        <span class="bg-green-100 px-2 py-1 rounded ml-1">处理中: ${stats.active}</span>
                    </div>
                `;
                queueStats.appendChild(queueDiv);
            });

            document.getElementById('queue-count').textContent = totalJobs;
        }

        // 更新时间戳
        document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
    }

    updateConnectionStatus(connected) {
        const indicator = document.getElementById('status-indicator');
        if (!connected) {
            indicator.className = 'w-3 h-3 rounded-full bg-red-400 mr-2';
            document.getElementById('status-text').textContent = '连接断开';
        }
    }

    async startAutomation() {
        try {
            const response = await fetch('/api/automation/start', { method: 'POST' });
            const data = await response.json();
            
            if (data.success) {
                this.showNotification('自动化已启动', 'success');
                this.log('自动化系统已启动', 'success');
            } else {
                this.showNotification('启动失败', 'error');
            }
        } catch (error) {
            this.showNotification(`启动失败: ${error.message}`, 'error');
        }
    }

    async stopAutomation() {
        try {
            const response = await fetch('/api/automation/stop', { method: 'POST' });
            const data = await response.json();
            
            if (data.success) {
                this.showNotification('自动化已停止', 'success');
                this.log('自动化系统已停止', 'info');
            } else {
                this.showNotification('停止失败', 'error');
            }
        } catch (error) {
            this.showNotification(`停止失败: ${error.message}`, 'error');
        }
    }

    async runOnce() {
        try {
            this.showNotification('正在执行单次任务...', 'info');
            const response = await fetch('/api/automation/run-once', { method: 'POST' });
            const data = await response.json();
            
            if (data.success) {
                this.showNotification(data.message, 'success');
                this.log(`单次任务完成: ${data.result ? '已创建视频' : '未创建视频'}`, 'info');
            } else {
                this.showNotification('执行失败', 'error');
            }
        } catch (error) {
            this.showNotification(`执行失败: ${error.message}`, 'error');
        }
    }

    async analyzeTrends() {
        try {
            this.showNotification('正在分析趋势...', 'info');
            const response = await fetch('/api/trends');
            const data = await response.json();
            
            this.log('趋势分析完成', 'success');
            console.log('趋势数据:', data);
            this.showNotification('趋势分析完成，请查看控制台', 'success');
        } catch (error) {
            this.showNotification(`分析失败: ${error.message}`, 'error');
        }
    }

    async getAuthUrl() {
        try {
            const response = await fetch('/api/youtube/auth-url');
            const data = await response.json();
            
            if (data.authUrl) {
                window.open(data.authUrl, '_blank');
                this.showNotification('认证页面已打开，完成后输入认证码', 'info');
            }
        } catch (error) {
            this.showNotification(`获取认证链接失败: ${error.message}`, 'error');
        }
    }

    async submitAuth() {
        const code = document.getElementById('auth-code').value.trim();
        if (!code) {
            this.showNotification('请输入认证码', 'error');
            return;
        }

        try {
            const response = await fetch('/api/youtube/authenticate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showNotification('YouTube认证成功', 'success');
                document.getElementById('auth-code').value = '';
                this.loadSystemStatus();
            } else {
                this.showNotification('认证失败', 'error');
            }
        } catch (error) {
            this.showNotification(`认证失败: ${error.message}`, 'error');
        }
    }

    async generateIdeas() {
        const count = parseInt(document.getElementById('idea-count').value) || 5;
        
        try {
            this.showNotification('正在生成创意...', 'info');
            const response = await fetch('/api/ideas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ count })
            });
            
            const data = await response.json();
            this.displayIdeas(data.ideas || []);
            this.showNotification(`已生成${data.ideas?.length || 0}个创意`, 'success');
        } catch (error) {
            this.showNotification(`生成创意失败: ${error.message}`, 'error');
        }
    }

    displayIdeas(ideas) {
        const container = document.getElementById('ideas-list');
        container.innerHTML = '';

        ideas.forEach((idea, index) => {
            const ideaDiv = document.createElement('div');
            ideaDiv.className = 'p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50';
            ideaDiv.innerHTML = `
                <div class="font-medium text-sm">${idea.title || `创意 ${index + 1}`}</div>
                <div class="text-xs text-gray-600 mt-1">${(idea.script || '').substring(0, 100)}...</div>
            `;
            
            ideaDiv.addEventListener('click', () => {
                document.getElementById('video-title').value = idea.title || '';
                document.getElementById('video-script').value = idea.script || '';
                document.getElementById('video-tags').value = (idea.tags || []).join(', ');
            });
            
            container.appendChild(ideaDiv);
        });
    }

    async createVideo(event) {
        event.preventDefault();
        
        const title = document.getElementById('video-title').value.trim();
        const script = document.getElementById('video-script').value.trim();
        const tags = document.getElementById('video-tags').value.split(',').map(tag => tag.trim()).filter(tag => tag);

        if (!title || !script) {
            this.showNotification('请填写标题和脚本', 'error');
            return;
        }

        const scriptData = {
            title,
            script,
            description: `${script.substring(0, 200)}...`,
            tags
        };

        try {
            this.showNotification('正在创建视频任务...', 'info');
            const response = await fetch('/api/video/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scriptData })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showNotification(`视频任务已提交 (ID: ${data.jobId})`, 'success');
                this.log(`视频创建任务已提交: ${title}`, 'info');
                document.getElementById('video-form').reset();
            } else {
                this.showNotification('创建任务失败', 'error');
            }
        } catch (error) {
            this.showNotification(`创建任务失败: ${error.message}`, 'error');
        }
    }

    showNotification(message, type = 'info') {
        const container = document.getElementById('notifications');
        const notification = document.createElement('div');
        
        const colors = {
            success: 'bg-green-500',
            error: 'bg-red-500',
            info: 'bg-blue-500',
            warning: 'bg-yellow-500'
        };

        notification.className = `${colors[type]} text-white px-4 py-2 rounded shadow-lg transform transition-all duration-300 translate-x-full opacity-0`;
        notification.textContent = message;
        
        container.appendChild(notification);
        
        // 动画显示
        setTimeout(() => {
            notification.classList.remove('translate-x-full', 'opacity-0');
        }, 10);
        
        // 自动消失
        setTimeout(() => {
            notification.classList.add('translate-x-full', 'opacity-0');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 5000);
    }

    log(message, level = 'info') {
        const logsContainer = document.getElementById('logs');
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        
        const colors = {
            info: 'text-blue-600',
            success: 'text-green-600',
            error: 'text-red-600',
            warning: 'text-yellow-600'
        };

        logEntry.className = `${colors[level]} mb-1`;
        logEntry.innerHTML = `<span class="text-gray-500">[${timestamp}]</span> ${message}`;
        
        logsContainer.appendChild(logEntry);
        logsContainer.scrollTop = logsContainer.scrollHeight;
        
        // 限制日志条数
        while (logsContainer.children.length > 100) {
            logsContainer.removeChild(logsContainer.firstChild);
        }
    }

    formatQueueName(name) {
        const nameMap = {
            videoGeneration: '视频生成',
            trendAnalysis: '趋势分析',
            videoUpload: '视频上传',
            aiProcessing: 'AI处理'
        };
        return nameMap[name] || name;
    }

    startStatusUpdates() {
        // 定期更新系统状态
        setInterval(() => {
            this.loadSystemStatus();
        }, 30000); // 每30秒更新一次
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new YouTubeAutomationUI();
});