#!/usr/bin/env node
/**
 * Checks that Infisical can serve every secret name in a wrangler.jsonc's
 * `secrets.required` list, before a deploy. Mirrors the intent of the
 * monorepo's `bun run secrets:doctor`, scaled down for a single-worker repo.
 *
 * Deliberately non-fatal when Infisical itself isn't reachable: this repo is
 * cloned and deployed by self-hosters who have no TailAI Infisical access,
 * and that must keep working exactly as before. Only a confirmed *missing
 * secret* (Infisical reachable, name absent) fails the deploy.
 *
 * Prints secret names only — never values.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_ENV = "prod";

function resolveCli(root) {
	const local = join(root, "node_modules", ".bin", "infisical");
	return existsSync(local) ? local : "infisical";
}

/** Regex-based on purpose: wrangler.jsonc is JSONC (comments), and the
 * `secrets.required` array is a simple string list, so a full parser is
 * more than this needs. */
export function extractRequiredSecrets(text) {
	const match = text.match(/"secrets"\s*:\s*\{[^}]*"required"\s*:\s*\[([^\]]*)\]/s);
	if (!match) return [];
	return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

async function run(cmd, args) {
	const { execFile } = await import("node:child_process");
	return new Promise((resolvePromise) => {
		execFile(cmd, args, { encoding: "utf8" }, (error, stdout, stderr) => {
			resolvePromise({ error, stdout, stderr });
		});
	});
}

/**
 * @param {{root: string, wranglerConfig: string, env?: string, path?: string}} opts
 */
export async function checkRequiredSecrets({
	root,
	wranglerConfig,
	env = process.env.INFISICAL_ENV || DEFAULT_ENV,
	path: secretPath = "/",
}) {
	if (process.env.SKIP_SECRETS_CHECK === "1") return;

	const required = extractRequiredSecrets(readFileSync(wranglerConfig, "utf8"));
	if (required.length === 0) return;

	const cli = resolveCli(root);
	const { error, stdout, stderr } = await run(cli, [
		"secrets",
		`--env=${env}`,
		`--path=${secretPath}`,
		"--recursive",
		"-o",
		"json",
	]);

	if (error) {
		const detail = stderr?.trim() || error.message;
		const notAuthenticated = /infisical login|not authenticated|unauthorized/i.test(detail);
		const cliMissing = /ENOENT|not found/i.test(detail);
		if (cliMissing) {
			console.warn(
				"⚠ infisical CLI not found — skipping the Infisical secrets check.\n" +
					"  (Run `npm install`, then `npm run secrets:login` if you're a TailAI maintainer.)",
			);
			return;
		}
		if (notAuthenticated) {
			console.warn(
				"⚠ Not logged in to Infisical — skipping the Infisical secrets check.\n" +
					"  (Run `npm run secrets:login` if you're a TailAI maintainer. Self-hosters can ignore this.)",
			);
			return;
		}
		console.warn(`⚠ Could not reach Infisical — skipping the secrets check.\n  ${detail}`);
		return;
	}

	let available;
	try {
		available = new Set(JSON.parse(stdout).map((s) => s.secretKey));
	} catch {
		console.warn("⚠ Could not parse Infisical's response — skipping the secrets check.");
		return;
	}

	const missing = required.filter((name) => !available.has(name));
	if (missing.length === 0) return;

	console.error(`
✖ Infisical env "${env}" is missing ${missing.length} secret(s) that wrangler.jsonc requires:
${missing.map((m) => `    ${m}`).join("\n")}

  infisical secrets set --env=${env} --path=${secretPath} ${missing[0]}=<value>

  To deploy anyway: SKIP_SECRETS_CHECK=1 npm run deploy
`);
	process.exit(1);
}
