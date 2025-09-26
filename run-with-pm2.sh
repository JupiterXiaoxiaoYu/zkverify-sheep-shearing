#!/bin/bash

# PM2运行脚本 - 自动安装PM2并启动程序

echo "🚀 设置自动重启的rapidsnark pipeline..."

# 检查是否安装了PM2
if ! command -v pm2 &> /dev/null; then
    echo "📦 PM2未安装，正在安装..."
    npm install -g pm2
fi

# 创建日志目录
mkdir -p logs

# 停止已有的进程（如果存在）
pm2 stop rapidsnark-pipeline 2>/dev/null || true
pm2 delete rapidsnark-pipeline 2>/dev/null || true

# 启动新进程
echo "🔄 启动带自动重启的pipeline..."
pm2 start ecosystem.config.js

# 保存PM2进程列表（系统重启后自动恢复）
pm2 save

# 显示状态
pm2 status
echo ""
echo "📊 查看日志: pm2 logs rapidsnark-pipeline"
echo "📊 查看监控: pm2 monit"
echo "🛑 停止进程: pm2 stop rapidsnark-pipeline"
echo "🔄 重启进程: pm2 restart rapidsnark-pipeline"
echo ""
echo "✅ Pipeline已启动，崩溃后会自动重启！"