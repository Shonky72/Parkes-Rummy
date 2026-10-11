/**
 * Facebook receives only the public room invitation. Never carry a current
 * page's query string, fragment, or player credentials into an external share.
 */
export function facebookInviteUrl(inviteLink: string): string {
  try {
    const invitation = new URL(inviteLink);
    if (invitation.protocol !== 'https:' || invitation.username || invitation.password) return '';
    if (!/^\/join\/(?:[A-Z0-9]{4}|[A-Z0-9]{6})\/?$/i.test(invitation.pathname)) return '';
    invitation.search = '';
    invitation.hash = '';

    const share = new URL('https://www.facebook.com/sharer/sharer.php');
    share.searchParams.set('u', invitation.href);
    return share.href;
  } catch {
    return '';
  }
}
