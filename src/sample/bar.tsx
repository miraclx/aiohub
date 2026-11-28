// The one thing the preview shows that a real hub does not: a bar saying what this is, with a way back to the start.
import {useEffect} from 'react';
import {links, reset} from './fake';

/* `manager`: the manager's view is on screen (not someone's own page, and not signed out). `onReset`: reads the hub again. */
export default function Bar({manager, toast, onReset}: {manager: boolean; toast: (text: string) => void; onReset: () => void}) {
  // A link to a made-up address (a setup on its own server, the web player with this hub's address) has nowhere to go: it says so instead.
  useEffect(() => {
    const stop = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null, host = link ? new URL(link.href).hostname : '';
      if (!link || !(host === 'example.com' || host.endsWith('.example') || host === 'web.aiostreams.org')) return;
      event.preventDefault(); event.stopPropagation(); toast('Preview: this opens another site on a real hub');
    };
    document.addEventListener('click', stop, true);
    return () => document.removeEventListener('click', stop, true);
  }, [toast]);
  const others = manager ? links() : [];
  return <p className="preview-bar">Preview with sample data. Nothing here is saved or sent anywhere. <button type="button" className="link" onClick={() => {reset(); onReset();}}>Reset</button>
    {/* Each person's own page, opened the way their manager opens it on a real hub: through their link. */}
    {!!others.length && <span className="preview-as"> See it as {others.map((person, n) => <span key={person.id}>{n ? ', ' : ''}<a className="link" href={person.link}>{person.name}</a></span>)}.</span>}</p>;
}
