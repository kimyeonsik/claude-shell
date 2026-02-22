import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { MemoryStore, MEMORY_PATH } from "../types.js";
import { estimateTokens } from "./tokens.js";

const MAX_RECENT_WORK = 10;

export class Memory {
  private store: MemoryStore;
  private path: string;

  constructor(path: string = MEMORY_PATH) {
    this.path = path;
    this.store = this.load();
  }

  private load(): MemoryStore {
    try {
      if (existsSync(this.path)) {
        return JSON.parse(readFileSync(this.path, "utf-8"));
      }
    } catch {
      // corrupt file — start fresh
    }
    return { project: {}, conventions: [], decisions: [], recentWork: [] };
  }

  private save(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.store, null, 2));
  }

  get(): MemoryStore {
    return this.store;
  }

  remember(fact: string): void {
    // Smart categorization
    const lower = fact.toLowerCase();
    if (lower.includes("convention") || lower.includes("rule") || lower.includes("always") || lower.includes("never")) {
      if (!this.store.conventions.includes(fact)) {
        this.store.conventions.push(fact);
      }
    } else if (lower.includes("decided") || lower.includes("decision") || lower.includes("chose")) {
      if (!this.store.decisions.includes(fact)) {
        this.store.decisions.push(fact);
      }
    } else {
      // Store as project info by default
      this.store.recentWork.push(fact);
      if (this.store.recentWork.length > MAX_RECENT_WORK) {
        this.store.recentWork.shift();
      }
    }
    this.save();
  }

  setProject(key: string, value: string): void {
    this.store.project[key] = value;
    this.save();
  }

  mergeExtracted(data: Partial<MemoryStore>): void {
    if (data.project) {
      Object.assign(this.store.project, data.project);
    }
    if (data.conventions) {
      for (const c of data.conventions) {
        if (!this.store.conventions.includes(c)) {
          this.store.conventions.push(c);
        }
      }
    }
    if (data.decisions) {
      for (const d of data.decisions) {
        if (!this.store.decisions.includes(d)) {
          this.store.decisions.push(d);
        }
      }
    }
    if (data.recentWork) {
      this.store.recentWork.push(...data.recentWork);
      while (this.store.recentWork.length > MAX_RECENT_WORK) {
        this.store.recentWork.shift();
      }
    }
    this.save();
  }

  clear(): void {
    this.store = { project: {}, conventions: [], decisions: [], recentWork: [] };
    this.save();
  }

  buildPrompt(): string {
    const parts: string[] = [];

    const projEntries = Object.entries(this.store.project);
    if (projEntries.length > 0) {
      parts.push(projEntries.map(([k, v]) => `${k}: ${v}`).join(", "));
    }
    if (this.store.conventions.length > 0) {
      parts.push("Conventions: " + this.store.conventions.join("; "));
    }
    if (this.store.decisions.length > 0) {
      parts.push("Decisions: " + this.store.decisions.join("; "));
    }
    if (this.store.recentWork.length > 0) {
      const recent = this.store.recentWork.slice(-3);
      parts.push("Recent: " + recent.join("; "));
    }

    return parts.length > 0 ? parts.join("\n") : "(empty)";
  }

  estimateTokens(): number {
    const prompt = this.buildPrompt();
    if (prompt === "(empty)") return 0;
    return estimateTokens(prompt);
  }
}
