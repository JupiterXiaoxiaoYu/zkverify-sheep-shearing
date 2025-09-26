#!/bin/bash

# systemd服务安装脚本

echo "📦 安装systemd服务..."

# 复制服务文件
sudo cp rapidsnark-pipeline.service /etc/systemd/system/

# 重新加载systemd
sudo systemctl daemon-reload

# 启用服务（开机自启）
sudo systemctl enable rapidsnark-pipeline

# 启动服务
sudo systemctl start rapidsnark-pipeline

# 查看状态
sudo systemctl status rapidsnark-pipeline

echo ""
echo "✅ 服务已安装并启动！"
echo ""
echo "📊 常用命令："
echo "  查看状态: sudo systemctl status rapidsnark-pipeline"
echo "  查看日志: sudo journalctl -u rapidsnark-pipeline -f"
echo "  重启服务: sudo systemctl restart rapidsnark-pipeline"
echo "  停止服务: sudo systemctl stop rapidsnark-pipeline"