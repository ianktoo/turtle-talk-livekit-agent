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

.PHONY: install build debug start stop status logs monitor sync-lib docker-build docker-run help

# Default target
help:
	@echo "Turtle Talk LiveKit agent"
	@echo ""
	@echo "  make install    Install dependencies ($(NPM) install)"
	@echo "  make sync-lib   Fetch shared lib/speech from turtle-talk main repo"
	@echo "  make build      Compile TypeScript"
	@echo "  make debug      Run in dev mode (foreground, for local debugging)"
	@echo "  make start      Build and run in production (foreground)"
	@echo "  make stop       Stop the agent (override STOP_CMD for systemd/pm2)"
	@echo "  make status     Show systemd service status (systemctl --user status)"
	@echo "  make logs       Tail live service logs via journald (Ctrl+C to stop)"
	@echo "  make monitor    Tail the debug log file in real time (Ctrl+C to stop)"
	@echo "  make docker-build  Build Docker image (tag: turtle-talk-agent)"
	@echo "  make docker-run    Run container (requires env vars or --env-file)"
	@echo ""
	@echo "Deployment: set STOP_CMD to your process manager's stop command, e.g.:"
	@echo "  make stop STOP_CMD='systemctl stop turtle-talk-agent'"
	@echo "  make stop STOP_CMD='pm2 stop shelly-agent'"

install:
	$(NPM) install

# Sync shared lib/speech from the turtle-talk main repo.
# Run this whenever lib/speech types or prompts change in the main repo.
# Deploy workflow: make sync-lib && make build
sync-lib:
	@sh scripts/sync-lib.sh

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

status:
	@systemctl --user status turtle-talk-agent

logs:
	@journalctl --user -u turtle-talk-agent -f

# Monitor: tail the debug log (Ctrl+C to stop)
LOG_FILE ?= ../debug-6febbf.log
monitor:
	@touch $(LOG_FILE)
	@echo "Tailing $(LOG_FILE) — Ctrl+C to stop"
	@tail -F $(LOG_FILE)

# Docker: build image (tag turtle-talk-agent)
docker-build:
	docker build -t turtle-talk-agent .

# Docker: run container; pass env from host or use --env-file .env.prod
DOCKER_ENV ?= -e LIVEKIT_URL -e LIVEKIT_API_KEY -e LIVEKIT_API_SECRET -e OPENAI_API_KEY
docker-run:
	docker run --rm $(DOCKER_ENV) turtle-talk-agent
