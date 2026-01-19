#!/bin/bash

echo "============================================"
echo "Face Detection Labeler Service Status"
echo "============================================"
echo ""

# PM2 status
echo "PM2 Process Status:"
echo "-------------------"
pm2 status
echo ""

# Check Python service health
echo "Python Service Health:"
echo "----------------------"
if curl -s http://localhost:5001/health > /dev/null 2>&1; then
    HEALTH=$(curl -s http://localhost:5001/health | python3 -m json.tool 2>/dev/null || echo "Unable to parse")
    echo "✓ Python service is healthy"
    echo "$HEALTH"
else
    echo "✗ Python service not responding on port 5001"
fi
echo ""

# Check labeler service
echo "Labeler Service:"
echo "----------------"
if curl -s http://localhost:4100 > /dev/null 2>&1; then
    echo "✓ Labeler is running on port 4100"
else
    echo "✗ Labeler not responding on port 4100"
fi
echo ""

# Check metrics
echo "Metrics Endpoint:"
echo "-----------------"
if curl -s http://localhost:4101/metrics > /dev/null 2>&1; then
    echo "✓ Metrics available at http://localhost:4101/metrics"
    echo ""
    echo "Recent metrics:"
    curl -s http://localhost:4101/metrics | grep -E "(posts_processed|faces_detected|queue)" | head -10
else
    echo "✗ Metrics not available on port 4101"
fi
echo ""

# Recent logs
echo "Recent Logs (last 20 lines):"
echo "----------------------------"
echo ""
echo "Python Service:"
pm2 logs python-service --lines 10 --nostream
echo ""
echo "Labeler:"
pm2 logs labeler --lines 10 --nostream
echo ""

# System resources
echo "System Resources:"
echo "-----------------"
echo "Memory usage:"
free -h | grep -E "Mem|Swap"
echo ""
echo "CPU usage:"
top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print "CPU: " 100 - $1"%"}'
echo ""

echo "============================================"
echo ""
echo "Useful commands:"
echo "  pm2 logs           - View live logs"
echo "  pm2 monit          - Monitor resources"
echo "  pm2 restart all    - Restart services"
echo ""
