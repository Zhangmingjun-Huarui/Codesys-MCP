# encoding:utf-8
from __future__ import print_function
import sys

output_file = r"D:\Codesys-MCP-main\Codesys-MCP-main\test_output.txt"

def log(msg):
    with open(output_file, "a") as f:
        f.write(msg + "\n")
    print(msg)

log("Starting test_connect_direct.py...")

try:
    if projects.primary:
        projects.primary.close()
        log("Closed existing project.")

    proj = projects.open(r"D:\Codesys-MCP-main\Codesys-MCP-main\AccumulatorProject.project")
    log("Project opened: %s" % proj.path)

    app = proj.active_application
    log("Active application: %s" % app.get_name())

    log("Creating online application...")
    onlineapp = online.create_online_application(app)
    log("Online app created successfully!")

    log("Logging in...")
    onlineapp.login(OnlineChangeOption.Try, True)
    log("Login successful!")

    if not onlineapp.application_state == ApplicationState.run:
        onlineapp.start()
        log("Application started!")

    system.delay(1000)

    value = onlineapp.read_value("PLC_PRG.nAccumulator")
    log("nAccumulator value: %s" % value)

    cycle = onlineapp.read_value("PLC_PRG.nCycleCount")
    log("nCycleCount value: %s" % cycle)

    onlineapp.logout()
    log("Logged out.")

    proj.close()
    log("Project closed.")
    log("SCRIPT_SUCCESS: All operations completed successfully.")
except Exception as e:
    log("ERROR: %s" % str(e))
    import traceback
    log(traceback.format_exc())
    sys.exit(1)
