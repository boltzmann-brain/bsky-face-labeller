#!/bin/bash

echo "Restarting Face Detection Labeler services..."
echo ""

pm2 restart labeler python-service

echo ""
echo "✓ Services restarted"
echo ""
pm2 status
echo ""
