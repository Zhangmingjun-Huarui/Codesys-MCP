# codesys-mcp-persistent

MCP server for CODESYS with a persistent UI instance and file-based IPC.

Unlike headless-only approaches that spawn a new CODESYS process per command, this server launches CODESYS **with its UI visible** and keeps it running. MCP tool calls are sent to the same instance via a file-based IPC watcher, so changes appear in real-time and the user can interact with the IDE alongside AI-driven automation.

## Features

- **Persistent mode** — CODESYS UI stays open; commands execute in the running instance via file-based IPC
- **Headless fallback** — automatic fallback to `--noUI` spawn-per-command if persistent mode fails
- **File-based IPC** — proven approach using atomic file writes and a Python watcher script
- **Command serialization** — async mutex ensures one command at a time
- **Health monitoring** — detects CODESYS crashes and reports state
- **28 MCP tools** — project management, POU authoring, structured compiler diagnostics, runtime monitoring, library management
- **Drop-in replacement** — same MCP tool names and parameters as `@codesys/mcp-toolkit`

## Requirements

| Component | Minimum Version | Notes |
|-----------|----------------|-------|
| **Node.js** | 18+ | Required for MCP SDK |
| **CODESYS** | 3.5 SP19+ | Tested with 3.5.19.50 and 3.5.21.0 |
| **Windows** | 10/11 x64 | CODESYS only runs on Windows |
| **CODESYS Control Win V3** | Match CODESYS version | Windows service for local PLC simulation |
| **CODESYS Gateway V3** | Match CODESYS version | Required for device communication |

### Hardware Compatibility

- **CPU**: x86-64 processor (CODESYS does not support ARM64 on Windows)
- **RAM**: Minimum 4 GB free (CODESYS IDE + Node.js + MCP server)
- **Disk**: 2 GB free for CODESYS project files, temporary IPC files, and log output
- **Network**: Local PLC simulation requires no network; physical PLC requires Ethernet connection to target device
- **Non-ASCII path warning**: If the Windows temp directory contains non-ASCII characters (e.g., Chinese usernames), the server automatically falls back to `C:\codesys-mcp-tmp` for IPC files

## Installation

```bash
npm install -g codesys-mcp-persistent
```

Or install from the repository:

```bash
git clone https://github.com/luke-harriman/Codesys-MCP.git
cd Codesys-MCP
npm install
npm run build
npm link
```

## Quick Start

Add to your `.mcp.json` (Claude Code configuration):

```json
{
  "mcpServers": {
    "codesys": {
      "command": "codesys-mcp-persistent",
      "args": [
        "--codesys-path", "C:\\Program Files\\CODESYS 3.5.21.0\\CODESYS\\Common\\CODESYS.exe",
        "--codesys-profile", "CODESYS V3.5 SP21 Patch 3",
        "--mode", "persistent"
      ]
    }
  }
}
```

Or run directly:

```bash
codesys-mcp-persistent \
  --codesys-path "C:\Program Files\CODESYS 3.5.21.0\CODESYS\Common\CODESYS.exe" \
  --codesys-profile "CODESYS V3.5 SP21 Patch 3"
```

## CLI Reference

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --codesys-path <path>` | Path to CODESYS executable | `$CODESYS_PATH` or auto-detected |
| `-f, --codesys-profile <name>` | CODESYS profile name | `$CODESYS_PROFILE` or `CODESYS V3.5 SP21` |
| `-w, --workspace <dir>` | Workspace directory for relative paths | Current directory |
| `-m, --mode <mode>` | `persistent` (UI) or `headless` (--noUI) | `persistent` |
| `--no-auto-launch` | Don't launch CODESYS on startup | Auto-launch enabled |
| `--fallback-headless` | Fall back to headless if persistent fails | `true` |
| `--keep-alive` | Keep CODESYS running after server stops | `false` |
| `--timeout <ms>` | Default command timeout | `60000` |
| `--detect` | List installed CODESYS versions and exit | — |
| `--verbose` | Enable verbose logging | — |
| `--debug` | Enable debug logging | — |
| `-V, --version` | Show version number | — |
| `-h, --help` | Show help | — |

Environment variables `CODESYS_PATH` and `CODESYS_PROFILE` are used as defaults when the corresponding flags are not provided.

## MCP Tools

### Management Tools

| Tool | Description | Parameters | Error Conditions |
|------|-------------|------------|-----------------|
| `launch_codesys` | Manually launch CODESYS (use with `--no-auto-launch`) | None | Persistent mode not configured; CODESYS already running |
| `shutdown_codesys` | Shut down the persistent CODESYS instance | None | No persistent instance running; shutdown timeout |
| `get_codesys_status` | Get current state, PID, execution mode | None | — |

### Project Tools

| Tool | Description | Parameters | Error Conditions |
|------|-------------|------------|-----------------|
| `open_project` | Open an existing CODESYS project file | `filePath` | File not found; file locked by another instance; invalid project format |
| `create_project` | Create a new project from the standard template | `filePath` | Template not found; path not writable; file already exists |
| `save_project` | Save the currently open project | `projectFilePath` | No project open; disk full; permission denied |
| `compile_project` | Build the primary application (120s timeout) | `projectFilePath` | Compilation errors; project not open; CODESYS internal error |
| `get_compile_messages` | Retrieve last compiler messages without a new build | `projectFilePath` | No previous build; message API unavailable |

### POU / Code Authoring Tools

| Tool | Description | Parameters | Error Conditions |
|------|-------------|------------|-----------------|
| `create_pou` | Create a Program, Function Block, or Function | `projectFilePath`, `name`, `type`, `language`, `parentPath` | Invalid IEC identifier; name conflict; parent path not found |
| `set_pou_code` | Set declaration and/or implementation code | `projectFilePath`, `pouPath`, `declarationCode?`, `implementationCode?` | POU not found; invalid ST syntax; both code params empty |
| `create_property` | Create a property within a Function Block | `projectFilePath`, `parentPouPath`, `propertyName`, `propertyType` | Parent not a Function Block; name conflict |
| `create_method` | Create a method within a Function Block | `projectFilePath`, `parentPouPath`, `methodName`, `returnType?` | Parent not a Function Block; name conflict |
| `create_dut` | Create a DUT (Structure, Enumeration, Union, Alias) | `projectFilePath`, `name`, `dutType`, `parentPath` | Invalid name; type conflict |
| `create_gvl` | Create a Global Variable List | `projectFilePath`, `name`, `parentPath`, `declarationCode?` | Name conflict; invalid declaration syntax |
| `create_folder` | Create an organizational folder | `projectFilePath`, `folderName`, `parentPath` | Parent path not found |
| `delete_object` | Delete any project object (**destructive, cannot undo**) | `projectFilePath`, `objectPath` | Object not found; object locked |
| `rename_object` | Rename any project object | `projectFilePath`, `objectPath`, `newName` | Invalid new name; name conflict |
| `get_all_pou_code` | Bulk read all code in the project (120s timeout) | `projectFilePath` | No project open; large project timeout |

### Online / Runtime Tools

| Tool | Description | Parameters | Error Conditions |
|------|-------------|------------|-----------------|
| `connect_to_device` | Login to the PLC runtime via IPC | `projectFilePath` | No device configured; Gateway service not running; project locked |
| `disconnect_from_device` | Logout from the PLC runtime | `projectFilePath` | Not logged in; connection lost |
| `get_application_state` | Check if PLC application is running/stopped/exception | `projectFilePath` | Not connected to device |
| `read_variable` | Read a live variable value from the running PLC | `projectFilePath`, `variablePath` | Not connected; variable not found; application stopped |
| `write_variable` | Write/force a variable value on the running PLC | `projectFilePath`, `variablePath`, `value` | Not connected; type mismatch; write-protected variable |
| `download_to_device` | Download compiled application to PLC (120s timeout) | `projectFilePath` | Not compiled; not connected; device unreachable |
| `start_stop_application` | Start or stop the PLC application | `projectFilePath`, `action` | Invalid action; not connected; application in exception state |

### Library Management Tools

| Tool | Description | Parameters | Error Conditions |
|------|-------------|------------|-----------------|
| `list_project_libraries` | List all referenced libraries with version info | `projectFilePath` | Library Manager not found |
| `add_library` | Add a library reference to the project | `projectFilePath`, `libraryName` | Library not installed in repository; already referenced |

## MCP Resources

| Resource URI | Description |
|--------------|-------------|
| `codesys://project/status` | CODESYS scripting status and open project info |
| `codesys://project/{path}/structure` | Project tree structure |
| `codesys://project/{path}/pou/{pou}/code` | POU declaration and implementation code |

## Execution Modes

### Persistent Mode (default)

1. Server launches `CODESYS.exe` with `--runscript=watcher.py` (no `--noUI`)
2. CODESYS UI opens — user can see and interact with the IDE
3. The watcher script starts a .NET background thread that polls a `commands/` directory, then **returns control to CODESYS** so the UI stays fully responsive
4. When a tool is called, the server writes a `.py` script + `.command.json` to `commands/`
5. The background thread detects the command and marshals execution onto the CODESYS UI thread via `system.execute_on_primary_thread()`
6. Results are written atomically to `results/`
7. Changes made by tools appear in the CODESYS UI in real-time
8. The UI remains interactive between commands — only briefly paused during synchronous API calls (compile, open)

**Persistent mode limitations**:
- Only one CODESYS instance can be active at a time
- Project files cannot be opened simultaneously by multiple CODESYS instances
- If CODESYS crashes, the server detects it via health monitoring and transitions to `error` state
- Some CODESYS scripting APIs (particularly `online.create_online_application()`) may fail within the `exec()` context due to internal state initialization issues — the `connect_to_device` tool includes multiple fallback methods to handle this

### Headless Mode

Falls back to the original approach: each tool call spawns a new CODESYS process with `--noUI`, runs the script, and exits. No UI is shown. Used when:

- `--mode headless` is specified
- Persistent mode fails to launch and `--fallback-headless` is enabled
- CODESYS is launched with `--no-auto-launch` and `launch_codesys` hasn't been called yet

**Headless mode limitations**:
- Each command spawns a new CODESYS process (10-30s startup overhead)
- No UI visibility for the user
- Cannot share the same project file with a running CODESYS UI instance

## CODESYS Scripting API Reference

This server communicates with CODESYS through IronPython scripts executed within the CODESYS scripting engine. The following API surface is used:

### Global Objects (available in `--runscript` context)

| Object | Description | Key Methods |
|--------|-------------|-------------|
| `projects` | Project management | `open(path)`, `.primary`, `list()` |
| `online` | Online communication | `create_online_application(app)` |
| `scriptengine` | Scripting engine | `.projects`, `.online`, `.system` |
| `system` | System utilities | `.delay(ms)`, `.exit(code)`, `.execute_on_primary_thread(fn)` |
| `OnlineChangeOption` | Login options | `.Try`, `.TryOnlineChange` |
| `ApplicationState` | App state enum | `.run`, `.stop`, `.exception` |

### OnlineApplication API (CODESYS 3.5.19+)

| Method | Description | Usage |
|--------|-------------|-------|
| `read_value(expression)` | Read a variable value | `online_app.read_value("PLC_PRG.nCounter")` |
| `set_prepared_value(expr, value)` | Prepare a value for writing | `online_app.set_prepared_value("PLC_PRG.bEnable", str(True))` |
| `write_prepared_values()` | Execute all prepared writes | Call after `set_prepared_value()` |
| `force_prepared_values()` | Force-write prepared values | Fallback if `write_prepared_values()` fails |
| `login(option, auto_start)` | Login to PLC | `online_app.login(OnlineChangeOption.Try, True)` |
| `logout()` | Logout from PLC | `online_app.logout()` |
| `start()` | Start the PLC application | `online_app.start()` |
| `stop()` | Stop the PLC application | `online_app.stop()` |
| `download()` | Download app to PLC | `online_app.download()` |
| `.application_state` | Get current state | `str(online_app.application_state)` |
| `.is_logged_in` | Check login status | `online_app.is_logged_in` |

**Critical**: The `write_value()` method does NOT exist in CODESYS 3.5 ScriptOnlineApplication. Use `set_prepared_value()` + `write_prepared_values()` instead.

### IronPython Constraints

When writing scripts for CODESYS's IronPython engine:

- **No** `print(msg, flush=True)` — use `print(msg); sys.stdout.flush()`
- **No** f-strings — use `%` formatting or `.format()`
- **No** `from scriptengine import *` — use global objects directly (`projects`, `online`, etc.)
- **Use** `system.delay()` for waiting, NOT `time.sleep()` (in `--runscript` context)
- **Use** `system.exit(code)` to exit CODESYS, NOT `scriptengine.system.exit()`
- **Use** `sys.exit(code)` within IPC `exec()` context (watcher catches SystemExit)

## Data Processing Flow

### Write Variable Flow

```
User/AI → MCP Tool Call (write_variable)
    → server.ts: prepareScriptWithHelpers(['ensure_project_open', 'ensure_online_connection'])
    → executor.executeScript(interpolated_python_code)
    → [Persistent] IPC: write .py + .command.json → watcher.py polls → exec() on UI thread
    → [Headless]  Spawn CODESYS --noUI --runscript
    → Python: _convert_value(raw) → Python type (bool/int/float/str)
    → Python: set_prepared_value(path, str(converted)) → write_prepared_values()
    → Python: read_value(path) → verification read-back
    → Result JSON → server.ts: parse "Value Verified" from output
    → MCP Response to User/AI
```

### Connect to Device Flow

```
User/AI → MCP Tool Call (connect_to_device)
    → server.ts: prepareScriptWithHelpers(['ensure_project_open'])
    → executor.executeScript(interpolated_python_code)
    → Python: projects.primary → find active_application
    → Python: 4 fallback methods to create online_application
        Method 1: online.create_online_application(app)
        Method 2: app.create_online_application()
        Method 3: scriptengine.online.create_online_application(app)
        Method 4: from scriptengine import online → create_online_application(app)
    → Python: 3 fallback methods for login
        Method 1: login(OnlineChangeOption.Try, True)
        Method 2: login(OnlineChangeOption.Try, False)
        Method 3: login()
    → Python: auto-start if state != "run"
    → Result JSON → server.ts: parse Application + State
    → MCP Response to User/AI
```

## Exception Handling

### TypeScript Layer

| Error Type | Handling | Recovery |
|-----------|----------|----------|
| CODESYS process crash | Health monitor detects via PID check every 5s | State → `error`, tools return error |
| IPC timeout (60s default, 120s for compile) | Progressive polling with backoff (100ms → 1s) | Throw timeout error to MCP client |
| IPC result file corrupted | 3 retries with 100ms delay | Return null result, trigger timeout |
| Async mutex queue overflow | Commands queue sequentially | No overflow possible (single queue) |
| Project file locked | `ensure_project_open` with 3 retries, 2s delay | Reopen project on retry |
| CODESYS executable not found | Startup validation | Throw error, prevent launch |
| Non-ASCII temp path | Auto-detect, fallback to `C:\codesys-mcp-tmp` | Transparent fallback |

### Python Script Layer

| Error Type | Handling | Recovery |
|-----------|----------|----------|
| `SystemExit(0)` from IPC exec | Watcher catches, treats as success | Normal flow |
| `SystemExit(non-zero)` from IPC exec | Watcher catches, treats as failure | Error in result |
| `SCRIPT_ERROR` marker | Parsed by TypeScript layer | `isError: true` in MCP response |
| `online.create_online_application()` fails | 4 fallback creation methods | Next method attempted |
| `login()` fails | 3 fallback parameter combinations | Next method attempted |
| `set_prepared_value()` fails | Try with original string, then `force_prepared_values()` | Next method attempted |
| Project not open | `ensure_project_open` with retry logic | Reopen with `projects.open()` |

### Potential Technical Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **CODESYS version incompatibility** | Scripting API may differ between CODESYS versions | Multiple fallback methods for each API call; tested on 3.5.19.50 |
| **`exec()` context limitations** | Some CODESYS internal state may not initialize properly in `exec()` context | 4 fallback methods for online_application creation; `--runscript` for full context |
| **Project file locking** | Multiple CODESYS instances cannot open the same project | Single persistent instance; headless mode checks for locks |
| **Gateway service crash** | PLC communication fails silently | User must check Windows Services; error messages include service names |
| **Non-ASCII Windows username** | IPC temp directory path may cause IronPython encoding errors | Auto-fallback to `C:\codesys-mcp-tmp` |
| **CODESYS modal dialogs** | UI-blocking dialogs prevent script execution | User must dismiss; health monitor detects hung state |
| **Large project compilation** | May exceed default 60s timeout | 120s timeout for compile; configurable via `--timeout` |
| **Memory leak in long session** | CODESYS IDE may consume increasing memory over time | Recommend periodic `shutdown_codesys` + `launch_codesys` cycle |
| **IronPython 2.7 limitations** | No f-strings, no `async/await`, limited stdlib | All scripts use Python 2-compatible syntax |
| **Concurrent tool calls** | CODESYS scripting API is not thread-safe | Async mutex serializes all commands |

## Detect Installed Versions

```bash
codesys-mcp-persistent --detect
```

Scans `Program Files` and `Program Files (x86)` for CODESYS installations.

## Troubleshooting

**CODESYS not found**
Verify the path with `--detect`. The executable is typically at:
`C:\Program Files\CODESYS 3.5.XX.X\CODESYS\Common\CODESYS.exe`

**Project file locked**
Another CODESYS instance may have the project open. Close it first or use persistent mode so there's only one instance.

**Watcher timeout (persistent mode)**
If the watcher doesn't signal ready within 60 seconds, check:
- CODESYS path and profile are correct
- No modal dialogs are blocking CODESYS startup
- Try `--verbose` for detailed logging

**UI briefly pauses during commands (persistent mode)**
The watcher uses a background thread that marshals work onto the UI thread, so the UI stays responsive between commands. During synchronous CODESYS API calls (compile, project open), the UI may briefly pause — this is expected and normal. If a command hangs, check the CODESYS messages window for modal dialogs or errors.

**Command timeout**
Default is 60s (120s for compile and download). Increase with `--timeout <ms>`. Check CODESYS messages window for errors.

**Online/runtime tools fail**
The online tools (`connect_to_device`, `read_variable`, etc.) require:
- A device/gateway configured in the CODESYS project
- The project to be compiled successfully before connecting
- A reachable PLC or CODESYS SoftPLC runtime
- CODESYS Gateway V3 and CODESYS Control Win V3 services running

**`write_variable` fails with type error**
Ensure the value string is convertible to the target PLC type. The server auto-converts:
- `"TRUE"`, `"yes"`, `"1"`, `"on"` → Python `True` → PLC `BOOL#TRUE`
- `"FALSE"`, `"no"`, `"0"`, `"off"` → Python `False` → PLC `BOOL#FALSE`
- Integer strings → Python `int` → PLC `INT`/`DINT`/etc.
- Float strings → Python `float` → PLC `REAL`/`LREAL`
- Other strings → passed as-is to CODESYS

**CODESYS crashes or hangs**
- Kill the process: `Get-Process -Name "CODESYS" | Stop-Process -Force`
- The server's health monitor will detect the crash within 5 seconds
- If using persistent mode, the server transitions to `error` state; call `launch_codesys` to restart

## Development

```bash
# Install dependencies
npm install

# Build (compiles TypeScript + copies Python scripts)
npm run build

# Run all tests (35 unit tests)
npm test

# Type check only
npm run typecheck

# Run tests in watch mode
npm run test:watch
```

### Project Structure

```
src/
  bin.ts              CLI entry point
  server.ts           MCP tool/resource registration (28 tools, 3 resources)
  launcher.ts         CODESYS process management (persistent mode)
  ipc.ts              File-based IPC transport (atomic writes, polling)
  headless.ts         Headless fallback executor (spawn-per-command)
  script-manager.ts   Python template loading + variable interpolation
  types.ts            Shared TypeScript types
  logger.ts           Structured stderr logging
  scripts/            Python scripts (watcher + 2 helpers + 25 tool scripts)
    watcher.py              Background polling thread for IPC
    ensure_project_open.py  Shared: project open with retry logic
    ensure_online_connection.py  Shared: online connection with fallbacks
    find_object_by_path.py Shared: project tree navigation
    connect_to_device.py   Device connection (IPC-compatible, 4 fallback methods)
    write_variable.py      Variable writing (set_prepared_value + write_prepared_values)
    read_variable.py       Variable reading (read_value)
    compile_project.py     Project compilation
    get_compile_messages.py  Compiler message retrieval
    ... (other tool scripts)
tests/
  unit/               Unit tests (IPC, script manager, launcher)
  integration/        Integration tests (script pipeline, manual CODESYS tests)
  mock_watcher.py     Standalone watcher for testing without CODESYS
```

### Adding a New MCP Tool

1. Create a Python script in `src/scripts/<tool_name>.py` using `{PLACEHOLDER}` tokens for parameters
2. If the tool needs project/online access, use `ensure_project_open()` and `ensure_online_connection()` helpers
3. Print `SCRIPT_SUCCESS: <message>` on success, `SCRIPT_ERROR: <message>` on failure
4. Use `sys.exit(0)` for success, `sys.exit(1)` for failure
5. Register the tool in `src/server.ts` using `s.tool(name, description, schema, handler)`
6. Use `scriptManager.prepareScriptWithHelpers()` for scripts that need shared helpers
7. Add unit tests in `tests/unit/`

### Python Script Template

```python
import sys
import traceback

PARAMETER = "{PARAMETER}"

try:
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    # ... tool-specific logic ...
    print("Result: ...")
    print("SCRIPT_SUCCESS: Operation completed.")
    sys.exit(0)
except SystemExit:
    raise
except Exception as e:
    error_detail = traceback.format_exc()
    print("SCRIPT_ERROR: %s" % e)
    sys.exit(1)
```

## License

MIT
