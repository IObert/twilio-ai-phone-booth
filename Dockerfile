FROM node:22-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install ALL dependencies (including devDependencies for TypeScript)
RUN pnpm install --frozen-lockfile

# Copy app source code
COPY app ./app

# Copy other necessary files
COPY .env.example ./

# Expose port
EXPOSE 8000

# Set NODE_ENV to production (optional but recommended)
ENV NODE_ENV=production

# Start server
CMD ["pnpm", "start"]

