import { Turn, DEFAULT_BUDGET } from "../types.js";
import { estimateTokens } from "./tokens.js";

export class Window {
  private turns: Turn[] = [];
  private maxTokens: number;
  private currentTokens = 0;

  constructor(maxTokens: number = DEFAULT_BUDGET.window) {
    this.maxTokens = maxTokens;
  }

  addTurn(role: "user" | "assistant", content: string): Turn {
    const tokens = estimateTokens(content);
    const turn: Turn = {
      role,
      content,
      ts: Date.now(),
      tokens,
    };
    this.turns.push(turn);
    this.currentTokens += tokens;
    return turn;
  }

  // Returns evicted turns that should be summarized into topics
  trimIfNeeded(): Turn[] {
    const evicted: Turn[] = [];

    // Evict oldest turn pairs when over token budget.
    // Always keep at least 1 turn pair (user + assistant).
    // Invariant: turns are always added as user/assistant pairs via manager.addTurn().
    while (this.currentTokens > this.maxTokens && this.turns.length > 2) {
      const u = this.turns.shift();
      const a = this.turns.shift();
      if (u) { evicted.push(u); this.currentTokens -= (u.tokens ?? 0); }
      if (a) { evicted.push(a); this.currentTokens -= (a.tokens ?? 0); }
    }

    this.currentTokens = Math.max(0, this.currentTokens);
    return evicted;
  }

  getTurns(): Turn[] {
    return [...this.turns];
  }

  getRecentSummary(maxPairs: number = 3): string {
    const pairs: string[] = [];
    // Start from the most recent turns
    const startIdx = Math.max(0, this.turns.length - maxPairs * 2);
    let i = startIdx;
    while (i < this.turns.length && pairs.length < maxPairs) {
      const user = this.turns[i];
      const assistant = this.turns[i + 1];
      if (user && assistant) {
        const uPreview = user.content.slice(0, 100);
        const aPreview = assistant.content.slice(0, 150);
        pairs.push(`User: ${uPreview}\nAssistant: ${aPreview}`);
        i += 2;
      } else {
        i++;
      }
    }
    return pairs.join("\n---\n");
  }

  count(): number {
    return Math.floor(this.turns.length / 2);
  }

  isEmpty(): boolean {
    return this.turns.length === 0;
  }

  clear(): void {
    this.turns = [];
    this.currentTokens = 0;
  }

  estimateTokens(): number {
    return this.currentTokens;
  }

}
