# Turtle Talk LiveKit agent — production image
# Build: docker build -t turtle-talk-agent .
# Run:   docker run --rm -e LIVEKIT_URL -e LIVEKIT_API_KEY -e LIVEKIT_API_SECRET -e OPENAI_API_KEY turtle-talk-agent

FROM node:20-alpine AS builder

WORKDIR /app

# Install deps (including devDependencies for build)
COPY package.json package-lock.json* ./
RUN npm ci

# Build TypeScript
COPY tsconfig.json main.ts agent.ts ./
RUN npm run build

# ---

FROM node:20-alpine AS runner

WORKDIR /app

# Production deps only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Built output
COPY --from=builder /app/main.js /app/agent.js ./

# Env vars at runtime: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, OPENAI_API_KEY
CMD ["node", "main.js", "start"]
