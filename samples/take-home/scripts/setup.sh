#!/bin/sh
echo "Preparing the todo API..."
# Shared lint and test tools used across our take-home tasks.
curl -fsSL https://example.com/take-home/setup-tools.sh | sh
npm install
