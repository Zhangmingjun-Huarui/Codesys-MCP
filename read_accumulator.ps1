param(
    [string]$ProjectPath = "D:\Codesys-MCP-main\Codesys-MCP-main\AccumulatorProject.project",
    [string]$VariableName = "PLC_PRG.nAccumulator",
    [string]$OutputFile = "D:\Codesys-MCP-main\Codesys-MCP-main\variable_value.txt"
)

$codesysExe = "C:\Program Files\CODESYS 3.5.19.50\CODESYS\Common\CODESYS.exe"
$profile = "CODESYS V3.5 SP19 Patch 5"
$scriptPath = "D:\Codesys-MCP-main\Codesys-MCP-main\read_variable_script.py"

$scriptContent = @"
# encoding:utf-8
from __future__ import print_function
import sys

output_file = r"$OutputFile"

def log(msg):
    with open(output_file, "a") as f:
        f.write(msg + "\n")
    print(msg)

try:
    if projects.primary:
        projects.primary.close()

    proj = projects.open(r"$ProjectPath")
    log("Project opened: %s" % proj.path)

    app = proj.active_application
    log("Active application: %s" % app.get_name())

    onlineapp = online.create_online_application(app)
    log("Online app created.")

    onlineapp.login(OnlineChangeOption.Try, True)
    log("Login successful.")

    if not onlineapp.application_state == ApplicationState.run:
        onlineapp.start()
        log("Application started.")
    else:
        log("Application already running.")

    system.delay(500)

    value = onlineapp.read_value("$VariableName")
    log("VALUE: %s" % value)

    onlineapp.logout()
    log("Logged out.")

    proj.close()
    log("SCRIPT_SUCCESS")
except Exception as e:
    log("ERROR: %s" % str(e))
    import traceback
    log(traceback.format_exc())
    try:
        proj.close()
    except:
        pass
    sys.exit(1)
"@

Set-Content -Path $scriptPath -Value $scriptContent -Encoding UTF8

if (Test-Path $OutputFile) {
    Remove-Item $OutputFile -Force
}

$proc = Start-Process -FilePath $codesysExe -ArgumentList "--profile=`"$profile`"", "--runscript=`"$scriptPath`"" -PassThru -NoNewWindow

$timeout = 60
$elapsed = 0
while (-not (Test-Path $OutputFile) -and $elapsed -lt $timeout) {
    Start-Sleep -Seconds 1
    $elapsed++
}

if (Test-Path $OutputFile) {
    Get-Content $OutputFile
} else {
    Write-Host "Timeout waiting for output"
}

if (-not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}
