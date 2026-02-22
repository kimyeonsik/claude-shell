import { ContextBudget, ContextResult, DEFAULT_BUDGET, DaemonStatus, MEMORY_EXTRACT_INTERVAL } from "../types.js";
import { Memory } from "./memory.js";
import { Window } from "./window.js";
import { TopicManager } from "./topic.js";
import { ShellContext } from "./shell.js";

export class ContextManager {
  readonly memory: Memory;
  readonly window: Window;
  readonly topics: TopicManager;
  readonly shell: ShellContext;
  private budget: ContextBudget;
  private turnCount = 0;
  private sessionDirty = false;

  constructor(budget: ContextBudget = DEFAULT_BUDGET) {
    this.memory = new Memory();
    this.window = new Window(budget.window);
    this.topics = new TopicManager();
    this.shell = new ShellContext();
    this.budget = budget;
  }

  build(overrideCwd?: string): ContextResult {
    // Trim window and summarize evicted turns
    const evicted = this.window.trimIfNeeded();
    if (evicted.length > 0) {
      this.topics.addFromTurns(evicted);
      this.sessionDirty = true;
    }

    const needsNewSession = this.sessionDirty;

    // Build prompt BEFORE resetting dirty flag so summary is included
    const systemPrompt = this.buildSystemPrompt(overrideCwd, needsNewSession);

    if (this.sessionDirty) {
      this.sessionDirty = false;
    }

    return { systemPrompt, needsNewSession };
  }

  private buildSystemPrompt(overrideCwd?: string, includeConversationSummary = false): string {
    const sections: string[] = [];

    // L0: Memory
    const memPrompt = this.memory.buildPrompt();
    if (memPrompt !== "(empty)") {
      sections.push(`[Memory]\n${memPrompt}`);
    }

    // L1: Topics
    const topicPrompt = this.topics.buildPrompt();
    if (topicPrompt !== "(no previous topics)") {
      sections.push(`[Previous Topics]\n${topicPrompt}`);
    }

    // L2: Shell Context
    const shellPrompt = this.shell.buildPrompt(overrideCwd);
    sections.push(`[Shell Context]\n${shellPrompt}`);

    // L3: On session reset, include recent conversation summary so context carries over
    if (includeConversationSummary && this.window.count() > 0) {
      const recentSummary = this.window.getRecentSummary();
      if (recentSummary) {
        sections.push(`[Recent Conversation Summary]\n${recentSummary}`);
      }
    }

    return sections.join("\n\n");
  }

  addTurn(userMessage: string, assistantResponse: string): void {
    this.window.addTurn("user", userMessage);
    this.window.addTurn("assistant", assistantResponse);
    this.turnCount++;
  }

  getTurnCount(): number {
    return this.turnCount;
  }

  shouldExtractMemory(): boolean {
    return this.turnCount > 0 && this.turnCount % MEMORY_EXTRACT_INTERVAL === 0;
  }

  forceNewSession(): void {
    this.sessionDirty = true;
  }

  compact(): void {
    const turns = this.window.getTurns();
    if (turns.length > 0) {
      this.topics.addFromTurns(turns, `compact-${Date.now()}`);
      this.window.clear();
      this.sessionDirty = true;
    }
  }

  clearWindow(): void {
    this.window.clear();
    this.sessionDirty = true;
  }

  clearAll(): void {
    this.window.clear();
    this.topics.clear();
    this.memory.clear();
    this.sessionDirty = true;
  }

  switchTopic(name: string): { savedTopic: string | null } {
    // Save current conversation as topic
    let savedTopic: string | null = null;
    const turns = this.window.getTurns();
    if (turns.length > 0) {
      const topic = this.topics.addFromTurns(turns);
      savedTopic = topic.name;
      this.window.clear();
    }

    this.sessionDirty = true;
    return { savedTopic };
  }

  recallTopic(name: string): { found: boolean; summary?: string } {
    const topic = this.topics.get(name);
    if (!topic) return { found: false };

    // Inject topic summary as context for next query
    this.sessionDirty = true;
    return { found: true, summary: topic.summary };
  }

  getStatus(): DaemonStatus {
    const memoryTokens = this.memory.estimateTokens();
    const topicTokens = this.topics.estimateTokens();
    const windowTokens = this.window.estimateTokens();
    const shellTokens = this.shell.estimateTokens();
    // Section headers + join separators overhead (~15 tokens)
    const framingOverhead = this.estimateFramingOverhead();

    return {
      sessionId: null, // filled by daemon
      windowTurns: this.window.count(),
      topicCount: this.topics.count(),
      memoryTokens,
      topicTokens,
      windowTokens,
      shellTokens,
      totalTokens: memoryTokens + topicTokens + windowTokens + shellTokens + framingOverhead,
      budget: this.budget.total,
    };
  }

  private estimateFramingOverhead(): number {
    // Each active section adds a header like "[Memory]\n" (~3-5 tokens) + "\n\n" join (~1 token)
    let sections = 1; // Shell Context is always present
    if (this.memory.buildPrompt() !== "(empty)") sections++;
    if (this.topics.count() > 0) sections++;
    if (this.sessionDirty && this.window.count() > 0) sections++; // [Recent Conversation Summary]
    // ~4 tokens per section header, ~1 token per join separator
    return sections * 4 + Math.max(0, sections - 1);
  }
}
