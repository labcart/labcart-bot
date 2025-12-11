#!/bin/bash

echo "Starting marketplace bot server with PM2..."
pm2 start ecosystem.config.js

echo ""
echo "Status:"
pm2 list

echo ""
echo "To view logs: pm2 logs marketplace-bot"
echo "To stop: pm2 stop marketplace-bot"
echo "To restart: pm2 restart marketplace-bot"
