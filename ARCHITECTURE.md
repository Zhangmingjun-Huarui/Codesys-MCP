# Architecture: codesys-mcp-persistent

## System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                      MCP Client (AI/Claude)                   │
│                   Stdio JSON-RPC messages                     │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                   Node.js MCP Server                          │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │  server.ts   │  │  launcher.ts │  │  script-manager  │    │
│  │  (28 tools)  │  │  (process    │  │  (template       │    │
│  │  (3 resources│  │   mgmt)      │  │   interpolation) │    │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘    │
│         │                │                    │               │
│  ┌──────▼────────────────▼────────────────────▼─────────┐    │
│  │              ScriptExecutor Interface                  │    │
│  │     ┌──────────────────┐  ┌──────────────────┐       │    │
│  │     │  IpcExecutor     │  │ HeadlessExecutor │       │    │
│  │     │  (persistent)    │  │ (--noUI fallback)│       │    │
│  │     └────────┬─────────┘  └──────────────────┘       │    │
│  └──────────────┼───────────────────────────────────────┘    │
└─────────────────┼────────────────────────────────────────────┘
                  │ File-based IPC
                  │ (atomic writes to commands/ dir)
┌─────────────────▼────────────────────────────────────────────┐
│              CODESYS IDE (persistent UI)                      │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  watcher.py (.NET Background Thread)                   │   │
│  │     polls commands/ → exec() on UI thread → results/  │   │
│  └───────────────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  CODESYS Scripting Engine (IronPython 2.7)             │   │
│  │     projects | online | system | OnlineChangeOption    │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. server.ts — MCP Tool Registration

**Purpose**: Registers 28 MCP tools and 3 MCP resources. Handles tool call routing, parameter validation (zod), and response formatting.

**Key design decisions**:
- **Async mutex** (`async-mutex` package) wraps all tool handlers to serialize CODESYS commands — the CODESYS scripting API is single-threaded and not thread-safe
- **Helper injection**: `scriptManager.prepareScriptWithHelpers()` prepends shared Python helper code (e.g., `ensure_project_open`, `ensure_online_connection`) before the main tool script
- **Error propagation**: Python `SCRIPT_ERROR` markers are parsed and mapped to `isError: true` MCP responses
- **Timeout management**: Default 60s, extended to 120s for compile and download operations

**Tool handler pattern**:
```typescript
s.tool('tool_name', 'description', { param: z.string() }, async (args) => {
  const script = scriptManager.prepareScriptWithHelpers(
    'tool_name', { PLACEHOLDER: value }, ['helper1', 'helper2']
  );
  const result = await executor.executeScript(script);
  if (result.success && result.output.includes('SCRIPT_SUCCESS')) {
    return { content: [{ type: 'text', text: parseOutput(result) }], isError: false };
  }
  return formatToolResponse(result, context);
});
```

### 2. launcher.ts — Process Management

**Purpose**: Manages the CODESYS process lifecycle in persistent mode.

**Process launch**:
1. Creates temp directory for IPC (`os.tmpdir()` or `C:\codesys-mcp-tmp` fallback)
2. Creates `commands/` and `results/` subdirectories
3. Copies `watcher.py` to temp directory
4. Spawns CODESYS: `"CODESYS.exe" --profile="..." --runscript="watcher.py"`
5. Polls for `watcher-ready.txt` signal (up to 60s)
6. Starts health monitor (5s interval PID check)

**Health monitoring**:
- Checks `process.kill(pid, 0)` every 5 seconds (non-destructive signal 0)
- If process is dead, transitions state to `error` and emits log warning
- Does NOT auto-restart — user must call `launch_codesys` or restart MCP server

**Shutdown**:
- Writes `shutdown.command` file to `commands/`
- Waits up to 10s for CODESYS to exit gracefully
- Falls back to `process.kill()` if shutdown command times out

### 3. ipc.ts — File-Based IPC Transport

**Purpose**: Sends Python scripts to the running CODESYS instance via atomic file writes and polls for results.

**Command execution flow**:
1. Generate unique command ID (`ipc_${timestamp}_${random}`)
2. Write Python script to `commands/${commandId}.py`
3. Write command metadata to `commands/${commandId}.command.json` (atomic via rename)
4. Poll for `results/${commandId}.result.json` with progressive backoff:
   - First 2s: poll every 100ms
   - 2s-10s: poll every 500ms
   - 10s+: poll every 1000ms
5. Parse result JSON: `{ success: bool, output: string, error?: string }`
6. Clean up result file

**Atomic file writes**:
- Write to `.tmp` file first, then rename to final name
- Prevents watcher from reading partial files
- Windows `fs.renameSync` is atomic for same-volume renames

**Error handling**:
- Result file parse errors: 3 retries with 100ms delay
- Timeout: configurable per-command (default 60s)
- Watcher crash detection: if no result after timeout, health monitor will detect process death

### 4. headless.ts — Headless Fallback

**Purpose**: Spawns a new CODESYS process with `--noUI` for each command when persistent mode is unavailable.

**Process per command**:
1. Write interpolated script to temp `.py` file in `os.tmpdir()`
2. Spawn: `CODESYS.exe --profile="..." --noUI --runscript="temp.py"`
3. Collect stdout + stderr
4. Determine success: check for `SCRIPT_SUCCESS` or `SCRIPT_ERROR` markers, fall back to exit code
5. Clean up temp file

**Trade-offs**:
- No UI visibility
- 10-30s startup overhead per command
- Cannot conflict with existing CODESYS UI instance on same project
- Full scripting context available (no `exec()` limitations)

### 5. script-manager.ts — Template Engine

**Purpose**: Loads Python script templates and interpolates `{PLACEHOLDER}` tokens with actual values.

**Template interpolation**:
- Scans `src/scripts/` directory for `.py` files
- Caches templates in memory (loaded once, reused)
- Replaces `{PLACEHOLDER}` patterns with parameter values
- Path escaping: backslashes are doubled for Python raw strings

**Helper injection** (`prepareScriptWithHelpers`):
- Loads the main script template
- Loads each helper script (e.g., `ensure_project_open.py`)
- Concatenates helpers + main script into single Python file
- Helpers define functions; main script calls them
- Order matters: helpers must be defined before they are called

### 6. watcher.py — CODESYS IPC Watcher

**Purpose**: Runs inside CODESYS as a `--runscript`. Starts a .NET background thread that polls for commands and executes them on the CODESYS UI thread.

**Architecture**:
```python
# Main script context (--runscript)
# 1. Create .NET background thread
# 2. Thread polls commands/ directory every 500ms
# 3. On new command: read .py file content
# 4. Marshal to UI thread: system.execute_on_primary_thread(lambda: exec(code))
# 5. Capture output via sys.stdout redirection
# 6. Write result to results/ directory
# 7. Signal ready via watcher-ready.txt
```

**Thread safety**:
- `exec()` runs on the CODESYS UI (primary) thread via `system.execute_on_primary_thread()`
- This ensures all CODESYS API calls happen in the correct threading context
- The background thread only handles file I/O (command polling, result writing)
- `SystemExit` is caught separately — `sys.exit(0)` in exec'd code means success, not exit CODESYS

**Shutdown handling**:
- Checks for `shutdown.command` file on each poll cycle
- On shutdown: writes `shutdown-ack.txt`, then calls `system.exit(0)` to close CODESYS

## Data Flow Diagrams

### Project Compilation Flow

```
MCP Client → server.ts: compile_project({ projectFilePath })
  → scriptManager: load 'compile_project' template
  → interpolate: { PROJECT_FILE_PATH: "D:\\...\\test.project" }
  → executor.executeScript(interpolated_script, 120000)
    → [Persistent] ipc.ts:
      1. Write commands/ipc_xxx.py
      2. Write commands/ipc_xxx.command.json
      3. Poll results/ipc_xxx.result.json (120s timeout)
    → watcher.py (in CODESYS):
      4. Detect new command
      5. exec() on UI thread:
         - projects.primary or projects.open(path)
         - primary_application.generate_compiled_output()
      6. Write results/ipc_xxx.result.json
    → ipc.ts:
      7. Parse result JSON
      8. Return { success, output, error }
  → server.ts: parse errors/warnings from output
  → MCP Response: { content: [{ type: "text", text: "Compiled with 0 errors, 0 warnings" }] }
```

### Variable Read Flow

```
MCP Client → server.ts: read_variable({ projectFilePath, variablePath })
  → prepareScriptWithHelpers('read_variable', ..., ['ensure_project_open', 'ensure_online_connection'])
  → executor.executeScript(full_script)
    → Python in CODESYS:
      1. ensure_project_open(path) → project object
      2. ensure_online_connection(project) → (online_app, app) tuple
         - 4 methods to create online_application
         - 3 methods for login
      3. online_app.read_value("PLC_PRG.nCounter")
      4. print("Value: " + str(result))
      5. print("SCRIPT_SUCCESS: ...")
    → Result parsed by server.ts
  → MCP Response: { content: [{ type: "text", text: "PLC_PRG.nCounter = DINT#42" }] }
```

### Variable Write Flow (with type conversion)

```
MCP Client → server.ts: write_variable({ projectFilePath, variablePath: "PLC_PRG.bEnable", value: "TRUE" })
  → prepareScriptWithHelpers('write_variable', ..., ['ensure_project_open', 'ensure_online_connection'])
  → executor.executeScript(full_script)
    → Python in CODESYS:
      1. ensure_project_open(path)
      2. ensure_online_connection(project)
      3. _convert_value("TRUE") → Python True (bool)
      4. Method 1: online_app.set_prepared_value("PLC_PRG.bEnable", str(True))
                    online_app.write_prepared_values()
      5. Read back verification: online_app.read_value("PLC_PRG.bEnable") → "TRUE"
      6. print("Value Written: TRUE")
      7. print("Value Verified: TRUE")
      8. print("SCRIPT_SUCCESS: Variable written successfully.")
    → Result parsed by server.ts: extract "Value Verified" line
  → MCP Response: { content: [{ type: "text", text: "Written: TRUE, Verified: TRUE" }] }
```

## Shared Python Helpers

### ensure_project_open(path)

**Purpose**: Ensures a project is open in CODESYS, opening it if necessary.

```python
def ensure_project_open(project_path):
    # 1. Check projects.primary (already open)
    # 2. If None, try projects.open(project_path) with 3 retries
    # 3. Between retries: system.delay(2000) to wait for file locks
    # 4. Return project object
```

**Error scenarios**:
- File not found: `SCRIPT_ERROR: Project file not found`
- File locked by another instance: Retry 3 times with 2s delay
- Invalid project format: `SCRIPT_ERROR: Failed to open project`

### ensure_online_connection(project)

**Purpose**: Creates an online application and establishes a PLC connection.

```python
def ensure_online_connection(project):
    # 1. Find active application (4 search methods)
    # 2. Create online application (4 fallback methods)
    # 3. Check login state (is_logged_in)
    # 4. Login if needed (3 parameter combinations)
    # 5. Return (online_app, target_app) tuple
```

**Fallback chain for `create_online_application`**:

| Priority | Method | Context |
|----------|--------|---------|
| 1 | `online.create_online_application(app)` | Standard API (works in most cases) |
| 2 | `app.create_online_application()` | Application-internal method |
| 3 | `scriptengine.online.create_online_application(app)` | Explicit engine reference |
| 4 | `from scriptengine import online; online.create_online_application(app)` | Fresh import (IPC exec context) |

**Fallback chain for `login`**:

| Priority | Call | Notes |
|----------|------|-------|
| 1 | `login(OnlineChangeOption.Try, True)` | Try online change, auto-start |
| 2 | `login(OnlineChangeOption.Try, False)` | Try online change, no auto-start |
| 3 | `login()` | No parameters (some CODESYS versions) |

## Error Handling Strategy

### Layer 1: MCP Server (TypeScript)

All tool handlers follow a consistent pattern:

```typescript
try {
  const result = await executor.executeScript(script, timeout);
  const success = result.success && result.output.includes('SCRIPT_SUCCESS');
  if (success) {
    return { content: [{ type: 'text', text: parsedOutput }], isError: false };
  }
  return formatToolResponse(result, context);
} catch (error) {
  return { content: [{ type: 'text', text: error.message }], isError: true };
}
```

### Layer 2: IPC Transport (TypeScript)

- **Timeout**: Progressive polling with configurable timeout
- **File corruption**: 3 retries for result parsing
- **Process death**: Health monitor detects and reports

### Layer 3: Python Scripts

All scripts follow the template:

```python
try:
    # Main logic with fallback methods
    print("SCRIPT_SUCCESS: ...")
    sys.exit(0)
except SystemExit:
    raise  # Let watcher handle SystemExit
except Exception as e:
    traceback.print_exc()
    print("SCRIPT_ERROR: %s" % e)
    sys.exit(1)
```

### Layer 4: CODESYS Watcher

```python
try:
    exec(compiled_code, exec_globals)
    # Capture output, write success result
except SystemExit as se:
    # sys.exit(0) → success result
    # sys.exit(non-zero) → failure result
except Exception as e:
    # Write error result
```

## Version Compatibility Matrix

| CODESYS Version | Node.js | Windows | Status | Notes |
|----------------|---------|---------|--------|-------|
| 3.5.19.50 | 18+ | 10/11 x64 | ✅ Tested | Primary development target |
| 3.5.21.0 | 18+ | 10/11 x64 | ✅ Compatible | Same API surface |
| 3.5.17.x | 18+ | 10/11 x64 | ⚠️ Partial | Some online API methods may differ |
| 3.5.14.x and earlier | 18+ | 10/11 x64 | ❌ Unsupported | Missing scripting APIs |
| CODESYS V4 (Linux) | — | — | ❌ Incompatible | Different architecture |

## Performance Characteristics

| Operation | Persistent Mode | Headless Mode |
|-----------|----------------|---------------|
| First command | 20-30s (launch CODESYS) | 10-30s (spawn + execute) |
| Subsequent commands | 1-5s (IPC round-trip) | 10-30s (spawn each time) |
| Compile | 5-30s + compile time | 10-30s + compile time |
| Read variable | 1-2s | 10-30s |
| Write variable | 1-3s (includes verification) | 10-30s |
| Memory overhead | ~500 MB (CODESYS IDE) | ~300 MB per spawn |

## Security Considerations

- **No authentication**: The MCP server does not implement authentication — it trusts the MCP client
- **Local only**: CODESYS IPC operates via local file system (no network exposure)
- **Code injection**: `exec()` is used in watcher.py — this is intentional and necessary for the IPC mechanism; the server only writes scripts it generates from trusted templates
- **Project file paths**: Server validates paths exist before passing to CODESYS; path traversal is mitigated by CODESYS's own file handling
- **No secrets in scripts**: Python scripts never contain credentials; PLC login is handled by CODESYS's own gateway authentication
