import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { Topic, Turn, TOPICS_PATH, MAX_TOPICS } from "../types.js";
import { estimateTokens } from "./tokens.js";

export class TopicManager {
  private topics: Topic[] = [];
  private path: string;

  constructor(path: string = TOPICS_PATH) {
    this.path = path;
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.path)) {
        const loaded: Topic[] = JSON.parse(readFileSync(this.path, "utf-8"));
        // Re-estimate tokens for topics saved with old estimator (len/4)
        let migrated = false;
        for (const t of loaded) {
          const fresh = estimateTokens(t.summary);
          if (t.tokens !== fresh) { t.tokens = fresh; migrated = true; }
        }
        this.topics = loaded;
        if (migrated) this.save();
      }
    } catch {
      this.topics = [];
    }
  }

  private save(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.topics, null, 2));
    this.version++;
  }

  getAll(): Topic[] {
    return [...this.topics];
  }

  get(name: string): Topic | undefined {
    return this.topics.find(
      (t) => t.name.toLowerCase() === name.toLowerCase()
    );
  }

  // Summarize evicted turns into a topic
  addFromTurns(turns: Turn[], name?: string): Topic {
    const topicName = name ?? this.generateName(turns);

    // Build a simple summary from turns
    const summaryParts: string[] = [];
    for (let i = 0; i < turns.length; i += 2) {
      const user = turns[i];
      const assistant = turns[i + 1];
      if (user && assistant) {
        const q = user.content.slice(0, 60).replace(/\n/g, " ");
        const a = assistant.content.slice(0, 80).replace(/\n/g, " ");
        summaryParts.push(`Q: ${q}... → A: ${a}...`);
      }
    }

    const summary = summaryParts.join(" | ");
    const topic: Topic = {
      name: topicName,
      summary,
      ts: Date.now(),
      tokens: estimateTokens(summary),
    };

    this.topics.push(topic);

    // Evict oldest if over limit
    while (this.topics.length > MAX_TOPICS) {
      this.topics.shift();
    }

    this.save();
    return topic;
  }

  addManual(name: string, summary: string): Topic {
    const topic: Topic = {
      name,
      summary,
      ts: Date.now(),
      tokens: estimateTokens(summary),
    };

    // Replace if same name exists
    const idx = this.topics.findIndex(
      (t) => t.name.toLowerCase() === name.toLowerCase()
    );
    if (idx >= 0) {
      this.topics[idx] = topic;
    } else {
      this.topics.push(topic);
    }

    while (this.topics.length > MAX_TOPICS) {
      this.topics.shift();
    }

    this.save();
    return topic;
  }

  remove(name: string): boolean {
    const idx = this.topics.findIndex(
      (t) => t.name.toLowerCase() === name.toLowerCase()
    );
    if (idx >= 0) {
      this.topics.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }

  clear(): void {
    this.topics = [];
    this.save();
  }

  private cachedPrompt: string | null = null;
  private cachedPromptVersion = -1;
  private version = 0;

  buildPrompt(): string {
    if (this.topics.length === 0) return "(no previous topics)";

    if (this.cachedPrompt !== null && this.cachedPromptVersion === this.version) {
      return this.cachedPrompt;
    }

    this.cachedPrompt = this.topics
      .map((t) => {
        const time = new Date(t.ts).toLocaleTimeString("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
        });
        return `- ${t.name}: ${t.summary} (${time})`;
      })
      .join("\n");
    this.cachedPromptVersion = this.version;
    return this.cachedPrompt;
  }

  estimateTokens(): number {
    if (this.topics.length === 0) return 0;
    // Account for per-topic framing: "- {name}: {summary} ({time})\n"
    return estimateTokens(this.buildPrompt());
  }

  count(): number {
    return this.topics.length;
  }

  private generateName(turns: Turn[]): string {
    // Extract keywords from first user message
    const firstUser = turns.find((t) => t.role === "user");
    if (!firstUser) return `topic-${Date.now()}`;

    const words = firstUser.content
      .replace(/[^a-zA-Z가-힣0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 3);

    return words.length > 0 ? words.join("-") : `topic-${Date.now()}`;
  }

}
