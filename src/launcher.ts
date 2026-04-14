/**
 * CODESYS launcher — spawns CODESYS with UI and watcher script,
 * tracks process lifecycle, delegates to IPC for command execution.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { LauncherConfig, LauncherStatus, CodesysState, IpcResult, ScriptExecutor } from './types';
import { IpcClient, DEFAULT_IPC_CONFIG } from './ipc';
import { ScriptManager } from './script-manager';
import { launcherLog } from './logger';

const SESSION_DIR_PREFIX = 'codesys-mcp-persistent';
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 500;
const SHUTDOWN_WAIT_MS = 5_000;
const HEALTH_CHECK_INTERVAL_MS = 5_000;

export class CodesysLauncher implements ScriptExecutor {
  private config: LauncherConfig;
  private state: CodesysState = 'stopped';
  private pid: number | null = null;
  private sessionId: string | null = null;
  private ipcDir: string | null = null;
  private ipcClient: IpcClient | null = null;
  private process: ChildProcess | null = null;
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private stateChangeCallbacks: Array<(state: CodesysState) => void> = [];

  constructor(config: LauncherConfig) {
    this.config = config;
  }

  /** Launch CODESYS with UI and watcher script */
  async launch(): Promise<void> {
    if (this.state === 'ready' || this.state === 'launching') {
      launcherLog.warn(`Cannot launch: state is ${this.state}`);
      return;
    }

    // Validate CODESYS exe exists
    if (!fs.existsSync(this.config.codesysPath)) {
      const err = `CODESYS executable not found: ${this.config.codesysPath}`;
      this.setState('error');
      this.lastError = err;
      throw new Error(err);
    }

    this.setState('launching');
    this.sessionId = uuidv4();
    const tmpBase = this.getSafeTempDir();
    this.ipcDir = path.join(tmpBase, SESSION_DIR_PREFIX, this.sessionId);

    launcherLog.info(`Session ${this.sessionId} — IPC dir: ${this.ipcDir}`);

    // Create IPC client and directories
    this.ipcClient = new IpcClient({
      baseDir: this.ipcDir,
      ...DEFAULT_IPC_CONFIG,
    });
    await this.ipcClient.ensureDirectories();

    // Prepare watcher script with interpolated IPC path
    const scriptManager = new ScriptManager();
    const watcherTemplate = scriptManager.loadTemplate('watcher');
    const ipcPathEscaped = this.ipcDir.replace(/\\/g, '\\\\');
    const watcherContent = scriptManager.interpolate(watcherTemplate, {
      IPC_BASE_DIR: ipcPathEscaped,
    });

    // Write interpolated watcher to IPC directory
    const watcherPath = path.join(this.ipcDir, 'watcher.py');
    fs.writeFileSync(watcherPath, watcherContent, 'utf-8');

    // Build CODESYS command
    const quotedExe = `"${this.config.codesysPath}"`;
    const profileArg = `--profile="${this.config.profileName}"`;
    const scriptArg = `--runscript="${watcherPath}"`;
    const fullCommand = `${quotedExe} ${profileArg} ${scriptArg}`;

    launcherLog.info(`Spawning: ${fullCommand}`);

    // Spawn CODESYS detached with UI visible
    const codesysDir = path.dirname(this.config.codesysPath);
    this.process = spawn(fullCommand, [], {
      detached: true,
      shell: true,
      windowsHide: false,
      stdio: 'ignore',
      cwd: codesysDir,
    });

    this.pid = this.process.pid ?? null;
    this.process.unref();

    launcherLog.info(`CODESYS spawned with PID ${this.pid}`);

    // Handle process exit
    this.process.on('exit', (code) => {
      launcherLog.warn(`CODESYS process exited with code ${code}`);
      if (this.state !== 'stopping') {
        this.lastError = `CODESYS exited unexpectedly (code ${code})`;
        this.setState('error');
      }
      this.pid = null;
      this.process = null;
    });

    // Poll for ready.signal
    const readyStart = Date.now();
    while (Date.now() - readyStart < READY_TIMEOUT_MS) {
      if (await this.ipcClient.isReady()) {
        this.setState('ready');
        this.startedAt = Date.now();
        launcherLog.info('CODESYS watcher is ready');
        this.startHealthMonitor();
        return;
      }
      await this.sleep(READY_POLL_MS);
    }

    // Timeout — watcher never signaled ready
    this.lastError = `Watcher did not signal ready within ${READY_TIMEOUT_MS}ms`;
    this.setState('error');
    throw new Error(this.lastError);
  }

  /** Graceful shutdown */
  async shutdown(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'stopping') return;

    this.setState('stopping');
    this.stopHealthMonitor();

    // Try to close projects and quit CODESYS gracefully via script
    if (this.ipcClient && this.state !== 'error') {
      try {
        launcherLog.info('Sending quit script to close projects and exit CODESYS...');
        await this.ipcClient.sendCommand(`
import sys
try:
    import scriptengine as se
    # Close all open projects without saving (save should be done before shutdown)
    for p in list(se.projects):
        try:
            p.close()
        except:
            pass
    print("Projects closed")
except:
    pass
# Request CODESYS to quit
try:
    import scriptengine as se
    se.system.exit()
except:
    pass
print("SCRIPT_SUCCESS")
sys.exit(0)
`, 10_000);
      } catch {
        launcherLog.debug('Quit script timed out or failed (expected if CODESYS exits)');
      }
    }

    // Send terminate signal to watcher
    if (this.ipcClient) {
      try {
        await this.ipcClient.sendTerminate();
      } catch {
        launcherLog.warn('Failed to send terminate signal');
      }
    }

    // Wait for process exit
    if (this.pid !== null) {
      const waitStart = Date.now();
      while (Date.now() - waitStart < SHUTDOWN_WAIT_MS) {
        if (!this.isRunning()) break;
        await this.sleep(500);
      }

      // Force kill if still alive
      if (this.isRunning() && this.pid !== null) {
        launcherLog.warn('Force-killing CODESYS process');
        try {
          // On Windows, use taskkill for reliable process termination
          if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            try {
              // First try graceful close (WM_CLOSE)
              execSync(`taskkill /PID ${this.pid}`, { timeout: 5000, stdio: 'ignore' });
              await this.sleep(3_000);
            } catch { /* ignore */ }
            if (this.isRunning()) {
              // Force kill
              try {
                execSync(`taskkill /F /PID ${this.pid}`, { timeout: 5000, stdio: 'ignore' });
              } catch { /* ignore */ }
            }
          } else if (this.process) {
            this.process.kill('SIGTERM');
            await this.sleep(2_000);
            if (this.isRunning() && this.process) {
              this.process.kill('SIGKILL');
            }
          }
        } catch {
          launcherLog.warn('Failed to kill CODESYS process');
        }
      }
    }

    // Clean up IPC directory
    if (this.ipcClient) {
      await this.ipcClient.cleanup();
    }

    this.pid = null;
    this.process = null;
    this.ipcClient = null;
    this.setState('stopped');
    launcherLog.info('Shutdown complete');
  }

  /** Execute a script through the IPC channel */
  async executeScript(content: string, timeoutMs?: number): Promise<IpcResult> {
    if (this.state !== 'ready' || !this.ipcClient) {
      throw new Error(`Cannot execute script: launcher state is '${this.state}'`);
    }
    return this.ipcClient.sendCommand(content, timeoutMs);
  }

  /** Execute a script using --runscript (direct execution, bypasses IPC) */
  async executeRunScript(scriptName: string, params: Record<string, string>, timeoutMs?: number): Promise<IpcResult> {
    const scriptManager = new ScriptManager();
    const scriptContent = scriptManager.loadTemplate(scriptName);
    const interpolated = scriptManager.interpolate(scriptContent, params);
    
    // Create temporary script file
    const tmpDir = this.getSafeTempDir();
    const scriptDir = path.join(tmpDir, 'codesys-mcp-runscript');
    if (!fs.existsSync(scriptDir)) {
      fs.mkdirSync(scriptDir, { recursive: true });
    }
    
    const scriptPath = path.join(scriptDir, `${scriptName}_${Date.now()}.py`);
    fs.writeFileSync(scriptPath, interpolated, 'utf-8');
    
    launcherLog.info(`Executing --runscript: ${scriptPath}`);
    
    if (this.state === 'ready' && this.pid !== null) {
      launcherLog.info('Closing existing CODESYS instance for --runscript execution');
      try {
        if (process.platform === 'win32') {
          const { execSync } = require('child_process');
          try {
            execSync(`taskkill /F /PID ${this.pid}`, { timeout: 5000, stdio: 'ignore' });
          } catch { /* ignore */ }
        }
        this.pid = null;
        this.process = null;
        this.setState('stopped');
        await this.sleep(2000);
      } catch (e) {
        launcherLog.warn(`Failed to close existing CODESYS: ${e}`);
      }
    }
    
    return new Promise((resolve) => {
      const timeout = timeoutMs || 90_000;
      let output = '';
      let error = '';
      let timedOut = false;
      
      const quotedExe = `"${this.config.codesysPath}"`;
      const profileArg = `--profile="${this.config.profileName}"`;
      const scriptArg = `--runscript="${scriptPath}"`;
      const fullCommand = `${quotedExe} ${profileArg} ${scriptArg}`;
      
      launcherLog.info(`Spawning: ${fullCommand}`);
      
      const proc = spawn(fullCommand, [], {
        shell: true,
        windowsHide: true,
        cwd: path.dirname(this.config.codesysPath),
      });
      
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeout);
      
      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });
      
      proc.stderr?.on('data', (data) => {
        error += data.toString();
      });
      
      proc.on('close', (code) => {
        clearTimeout(timer);
        
        // Clean up temp script
        try {
          fs.unlinkSync(scriptPath);
        } catch { /* ignore */ }
        
        const success = !timedOut && code === 0 && output.includes('SCRIPT_SUCCESS');
        
        launcherLog.info(`--runscript completed: success=${success}, code=${code}`);
        
        resolve({
          requestId: `runscript_${Date.now()}`,
          success,
          output: output || error,
          error: timedOut ? 'Timeout' : (code !== 0 ? `Exit code: ${code}` : ''),
          timestamp: Date.now(),
        });
      });
      
      proc.on('error', (err) => {
        clearTimeout(timer);
        launcherLog.error(`--runscript error: ${err.message}`);
        resolve({
          requestId: `runscript_${Date.now()}`,
          success: false,
          output: '',
          error: err.message,
          timestamp: Date.now(),
        });
      });
    });
  }

  /** Get current launcher status */
  getStatus(): LauncherStatus {
    return {
      state: this.state,
      pid: this.pid,
      sessionId: this.sessionId,
      ipcDir: this.ipcDir,
      startedAt: this.startedAt,
      lastError: this.lastError,
    };
  }

  /** Check if the CODESYS process is still alive */
  isRunning(): boolean {
    if (this.pid === null) return false;
    try {
      process.kill(this.pid, 0); // Signal 0 = test if process exists
      return true;
    } catch {
      return false;
    }
  }

  /** Register callback for state changes */
  onStateChange(callback: (state: CodesysState) => void): void {
    this.stateChangeCallbacks.push(callback);
  }

  private setState(state: CodesysState): void {
    const prev = this.state;
    this.state = state;
    if (prev !== state) {
      launcherLog.info(`State: ${prev} -> ${state}`);
      for (const cb of this.stateChangeCallbacks) {
        try { cb(state); } catch { /* ignore callback errors */ }
      }
    }
  }

  private startHealthMonitor(): void {
    this.healthInterval = setInterval(() => {
      if (this.state === 'ready' && !this.isRunning()) {
        launcherLog.error('Health check: CODESYS process died');
        this.lastError = 'CODESYS process died unexpectedly';
        this.pid = null;
        this.process = null;
        this.setState('error');
        this.stopHealthMonitor();
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private stopHealthMonitor(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getSafeTempDir(): string {
    const defaultTmp = os.tmpdir();
    const hasNonAscii = /[^ -~]/.test(defaultTmp);
    if (!hasNonAscii) {
      return defaultTmp;
    }
    const fallback = 'C:\\codesys-mcp-tmp';
    if (!fs.existsSync(fallback)) {
      fs.mkdirSync(fallback, { recursive: true });
    }
    launcherLog.info(`Default temp dir contains non-ASCII characters (${defaultTmp}), using fallback: ${fallback}`);
    return fallback;
  }
}
