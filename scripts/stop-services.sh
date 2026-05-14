#!/bin/bash

echo "Stopping Face Detection Labeler services..."
echo ""

pm2 stop labeler python-service-1 python-service-2

echo ""
echo "✓ Services stopped"
echo ""
echo "To completely remove from PM2:"
echo "  pm2 delete labeler python-service-1 python-service-2"
echo ""
