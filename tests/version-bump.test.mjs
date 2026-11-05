import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

test('version bump records releases sharing the same minimum app version', () => {
	const cwd = mkdtempSync(path.join(tmpdir(), 'sequencer-version-'));
	try {
		writeFileSync(path.join(cwd, 'manifest.json'), JSON.stringify({ version: '0.4.0', minAppVersion: '1.6.6' }));
		writeFileSync(path.join(cwd, 'versions.json'), JSON.stringify({ '0.4.0': '1.6.6' }));
		execFileSync(process.execPath, [path.resolve('version-bump.mjs')], {
			cwd,
			env: { ...process.env, npm_package_version: '0.5.0' },
		});
		assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, 'manifest.json'), 'utf8')), {
			version: '0.5.0', minAppVersion: '1.6.6',
		});
		assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, 'versions.json'), 'utf8')), {
			'0.4.0': '1.6.6', '0.5.0': '1.6.6',
		});
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
