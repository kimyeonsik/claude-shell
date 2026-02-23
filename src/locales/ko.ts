import { type Translations } from "./en.js";

export const ko: Translations = {
  // connection.ts
  conn_starting_daemon: "데몬 시작 중...",
  conn_daemon_ready:    "데몬 준비 완료.",
  // shell.ts — handleCommandNotFound
  shell_forwarding_to_ai:     "  → AI에게 전달합니다.\n",
  shell_irreversible_warning: "  ⚠  되돌릴 수 없는 명령입니다!\n",
  shell_did_you_mean:         "  혹시 ",
  shell_did_you_mean_suffix:  "인가요? [Y=실행 / n=취소 / a=AI] ",
  shell_send_to_ai:           "  AI에게 보낼까요? [Y/n] ",
  // shell.ts — printStatus
  status_header:     "── aish status ──",
  status_turns_unit: "턴",
  // shell.ts — printWelcome
  welcome_subtitle: " — Interactive Shell + AI",
  welcome_hint:     "Commands: > AI query | cmd |> AI pipe | --status | --help | exit",
  // shell.ts — printHelp
  help_header:         "── aish Interactive Shell ──",
  help_shell_section:  "셸 명령어:",
  help_run_command:    "셸 명령어 실행",
  help_change_dir:     "디렉토리 이동",
  help_ai_section:     "AI 명령어:",
  help_ai_query:       "AI에게 질문 (최근 출력이 자동 컨텍스트)",
  help_ai_pipe:        "명령 결과를 AI에 파이프",
  help_daemon_section: "데몬 명령어:",
  help_status:         "컨텍스트 상태",
  help_compact:        "윈도우 요약",
  help_clear:          "윈도우 초기화",
  help_forget:         "전체 초기화",
  help_topic:          "주제 전환",
  help_recall:         "주제 복원",
  help_remember:       "메모리 저장",
  help_lang:           "언어 변경 (en/ko)",
  help_stop:           "데몬 종료",
  help_exit:           "Shell 종료",
  // client.ts — printHelp
  client_help_title:   "aish — Claude Shell",
  client_help_usage:   "사용법:",
  client_oneshot:      "AI에게 메시지 (one-shot)",
  client_interactive:  "Interactive Shell 진입",
  client_status:       "컨텍스트 상태",
  client_compact:      "윈도우 강제 요약",
  client_clear:        "윈도우 초기화 (Memory 유지)",
  client_forget:       "전체 초기화",
  client_topic:        "주제 전환",
  client_recall:       "이전 주제 복원",
  client_remember:     "메모리에 저장",
  client_start:        "daemon 시작",
  client_stop:         "daemon 종료",
  client_lang:         "언어 변경 (en/ko)",
  // lang messages
  lang_set_to:    "언어가 변경되었습니다:",
  lang_unknown:   "알 수 없는 언어",
  lang_available: "사용 가능",
};
