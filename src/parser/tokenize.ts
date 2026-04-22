/**
 * Line tokenizer for X32 scene files.
 *
 * Replaces Python's `csv.reader(fobj, delimiter=' ')` which:
 *   - splits on single spaces
 *   - treats `"..."` as a single token with quotes stripped
 *   - escapes doubled-up quotes (`""`) as a literal `"` inside a quoted token
 *
 * Scene-file tokens are overwhelmingly simple (OSC paths, ints, short colour
 * codes), so the only real reason this exists is to keep quoted channel names
 * like `"Lead Vox"` as one token rather than two.
 */
export function tokenizeLine(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const len = line.length;

  while (i < len) {
    // Skip the single-space delimiter; stop on any other whitespace (newline).
    while (i < len && line[i] === ' ') i++;
    if (i >= len) break;

    if (line[i] === '"') {
      i++;
      let value = '';
      while (i < len) {
        if (line[i] === '"') {
          if (i + 1 < len && line[i + 1] === '"') {
            // Escaped quote inside a quoted token.
            value += '"';
            i += 2;
            continue;
          }
          i++; // closing quote
          break;
        }
        value += line[i++];
      }
      tokens.push(value);
    } else {
      let value = '';
      while (i < len && line[i] !== ' ') value += line[i++];
      tokens.push(value);
    }
  }

  return tokens;
}
