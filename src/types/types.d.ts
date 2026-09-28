
export interface GameExecutable {
  is_launcher: boolean;
  name: string;
  os: string;
  filename?: string;
  path?: string;
  segments?: number;
  is_running?: boolean;
  is_installed?: boolean;
  /** Epoch ms when the dummy process was started (for the elapsed timer). */
  started_at?: number;
  /** Epoch ms just before the launch was requested (detection must come after this). */
  launch_requested_at?: number;
  /** Epoch ms when Discord's log reported the game as detected. */
  detected_at?: number;
}
export interface Game {
    uid?: string;
    id: string;
    name: string;
    executables: GameExecutable[];
    aliases?: string[];
    themes?: string[];
    icon_hash?: string | null;
    is_running?: boolean;
    is_installed?: boolean;
    /** Executable name used by "Play", "Launch selected" and "Launch all". */
    selected_exe?: string;
}

export interface GameActionsProvider {
  canPlayGame: (game: Game | null) => boolean;
  isGameInstalled: (game: Game | null) => boolean;
  isExecutableRunning: (executable: GameExecutable) => boolean;
  isGameExecutableInstalled: (executable: GameExecutable) => boolean;
}
