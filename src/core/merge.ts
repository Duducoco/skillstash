export interface SkillResolution {
  skill: string;
  winner: 'ours' | 'theirs' | 'deleted';
  reason: string;
}

export interface MergeResult {
  mergedSkills: Record<string, any>;
  resolutions: SkillResolution[];
  winnerMap: Record<string, 'ours' | 'theirs' | 'deleted'>;
}

/**
 * Three-way merge of the shared registry.json skills section.
 * Uses updatedAt timestamps to decide which device's version wins on conflict.
 * base may be null on first divergence (treated as empty).
 */
export function mergeSharedRegistries(
  base: { skills: Record<string, any> } | null,
  ours: { skills: Record<string, any> },
  theirs: { skills: Record<string, any> },
): MergeResult {
  const mergedSkills: Record<string, any> = {};
  const resolutions: SkillResolution[] = [];
  const winnerMap: Record<string, 'ours' | 'theirs' | 'deleted'> = {};

  const baseSkills = base?.skills ?? {};
  const oursSkills = ours.skills ?? {};
  const theirsSkills = theirs.skills ?? {};

  const allNames = new Set([
    ...Object.keys(oursSkills),
    ...Object.keys(theirsSkills),
    ...Object.keys(baseSkills),
  ]);

  for (const name of allNames) {
    const inOurs = name in oursSkills;
    const inTheirs = name in theirsSkills;
    const inBase = name in baseSkills;

    const oursSkill = oursSkills[name];
    const theirsSkill = theirsSkills[name];
    const baseSkill = baseSkills[name];

    if (inOurs && inTheirs) {
      if (sameSkill(oursSkill, theirsSkill)) {
        mergedSkills[name] = oursSkill;
        winnerMap[name] = 'ours';
      } else {
        const oursTime = new Date(oursSkill.updatedAt ?? 0).getTime();
        const theirsTime = new Date(theirsSkill.updatedAt ?? 0).getTime();
        if (oursTime >= theirsTime) {
          mergedSkills[name] = oursSkill;
          winnerMap[name] = 'ours';
          resolutions.push({
            skill: name,
            winner: 'ours',
            reason: oursTime > theirsTime ? '本地版本更新' : '时间戳相同，保留本地',
          });
        } else {
          mergedSkills[name] = theirsSkill;
          winnerMap[name] = 'theirs';
          resolutions.push({ skill: name, winner: 'theirs', reason: '远端版本更新' });
        }
      }
    } else if (inOurs && !inTheirs) {
      if (inBase && !sameSkill(oursSkill, baseSkill)) {
        // We modified it, they deleted it — keep ours
        mergedSkills[name] = oursSkill;
        winnerMap[name] = 'ours';
        resolutions.push({ skill: name, winner: 'ours', reason: '远端已删除，本地有改动，保留本地' });
      } else if (inBase) {
        // We didn't modify it, they deleted it — follow deletion
        winnerMap[name] = 'deleted';
        resolutions.push({ skill: name, winner: 'deleted', reason: '远端已删除' });
      } else {
        // Added locally only — keep
        mergedSkills[name] = oursSkill;
        winnerMap[name] = 'ours';
      }
    } else if (!inOurs && inTheirs) {
      if (inBase && !sameSkill(theirsSkill, baseSkill)) {
        // They modified it, we deleted it — take theirs
        mergedSkills[name] = theirsSkill;
        winnerMap[name] = 'theirs';
        resolutions.push({ skill: name, winner: 'theirs', reason: '本地已删除，远端有改动，采用远端' });
      } else if (inBase) {
        // We deleted, they didn't modify — stay deleted
        winnerMap[name] = 'deleted';
        resolutions.push({ skill: name, winner: 'deleted', reason: '本地已删除' });
      } else {
        // Added remotely only — take
        mergedSkills[name] = theirsSkill;
        winnerMap[name] = 'theirs';
      }
    }
    // !inOurs && !inTheirs && inBase → deleted by both, stay absent
  }

  return { mergedSkills, resolutions, winnerMap };
}

function sameSkill(a: any, b: any): boolean {
  return a?.hash === b?.hash && a?.version === b?.version;
}
