#!/bin/bash

echo "🚀 Setting up RIO (Relational Intelligence Orchestrator)"

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ is required"
    exit 1
fi

echo "✓ Node.js version OK"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create directories
mkdir -p logs
mkdir -p data

# Copy env file
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✓ Created .env file - please configure it"
else
    echo "✓ .env file exists"
fi

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Configure your .env file"
echo "2. Start MongoDB"
echo "3. Run: npm run dev"
echo ""