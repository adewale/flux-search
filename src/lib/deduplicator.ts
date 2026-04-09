import type { IssueRow } from '../db/types';
import { getIssueBySourceUrl, getIssueByContentHash } from '../db/queries';

export interface DeduplicationResult {
  isDuplicate: boolean;
  existingIssue?: IssueRow;
  reason?: string;
}

export async function checkDuplicate(
  db: D1Database,
  sourceUrl: string,
  contentHash: string,
  issueNumber: number | null,
  publishedAt: string | null
): Promise<DeduplicationResult> {
  const byUrl = await getIssueBySourceUrl(db, sourceUrl);
  if (byUrl) {
    return { isDuplicate: true, existingIssue: byUrl, reason: 'source_url' };
  }

  if (contentHash) {
    const byHash = await getIssueByContentHash(db, contentHash);
    if (byHash) {
      return { isDuplicate: true, existingIssue: byHash, reason: 'content_hash' };
    }
  }

  if (issueNumber && publishedAt) {
    const byNumberDate = await db.prepare(
      'SELECT * FROM issues WHERE issue_number = ? AND published_at = ? AND status = ?'
    ).bind(issueNumber, publishedAt, 'active').first<IssueRow>();
    if (byNumberDate) {
      return { isDuplicate: true, existingIssue: byNumberDate, reason: 'issue_number_date' };
    }
  }

  return { isDuplicate: false };
}
