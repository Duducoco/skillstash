import { describe, it, expect } from 'vitest';
import { mergeSharedRegistries } from '../src/core/merge.js';
import '../src/i18n/en.js';
import '../src/i18n/zh.js';

function skill(overrides: Record<string, any> = {}) {
  return {
    version: '1.0.0',
    hash: 'abc',
    updatedAt: '2026-01-01T00:00:00Z',
    installedAt: '2026-01-01T00:00:00Z',
    source: 'local',
    enabled: true,
    ...overrides,
  };
}

describe('mergeSharedRegistries', () => {
  it('保留只在本地存在的技能', () => {
    const result = mergeSharedRegistries(
      { skills: {} },
      { skills: { 'local-only': skill() } },
      { skills: {} },
    );
    expect(result.mergedSkills['local-only']).toBeDefined();
    expect(result.winnerMap['local-only']).toBe('ours');
    expect(result.resolutions).toHaveLength(0);
  });

  it('采用只在远端存在的技能', () => {
    const result = mergeSharedRegistries(
      { skills: {} },
      { skills: {} },
      { skills: { 'remote-only': skill() } },
    );
    expect(result.mergedSkills['remote-only']).toBeDefined();
    expect(result.winnerMap['remote-only']).toBe('theirs');
    expect(result.resolutions).toHaveLength(0);
  });

  it('两端 hash 和 version 相同时无 resolution 记录', () => {
    const s = skill();
    const result = mergeSharedRegistries(
      { skills: { foo: s } },
      { skills: { foo: s } },
      { skills: { foo: s } },
    );
    expect(result.mergedSkills['foo']).toBeDefined();
    expect(result.winnerMap['foo']).toBe('ours');
    expect(result.resolutions).toHaveLength(0);
  });

  it('本地 updatedAt 更新时保留本地', () => {
    const base = skill({ hash: 'base', version: '1.0.0', updatedAt: '2026-01-01T00:00:00Z' });
    const ours = skill({ hash: 'ours', version: '1.1.0', updatedAt: '2026-03-01T00:00:00Z' });
    const theirs = skill({ hash: 'theirs', version: '1.0.1', updatedAt: '2026-02-01T00:00:00Z' });

    const result = mergeSharedRegistries(
      { skills: { foo: base } },
      { skills: { foo: ours } },
      { skills: { foo: theirs } },
    );
    expect(result.winnerMap['foo']).toBe('ours');
    expect(result.mergedSkills['foo'].hash).toBe('ours');
    expect(result.resolutions[0].reason).toBe('local version is newer');
  });

  it('远端 updatedAt 更新时采用远端', () => {
    const base = skill({ hash: 'base', version: '1.0.0', updatedAt: '2026-01-01T00:00:00Z' });
    const ours = skill({ hash: 'ours', version: '1.0.1', updatedAt: '2026-02-01T00:00:00Z' });
    const theirs = skill({ hash: 'theirs', version: '1.1.0', updatedAt: '2026-03-01T00:00:00Z' });

    const result = mergeSharedRegistries(
      { skills: { foo: base } },
      { skills: { foo: ours } },
      { skills: { foo: theirs } },
    );
    expect(result.winnerMap['foo']).toBe('theirs');
    expect(result.mergedSkills['foo'].hash).toBe('theirs');
    expect(result.resolutions[0].reason).toBe('remote version is newer');
  });

  it('远端删除、本地未改时跟随删除', () => {
    const s = skill();
    const result = mergeSharedRegistries(
      { skills: { foo: s } },
      { skills: { foo: s } },  // ours same as base
      { skills: {} },           // theirs deleted it
    );
    expect(result.mergedSkills['foo']).toBeUndefined();
    expect(result.winnerMap['foo']).toBe('deleted');
    expect(result.resolutions[0].reason).toBe('deleted by remote');
  });

  it('远端删除但本地改动时保留本地', () => {
    const base = skill({ hash: 'base' });
    const ours = skill({ hash: 'modified', updatedAt: '2026-02-01T00:00:00Z' });
    const result = mergeSharedRegistries(
      { skills: { foo: base } },
      { skills: { foo: ours } },
      { skills: {} },
    );
    expect(result.mergedSkills['foo']).toBeDefined();
    expect(result.winnerMap['foo']).toBe('ours');
    expect(result.resolutions[0].reason).toBe('remote deleted but local has changes, keeping local');
  });

  it('本地删除、远端未改时跟随删除', () => {
    const s = skill();
    const result = mergeSharedRegistries(
      { skills: { foo: s } },
      { skills: {} },   // ours deleted it
      { skills: { foo: s } },  // theirs same as base
    );
    expect(result.mergedSkills['foo']).toBeUndefined();
    expect(result.winnerMap['foo']).toBe('deleted');
    expect(result.resolutions[0].reason).toBe('deleted by local');
  });

  it('本地删除但远端有改动时采用远端', () => {
    const base = skill({ hash: 'base' });
    const theirs = skill({ hash: 'modified', updatedAt: '2026-02-01T00:00:00Z' });
    const result = mergeSharedRegistries(
      { skills: { foo: base } },
      { skills: {} },
      { skills: { foo: theirs } },
    );
    expect(result.mergedSkills['foo']).toBeDefined();
    expect(result.winnerMap['foo']).toBe('theirs');
    expect(result.resolutions[0].reason).toBe('local deleted but remote has changes, taking remote');
  });

  it('base 为 null 时两端技能全部保留', () => {
    const result = mergeSharedRegistries(
      null,
      { skills: { 'skill-a': skill({ hash: 'a' }) } },
      { skills: { 'skill-b': skill({ hash: 'b' }) } },
    );
    expect(result.mergedSkills['skill-a']).toBeDefined();
    expect(result.mergedSkills['skill-b']).toBeDefined();
  });

  it('时间戳相同但内容不同时保留本地', () => {
    const ts = '2026-01-01T00:00:00Z';
    const ours = skill({ hash: 'ours', updatedAt: ts });
    const theirs = skill({ hash: 'theirs', updatedAt: ts });
    const result = mergeSharedRegistries(
      { skills: { foo: ours } },
      { skills: { foo: ours } },
      { skills: { foo: theirs } },
    );
    expect(result.winnerMap['foo']).toBe('ours');
    expect(result.resolutions[0].reason).toBe('same timestamp, keeping local');
  });
});

describe('mergeSharedRegistries: edge cases', () => {
  it('handles missing updatedAt in ours gracefully', () => {
    const base = skill({ hash: 'base' });
    const ours = { ...skill({ hash: 'ours' }), updatedAt: undefined } as any;
    const theirs = skill({ hash: 'theirs', updatedAt: '2026-06-01T00:00:00Z' });

    const result = mergeSharedRegistries(
      { skills: { foo: base } },
      { skills: { foo: ours } },
      { skills: { foo: theirs } },
    );
    expect(result.mergedSkills['foo']).toBeDefined();
    expect(['ours', 'theirs']).toContain(result.winnerMap['foo']);
  });

  it('handles missing updatedAt in theirs gracefully', () => {
    const base = skill({ hash: 'base' });
    const ours = skill({ hash: 'ours', updatedAt: '2026-06-01T00:00:00Z' });
    const theirs = { ...skill({ hash: 'theirs' }), updatedAt: undefined } as any;

    const result = mergeSharedRegistries(
      { skills: { foo: base } },
      { skills: { foo: ours } },
      { skills: { foo: theirs } },
    );
    expect(result.mergedSkills['foo']).toBeDefined();
    expect(['ours', 'theirs']).toContain(result.winnerMap['foo']);
  });

  it('handles large sets of concurrent additions with no conflicts', () => {
    const oursSkills: Record<string, any> = {};
    const theirsSkills: Record<string, any> = {};
    for (let i = 0; i < 50; i++) {
      oursSkills[`local-skill-${i}`] = skill({ hash: `local-${i}` });
    }
    for (let i = 0; i < 50; i++) {
      theirsSkills[`remote-skill-${i}`] = skill({ hash: `remote-${i}` });
    }
    const result = mergeSharedRegistries(
      null,
      { skills: oursSkills },
      { skills: theirsSkills },
    );
    expect(Object.keys(result.mergedSkills)).toHaveLength(100);
    expect(result.resolutions).toHaveLength(0);
  });

  it('processes multiple conflicting skills independently', () => {
    const base = { skills: { a: skill({ hash: 'a-base' }), b: skill({ hash: 'b-base' }) } };
    const ours = {
      skills: {
        a: skill({ hash: 'a-ours', version: '2.0.0', updatedAt: '2026-03-01T00:00:00Z' }),
        b: skill({ hash: 'b-ours', version: '1.0.1', updatedAt: '2026-02-01T00:00:00Z' }),
      },
    };
    const theirs = {
      skills: {
        a: skill({ hash: 'a-theirs', version: '1.0.1', updatedAt: '2026-02-01T00:00:00Z' }),
        b: skill({ hash: 'b-theirs', version: '2.0.0', updatedAt: '2026-03-01T00:00:00Z' }),
      },
    };
    const result = mergeSharedRegistries(base, ours, theirs);
    expect(result.winnerMap['a']).toBe('ours');   // ours is newer for a
    expect(result.winnerMap['b']).toBe('theirs'); // theirs is newer for b
  });
});
