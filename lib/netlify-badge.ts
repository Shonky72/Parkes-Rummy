/** Only the identified hosting badge is repositioned. No iframe content is read,
 * rewritten, hidden or recreated, preserving its original browsing context. */
export function positionNetlifyBadge(): boolean {
  const frame = document.querySelector<HTMLIFrameElement>('body > iframe#nl-badge-frame[title="Powered by Netlify"]');
  const page = document.querySelector<HTMLElement>('.parkes-app');
  if (!frame || !page) return false;
  const frameHeight = frame.offsetHeight;
  const dock = page.querySelector<HTMLElement>('.your-hand');
  const dockHeight = dock && getComputedStyle(dock).position === 'fixed' ? dock.getBoundingClientRect().height : 0;
  const offset = Math.ceil(page.getBoundingClientRect().bottom - document.body.getBoundingClientRect().top + 8);
  const set = (element: HTMLElement, key: string, value: string) => {
    if (element.style.getPropertyValue(key) !== value) element.style.setProperty(key, value);
  };
  set(frame, '--parkes-badge-top', `${offset}px`);
  set(document.body, '--parkes-badge-clearance', `${Math.ceil(frameHeight + dockHeight + 24)}px`);
  return true;
}
