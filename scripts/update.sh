#!/bin/bash
set -e

echo "============================================"
echo "Updating Face Detection Labeler"
echo "============================================"
echo ""

# Stop services
echo "Stopping services..."
pm2 stop labeler python-service-1 python-service-2

# Pull latest changes
echo "Pulling latest changes from GitHub..."
git pull

# Update Node.js dependencies
echo "Updating Node.js dependencies..."
npm install

# Update Python dependencies (uses venv to avoid system package conflicts)
echo "Updating Python dependencies..."
python-service/venv/bin/pip install -r python-service/requirements.txt

# Restart services
echo "Restarting services..."
pm2 restart labeler python-service-1 python-service-2

echo ""
echo "✓ Update complete!"
echo ""
pm2 status
echo ""
