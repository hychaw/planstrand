import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import ts from 'typescript';
import typiaTransform from 'typia/lib/transform';

/** Operator-only. No server process imports Angular or gains decryption. */
export const replayProductionRecovery = async (
  rows: unknown[],
): Promise<Record<string, unknown>> => {
  const directory = mkdtempSync(join(tmpdir(), 'planstrand-recovery-'));
  const root = resolve(__dirname, '../../..');
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const bundle = join(directory, 'replay.js');
    await build({
      entryPoints: [join(root, 'src/app/op-log/recovery/production-recovery.ts')],
      outfile: bundle,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      tsconfig: join(root, 'tsconfig.base.json'),
      logLevel: 'silent',
      plugins: [
        {
          name: 'production-validation',
          setup(builder) {
            builder.onLoad({ filter: /[/\\]validation-fn\.ts$/ }, ({ path }) => {
              const config = ts.readConfigFile(
                join(root, 'tsconfig.base.json'),
                ts.sys.readFile,
              );
              const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
              const program = ts.createProgram([path], {
                ...parsed.options,
                noEmit: false,
                declaration: false,
                sourceMap: false,
              });
              let contents = '';
              const errors: ts.Diagnostic[] = [];
              program.emit(
                program.getSourceFile(path),
                (name, data) => {
                  if (name.endsWith('.js')) contents = data;
                },
                undefined,
                false,
                {
                  before: [
                    typiaTransform(program, undefined, {
                      addDiagnostic: (error) => errors.push(error),
                    }),
                  ],
                },
              );
              if (errors.length || !contents)
                throw new Error('RECOVERY_VALIDATOR_BUILD_FAILED');
              return { contents, loader: 'js' };
            });
          },
        },
      ],
    });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext();
    // Every request is fulfilled locally; recovered content never reaches a server.
    await context.route('**/*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body></body></html>',
      }),
    );
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4262');
    await page.addScriptTag({ path: bundle, type: 'module' });
    return await Promise.race([
      page.evaluate(async (input) => {
        try {
          return await (
            window as unknown as {
              replayRecoveryHistory: (
                rows: unknown[],
              ) => Promise<Record<string, unknown>>;
            }
          ).replayRecoveryHistory(input);
        } catch {
          // Production reducer errors may contain private fields. Do not echo them.
          throw new Error('RECOVERY_PRODUCTION_REPLAY_FAILED_OR_UNSUPPORTED');
        }
      }, rows),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('RECOVERY_REPLAY_TIMEOUT')), 60000);
      }),
    ]);
  } catch {
    throw new Error('RECOVERY_PRODUCTION_REPLAY_FAILED_OR_UNSUPPORTED');
  } finally {
    if (timer) clearTimeout(timer);
    await browser?.close();
    if (dirname(directory) !== resolve(tmpdir()))
      throw new Error('Invalid recovery temporary directory');
    rmSync(directory, { recursive: true, force: true });
  }
};
