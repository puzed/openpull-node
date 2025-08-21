#!/usr/bin/env node --experimental-strip-types
/**
 * OpenPull CLI Tool
 *
 * Wraps any command, captures its stdout/stderr, and forwards lines
 * to OpenPull using the library’s forwarding connection. This file is
 * executed as a Node.js script and relies on compiled JS output.
 */

import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createConnection } from '../dist/connection-manager.js';
import { getActiveWebRTCManager } from '../dist/connection.js';
import { getBufferSize } from '../dist/log-buffer.js';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    url: {
      type: 'string',
      short: 'u',
      default: process.env.OPENPULL_URL,
    },
    help: {
      type: 'boolean',
      short: 'h',
    },
    version: {
      type: 'boolean',
      short: 'v',
    },
  },
});

/** Print CLI usage information. */
function showHelp(): void {
  console.log(`
OpenPull CLI - Stream stdout/stderr to OpenPull dashboard

Usage:
  openpull [options] -- <command> [args...]

Options:
  -u, --url <url>     OpenPull connection URL (default: $OPENPULL_URL)
  -h, --help          Show this help message
  -v, --version       Show version number

Environment Variables:
  OPENPULL_URL        Default connection URL

Examples:
  openpull --url "openpull://appender:key@session.localhost:3000/" -- node app.js
  openpull -- npm test
  openpull -- python script.py

The CLI will forward all stdout/stderr from the spawned process to OpenPull,
parsing JSON logs when possible and treating plain text as info logs.
`);
}

/** Resolve the package version from package.json and print it. */
async function showVersion(): Promise<void> {
  try {
    const { readFile } = await import('node:fs/promises');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    
    const packagePath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json');
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
    console.log(packageJson.version);
  } catch {
    console.log('unknown');
  }
}

/** Parse CLI args, establish connection, and proxy a child process. */
async function main(): Promise<void> {
  if (values.help) {
    showHelp();
    process.exit(0);
  }

  if (values.version) {
    await showVersion();
    process.exit(0);
  }

  if (!values.url) {
    console.error('Error: OpenPull URL is required. Use --url or set OPENPULL_URL environment variable.');
    console.error('Run "openpull --help" for usage information.');
    process.exit(1);
  }

  if (positionals.length === 0) {
    console.error('Error: Command is required.');
    console.error('Run "openpull --help" for usage information.');
    process.exit(1);
  }

  // Find the -- separator
  const separatorIndex = process.argv.findIndex(arg => arg === '--');
  if (separatorIndex === -1) {
    console.error('Error: Command must be preceded by "--"');
    console.error('Example: openpull --url "..." -- node app.js');
    process.exit(1);
  }

  const command = positionals[0];
  const args = positionals.slice(1);

  try {
    console.log(`[OpenPull] Connecting to: ${values.url}`);
    const connection = await createConnection(values.url);
    
    console.log(`[OpenPull] Spawning: ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      stdio: 'pipe',
      env: process.env,
    });

    // Forward stdout/stderr through OpenPull
    const cleanup = await connection.forwardStreams(child.stdout!, child.stderr!);

    // Handle child process events
    child.on('error', (error) => {
      console.error(`[OpenPull] Failed to start child process: ${error.message}`);
      cleanup();
      process.exit(1);
    });

    child.on('exit', async (code, signal) => {
      if (signal) {
        console.log(`[OpenPull] Child process killed with signal ${signal}`);
      } else {
        console.log(`[OpenPull] Child process exited with code ${code}`);
      }
      cleanup();

      // If we have buffered logs but no readers yet, wait briefly to allow flush
      const buffered = getBufferSize();
      const manager = getActiveWebRTCManager();
      const hasReaders = manager?.getConnectionCount?.() && manager.getConnectionCount() > 0;
      const maxWaitMs = Number(process.env.OPENPULL_EXIT_DELAY_MS || process.env.OPENPULL_FLUSH_TIMEOUT_MS || 2500);

      if (buffered > 0 && !hasReaders && manager) {
        await new Promise<void>((resolve) => {
          let resolved = false;
          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          }, Math.max(0, maxWaitMs));

          const unsubscribe = manager.onConnection?.((_peerId: string, connected: boolean) => {
            if (connected && !resolved) {
              // Give a tiny moment for buffered send to occur
              setTimeout(() => {
                if (!resolved) {
                  resolved = true;
                  clearTimeout(timeout);
                  resolve();
                }
              }, 150);
              if (typeof unsubscribe === 'function') unsubscribe();
            }
          });
        });
      }

      process.exit(code ?? 1);
    });

    // Forward stdin to child
    process.stdin.pipe(child.stdin);

    // Handle process termination
    process.on('SIGINT', () => {
      console.log('[OpenPull] Received SIGINT, terminating child process...');
      child.kill('SIGINT');
    });

    process.on('SIGTERM', () => {
      console.log('[OpenPull] Received SIGTERM, terminating child process...');
      child.kill('SIGTERM');
    });

  } catch (error) {
    console.error(`[OpenPull] Connection error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[OpenPull] Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
