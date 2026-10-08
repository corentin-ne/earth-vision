import type { MultiLineString, Position } from 'geojson';

/** On a cut of the data rather than a real edge: the antimeridian or a pole. */
const onCut = (a: Position, b: Position) =>
  (Math.abs(a[0]) >= 179.999 && Math.abs(b[0]) >= 179.999 && Math.sign(a[0]) === Math.sign(b[0])) ||
  (Math.abs(a[1]) >= 89.99 && Math.abs(b[1]) >= 89.99);

/**
 * Removes the stretches of lines that run along the cuts in the data. The engine already
 * skips arcs lying entirely on a cut, but an arc can also run along the coast and then
 * follow the cut (Antarctica along the south pole, shapes cut at 180°), which would draw
 * a false coast: a ring round the polar cap, or a line down the Bering Strait.
 */
export function dropCuts(g: MultiLineString): MultiLineString {
  const out: Position[][] = [];
  for (const line of g.coordinates) {
    let run: Position[] = [line[0]];
    for (let i = 1; i < line.length; i++) {
      if (onCut(line[i - 1], line[i])) {
        if (run.length > 1) out.push(run);
        run = [line[i]];
      } else run.push(line[i]);
    }
    if (run.length > 1) out.push(run);
  }
  return { type: 'MultiLineString', coordinates: out };
}

