'use client';

import { Copy, ExternalLink, Share2 } from 'lucide-react';
import { facebookInviteUrl } from '@/lib/invite-share';

export interface InviteActionsProps {
  inviteLink: string;
  hostName?: string;
  onShare: () => void | Promise<unknown>;
  onCopy: () => void | Promise<unknown>;
  disabled?: boolean;
}

/** Opens user-controlled sharing tools. No friends or account data is accessed. */
export function InviteActions({
  inviteLink,
  hostName,
  onShare,
  onCopy,
  disabled = false,
}: InviteActionsProps) {
  const unavailable = disabled || !inviteLink;
  const facebookUrl = facebookInviteUrl(inviteLink);
  const tableLabel = hostName ? `${hostName}’s table` : 'this table';

  return (
    <div className="invite-actions" role="group" aria-label="Invite friends">
      <button type="button" className="button gold invite-share-button" disabled={unavailable} onClick={() => void onShare()}>
        <Share2 size={21} aria-hidden="true"/>Share invite
      </button>
      {unavailable || !facebookUrl ? (
        <button type="button" className="button outline invite-facebook-button" disabled>
          <span className="invite-facebook-mark" aria-hidden="true">f</span>Facebook
        </button>
      ) : (
        <a
          className="button outline invite-facebook-button"
          href={facebookUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Share an invitation to ${tableLabel} on Facebook, opens a new tab`}
        >
          <span className="invite-facebook-mark" aria-hidden="true">f</span>Facebook
          <ExternalLink size={12} className="invite-external-icon" aria-hidden="true"/>
        </a>
      )}
      <button type="button" className="button outline invite-copy-button" disabled={unavailable} onClick={() => void onCopy()}>
        <Copy size={18} aria-hidden="true"/>Copy link
      </button>
    </div>
  );
}
