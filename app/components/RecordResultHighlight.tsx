'use client';
import { useState } from 'react';
import { BookOpen, Download, Share2 } from 'lucide-react';
import type { PublicRoom } from '../../lib/types';
import type { SharePreview } from '../../db/records';
import { progressRequest, shareProgressImage } from '../../lib/progress-client';
import '../progress.css';

/** Mounted inside the established results gate, after the winning/reveal sequence. */
export default function RecordResultHighlight({ record }: { record: NonNullable<PublicRoom['completedRecord']> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [share, setShare] = useState<SharePreview | null>(null), [notice, setNotice] = useState('');
  async function publishShare() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const selected = share ?? (await progressRequest<{ share: SharePreview }>('/api/records', { action: 'createShare', handId: record.handId })).share;
      setShare(selected);
      const result = await shareProgressImage(selected);
      setNotice(result === 'copied' ? 'Record link copied.' : result === 'cancelled' ? 'Your link is ready. Save the image or manage the link in My profile.' : 'Your shared record is ready.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Open My profile to share this record.'); }
    finally { setBusy(false); }
  }
  return <section className="record-result-highlight" aria-label="Your hand record">
    <p><strong>{record.openingTurn === null ? 'Opening not completed this hand.' : `Your opening: Turn ${record.openingTurn}.`}</strong>{record.firstLegalTurn !== null ? ` First legal chance: Turn ${record.firstLegalTurn}.` : ''}{record.opportunitiesPassed ? ` Legal opportunities passed: ${record.opportunitiesPassed}.` : ''}</p>
    {record.achievements.length > 0 && <p>{record.achievements.map(id => id.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')).join(' · ')}</p>}
    <div className="progress-actions">
      <a className="button outline" href={`/profile?tab=history&handId=${encodeURIComponent(record.handId)}`}><BookOpen size={16}/>View record</a>
      {record.openingTurn !== null && <button className="button outline" disabled={busy} onClick={() => { void publishShare(); }}><Share2 size={16}/>{busy ? 'Preparing…' : 'Share record'}</button>}
      {share && <a className="button outline" href={share.imageUrl} download="parkes-rummy-record.png"><Download size={16}/>Save image</a>}
    </div>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
