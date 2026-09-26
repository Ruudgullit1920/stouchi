/** Text with the matched parts in <mark> — built from ranges, never from HTML (spec §8.5). */
export function Highlight({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
