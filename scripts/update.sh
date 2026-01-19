#!/bin/bash
set -e

echo "============================================"
echo "Updating Face Detection Labeler"
echo "============================================"
echo ""

# Stop services
echo "Stopping services..."
pm2 stop labeler python-service

# Pull latest changes
echo "Pulling latest changes from GitHub..."
git pull

# Update Node.js dependencies
echo "Updating Node.js dependencies..."
npm install

# Update Python dependencies
echo "Updating Python dependencies..."
pip3 install --user -r python-service/requirements.txt

# Restart services
echo "Restarting services..."
pm2 restart labeler python-service

echo ""
echo "✓ Update complete!"
echo ""
pm2 status
echo ""
