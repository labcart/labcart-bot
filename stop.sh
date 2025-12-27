#!/bin/bash

echo "Stopping marketplace bot server..."
pm2 stop marketplace-bot

echo ""
pm2 list
