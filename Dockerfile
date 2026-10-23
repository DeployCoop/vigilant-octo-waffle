# Multi-stage Dockerfile for Vigilant Octo Waffle Next.js Web Control Plane
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Install system dependencies & CLIs needed for cluster management
RUN apt-get update && apt-get install -y \
    curl \
    git \
    bash \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install kubectl (pinned + checksum-verified, Plan III §8.1).
# Dependabot does not track these curl installs: bump KUBECTL_VERSION and
# KUBECTL_SHA256 together. The digest is the official
# https://dl.k8s.io/release/<version>/bin/linux/amd64/kubectl.sha256 file.
ARG KUBECTL_VERSION="v1.32.2"
ARG KUBECTL_SHA256="4f6a959dcc5b702135f8354cc7109b542a2933c46b808b248a214c1f69f817ea"
RUN curl -LO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
    && echo "${KUBECTL_SHA256}  kubectl" | sha256sum -c - \
    && chmod +x kubectl \
    && mv kubectl /usr/local/bin/

# Install kind (pinned + checksum-verified, Plan III §8.1).
# Bump KIND_VERSION and KIND_SHA256 together; the digest is the official
# kind-linux-amd64.sha256sum published with the kind release.
ARG KIND_VERSION="v0.27.0"
ARG KIND_SHA256="a6875aaea358acf0ac07786b1a6755d08fd640f4c79b7a2e46681cc13f49a04b"
RUN curl -Lo ./kind "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-amd64" \
    && echo "${KIND_SHA256}  kind" | sha256sum -c - \
    && chmod +x ./kind \
    && mv ./kind /usr/local/bin/kind

# Install helm (pinned + checksum-verified, Plan III §8.1).
# HELM_VERSION must match the azure/setup-helm pin in
# .github/workflows/ci.yml (Plan III §8.2) so CI tests the helm the image
# ships. Bump HELM_VERSION and HELM_SHA256 together; the digest is the
# official https://get.helm.sh/helm-<version>-linux-amd64.tar.gz.sha256sum.
ARG HELM_VERSION="v3.17.1"
ARG HELM_SHA256="3b66f3cd28409f29832b1b35b43d9922959a32d795003149707fea84cbcd4469"
RUN curl -fsSL -o helm.tar.gz "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" \
    && echo "${HELM_SHA256}  helm.tar.gz" | sha256sum -c - \
    && tar -zxvf helm.tar.gz \
    && mv linux-amd64/helm /usr/local/bin/helm \
    && chmod +x /usr/local/bin/helm \
    && rm -rf linux-amd64 helm.tar.gz

WORKDIR /app

FROM base AS builder
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/
# The orchestrator shells out to the bash runners and templates under
# src/ at runtime and locates the workspace root via src/default.env;
# the tree must ship in the image (Plan III §8.4 runtime contents).
COPY src/ ./src/

RUN pnpm install --frozen-lockfile
RUN pnpm build

# Ship production-only node_modules in the runner stage (Plan III §8.4):
# a production re-install across every workspace importer, after the
# build. Two traps, both hit in this PR's CI and fixed the way pnpm
# itself prescribes:
# - No CI=true here: under CI, pnpm records enableGlobalVirtualStore
#   as false in the install state, while the runtime (no CI) computes
#   the pnpm 11 default — so `pnpm start`'s deps-status check judged
#   the tree out of sync and reinstalled at every boot. The purge
#   confirmation the build cannot answer interactively is instead
#   disabled by name (pnpm_config_confirm_modules_purge=false).
# - --ignore-scripts: the pass re-runs workspace lifecycle scripts,
#   and the orchestrator's `prepare` is `tsc` — but TypeScript is a
#   devDependency being removed by this very pass. The dist output is
#   already built above; nothing needs to re-run.
RUN pnpm_config_confirm_modules_purge=false pnpm install --prod --frozen-lockfile --ignore-scripts

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Run as the image's non-root node user (uid 1000, Plan III §8.4). The
# app writes runtime state (.vow/) under /app, so the copy is chowned.
COPY --from=builder --chown=node:node /app ./
# The /app directory itself predates the copy (the base stage's
# WORKDIR created it as root); COPY --chown covers the copied files,
# not that directory inode. The app creates state directories directly
# under /app at runtime, so the directory must be node-owned too.
RUN chown node:node /app
USER node

EXPOSE 3000
CMD ["pnpm", "start"]
