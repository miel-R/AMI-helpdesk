@echo off
echo ====================================
echo Fixing Helpdesk Bot Installation
echo ====================================

echo.
echo Step 1: Installing dependencies...
npm install express dotenv node-cache uuid axios @types/express @types/node @types/node-cache @types/uuid typescript ts-node nodemon

echo.
echo Step 2: Installing TypeScript globally...
npm install -g typescript ts-node nodemon

echo.
echo Step 3: Building the project...
npx tsc

echo.
echo ====================================
echo Done! Run 'npm run dev' to start
echo ====================================
pause