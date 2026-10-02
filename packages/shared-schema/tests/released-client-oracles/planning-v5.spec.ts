import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  SUPER_SYNC_BASELINE_OP_TYPES,
  SUPER_SYNC_IMPORT_REASONS,
} from '../../src/supersync-http-contract';
import { gitBlobSha, RELEASED_V18_22_0 } from './v18-22-0.fixture';

const releasedSources = RELEASED_V18_22_0.sources;
const withoutImports = (source: string): string => {
  const ast = ts.createSourceFile('released.ts', source, ts.ScriptTarget.Latest, true);
  return ast.statements
    .filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(ast))
    .join('\n');
};
const run = (
  source: string,
  globals: Record<string, unknown>,
): Record<string, unknown> => {
  const exports: Record<string, unknown> = {};
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { ...globals, exports });
  return exports;
};

describe('Planning v5 against the pinned released schema-4 receive boundary', () => {
  it('matches every embedded full source to its pinned released Git blob', () => {
    for (const { source, blobSha } of Object.values(releasedSources)) {
      expect(gitBlobSha(source)).toBe(blobSha);
      expect(gitBlobSha(source + '\n')).not.toBe(blobSha);
    }
  });
  const constants = run(
    withoutImports(
      releasedSources['packages/shared-schema/src/schema-version.ts'].source,
    ),
    {},
  );
  const parserSource =
    releasedSources['src/app/op-log/persistence/schema-migration.service.ts'].source;
  const parserAst = ts.createSourceFile(
    'parser.ts',
    parserSource,
    ts.ScriptTarget.Latest,
    true,
  );
  const parserStatement = parserAst.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (d) => d.name.getText(parserAst) === 'getOperationSchemaVersion',
      ),
  );
  if (!parserStatement) throw new Error('Pinned parser is unavailable');
  const parser = run(parserStatement.getText(parserAst), {});
  // Execute the released guard and parser. The baseline enum remains immutable;
  // no current migration/reducer/receive predicate substitutes for released code.
  const guard = run(
    withoutImports(releasedSources['src/app/op-log/sync/remote-op-block.util.ts'].source),
    {
      ...constants,
      ...parser,
      OpType: Object.fromEntries(
        SUPER_SYNC_BASELINE_OP_TYPES.map((type) => [type, type]),
      ),
      SUPER_SYNC_IMPORT_REASONS,
    },
  );
  const block = guard['getRemoteOpBlockReason'] as (
    op: { schemaVersion: number; opType: string },
    version: number,
  ) => string | null;
  const prefix = guard['takeInterpretableOpPrefix'] as (
    ops: { schemaVersion: number; opType: string }[],
    version: number,
  ) => unknown[];
  it('keeps the interpretable prefix before an unsupported op', () => {
    const supported = { schemaVersion: 4, opType: 'UPD' };
    expect(block(supported, 4)).toBeNull();
    expect(
      prefix([supported, { schemaVersion: 5, opType: 'PLANNING_V1' }, supported], 4),
    ).toEqual([supported]);
  });
  for (const opType of ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR', 'PLANNING_V1'])
    it('blocks ' + opType + ' before hydration and cursor interpretation', () => {
      expect(constants['CURRENT_SCHEMA_VERSION']).toBe(4);
      const future = { schemaVersion: 5, opType };
      expect(block(future, 4)).toBe('VERSION_TOO_NEW');
      expect(prefix([future], 4)).toEqual([]);
    });
  it('independently blocks PLANNING_V1 if a sender incorrectly labels it schema 4', () => {
    expect(block({ schemaVersion: 4, opType: 'PLANNING_V1' }, 4)).toBe(
      'UNKNOWN_OP_VOCABULARY',
    );
  });
});
