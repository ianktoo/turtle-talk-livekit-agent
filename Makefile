# Turtle Talk LiveKit agent — make targets for local dev and deployment
#
# Usage:
#   make install   # install dependencies
#   make build     # compile TypeScript
#   make debug     # run in dev mode (foreground, with tsx) — for local debugging
#   make start     # build and run in production mode (foreground)
#   make stop      # stop the agent (see STOP_CMD below for deployment)
#
# On a deployed server you can override how to stop, e.g.:
#   make stop STOP_CMD="systemctl stop turtle-talk-agent"
#   make stop STOP_CMD="pm2 stop shelly-agent"
# Or run start under a process manager and use that manager's stop command.

SHELL := /bin/sh
NPM := npm
# Prefer pnpm if available (run: make install NPM=pnpm, or set in env)
ifneq (,$(shell command -v pnpm 2>/dev/null))
	NPM := pnpm
endif

.PHONY: install build debug start stop docker-build docker-run help

# Default target
help:
	@echo "Turtle Talk LiveKit agent"
	@echo ""
	@echo "  make install   Install dependencies ($(NPM) install)"
	@echo "  make build    Compile TypeScript"
	@echo "  make debug    Run in dev mode (foreground, for local debugging)"
	@echo "  make start    Build and run in production (foreground)"
	@echo "  make stop     Stop the agent (override STOP_CMD for systemd/pm2)"
	@echo "  make docker-build  Build Docker image (tag: turtle-talk-agent)"
	@echo "  make docker-run    Run container (requires env vars or --env-file)"
	@echo ""
	@echo "Deployment: set STOP_CMD to your process manager's stop command, e.g.:"
	@echo "  make stop STOP_CMD='systemctl stop turtle-talk-agent'"
	@echo "  make stop STOP_CMD='pm2 stop shelly-agent'"

install:
	$(NPM) install

build:
	$(NPM) run build

# Dev mode: tsx main.ts dev — connects to LiveKit, hot reload not applicable but useful for debugging
debug:
	$(NPM) run dev

# Production: compile then node main.js start
start: build
	$(NPM) run start

# Stop the agent. Default: pkill on Unix. Override on Windows or for deployment:
#   make stop STOP_CMD="taskkill //F //IM node.exe"
#   make stop STOP_CMD="systemctl stop turtle-talk-agent"
#   make stop STOP_CMD="pm2 stop shelly-agent"
STOP_CMD ?= pkill -f "node.*main\.js start" 2>/dev/null || true
stop:
	@echo "Stopping agent: $(STOP_CMD)"
	@$(STOP_CMD)

# Docker: build image (tag turtle-talk-agent)
docker-build:
	docker build -t turtle-talk-agent .

# Docker: run container; pass env from host or use --env-file .env.prod
DOCKER_ENV ?= -e LIVEKIT_URL -e LIVEKIT_API_KEY -e LIVEKIT_API_SECRET -e OPENAI_API_KEY
docker-run:
	docker run --rm $(DOCKER_ENV) turtle-talk-agent
