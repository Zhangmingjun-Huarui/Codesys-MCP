param(
    [string]$CodesysPath = 'C:\Program Files\CODESYS 3.5.19.50\CODESYS\Common\CODESYS.exe',
    [string]$CodesysProfile = 'CODESYS V3.5 SP19 Patch 5',
    [string]$ProjectDir = 'D:\Codesys-MCP-Test',
    [string]$ProjectName = 'PersistentDataTest',
    [string]$McpServerPath = 'D:\Codesys-MCP-main\Codesys-MCP-main\dist\bin.js'
)

$ErrorActionPreference = 'Stop'

$ProjectFile = Join-Path $ProjectDir "$ProjectName.project"

if (-not (Test-Path $ProjectDir)) {
    New-Item -ItemType Directory -Path $ProjectDir -Force | Out-Null
}

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  CODESYS MCP Persistent Mode Test' -ForegroundColor Cyan
Write-Host '  Data Persistence Test Program' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''
Write-Host "Project: $ProjectFile" -ForegroundColor Yellow
Write-Host "CODESYS: $CodesysPath" -ForegroundColor Yellow
Write-Host "Profile: $CodesysProfile" -ForegroundColor Yellow
Write-Host ''

Write-Host '[Step 1/7] Verifying CODESYS installation...' -ForegroundColor Green
if (-not (Test-Path $CodesysPath)) {
    Write-Host "ERROR: CODESYS not found at: $CodesysPath" -ForegroundColor Red
    Write-Host 'Run node dist/bin.js --detect to find installed versions.' -ForegroundColor Yellow
    exit 1
}
Write-Host "  CODESYS found: $CodesysPath" -ForegroundColor Gray

Write-Host '[Step 2/7] Verifying MCP server build...' -ForegroundColor Green
if (-not (Test-Path $McpServerPath)) {
    Write-Host 'ERROR: MCP server not built. Run npm run build first.' -ForegroundColor Red
    exit 1
}
Write-Host "  MCP server found: $McpServerPath" -ForegroundColor Gray

Write-Host '[Step 3/7] Checking project directory...' -ForegroundColor Green
if (Test-Path $ProjectFile) {
    Write-Host "  Existing project found, removing: $ProjectFile" -ForegroundColor Yellow
    Remove-Item $ProjectFile -Force
}
Write-Host "  Project directory: $ProjectDir" -ForegroundColor Gray

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  Manual Test Instructions' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''
Write-Host 'The CODESYS MCP server needs to be started by an MCP client (e.g., Claude Code).'
Write-Host 'Follow these steps to test the persistent mode with data persistence:'
Write-Host ''
Write-Host '1. Start MCP server in persistent mode:' -ForegroundColor Yellow
Write-Host "   node $McpServerPath --codesys-path $CodesysPath --codesys-profile $CodesysProfile --mode persistent --workspace $ProjectDir --verbose" -ForegroundColor White
Write-Host ''
Write-Host '2. Use MCP tools to create the test project:' -ForegroundColor Yellow
Write-Host '   a) create_project  -> filePath: PROJECT_FILE' -ForegroundColor White
Write-Host '   b) create_dut      -> name: ST_DataRecord, dutType: Structure, parentPath: Application' -ForegroundColor White
Write-Host '   c) create_gvl      -> name: GVL_Test, parentPath: Application' -ForegroundColor White
Write-Host '   d) create_pou      -> name: FB_PersistentData, type: FunctionBlock, language: ST, parentPath: Application' -ForegroundColor White
Write-Host '   e) create_pou      -> name: PLC_PRG, type: Program, language: ST, parentPath: Application' -ForegroundColor White
Write-Host ''
Write-Host '3. Set code for each POU using set_pou_code:' -ForegroundColor Yellow
Write-Host '   Source files are in: test_programs/' -ForegroundColor White
Write-Host '   - FB_PersistentData_decl.st  -> declarationCode' -ForegroundColor White
Write-Host '   - FB_PersistentData_impl.st  -> implementationCode' -ForegroundColor White
Write-Host '   - PLC_PRG_decl.st            -> declarationCode' -ForegroundColor White
Write-Host '   - PLC_PRG_impl.st            -> implementationCode' -ForegroundColor White
Write-Host '   - GVL_Test_decl.st           -> declarationCode' -ForegroundColor White
Write-Host ''
Write-Host '4. Compile the project:' -ForegroundColor Yellow
Write-Host '   compile_project -> projectFilePath: PROJECT_FILE' -ForegroundColor White
Write-Host ''
Write-Host '5. Connect to device and download:' -ForegroundColor Yellow
Write-Host '   connect_to_device -> projectFilePath: PROJECT_FILE' -ForegroundColor White
Write-Host '   download_to_device -> projectFilePath: PROJECT_FILE' -ForegroundColor White
Write-Host '   start_stop_application -> action: start' -ForegroundColor White
Write-Host ''
Write-Host '6. Test data persistence:' -ForegroundColor Yellow
Write-Host '   a) read_variable  -> variablePath: PLC_PRG.fbData._nCounter' -ForegroundColor White
Write-Host '   b) write_variable -> variablePath: PLC_PRG.fbData._nCounter, value: 999' -ForegroundColor White
Write-Host '   c) read_variable  -> variablePath: PLC_PRG.fbData._nCounter (verify: 999)' -ForegroundColor White
Write-Host '   d) start_stop_application -> action: stop' -ForegroundColor White
Write-Host '   e) start_stop_application -> action: start' -ForegroundColor White
Write-Host '   f) read_variable  -> variablePath: PLC_PRG.fbData._nCounter (verify: still 999)' -ForegroundColor White
Write-Host ''
Write-Host '7. Verify RETAIN persistence (warm restart):' -ForegroundColor Yellow
Write-Host '   RETAIN variables should survive a warm restart of the PLC.' -ForegroundColor White
Write-Host '   The _retain_Counter should retain its value after stop/start cycle.' -ForegroundColor White
Write-Host ''
Write-Host '8. Shutdown:' -ForegroundColor Yellow
Write-Host '   shutdown_codesys' -ForegroundColor White
Write-Host ''

$testProgramDir = 'D:\Codesys-MCP-main\Codesys-MCP-main\test_programs'
Write-Host 'Test program source files:' -ForegroundColor Green
Get-ChildItem $testProgramDir -Filter '*.st' | ForEach-Object {
    Write-Host "  $($_.Name)" -ForegroundColor Gray
}
