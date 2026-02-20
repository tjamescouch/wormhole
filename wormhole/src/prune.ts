/**
 * Branch pruning logic — delete remote feature branches merged to main.
 */

import { execSync } from 'node:child_process';

export interface PruneOptions {
  dryRun?: boolean;
  baseBranch?: string;
}

export interface PruneResult {
  deleted: string[];
  skipped: string[];
  errors: Array<{ branch: string; error: string }>;
}

/**
 * Prune merged feature branches from remote.
 *
 * Finds all remote feature/* branches that are fully merged into main
 * and deletes them. Protected branches (main, develop, etc.) are never deleted.
 */
export async function pruneRemoteBranches(options: PruneOptions = {}): Promise<PruneResult> {
  const dryRun = options.dryRun ?? false;
  const baseBranch = options.baseBranch ?? 'main';

  const result: PruneResult = {
    deleted: [],
    skipped: [],
    errors: [],
  };

  try {
    // Fetch latest from origin
    console.log('Fetching latest branches from origin...');
    execSync('git fetch --prune', { stdio: 'inherit' });

    // Get all remote feature branches
    const remoteBranchesRaw = execSync('git branch -r', { encoding: 'utf8' });
    const remoteBranches = remoteBranchesRaw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('origin/feature/'))
      .map((line) => line.replace('origin/', ''));

    if (remoteBranches.length === 0) {
      console.log('No feature branches found.');
      return result;
    }

    console.log(`Found ${remoteBranches.length} feature branches.`);

    // Check which branches are merged into base
    const mergedBranchesRaw = execSync(`git branch -r --merged origin/${baseBranch}`, { encoding: 'utf8' });
    const mergedBranches = new Set(
      mergedBranchesRaw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('origin/feature/'))
        .map((line) => line.replace('origin/', ''))
    );

    console.log(`${mergedBranches.size} feature branches are merged into ${baseBranch}.`);

    // Delete merged branches
    for (const branch of remoteBranches) {
      if (!mergedBranches.has(branch)) {
        result.skipped.push(branch);
        continue;
      }

      try {
        if (dryRun) {
          console.log(`[DRY RUN] Would delete origin/${branch}`);
          result.deleted.push(branch);
        } else {
          console.log(`Deleting origin/${branch}...`);
          execSync(`git push origin --delete ${branch}`, { stdio: 'inherit' });
          result.deleted.push(branch);
        }
      } catch (error: any) {
        const errorMsg = error.message || String(error);
        console.error(`Failed to delete ${branch}: ${errorMsg}`);
        result.errors.push({ branch, error: errorMsg });
      }
    }

    return result;
  } catch (error: any) {
    console.error(`Prune failed: ${error.message}`);
    throw error;
  }
}
