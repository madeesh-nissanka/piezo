/**
 * Piezo Parser - Pattern matching for solver output
 */
export class Parser {
  constructor(patterns) {
    this.patterns = patterns.map(p => ({
      ...p,
      regex: new RegExp(p.regex, p.flags || ""),
    }));
    this.summary = {
      lastProgress: null,
      warningCount: 0,
      errorCount: 0,
      converged: null,
    };
  }

  parseLine(lineNo, text) {
    const events = [];
    for (const pattern of this.patterns) {
      const match = text.match(pattern.regex);
      if (match) {
        const event = {
          t: Date.now(),
          line_no: lineNo,
          type: pattern.type || "info",
          name: pattern.name,
          fields: {},
          text,
        };
        if (pattern.fields && match.groups) {
          for (const field of pattern.fields) {
            event.fields[field] = match.groups[field];
          }
        } else if (pattern.fields && match.length > 1) {
          // Named capture groups not used, try positional
          for (let i = 0; i < pattern.fields.length && i + 1 < match.length; i++) {
            event.fields[pattern.fields[i]] = match[i + 1];
          }
        }
        events.push(event);
        this.updateSummary(event);
      }
    }
    return events;
  }

  updateSummary(event) {
    switch (event.type) {
      case "progress":
        this.summary.lastProgress = event;
        break;
      case "warning":
        this.summary.warningCount++;
        break;
      case "error":
        this.summary.errorCount++;
        break;
      case "converged":
        this.summary.converged = true;
        break;
    }
  }

  getSummary() {
    return { ...this.summary };
  }
}