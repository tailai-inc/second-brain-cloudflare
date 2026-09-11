#!/usr/bin/env sh
# Run a command with Infisical secrets injected into its process environment.
#
# Mirrors the monorepo's scripts/secrets/with-secrets.sh. Locally `infisical
# login` puts a token in the OS keyring, so nothing is written to disk here.
#
# CLOUDFLARE_INCLUDE_PROCESS_ENV is what makes `wrangler dev` put these into
# the Worker's `env` object, via the `secrets.required` list in
# wrangler.jsonc. It only applies when there is no .dev.vars file.
#
# This project's Infisical project currently only has a "prod" environment,
# so that is the default here (unlike the monorepo, which defaults to "dev").
set -e

export CLOUDFLARE_INCLUDE_PROCESS_ENV=true

# Prefer the workspace copy (pinned in package.json) over whatever is
# installed globally, and find it even when PATH does not include
# node_modules/.bin.
INFISICAL_BIN="$(git rev-parse --show-toplevel 2>/dev/null || echo .)/node_modules/.bin/infisical"
if [ ! -x "$INFISICAL_BIN" ]; then
	if command -v infisical >/dev/null 2>&1; then
		INFISICAL_BIN=infisical
	else
		echo "infisical CLI not found. Run 'npm install', then 'npm run secrets:login' once." >&2
		exit 127
	fi
fi

exec "$INFISICAL_BIN" run \
	--env="${INFISICAL_ENV:-prod}" \
	--path="${INFISICAL_PATH:-/}" \
	--recursive \
	-- "$@"
